import {json,browserWrite,readJson,limit,human,encrypt,randomHex,HttpError} from './security.mjs';
// Receipts use only a generated reference and fixed plain text. Never echo the
// submitted subject, message, device code or contact details into an email.
const receiptEmail=/^[a-z0-9.!#$%&'*+/=?^_`{|}~-]{1,64}@(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/i;
export async function communityRoutes(request,env,now,deps={human}){
 const path=new URL(request.url).pathname;
 if(path==='/api/player'&&request.method==='GET')return json({name:'La Voix Divine',stream_url:'https://icecast3.getstreamhosting.com/proxy/radiodivinessl/live',logo_url:'/assets/radiolavoixdivine.png'});
 if(!['/api/support','/api/support/ticket','/api/legal/request'].includes(path))return null;
 if(request.method==='GET'&&path==='/api/support'){
  return json({unlocked:true,public:true,videos:(await env.DB.prepare('SELECT id,topic,title,description,video_id FROM help_videos ORDER BY topic,id LIMIT 50').all()).results});
 }
 if(path==='/api/support'||request.method!=='POST')throw new HttpError(405,'Method not allowed.');
 await browserWrite(request,env,now);
 const body=await readJson(request,30000),ip=request.headers.get('CF-Connecting-IP')||'unknown';
 if(path==='/api/support/ticket'){
  await limit(env.DB,'ticket-ip',ip,5,3600,now);await limit(env.DB,'ticket-global','all',100,3600,now);
  await deps.human(request,env,body.turnstile_token,'support-ticket',now);
  const payload={};for(const [key,max] of [['name',100],['email',254],['subject',120],['message',3000]]){if(typeof body[key]!=='string'||!body[key].trim()||body[key].length>max)throw new HttpError(400,'Complete your name, email, subject and message.');payload[key]=body[key].trim();}
  if(!receiptEmail.test(payload.email))throw new HttpError(400,'Enter a valid email.');
  payload.email=payload.email.toLowerCase();
  payload.device_code=String(body.device_code||'').trim();if(payload.device_code.length>32)throw new HttpError(400,'Device code is too long.');
  await limit(env.DB,'ticket-recipient',payload.email,3,3600,now);
  const id=randomHex(16),receipt={text:`We received your Radio Locals support ticket.\n\nReference: ${id}\n\nKeep this reference for any follow-up with Radio Locals support. Your message and any device or security codes are not included in this receipt.\n\nIf you did not submit this ticket, you can ignore this email.`};
  // D1 batches are atomic: a ticket cannot be accepted without its durable
  // receipt, and a failed ticket cannot leave a receipt for the mail worker.
  // The ticket reference also identifies its one outbox job.
  await env.DB.batch([
   env.DB.prepare('INSERT INTO legal_requests(id,kind,encrypted_payload,created_at) VALUES (?,?,?,?)').bind(id,'support',await encrypt(env,JSON.stringify(payload)),now),
   env.DB.prepare('INSERT INTO mail_outbox(id,recipient,subject,encrypted_payload,due,expires) VALUES (?,?,?,?,?,?)').bind('support-receipt:'+id,payload.email,'Radio Locals support ticket received - '+id,await encrypt(env,JSON.stringify(receipt)),now,now+86400)
  ]);
  return json({status:'ok',reference:id,receipt_queued:true,message:'Your support ticket was submitted successfully. A confirmation email has been queued. Keep your reference in case the email does not arrive.'});
 }
 await limit(env.DB,'legal-ip',ip,5,3600,now);await limit(env.DB,'legal-global','all',100,3600,now);
 await deps.human(request,env,body.turnstile_token,'legal-request',now);
 const kind=body.kind;if(!['privacy','copyright','counter-notice'].includes(kind))throw new HttpError(400,'Choose a request type.');
 const required=kind==='privacy'?['name','email','message']:['name','email','address','phone','work','location','signature'];const payload={};
 for(const key of required){const max=['message','work','location'].includes(key)?8000:500;if(typeof body[key]!=='string'||!body[key].trim()||body[key].length>max)throw new HttpError(400,'Complete the required contact information.');payload[key]=body[key].trim();}
 if(!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(payload.email)||payload.email.length>254)throw new HttpError(400,'Enter a valid email.');
 if(kind!=='privacy'){if(body.good_faith!==true||body.authority!==true)throw new HttpError(400,'Confirm the required statements.');payload.good_faith=true;payload.authority=true;}
 const id=randomHex(16);await env.DB.prepare('INSERT INTO legal_requests(id,kind,encrypted_payload,created_at) VALUES (?,?,?,?)').bind(id,kind,await encrypt(env,JSON.stringify(payload)),now).run();
 return json({status:'ok',reference:id,message:'Request received. Keep your reference number.'});
}
