import {json,session,browserWrite,readJson,limit,human,otp,mac,randomHex,encrypt,decrypt,digest,HttpError} from './security.mjs';
import {matchTotp} from './totp.mjs';
import {decisionReason,ownerNotification,commitOwnerNotification} from './notifications.mjs';
async function revision(env,row){return mac(env,'station-review:'+JSON.stringify(row));}
export async function adminRoutes(request,env,now,deps={human}){
 const path=new URL(request.url).pathname;if(!path.startsWith('/api/admin/'))return null;
 const current=request.method==='GET'?await session(request,env,now):await browserWrite(request,env,now);
 if(!env.ADMIN_EMAIL||!env.ADMIN_TOTP_SECRET)throw new HttpError(503,'Admin MFA is not configured.');
 const ip=request.headers.get('CF-Connecting-IP')||'unknown';
 if(path==='/api/admin/login'&&request.method==='POST'){
  await limit(env.DB,'admin-login-ip',ip,5,900,now);await limit(env.DB,'admin-login-global','all',10,900,now);
  const body=await readJson(request);await deps.human(request,env,body.turnstile_token,'admin-login',now);
  const id=randomHex(16),email=String(body.email||'').trim().toLowerCase();
  if(email===env.ADMIN_EMAIL.trim().toLowerCase()){
   const code=otp();await env.DB.batch([
    env.DB.prepare('UPDATE admin_email_proofs SET consumed_at=? WHERE session_hash=? AND consumed_at IS NULL').bind(now,current.token_hash),
    env.DB.prepare('UPDATE admin_verifications SET consumed_at=? WHERE session_hash=? AND consumed_at IS NULL').bind(now,current.token_hash),
    env.DB.prepare('INSERT INTO admin_verifications(id,session_hash,code_hash,expires,created_at) VALUES (?,?,?,?,?)').bind(id,current.token_hash,await mac(env,'admin:'+id+':'+code),now+600,now),
    env.DB.prepare('INSERT INTO mail_outbox(id,recipient,subject,encrypted_payload,due,expires) VALUES (?,?,?,?,?,?)').bind(randomHex(16),env.ADMIN_EMAIL,'Your Radio Locals admin code',await encrypt(env,JSON.stringify({text:'Your private Radio Locals admin code is '+code+'. It expires in 10 minutes and works once. Never share this code.'})),now,now+600)
   ]);
  }
  return json({verification_id:id,message:'If this is the administrator email, a code will arrive shortly.'});
 }
 if(path==='/api/admin/verify'&&request.method==='POST'){
  await limit(env.DB,'admin-verify-ip',ip,20,900,now);const body=await readJson(request),id=String(body.verification_id||''),code=String(body.code||'');
  if(!/^[a-f0-9]{32}$/.test(id)||!/^\d{6}$/.test(code))throw new HttpError(400,'Enter the six-digit email code.');
  const check=await env.DB.prepare(`UPDATE admin_verifications SET attempts=attempts+1 WHERE id=? AND session_hash=? AND consumed_at IS NULL AND expires>? AND attempts<5 RETURNING code_hash`).bind(id,current.token_hash,now).first();
  if(!check||check.code_hash!==await mac(env,'admin:'+id+':'+code))throw new HttpError(400,'Incorrect or expired code.');
  const proof=randomHex(16),marker='verified:'+proof;
  await env.DB.batch([
   env.DB.prepare('UPDATE admin_verifications SET consumed_at=?,code_hash=? WHERE id=? AND session_hash=? AND consumed_at IS NULL AND expires>? AND code_hash=?').bind(now,marker,id,current.token_hash,now,check.code_hash),
   env.DB.prepare(`INSERT INTO admin_email_proofs(id,session_hash,expires) SELECT ?,?,? WHERE EXISTS
    (SELECT 1 FROM admin_verifications WHERE id=? AND session_hash=? AND consumed_at=? AND code_hash=?)`).bind(proof,current.token_hash,now+300,id,current.token_hash,now,marker)
  ]);
  if(!await env.DB.prepare('SELECT 1 FROM admin_email_proofs WHERE id=? AND session_hash=?').bind(proof,current.token_hash).first())throw new HttpError(400,'Incorrect or expired code.');
  return json({status:'mfa_required',mfa_id:proof});
 }
 if(path==='/api/admin/mfa'&&request.method==='POST'){
  await limit(env.DB,'admin-mfa-ip',ip,20,900,now);const body=await readJson(request),id=String(body.mfa_id||'');
  if(!/^[a-f0-9]{32}$/.test(id))throw new HttpError(400,'Start sign-in again.');
  const proof=await env.DB.prepare(`UPDATE admin_email_proofs SET attempts=attempts+1 WHERE id=? AND session_hash=? AND consumed_at IS NULL AND expires>? AND attempts<5 RETURNING id`).bind(id,current.token_hash,now).first();
  if(!proof)throw new HttpError(400,'This sign-in expired. Start again.');
  const match=await matchTotp(env,body.authenticator_code,now);
  if(!match)throw new HttpError(400,'Incorrect or already-used authenticator code. Wait for the next code and try again.');
  // Only this attempt can see its random consumed-proof marker. Matching a
  // previously used TOTP step alone must never authorize a losing request.
  const marker='used:'+randomHex(16),applied='EXISTS (SELECT 1 FROM admin_email_proofs WHERE id=? AND session_hash=? AND consumed_at=?)',args=[marker,current.token_hash,now];
  await env.DB.batch([
   env.DB.prepare(`UPDATE admin_email_proofs SET id=?,consumed_at=? WHERE id=? AND session_hash=? AND consumed_at IS NULL AND expires>?
    AND NOT EXISTS (SELECT 1 FROM admin_mfa_used WHERE secret_hash=? AND counter=?)`).bind(marker,now,id,current.token_hash,now,match.secretHash,match.counter),
   env.DB.prepare(`INSERT INTO admin_mfa_used(secret_hash,counter) SELECT ?,? WHERE ${applied}`).bind(match.secretHash,match.counter,...args),
   env.DB.prepare(`INSERT INTO admin_sessions(session_hash,expires) SELECT ?,? WHERE ${applied} ON CONFLICT(session_hash) DO UPDATE SET expires=excluded.expires`).bind(current.token_hash,now+900,...args),
   env.DB.prepare(`INSERT INTO admin_mfa_sessions(session_hash,expires) SELECT ?,? WHERE ${applied} ON CONFLICT(session_hash) DO UPDATE SET expires=excluded.expires`).bind(current.token_hash,now+900,...args)
  ]);
  if(!await env.DB.prepare(`SELECT 1 FROM admin_email_proofs WHERE id=? AND session_hash=? AND consumed_at=?`).bind(...args).first())throw new HttpError(400,'Incorrect or already-used authenticator code. Wait for the next code and try again.');
  return json({status:'ok'});
 }
 const grant=await env.DB.prepare('SELECT 1 FROM admin_sessions a JOIN admin_mfa_sessions m ON m.session_hash=a.session_hash WHERE a.session_hash=? AND a.expires>? AND m.expires>?').bind(current.token_hash,now,now).first();
 if(!grant)throw new HttpError(401,'Please sign in as administrator.');
 if(path==='/api/admin/enrollment'&&request.method==='POST'){
  await limit(env.DB,'admin-enroll',current.token_hash,20,3600,now);const token=randomHex();
  await env.DB.prepare('INSERT INTO device_enrollments(token_hash,expires) VALUES (?,?)').bind(await digest(token),now+600).run();
  return json({enrollment_token:token,expires_in:600});
 }
 if(path==='/api/admin/legal'&&request.method==='GET'){
  const url=new URL(request.url),kind=url.searchParams.get('kind')||'all',cursor=url.searchParams.get('cursor');
  if(!['all','support','legal'].includes(kind))throw new HttpError(400,'Choose a request type.');
  let before=null,beforeId='';if(cursor!==null){if(!/^\d{1,16}:[a-f0-9]{32}$/.test(cursor))throw new HttpError(400,'Invalid request page.');const [stamp,id]=cursor.split(':');before=Number(stamp);beforeId=id;if(!Number.isSafeInteger(before))throw new HttpError(400,'Invalid request page.');}
  const rows=(await env.DB.prepare(`SELECT * FROM legal_requests
   WHERE (?='all' OR (?='support' AND kind='support') OR (?='legal' AND kind!='support'))
    AND (? IS NULL OR created_at<? OR (created_at=? AND id<?))
   ORDER BY created_at DESC,id DESC LIMIT 201`).bind(kind,kind,kind,before,before,before,beforeId).all()).results;
  const more=rows.length>200,page=rows.slice(0,200),last=page.at(-1);
  return json({requests:await Promise.all(page.map(async row=>({id:row.id,kind:row.kind,state:row.state,created_at:row.created_at,payload:JSON.parse(await decrypt(env,row.encrypted_payload))}))),has_more:more,next_cursor:more?last.created_at+':'+last.id:null});
 }
 if(path==='/api/admin/legal'&&request.method==='POST'){
  const body=await readJson(request);if(!['review','closed'].includes(body.state)||typeof body.notes!=='string'||body.notes.length>4000)throw new HttpError(400,'Check the request state and notes.');
  if(!await env.DB.prepare('SELECT 1 FROM legal_requests WHERE id=?').bind(String(body.id)).first())throw new HttpError(404,'Request not found.');
  await env.DB.batch([env.DB.prepare('UPDATE legal_requests SET state=? WHERE id=?').bind(body.state,body.id),env.DB.prepare('INSERT INTO legal_actions VALUES (?,?,?,?,?)').bind(randomHex(16),body.id,body.state,body.notes,now)]);return json({status:'ok'});
 }
 if(path==='/api/admin/videos'&&request.method==='GET')return json({videos:(await env.DB.prepare('SELECT * FROM help_videos ORDER BY id').all()).results});
 if(path==='/api/admin/videos'&&request.method==='POST'){
  const body=await readJson(request);if(body.action==='delete'){await env.DB.prepare('DELETE FROM help_videos WHERE id=?').bind(Number(body.id)).run();return json({status:'ok'});}
  if(!['setup','wifi','stations','troubleshooting'].includes(body.topic)||typeof body.title!=='string'||!body.title.trim()||body.title.length>100||typeof body.description!=='string'||body.description.length>500||!/^[-\w]{11}$/.test(body.video_id||''))throw new HttpError(400,'Enter a topic, title and valid YouTube video ID.');
  await env.DB.prepare('INSERT INTO help_videos(topic,title,description,video_id,created_at) SELECT ?,?,?,?,? WHERE (SELECT count(*) FROM help_videos)<50').bind(body.topic,body.title,body.description,body.video_id,now).run();return json({status:'ok'});
 }
 const art=path.match(/^\/api\/admin\/artwork\/([a-f0-9]{64}\.png)$/);
 if(art&&request.method==='GET'){
  const station=await env.DB.prepare("SELECT 1 FROM stations WHERE artwork_key=? AND status!='deleted'").bind(art[1]).first();
  const object=station&&env.MEDIA?await env.MEDIA.get('sanitized/'+art[1]):null;
  if(!object||object.customMetadata?.sanitizer_version!=='1')throw new HttpError(404,'Artwork not found.');
  return new Response(object.body,{headers:{'Content-Type':'image/png','Cache-Control':'private, no-store','X-Content-Type-Options':'nosniff','Content-Security-Policy':"default-src 'none'; sandbox"}});
 }
 if(path==='/api/admin/stations'&&request.method==='GET'){
  const rows=await env.DB.prepare("SELECT code,name,bio,stream_url,contact_email,artwork_key,status,email_verified_at,updated_at FROM stations WHERE status!='deleted' ORDER BY code LIMIT 1000").all();
  return json({stations:await Promise.all(rows.results.map(async row=>({...row,revision:await revision(env,row)})))});
 }
 if(path==='/api/admin/logout'&&request.method==='POST'){
  await env.DB.batch([env.DB.prepare('DELETE FROM admin_sessions WHERE session_hash=?').bind(current.token_hash),env.DB.prepare('DELETE FROM admin_mfa_sessions WHERE session_hash=?').bind(current.token_hash)]);return json({status:'ok'});
 }
 if(path==='/api/admin/station'&&request.method==='POST'){
  await limit(env.DB,'admin-actions',current.token_hash,60,900,now);const body=await readJson(request);
  if(!['approve','reject','delete'].includes(body.action))throw new HttpError(400,'Choose an action.');
  const row=await env.DB.prepare('SELECT code,name,bio,stream_url,contact_email,artwork_key,status,email_verified_at,updated_at FROM stations WHERE code=?').bind(Number(body.code)).first();
  if(!row||row.status==='deleted')throw new HttpError(404,'Station not found.');
  if(body.revision!==await revision(env,row))throw new HttpError(409,'Station changed. Refresh and review it again.');
  if(body.action==='approve'&&(!row.email_verified_at||row.status!=='pending_review'))throw new HttpError(400,'Only email-verified stations awaiting review can be approved.');
  const status={approve:'published',reject:'suspended',delete:'deleted'}[body.action];
  const reason=decisionReason(body.reason,body.action==='reject'?'Please review the station details and artwork and submit an update for review.':'');
  if(row.status===status)return json({status:'ok',notification_queued:false});
  const notice=row.email_verified_at?await ownerNotification(env,{kind:{approve:'station-approved',reject:'station-needs-changes',delete:'station-removed'}[body.action],stationCode:row.code,recipient:row.contact_email,event:await revision(env,row),reason}):null;
  // Compare every reviewed field in SQL too: edits arriving after the revision
  // check must not be published without having been reviewed.
  const changed=await commitOwnerNotification(env,now,env.DB.prepare(`UPDATE stations SET status=?,updated_at=? WHERE code=? AND name=? AND bio=? AND stream_url=? AND contact_email=? AND artwork_key IS ? AND status=? AND email_verified_at IS ? AND updated_at=?`)
   .bind(status,Math.max(now,row.updated_at+1),row.code,row.name,row.bio,row.stream_url,row.contact_email,row.artwork_key,row.status,row.email_verified_at,row.updated_at),notice,[
   {sql:'INSERT INTO admin_audit(id,actor_hash,station_code,action,created_at) SELECT ?,?,?,?,? WHERE OWNER_NOTIFICATION_APPLIED',values:[randomHex(16),current.token_hash,row.code,body.action,now]},
   {sql:"UPDATE radio_commands SET state='failed' WHERE station_code=? AND state IN ('pending','delivered') AND ?!='published' AND OWNER_NOTIFICATION_APPLIED",values:[row.code,status]}
  ]);
  if(!changed)throw new HttpError(409,'Station changed. Refresh and review it again.');
  return json({status:'ok',notification_queued:Boolean(notice?.queued)});
 }
 throw new HttpError(404,'Not found.');
}
