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
 const replies=await Promise.all(rows.reverse().map(async row=>{const payload=JSON.parse(await decrypt(env,row.encrypted_payload));return {body:payload.body,created_at:row.created_at,...(payload.author==='customer'?{author:'customer'}:{})};}));
 const history=(await env.DB.prepare(`SELECT action AS state,created_at FROM legal_actions WHERE request_id=? AND action IN ('new','review','closed') ORDER BY created_at DESC,rowid DESC LIMIT 100`).bind(id).all()).results.reverse();
 // Deliberate allowlist: email address, device code and internal audit notes are not returned.
 return {ticket:{reference:item.id,state:item.state,subject:payload.subject,message:payload.message,created_at:item.created_at,...(payload.station_code?{station_code:payload.station_code,station_name:payload.station_name||''}:{})},replies,history};
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
  const recent=await env.DB.prepare('SELECT created_at FROM support_status_verifications WHERE session_hash=? AND created_at>? ORDER BY created_at DESC LIMIT 1').bind(current.token_hash,now-60).first();
  if(recent){const error=new HttpError(429,'Wait before requesting another code.');error.retry_after=Math.max(1,recent.created_at+60-now);throw error;}
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
  return json({status:'verification_required',verification_id:verificationId,expires_in:900,resend_after:60,message:generic});
 }
 if(path==='/api/support/status/verify'){
  await limit(env.DB,'support-status-verify-ip',ip,30,900,now);await limit(env.DB,'support-status-verify-session',current.token_hash,20,900,now);
  const id=String(body.verification_id||''),code=String(body.code||'').replace(/\s/g,'');
  if(!referencePattern.test(id)||!/^\d{6}$/.test(code))throw new HttpError(400,'Enter the 6-digit email code.');
  const check=await env.DB.prepare(`UPDATE support_status_verifications SET attempts=attempts+1 WHERE id=? AND session_hash=? AND consumed_at IS NULL AND expires>? AND attempts<5 RETURNING *`).bind(id,current.token_hash,now).first();
  if(!check){const error=new HttpError(400,'This support code expired or is no longer active. Request a new email code.');error.code='code_expired';throw error;}
  if(!check.ticket_id||check.code_hash!==await mac(env,'support-status:'+id+':'+code)){const exhausted=check.attempts>=5,error=new HttpError(400,exhausted?'This support code reached its attempt limit. Request a new email code.':'Incorrect support code. Check the newest email and try again.');error.code=exhausted?'code_exhausted':'code_incorrect';throw error;}
  const proved=await env.DB.prepare("SELECT encrypted_payload FROM legal_requests WHERE id=? AND kind='support'").bind(check.ticket_id).first(),provedEmail=proved?String(JSON.parse(await decrypt(env,proved.encrypted_payload)).email||'').trim().toLowerCase():'';
  if(!provedEmail||!emailPattern.test(provedEmail))throw new HttpError(400,'Incorrect or expired support code.');const emailHash=await mac(env,'support-email:'+provedEmail),operation=randomHex(16);
  await env.DB.batch([
   env.DB.prepare(`UPDATE support_status_verifications SET consumed_at=?,operation_token=? WHERE id=? AND session_hash=? AND consumed_at IS NULL AND expires>?`).bind(now,operation,id,current.token_hash,now),
   env.DB.prepare(`INSERT INTO support_ticket_grants(session_hash,ticket_id,expires)
    SELECT session_hash,ticket_id,? FROM support_status_verifications WHERE id=? AND operation_token=?
    ON CONFLICT(session_hash,ticket_id) DO UPDATE SET expires=excluded.expires`).bind(now+1800,id,operation),
   env.DB.prepare(`INSERT INTO support_sender_grants(session_hash,email_hash,verified_at,expires) SELECT session_hash,?,?,? FROM support_status_verifications WHERE id=? AND operation_token=? ON CONFLICT(session_hash,email_hash) DO UPDATE SET verified_at=excluded.verified_at,expires=excluded.expires`).bind(emailHash,now,Math.min(current.expires,now+2592000),id,operation)
  ]);
  if(!await env.DB.prepare('SELECT 1 FROM support_status_verifications WHERE id=? AND operation_token=?').bind(id,operation).first())throw new HttpError(400,'Incorrect or expired support code.');
  return json({status:'verified',reference:check.ticket_id,expires_in:1800});
 }
 if(path==='/api/support/status/reply'){
  const id=reference(body.reference),text=typeof body.message==='string'?body.message.trim():'';
  if(!text||text.length>3000)throw new HttpError(400,'Enter a reply of 1 to 3,000 characters.');
  if(typeof body.request_id!=='string'||!/^[-A-Za-z0-9_]{16,128}$/.test(body.request_id))throw new HttpError(400,'A valid request reference is required. Try again.');
  const item=await env.DB.prepare(`SELECT r.encrypted_payload,COALESCE(f.folder,'inbox') AS folder FROM legal_requests r JOIN support_ticket_grants g ON g.ticket_id=r.id LEFT JOIN support_ticket_flags f ON f.ticket_id=r.id WHERE r.id=? AND r.kind='support' AND g.session_hash=? AND g.expires>?`).bind(id,current.token_hash,now).first();
  if(!item)throw new HttpError(403,'Verify your email to reply to this support ticket.');
  const requestId='customer:'+body.request_id,requestHash=await mac(env,'support-customer-reply:'+JSON.stringify([id,current.token_hash,text]));
  const recorded=()=>env.DB.prepare('SELECT id,request_hash FROM support_replies WHERE ticket_id=? AND request_id=?').bind(id,requestId).first();
  let prior=await recorded();if(prior){if(prior.request_hash!==requestHash)throw new HttpError(409,'This request reference was used for a different reply.');return json({status:'ok',duplicate:true,reference:id,message:'Your reply was already sent.'});}
  if(item.folder==='spam')throw new HttpError(409,'Replies are unavailable for this ticket. Contact support for help.');
  const email=String(JSON.parse(await decrypt(env,item.encrypted_payload)).email||'').trim().toLowerCase(),emailHash=await mac(env,'support-email:'+email);
  const blocked=await env.DB.prepare('SELECT expires FROM support_abuse_blocks WHERE session_hash=? AND email_hash=? AND expires>?').bind(current.token_hash,emailHash,now).first();
  const wait=(seconds,message)=>{const error=new HttpError(429,message);error.retry_after=Math.max(1,Math.ceil(seconds));return error;};
  if(blocked)throw wait(blocked.expires-now,'Please wait before sending another support message.');
  const recent=await env.DB.prepare("SELECT created_at FROM support_replies WHERE ticket_id=? AND request_id LIKE 'customer:%' ORDER BY created_at DESC LIMIT 1").bind(id).first();
  if(recent&&recent.created_at+30>now)throw wait(recent.created_at+30-now,'Wait a moment before sending another reply.');
  await limit(env.DB,'support-customer-reply-session',current.token_hash,10,3600,now);await limit(env.DB,'support-customer-reply-ticket',id,6,3600,now);await limit(env.DB,'support-customer-reply-ip',ip,20,3600,now);await limit(env.DB,'support-customer-reply-global','all',200,3600,now);
  await deps.human(request,env,body.turnstile_token,'support-ticket',now);
  const recipient=String(env.ADMIN_EMAIL||'').trim().toLowerCase();if(recipient.length>254||!emailPattern.test(recipient))throw new HttpError(503,'Support reply delivery is temporarily unavailable. Your draft is kept.');
  const replyId=randomHex(16),operation=randomHex(16),outboxId='support-customer-reply:'+replyId;
  await env.DB.batch([
   env.DB.prepare(`INSERT INTO support_replies(id,ticket_id,request_id,request_hash,operation_token,actor_hash,encrypted_payload,state,outbox_id,created_at)
    SELECT ?,?,?,?,?,?,?,'new',?,? WHERE EXISTS(SELECT 1 FROM support_ticket_grants g JOIN legal_requests r ON r.id=g.ticket_id WHERE g.ticket_id=? AND g.session_hash=? AND g.expires>? AND r.kind='support') AND NOT EXISTS(SELECT 1 FROM support_ticket_flags WHERE ticket_id=? AND folder='spam') AND NOT EXISTS(SELECT 1 FROM support_replies WHERE ticket_id=? AND request_id LIKE 'customer:%' AND created_at>?) ON CONFLICT(ticket_id,request_id) DO NOTHING`).bind(replyId,id,requestId,requestHash,operation,current.token_hash,await encrypt(env,JSON.stringify({body:text,recipient,author:'customer'})),outboxId,now,id,current.token_hash,now,id,id,now-30),
   env.DB.prepare(`INSERT INTO mail_outbox(id,recipient,subject,encrypted_payload,due,expires) SELECT ?,?,?,?,?,? WHERE EXISTS(SELECT 1 FROM support_replies WHERE id=? AND operation_token=?)`).bind(outboxId,recipient,'Radio Locals customer reply - '+id,await encrypt(env,JSON.stringify({text:'A customer replied to their Radio Locals support ticket.\n\nReference: '+id+'\n\n'+text+'\n\nReview and reply in the administrator support inbox.'})),now,now+86400,replyId,operation),
   env.DB.prepare("UPDATE legal_requests SET state='new' WHERE id=? AND EXISTS(SELECT 1 FROM support_replies WHERE id=? AND operation_token=?)").bind(id,replyId,operation),
   env.DB.prepare("INSERT INTO legal_actions(id,request_id,action,notes,created_at) SELECT ?,?,'new','Customer replied in the website.',? WHERE EXISTS(SELECT 1 FROM support_replies WHERE id=? AND operation_token=?)").bind(replyId,id,now,replyId,operation)
  ]);
  prior=await recorded();if(!prior){const raced=await env.DB.prepare("SELECT created_at FROM support_replies WHERE ticket_id=? AND request_id LIKE 'customer:%' ORDER BY created_at DESC LIMIT 1").bind(id).first();if(raced&&raced.created_at+30>now)throw wait(raced.created_at+30-now,'Wait a moment before sending another reply.');throw new HttpError(409,'Ticket access changed. Verify your email and try again.');}if(prior.request_hash!==requestHash)throw new HttpError(409,'This request reference was used for a different reply.');
  return json({status:'ok',duplicate:prior.id!==replyId,reference:id,message:'Reply sent. It is added to this ticket.'});
 }
 if(path==='/api/support/status/logout'){
  const id=reference(body.reference);
  // Closing private access also cancels its pending email proofs. A correct
  // verification already waiting to commit must not reopen the closed ticket.
  await env.DB.batch([
   env.DB.prepare("UPDATE support_status_verifications SET consumed_at=?,code_hash='' WHERE session_hash=? AND ticket_id=? AND consumed_at IS NULL").bind(now,current.token_hash,id),
   env.DB.prepare('DELETE FROM support_ticket_grants WHERE session_hash=? AND ticket_id=?').bind(current.token_hash,id)
  ]);return json({status:'ok'});
 }
 throw new HttpError(404,'Not found.');
}
