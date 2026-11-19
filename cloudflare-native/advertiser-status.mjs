import {json,session,browserWrite,readJson,limit,human,otp,mac,encrypt,randomHex,HttpError} from './security.mjs';

const referencePattern=/^[a-f0-9]{32}$/;
const emailPattern=/^[^\s@\r\n]+@[^\s@\r\n]+\.[^\s@\r\n]+$/;
function reference(value){if(typeof value!=='string'||!referencePattern.test(value))throw new HttpError(400,'Enter the advertisement reference from your confirmation.');return value;}
export async function advertiserNotice(env,ad,kind){
 const preference=await env.DB.prepare('SELECT email_hash FROM ad_update_preferences WHERE ad_id=?').bind(ad.id).first();
 if(!preference||preference.email_hash!==await mac(env,'ad-email:'+ad.contact_email.trim().toLowerCase()))return null;
 const sentences={receipt:['Your Radio Locals advertisement reference','Your advertisement was received and is waiting for review.'],clear:['Your advertisement passed safety review','Your advertisement passed safety review and is waiting for the station owner.'],approve:['Your Radio Locals advertisement is approved','Your advertisement is approved for its scheduled dates.'],delete:['Your Radio Locals advertisement was removed','Your advertisement was removed and will not appear on radios.']};
 const words=sentences[kind];if(!words)throw Error('Invalid advertiser notice.');
 return {id:'advertiser:'+kind+':'+ad.id,email_hash:preference.email_hash,recipient:ad.contact_email,subject:words[0],encrypted_payload:await encrypt(env,JSON.stringify({text:words[1]+'\n\nAdvertisement reference: '+ad.id+'\nStation code: '+ad.station_code+'\n\nCheck its status: https://radiolocals.com/advertise/'+ad.station_code+'?reference='+ad.id+'\nVerify your email there when using another browser. Never share an email verification code.'}))};
}
async function status(env,current,id,now){
 const ad=await env.DB.prepare(`SELECT a.id,a.station_code,a.business,a.status,p.scanner_passed,p.owner_approved,p.start_at,p.end_at,
 EXISTS(SELECT 1 FROM ad_update_preferences preference WHERE preference.ad_id=a.id) AS email_updates
 FROM local_ads a JOIN ad_policy p ON p.ad_id=a.id WHERE a.id=? AND (
 EXISTS(SELECT 1 FROM ad_status_grants g WHERE g.ad_id=a.id AND g.session_hash=? AND g.expires>?) OR
 EXISTS(SELECT 1 FROM ad_requests r WHERE r.ad_id=a.id AND r.session_hash=? AND r.state='complete' AND r.expires>?))`).bind(id,current.token_hash,now,current.token_hash,now).first();
 if(!ad)throw new HttpError(403,'Verify your email to check this advertisement.');
 return {reference:ad.id,station_code:String(ad.station_code),business:ad.business,status:ad.status==='deleted'?'removed':ad.end_at<=now?'expired':ad.status==='approved'&&ad.owner_approved&&ad.scanner_passed?(ad.start_at>now?'scheduled':'approved'):ad.scanner_passed?'waiting_for_owner':'waiting_for_safety',start_at:ad.start_at,end_at:ad.end_at,email_updates:!!ad.email_updates};
}
export async function advertiserStatusRoutes(request,env,now,deps={human}){
 const url=new URL(request.url),path=url.pathname;
 if(!['/api/ads/status','/api/ads/updates/request','/api/ads/updates/verify','/api/ads/updates/stop'].includes(path))return null;
 if(path==='/api/ads/status'&&request.method==='GET'){
  const current=await session(request,env,now);await limit(env.DB,'ad-status-read',current.token_hash,30,60,now);return json(await status(env,current,reference(url.searchParams.get('reference')),now));
 }
 if(request.method!=='POST')throw new HttpError(405,'Method not allowed.');
 const current=await browserWrite(request,env,now),body=await readJson(request),ip=request.headers.get('CF-Connecting-IP')||'unknown';
 if(path==='/api/ads/updates/request'){
  await limit(env.DB,'ad-status-request-ip',ip,6,900,now);await limit(env.DB,'ad-status-request-session',current.token_hash,3,900,now);await limit(env.DB,'ad-status-request-global','all',30,60,now);
  const id=reference(body.reference),email=typeof body.email==='string'?body.email.trim().toLowerCase():'';
  if(!emailPattern.test(email)||email.length>254)throw new HttpError(400,'Enter the contact email used for this advertisement.');
  await limit(env.DB,'ad-status-request-email',email,3,900,now);
  const recent=await env.DB.prepare('SELECT created_at FROM ad_status_verifications WHERE session_hash=? ORDER BY created_at DESC LIMIT 1').bind(current.token_hash).first();
  if(recent&&recent.created_at>now-60){const error=new HttpError(429,'Wait before requesting another email code.');error.retry_after=recent.created_at+60-now;throw error;}
  await deps.human(request,env,body.turnstile_token,'advertiser-status',now);
  const ad=await env.DB.prepare('SELECT id,contact_email FROM local_ads WHERE id=?').bind(id).first(),matched=ad?.contact_email?.trim().toLowerCase()===email;
  const verificationId=randomHex(16),code=otp(),expires=now+900;
  const statements=[env.DB.prepare('UPDATE ad_status_verifications SET consumed_at=? WHERE session_hash=? AND consumed_at IS NULL').bind(now,current.token_hash),env.DB.prepare('INSERT INTO ad_status_verifications(id,session_hash,ad_id,email_hash,code_hash,expires,created_at) VALUES (?,?,?,?,?,?,?)').bind(verificationId,current.token_hash,matched?id:null,await mac(env,'ad-email:'+email),await mac(env,'ad-status:'+verificationId+':'+code),expires,now)];
  if(matched)statements.push(env.DB.prepare('INSERT INTO mail_outbox(id,recipient,subject,encrypted_payload,due,expires) VALUES (?,?,?,?,?,?)').bind('ad-access:'+verificationId,email,'Your private Radio Locals advertisement code',await encrypt(env,JSON.stringify({text:'Your private advertisement email code is '+code+'.\n\nEnter it only on the Radio Locals page where you requested it to check your advertisement and receive its receipt and decision updates. It expires in 15 minutes and works once. If you did not request it, ignore this email.'})),now,expires));
  await env.DB.batch(statements);return json({verification_id:verificationId,expires_in:900,resend_after:60,message:'If the reference and contact email match, a private code will arrive shortly.'});
 }
 if(path==='/api/ads/updates/verify'){
  await limit(env.DB,'ad-status-verify-ip',ip,30,900,now);await limit(env.DB,'ad-status-verify-session',current.token_hash,20,900,now);
  const id=String(body.verification_id||''),code=String(body.code||'').replace(/\s/g,'');if(!referencePattern.test(id)||!/^\d{6}$/.test(code))throw new HttpError(400,'Enter the 6-digit email code.');
  const check=await env.DB.prepare('UPDATE ad_status_verifications SET attempts=attempts+1 WHERE id=? AND session_hash=? AND consumed_at IS NULL AND expires>? AND attempts<5 RETURNING *').bind(id,current.token_hash,now).first();
  if(!check||!check.ad_id||check.code_hash!==await mac(env,'ad-status:'+id+':'+code))throw new HttpError(400,'Incorrect or expired advertisement code. Request a new code if needed.');
  const ad=await env.DB.prepare('SELECT id,contact_email,station_code FROM local_ads WHERE id=?').bind(check.ad_id).first();if(!ad||check.email_hash!==await mac(env,'ad-email:'+ad.contact_email.trim().toLowerCase()))throw new HttpError(400,'Advertisement contact changed. Request a new email code.');
  const operation=randomHex(16),emailHash=await mac(env,'ad-email:'+ad.contact_email.trim().toLowerCase()),receipt={id:'advertiser:receipt:'+ad.id,recipient:ad.contact_email,subject:'Your Radio Locals advertisement reference',encrypted_payload:await encrypt(env,JSON.stringify({text:'Your advertisement was received.\n\nAdvertisement reference: '+ad.id+'\nStation code: '+ad.station_code+'\n\nCheck its status: https://radiolocals.com/advertise/'+ad.station_code+'?reference='+ad.id+'\nYou will receive decision updates at this verified email address.'}))};
  const guard='EXISTS(SELECT 1 FROM ad_status_verifications WHERE id=? AND operation_token=?)';
  await env.DB.batch([
   env.DB.prepare('UPDATE ad_status_verifications SET consumed_at=?,operation_token=? WHERE id=? AND session_hash=? AND consumed_at IS NULL AND expires>? AND EXISTS(SELECT 1 FROM local_ads WHERE id=ad_status_verifications.ad_id AND contact_email=?)').bind(now,operation,id,current.token_hash,now,ad.contact_email),
   env.DB.prepare(`INSERT INTO ad_status_grants(session_hash,ad_id,expires) SELECT ?,?,? WHERE ${guard} ON CONFLICT(session_hash,ad_id) DO UPDATE SET expires=excluded.expires`).bind(current.token_hash,ad.id,Math.min(current.expires,now+1800),id,operation),
   env.DB.prepare(`INSERT INTO ad_update_preferences(ad_id,email_hash,verified_at) SELECT ?,?,? WHERE ${guard} ON CONFLICT(ad_id) DO UPDATE SET email_hash=excluded.email_hash,verified_at=excluded.verified_at`).bind(ad.id,emailHash,now,id,operation),
   env.DB.prepare(`INSERT INTO mail_outbox(id,recipient,subject,encrypted_payload,due,expires) SELECT ?,?,?,?,?,? WHERE ${guard} ON CONFLICT(id) DO NOTHING`).bind(receipt.id,receipt.recipient,receipt.subject,receipt.encrypted_payload,now,now+7*86400,id,operation)
  ]);
  if(!await env.DB.prepare('SELECT 1 FROM ad_status_verifications WHERE id=? AND operation_token=?').bind(id,operation).first())throw new HttpError(400,'Incorrect or expired advertisement code.');
  return json({status:'verified',...await status(env,current,ad.id,now)});
 }
 if(path==='/api/ads/updates/stop'){
  const id=reference(body.reference);await status(env,current,id,now);await env.DB.batch([
   env.DB.prepare('DELETE FROM ad_update_preferences WHERE ad_id=?').bind(id),
   env.DB.prepare("UPDATE ad_status_verifications SET consumed_at=?,code_hash='' WHERE ad_id=? AND consumed_at IS NULL").bind(now,id),
   env.DB.prepare("UPDATE mail_outbox SET state='failed',encrypted_payload='',lease=0 WHERE state='pending' AND lease=0 AND (id LIKE ? OR id IN(SELECT 'ad-access:'||v.id FROM ad_status_verifications v WHERE v.ad_id=?))").bind('advertiser:%:'+id,id)
  ]);return json({status:'ok'});
 }
 throw new HttpError(404,'Not found.');
}
