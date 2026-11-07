import {json,session,browserWrite,readJson,limit,human,otp,mac,encrypt,decrypt,randomHex,HttpError} from './security.mjs';

const referencePattern=/^[a-f0-9]{32}$/;
const emailPattern=/^[a-z0-9.!#$%&'*+/=?^_`{|}~-]{1,64}@(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/i;
const generic='If the email and ticket reference match, a private code will arrive shortly. Enter it here within 15 minutes.';
function reference(value){if(typeof value!=='string'||!referencePattern.test(value))throw new HttpError(400,'Enter the support ticket reference from your receipt.');return value;}
async function details(env,id,current,now){
 const item=await env.DB.prepare(`SELECT r.id,r.state,r.encrypted_payload,r.created_at FROM legal_requests r
   JOIN support_ticket_grants g ON g.ticket_id=r.id WHERE r.id=? AND r.kind='support' AND g.session_hash=? AND g.expires>?`).bind(id,current.token_hash,now).first();
 if(!item)throw new HttpError(403,'Verify your email to open this support ticket.');
 const payload=JSON.parse(await decrypt(env,item.encrypted_payload));
 const rows=(await env.DB.prepare(`SELECT encrypted_payload,created_at FROM support_replies WHERE ticket_id=? AND outbox_id IS NOT NULL ORDER BY created_at DESC,rowid DESC LIMIT 100`).bind(id).all()).results;
 const replies=await Promise.all(rows.reverse().map(async row=>({body:JSON.parse(await decrypt(env,row.encrypted_payload)).body,created_at:row.created_at})));
 const history=(await env.DB.prepare(`SELECT action AS state,created_at FROM legal_actions WHERE request_id=? AND action IN ('new','review','closed') ORDER BY created_at DESC,rowid DESC LIMIT 100`).bind(id).all()).results.reverse();
 // Deliberate allowlist: email address, device code and internal audit notes are not returned.
 return {ticket:{reference:item.id,state:item.state,subject:payload.subject,message:payload.message,created_at:item.created_at},replies,history};
}

export async function supportStatusRoutes(request,env,now,deps={human}){
 const url=new URL(request.url),path=url.pathname;
 if(!path.startsWith('/api/support/status/'))return null;
 if(request.method==='GET'){
  const current=await session(request,env,now);await limit(env.DB,'support-status-read',current.token_hash,60,60,now);
  if(path==='/api/support/status/recent'){
   const rows=(await env.DB.prepare(`SELECT r.id,r.state,r.encrypted_payload,r.created_at FROM support_ticket_grants g
    JOIN legal_requests r ON r.id=g.ticket_id WHERE g.session_hash=? AND g.expires>? AND r.kind='support' ORDER BY r.created_at DESC LIMIT 20`).bind(current.token_hash,now).all()).results;
   return json({tickets:await Promise.all(rows.map(async row=>({reference:row.id,state:row.state,created_at:row.created_at,subject:JSON.parse(await decrypt(env,row.encrypted_payload)).subject})))});
  }
  if(path==='/api/support/status/ticket')return json(await details(env,reference(url.searchParams.get('reference')),current,now));
  throw new HttpError(404,'Not found.');
 }
 if(request.method!=='POST')throw new HttpError(405,'Method not allowed.');
 const current=await browserWrite(request,env,now),body=await readJson(request),ip=request.headers.get('CF-Connecting-IP')||'unknown';
 if(path==='/api/support/status/request'){
  // Apply limits before provider verification and private ticket decryption.
  await limit(env.DB,'support-status-request-ip',ip,6,900,now);
  await limit(env.DB,'support-status-request-session',current.token_hash,3,900,now);
  await limit(env.DB,'support-status-request-global','all',60,60,now);
  const id=reference(body.reference),email=typeof body.email==='string'?body.email.trim().toLowerCase():'';
  if(email.length>254||!emailPattern.test(email))throw new HttpError(400,'Enter the email used for this support ticket.');
  await limit(env.DB,'support-status-request-email',email,3,900,now);
  const recent=await env.DB.prepare('SELECT 1 FROM support_status_verifications WHERE session_hash=? AND created_at>? LIMIT 1').bind(current.token_hash,now-60).first();
  if(recent)throw new HttpError(429,'Wait a minute before requesting another code.');
  await deps.human(request,env,body.turnstile_token,'support-status',now);
  const item=await env.DB.prepare("SELECT encrypted_payload FROM legal_requests WHERE id=? AND kind='support'").bind(id).first();
  let matched=false;if(item){const payload=JSON.parse(await decrypt(env,item.encrypted_payload));matched=String(payload.email||'').trim().toLowerCase()===email;}
  const verificationId=randomHex(16),code=otp(),expires=now+900,codeHash=await mac(env,'support-status:'+verificationId+':'+code);
  const statements=[
   env.DB.prepare('UPDATE support_status_verifications SET consumed_at=? WHERE session_hash=? AND consumed_at IS NULL').bind(now,current.token_hash),
   env.DB.prepare('INSERT INTO support_status_verifications(id,session_hash,ticket_id,code_hash,expires,created_at) VALUES (?,?,?,?,?,?)').bind(verificationId,current.token_hash,matched?id:null,codeHash,expires,now)
  ];
  if(matched)statements.push(env.DB.prepare('INSERT INTO mail_outbox(id,recipient,subject,encrypted_payload,due,expires) VALUES (?,?,?,?,?,?)').bind('support-access:'+verificationId,email,'Your private Radio Locals support code',await encrypt(env,JSON.stringify({text:`Your private Radio Locals support verification code is ${code}.\n\nEnter it only on the support page where you requested it. It expires in 15 minutes and works once. Never share it. If you did not request it, ignore this email.`})),now,expires));
  await env.DB.batch(statements);
  // Unknown and mismatched references have the same outward challenge shape.
  return json({status:'verification_required',verification_id:verificationId,expires_in:900,message:generic});
 }
 if(path==='/api/support/status/verify'){
  await limit(env.DB,'support-status-verify-ip',ip,30,900,now);await limit(env.DB,'support-status-verify-session',current.token_hash,20,900,now);
  const id=String(body.verification_id||''),code=String(body.code||'');
  if(!referencePattern.test(id)||!/^\d{6}$/.test(code))throw new HttpError(400,'Enter the 6-digit email code.');
  const check=await env.DB.prepare(`UPDATE support_status_verifications SET attempts=attempts+1 WHERE id=? AND session_hash=? AND consumed_at IS NULL AND expires>? AND attempts<5 RETURNING *`).bind(id,current.token_hash,now).first();
  if(!check||!check.ticket_id||check.code_hash!==await mac(env,'support-status:'+id+':'+code))throw new HttpError(400,'Incorrect or expired support code.');
  const operation=randomHex(16);
  await env.DB.batch([
   env.DB.prepare(`UPDATE support_status_verifications SET consumed_at=?,operation_token=? WHERE id=? AND session_hash=? AND consumed_at IS NULL AND expires>?`).bind(now,operation,id,current.token_hash,now),
   env.DB.prepare(`INSERT INTO support_ticket_grants(session_hash,ticket_id,expires)
    SELECT session_hash,ticket_id,? FROM support_status_verifications WHERE id=? AND operation_token=?
    ON CONFLICT(session_hash,ticket_id) DO UPDATE SET expires=excluded.expires`).bind(now+1800,id,operation)
  ]);
  if(!await env.DB.prepare('SELECT 1 FROM support_status_verifications WHERE id=? AND operation_token=?').bind(id,operation).first())throw new HttpError(400,'Incorrect or expired support code.');
  return json({status:'verified',reference:check.ticket_id,expires_in:1800});
 }
 if(path==='/api/support/status/logout'){
  await env.DB.prepare('DELETE FROM support_ticket_grants WHERE session_hash=? AND ticket_id=?').bind(current.token_hash,reference(body.reference)).run();return json({status:'ok'});
 }
 throw new HttpError(404,'Not found.');
}
