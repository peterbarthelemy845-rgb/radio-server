import {json,readJson,limit,browserWrite,digest,randomHex,otp,HttpError} from './security.mjs';

const identifier=value=>typeof value==='string'&&/^[a-f0-9]{32}$/.test(value);
function stationCode(value){if(typeof value==='string'&&/^[0-9]{2,6}$/.test(value))value=Number(value);return Number.isSafeInteger(value)&&value>=10&&value<=999999?value:null;}
export function telemetryStatements(env,id,body,now){
 const version=body.firmware_version;
 if(version!==undefined&&(typeof version!=='string'||!/^[A-Za-z0-9][A-Za-z0-9._+-]{0,31}$/.test(version)))throw new HttpError(400,'Invalid radio software version.');
 if(body.remote_control_version!==undefined&&body.remote_control_version!==1&&body.remote_control_version!==0)throw new HttpError(400,'Invalid radio control version.');
 if(body.volume_percent!==undefined&&(!Number.isInteger(body.volume_percent)||body.volume_percent<0||body.volume_percent>100))throw new HttpError(400,'Invalid radio volume.');
 if(body.muted!==undefined&&typeof body.muted!=='boolean')throw new HttpError(400,'Invalid radio mute state.');
 let code=null;if(body.current_station_code!==undefined&&!['',0,'0',null].includes(body.current_station_code)){code=stationCode(body.current_station_code);if(code===null)throw new HttpError(400,'Invalid current station code.');}
 // A legacy poll clears capability rather than leaving an old green control UI.
 return [env.DB.prepare(`INSERT INTO radio_telemetry(radio_id,firmware_version,remote_control_version,volume_percent,muted,current_station_code,reported_at,current_station_reported)
  VALUES (?,?,?,?,?,?,?,?) ON CONFLICT(radio_id) DO UPDATE SET firmware_version=excluded.firmware_version,
  remote_control_version=excluded.remote_control_version,volume_percent=excluded.volume_percent,muted=excluded.muted,
  current_station_code=excluded.current_station_code,reported_at=excluded.reported_at,current_station_reported=excluded.current_station_reported
  WHERE excluded.reported_at>=radio_telemetry.reported_at`).bind(id,version||null,body.remote_control_version===1?1:0,body.volume_percent??null,body.muted===undefined?null:Number(body.muted),code,now,Number(Object.hasOwn(body,'current_station_code')))];
}
export async function controlInfo(env,sessionHash,id,now){
 const row=await env.DB.prepare(`SELECT t.*,s.name AS station_name,
  EXISTS(SELECT 1 FROM radio_control_grants c JOIN phone_radios p ON p.session_hash=c.session_hash AND p.radio_id=c.radio_id
   WHERE c.session_hash=? AND c.radio_id=t.radio_id AND c.expires>? AND p.expires>?) AS controls_allowed
  FROM radio_telemetry t LEFT JOIN stations s ON s.code=t.current_station_code AND s.status='published' WHERE t.radio_id=?`).bind(sessionHash,now,now,id).first();
 if(!row?.firmware_version&&!row?.remote_control_version)return null;
 return {firmware_version:row.firmware_version,remote_control_version:row.remote_control_version,volume_percent:row.volume_percent,
  muted:row.muted===null?null:Boolean(row.muted),current_station_code:row.station_name?String(row.current_station_code):null,
  ...(row.current_station_reported||row.current_station_code!==null?{current_station:row.station_name||null}:{}),controls_allowed:Boolean(row.controls_allowed),telemetry_reported_at:row.reported_at,
  controls_ready:row.remote_control_version===1&&row.reported_at>now-30};
}
async function linked(env,id,hash,now,control=false){
 const grant=await env.DB.prepare(`SELECT p.expires FROM phone_radios p ${control?'JOIN radio_control_grants c ON c.session_hash=p.session_hash AND c.radio_id=p.radio_id AND c.expires>?':''}
  WHERE p.radio_id=? AND p.session_hash=? AND p.expires>?`).bind(...(control?[now]:[]),id,hash,now).first();
 if(!grant)throw new HttpError(403,control?'Approve phone controls on your radio first.':'Connect this phone to your radio first.');return grant;
}
async function capable(env,id,now){
 const state=await env.DB.prepare(`SELECT t.reported_at FROM radio_telemetry t JOIN radios r ON r.id=t.radio_id
  WHERE t.radio_id=? AND t.remote_control_version=1 AND t.reported_at>? AND r.last_seen>?`).bind(id,now-30,now-30).first();
 if(!state)throw new HttpError(409,'Radio controls are unavailable. Check power, Wi-Fi and radio software.');
}
export async function controlRoutes(request,env,now){
 const path=new URL(request.url).pathname;if(!['/api/phone/control','/api/phone/control/authorize','/api/phone/control/status'].includes(path))return null;
 if(request.method!=='POST')throw new HttpError(405,'Method not allowed.');
 const current=await browserWrite(request,env,now),body=await readJson(request,4096);
 if(path==='/api/phone/control/status'){
  await limit(env.DB,'phone-control-status',current.token_hash,60,60,now);
  const command=await env.DB.prepare(`SELECT c.state,c.expires FROM radio_control_commands c
   JOIN phone_radios p ON p.radio_id=c.radio_id AND p.session_hash=c.session_hash
   JOIN radio_control_grants g ON g.radio_id=c.radio_id AND g.session_hash=c.session_hash
   WHERE c.id=? AND c.session_hash=? AND p.expires>? AND g.expires>?`).bind(String(body.command_id||''),current.token_hash,now,now).first();
  if(!command)throw new HttpError(404,'Command not found.');
  return json({state:['applied','failed'].includes(command.state)?command.state:command.expires<=now?'expired':command.state});
 }
 const id=String(body.radio_id||'');if(!identifier(id))throw new HttpError(400,'Choose a linked radio.');
 const grant=await linked(env,id,current.token_hash,now,path==='/api/phone/control');await capable(env,id,now);
 if(path==='/api/phone/control/authorize'){
  await limit(env.DB,'control-authorize-phone',current.token_hash,5,900,now);await limit(env.DB,'control-authorize-radio',id,5,900,now);
  const claim=randomHex(16),check=otp().slice(0,4);
  await env.DB.batch([
   env.DB.prepare("UPDATE pair_claims SET state='expired' WHERE radio_id=? AND state='waiting' AND expires<=?").bind(id,now),
   env.DB.prepare(`INSERT INTO pair_claims(id,radio_id,session_hash,confirmation_code,state,expires,created_at)
    SELECT ?,?,?,?,'waiting',?,? WHERE EXISTS(SELECT 1 FROM phone_radios WHERE session_hash=? AND radio_id=? AND expires>?) ON CONFLICT DO NOTHING`).bind(claim,id,current.token_hash,check,now+180,now,current.token_hash,id,now),
   env.DB.prepare('INSERT INTO radio_control_claims(claim_id) SELECT id FROM pair_claims WHERE id=? ON CONFLICT DO NOTHING').bind(claim)
  ]);
  const row=await env.DB.prepare(`SELECT c.id,c.confirmation_code,c.session_hash,sc.claim_id FROM pair_claims c LEFT JOIN radio_control_claims sc ON sc.claim_id=c.id WHERE c.radio_id=? AND c.state='waiting' AND c.expires>?`).bind(id,now).first();
  if(!row||row.session_hash!==current.token_hash||!row.claim_id)throw new HttpError(409,'Another request is waiting on this radio. Try again shortly.');
  return json({claim_id:row.id,confirmation_code:row.confirmation_code,scope:'control',expires_in:180});
 }
 await limit(env.DB,'phone-control',current.token_hash,30,60,now);await limit(env.DB,'radio-control',id,30,60,now);
 if(typeof body.request_id!=='string'||!/^[-A-Za-z0-9_]{16,128}$/.test(body.request_id))throw new HttpError(400,'A valid command request reference is required.');
 const action=body.action;let value=body.value;
 if(action==='select_station'){
  value=stationCode(value);if(value===null)throw new HttpError(400,'Choose a saved station.');
  const saved=await env.DB.prepare(`SELECT 1 FROM radio_station_inventory i,json_each(i.station_codes_json) c JOIN stations s ON s.code=c.value AND s.status='published' WHERE i.radio_id=? AND s.code=? AND i.reported_at>?`).bind(id,value,now-120).first();
  if(!saved)throw new HttpError(409,'This station is not in the radio’s latest saved list.');
 }else if(action==='set_volume'){if(!Number.isInteger(value)||value<0||value>100)throw new HttpError(400,'Volume must be a number from 0 to 100.');}
 else if(action==='set_mute'){if(typeof value!=='boolean')throw new HttpError(400,'Choose mute or unmute.');}
 else throw new HttpError(400,'This radio action is not supported.');
 const hash=await digest(JSON.stringify([action,value]));
 const existing=await env.DB.prepare('SELECT id,request_hash,state,expires FROM radio_control_commands WHERE session_hash=? AND radio_id=? AND request_id=?').bind(current.token_hash,id,body.request_id).first();
 if(existing){if(existing.request_hash!==hash)throw new HttpError(409,'This request reference was already used for another command.');return json({command_id:existing.id,state:existing.expires<=now&&!['applied','failed'].includes(existing.state)?'expired':existing.state,duplicate:true});}
 const commandId=randomHex(16);
 await env.DB.batch([
  env.DB.prepare("UPDATE radio_control_commands SET state='expired' WHERE radio_id=? AND expires<=? AND state IN ('pending','delivered')").bind(id,now),
  env.DB.prepare(`INSERT INTO radio_control_commands(id,session_hash,radio_id,request_id,request_hash,action,value_json,state,created_at,expires)
   SELECT ?,?,?,?,?,?,?,'pending',?,? WHERE EXISTS(SELECT 1 FROM phone_radios p JOIN radio_control_grants c ON c.session_hash=p.session_hash AND c.radio_id=p.radio_id
    WHERE p.session_hash=? AND p.radio_id=? AND p.expires>? AND c.expires>?) ON CONFLICT DO NOTHING`).bind(commandId,current.token_hash,id,body.request_id,hash,action,JSON.stringify(value),now,now+60,current.token_hash,id,now,now)
 ]);
 const accepted=await env.DB.prepare('SELECT id,request_hash,state FROM radio_control_commands WHERE session_hash=? AND radio_id=? AND request_id=?').bind(current.token_hash,id,body.request_id).first();
 if(!accepted)throw new HttpError(409,'Wait for the radio to finish the current command, then try again.');
 if(accepted.request_hash!==hash)throw new HttpError(409,'This request reference was already used for another command.');
 return json({command_id:accepted.id,state:accepted.state,duplicate:accepted.id!==commandId});
}
export function approvalStatements(env,id,claim,decision,body,now){
 const scope=body.pair_scope==='control'&&body.remote_control_version===1;
 return [
  env.DB.prepare(`UPDATE pair_claims SET state=CASE WHEN expires<=? THEN 'expired' WHEN ?='approve' THEN 'approved' ELSE 'denied' END
   WHERE id=? AND radio_id=? AND state='waiting' AND (?='deny' OR NOT EXISTS(SELECT 1 FROM radio_control_claims WHERE claim_id=pair_claims.id)
    OR (?=1 AND EXISTS(SELECT 1 FROM phone_radios p WHERE p.radio_id=pair_claims.radio_id AND p.session_hash=pair_claims.session_hash AND p.expires>?)))`).bind(now,decision,claim,id,decision,Number(scope),now),
  env.DB.prepare(`INSERT INTO phone_radios(session_hash,radio_id,expires)
   SELECT c.session_hash,c.radio_id,CASE WHEN EXISTS(SELECT 1 FROM radio_control_claims sc WHERE sc.claim_id=c.id)
    THEN (SELECT p.expires FROM phone_radios p WHERE p.session_hash=c.session_hash AND p.radio_id=c.radio_id) ELSE ? END
   FROM pair_claims c WHERE c.id=? AND c.radio_id=? AND c.state='approved' AND c.expires>? AND changes()>0
   ON CONFLICT(session_hash,radio_id) DO UPDATE SET expires=excluded.expires`).bind(now+2592000,claim,id,now),
  env.DB.prepare(`INSERT INTO radio_control_grants(session_hash,radio_id,approved_at,expires)
   SELECT p.session_hash,p.radio_id,?,p.expires FROM pair_claims c JOIN radio_control_claims sc ON sc.claim_id=c.id
   JOIN phone_radios p ON p.session_hash=c.session_hash AND p.radio_id=c.radio_id WHERE c.id=? AND c.radio_id=? AND c.state='approved' AND c.expires>? AND p.expires>? AND ?=1 AND changes()>0
   ON CONFLICT(session_hash,radio_id) DO UPDATE SET approved_at=excluded.approved_at,expires=excluded.expires`).bind(now,claim,id,now,now,Number(scope))
 ];
}
export async function pollControls(env,id,body,now){
 await env.DB.prepare("UPDATE radio_control_commands SET state='expired' WHERE radio_id=? AND expires<=? AND state IN ('pending','delivered')").bind(id,now).run();
 let acknowledged='';const ack=body.control_ack_id,status=body.control_ack_status;
 if(identifier(ack)&&['applied','failed'].includes(status)){
  await env.DB.prepare(`UPDATE radio_control_commands SET state=? WHERE id=? AND radio_id=? AND state IN ('pending','delivered') AND expires>?`).bind(status,ack,id,now).run();
  const row=await env.DB.prepare("SELECT id FROM radio_control_commands WHERE id=? AND radio_id=? AND state IN ('applied','failed','expired')").bind(ack,id).first();if(row)acknowledged=row.id;
 }
 let command=null,valid=null;
 if(body.remote_control_version===1){
  command=await env.DB.prepare(`UPDATE radio_control_commands SET state='delivered',lease=? WHERE id=(SELECT c.id FROM radio_control_commands c
   JOIN phone_radios p ON p.session_hash=c.session_hash AND p.radio_id=c.radio_id
   JOIN radio_control_grants g ON g.session_hash=c.session_hash AND g.radio_id=c.radio_id
   WHERE c.radio_id=? AND c.state IN ('pending','delivered') AND c.expires>? AND c.lease<=? AND p.expires>? AND g.expires>?
   AND NOT EXISTS(SELECT 1 FROM radio_commands a WHERE a.radio_id=c.radio_id AND a.state IN ('pending','delivered') AND a.expires>?)
   AND (c.action!='select_station' OR EXISTS(SELECT 1 FROM radio_station_inventory i,json_each(i.station_codes_json) v JOIN stations s ON s.code=v.value AND s.status='published'
    WHERE i.radio_id=c.radio_id AND s.code=CAST(c.value_json AS INTEGER) AND i.reported_at>?))
   ORDER BY c.created_at LIMIT 1) RETURNING id,action,value_json,expires`).bind(now+10,id,now,now,now,now,now,now-120).first();
  // A command already queued on the radio remains valid while its delivery
  // lease is busy. Check its permission separately so deferred work can be
  // discarded after one phone is unlinked, even if other phones stay linked.
  valid=await env.DB.prepare(`SELECT c.id FROM radio_control_commands c
   JOIN phone_radios p ON p.session_hash=c.session_hash AND p.radio_id=c.radio_id
   JOIN radio_control_grants g ON g.session_hash=c.session_hash AND g.radio_id=c.radio_id
   WHERE c.radio_id=? AND c.state IN ('pending','delivered') AND c.expires>? AND p.expires>? AND g.expires>?
   AND (c.action!='select_station' OR EXISTS(SELECT 1 FROM radio_station_inventory i,json_each(i.station_codes_json) v JOIN stations s ON s.code=v.value AND s.status='published'
    WHERE i.radio_id=c.radio_id AND s.code=CAST(c.value_json AS INTEGER) AND i.reported_at>?))
   ORDER BY c.created_at LIMIT 1`).bind(id,now,now,now,now-120).first();
  if(command&&command.id!==valid?.id)command=null;
 }
 return {control_command_id:command?.id||'',control_valid_id:valid?.id||'',control_action:command?.action||'',control_value:command?JSON.parse(command.value_json):null,control_expires_in:command?Math.max(0,command.expires-now):0,control_acknowledged_id:acknowledged};
}
export function revokeControlStatements(env,id,sessionHash=null){
 if(sessionHash)return [env.DB.prepare('DELETE FROM radio_control_grants WHERE radio_id=? AND session_hash=?').bind(id,sessionHash),env.DB.prepare("UPDATE radio_control_commands SET state='failed' WHERE radio_id=? AND session_hash=? AND state IN ('pending','delivered')").bind(id,sessionHash),env.DB.prepare("UPDATE pair_claims SET state='cancelled' WHERE radio_id=? AND session_hash=? AND state='waiting' AND EXISTS(SELECT 1 FROM radio_control_claims WHERE claim_id=pair_claims.id)").bind(id,sessionHash)];
 return [env.DB.prepare('DELETE FROM radio_control_grants WHERE radio_id=?').bind(id),env.DB.prepare("UPDATE radio_control_commands SET state='failed' WHERE radio_id=? AND state IN ('pending','delivered')").bind(id)];
}
