import {controlInfo,revokeControlStatements} from './radio-controls.mjs';
import {json,digest,mac,encrypt,decrypt,randomHex,HttpError,limit,readJson,session,browserWrite,otp,human} from './security.mjs';
import {savedInventory} from './saved-inventory.mjs';

// Base phone grants permit station additions only. Controls require a separate physical approval. Device secrets never reach browsers.
export async function phoneRoutes(request,env,now,deps={human}) {
  const path=new URL(request.url).pathname;
  if(!path.startsWith('/api/phone/'))return null;
  if(request.method==='GET'&&path==='/api/phone/radios'){
    const current=await session(request,env,now);
    const rows=await env.DB.prepare(`SELECT r.id,r.name,r.last_seen,rp.code_hash,rp.code_encrypted,(SELECT s.name FROM listening_sessions l JOIN stations s ON s.code=l.station_code WHERE l.radio_id=r.id AND l.last_seen>${now-90}) AS current_station FROM phone_radios p JOIN radios r ON r.id=p.radio_id
      LEFT JOIN radio_pairs rp ON rp.radio_id=r.id AND (rp.expires=0 OR rp.expires>?)
      WHERE p.session_hash=? AND p.expires>? ORDER BY r.name`).bind(now,current.token_hash,now).all();
    const radios=await Promise.all(rows.results.map(async r=>{
      let device_code=null;
      if(r.code_encrypted)try{
        const code=await decrypt(env,r.code_encrypted);
        if(/^(?:[0-9]{4,8}|[A-Z0-9]{8})$/.test(code)&&await mac(env,'device-code:'+code)===r.code_hash)device_code=code;
      }catch{} // Legacy or unauthenticated stored values never become a displayed code.
      const info=await controlInfo(env,current.token_hash,r.id,now);
      return {id:r.id,name:r.name,last_seen:r.last_seen,current_station:r.current_station,online:r.last_seen>now-120,device_code,...(info||{})};
    }));
    const response=json({radios});
    if(current.setCookie)response.headers.set('Set-Cookie',current.setCookie);
    return response;
  }
  if(request.method==='GET'&&path==='/api/phone/stations'){
    const current=await session(request,env,now),id=new URL(request.url).searchParams.get('radio_id')||'';
    const grant=await env.DB.prepare('SELECT 1 FROM phone_radios WHERE radio_id=? AND session_hash=? AND expires>?').bind(id,current.token_hash,now).first();if(!grant)throw new HttpError(403,'Link this radio first.');
    const rows=await env.DB.prepare("SELECT DISTINCT station_code FROM radio_commands WHERE radio_id=? AND state='added' LIMIT 1000").bind(id).all();
    const inventory=await savedInventory(env,id);
    const response=json({confirmed_station_codes:rows.results.map(r=>String(r.station_code)),...inventory,
      note:inventory.inventory_reported_at===null?'This radio has not reported its saved stations yet.':'Published directory stations saved on this radio at its last report.'});
    if(current.setCookie)response.headers.set('Set-Cookie',current.setCookie);
    return response;
  }
  if(request.method!=='POST')throw new HttpError(405,'Method not allowed.');
  const current=await browserWrite(request,env,now),body=await readJson(request);
  const ip=request.headers.get('CF-Connecting-IP')||'unknown';
  if(path==='/api/phone/unlink'){
    const id=String(body.radio_id||'');await env.DB.batch([...revokeControlStatements(env,id,current.token_hash),env.DB.prepare('DELETE FROM phone_radios WHERE session_hash=? AND radio_id=?').bind(current.token_hash,id)]);
    return json({status:'ok'});
  }
  if(path==='/api/phone/logout'){
    await env.DB.batch([env.DB.prepare("UPDATE pair_claims SET state='cancelled' WHERE session_hash=? AND state IN ('waiting','approved')").bind(current.token_hash),env.DB.prepare('DELETE FROM radio_control_grants WHERE session_hash=?').bind(current.token_hash),env.DB.prepare('DELETE FROM phone_radios WHERE session_hash=?').bind(current.token_hash),env.DB.prepare('UPDATE sessions SET expires=? WHERE token_hash=?').bind(now,current.token_hash)]);return json({status:'ok'});
  }
  if(path==='/api/phone/claim'){
    await limit(env.DB,'claim-ip',ip,5,900,now);
    await limit(env.DB,'claim-global','all',60,60,now);
    await deps.human(request,env,body.turnstile_token,'radio-link',now);
    const code=String(body.device_code||'').replace(/[-\s]/g,'').toUpperCase();
    if(!/^(?:[0-9]{4,8}|[A-Z0-9]{8})$/.test(code))throw new HttpError(400,'Check the device code on your radio.');
    const codeHash=await mac(env,'device-code:'+code);
    const pair=await env.DB.prepare(`SELECT radio_id FROM radio_pairs WHERE code_hash=? AND (expires=0 OR expires>?)`)
      .bind(codeHash,now).first();
    if(!pair)throw new HttpError(400,'Check the device code on your radio.');
    await limit(env.DB,'claim-radio',pair.radio_id,5,900,now);
    await env.DB.prepare("UPDATE pair_claims SET state='expired' WHERE radio_id=? AND state='waiting' AND expires<=?")
      .bind(pair.radio_id,now).run();
    // An existing request is returned only to its initiating browser. Concurrent
    // requests cannot replace a number already shown for physical approval.
    const id=randomHex(16),check=otp().slice(0,4);
    await env.DB.prepare(`INSERT INTO pair_claims(id,radio_id,session_hash,confirmation_code,state,expires,created_at)
      VALUES (?,?,?,?,'waiting',?,?) ON CONFLICT DO NOTHING`)
      .bind(id,pair.radio_id,current.token_hash,check,now+180,now).run();
    const claim=await env.DB.prepare(`SELECT id,confirmation_code,session_hash FROM pair_claims
      WHERE radio_id=? AND state='waiting' AND expires>?`).bind(pair.radio_id,now).first();
    if(!claim||claim.session_hash!==current.token_hash)throw new HttpError(409,'Another request is waiting on this radio. Try again shortly.');
    // Backfill older radios only after a valid, rate-limited pairing request.
    await env.DB.prepare('UPDATE radio_pairs SET code_encrypted=? WHERE radio_id=? AND code_hash=? AND (expires=0 OR expires>?)')
      .bind(await encrypt(env,code),pair.radio_id,codeHash,now).run();
    return json({claim_id:claim.id,confirmation_code:claim.confirmation_code});
  }
  if(path==='/api/phone/claim/status'){
    await limit(env.DB,'claim-status',current.token_hash,40,60,now);
    const claim=await env.DB.prepare('SELECT state,expires,radio_id FROM pair_claims WHERE id=? AND session_hash=?')
      .bind(String(body.claim_id||''),current.token_hash).first();
    if(!claim)throw new HttpError(404,'Request not found.');
    return json({state:claim.expires<=now?'expired':claim.state,radio_id:claim.state==='approved'&&claim.expires>now?claim.radio_id:undefined});
  }
  if(path==='/api/phone/add'){
    await limit(env.DB,'phone-add',current.token_hash,20,60,now);
    const id=String(body.radio_id||''),code=String(body.station_code||'');
    const grant=await env.DB.prepare('SELECT 1 FROM phone_radios WHERE radio_id=? AND session_hash=? AND expires>?')
      .bind(id,current.token_hash,now).first();
    if(!grant)throw new HttpError(403,'Connect this phone to your radio first.');
    if(!/^[0-9]{2,6}$/.test(code)||!await env.DB.prepare("SELECT 1 FROM stations WHERE code=? AND status='published'").bind(Number(code)).first())
      throw new HttpError(404,'Station not found.');
    await env.DB.prepare("UPDATE radio_commands SET state='expired' WHERE radio_id=? AND expires<=? AND state IN ('pending','delivered')").bind(id,now).run();
    await env.DB.prepare(`INSERT INTO radio_commands(id,radio_id,station_code,state,created_at,expires)
      VALUES (?,?,?,'pending',?,?) ON CONFLICT DO NOTHING`).bind(randomHex(16),id,Number(code),now,now+300).run();
    const command=await env.DB.prepare(`SELECT id FROM radio_commands WHERE radio_id=? AND station_code=?
      AND state IN ('pending','delivered') AND expires>?`).bind(id,Number(code),now).first();
    if(!command)throw new HttpError(409,'Please try again.');
    return json({command_id:command.id,state:'pending'});
  }
  if(path==='/api/phone/command/status'){
    await limit(env.DB,'command-status',current.token_hash,40,60,now);
    const command=await env.DB.prepare(`SELECT c.state,c.expires FROM radio_commands c JOIN phone_radios p ON p.radio_id=c.radio_id
      WHERE c.id=? AND p.session_hash=? AND p.expires>?`).bind(String(body.command_id||''),current.token_hash,now).first();
    if(!command)throw new HttpError(404,'Request not found.');
    return json({state:['added','failed'].includes(command.state)?command.state:command.expires<=now?'expired':command.state});
  }
  throw new HttpError(404,'Not found.');
}
