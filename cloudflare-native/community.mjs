import {json,session,browserWrite,readJson,limit,human,digest,encrypt,randomHex,HttpError} from './security.mjs';
export async function communityRoutes(request,env,now,deps={human}){
 const path=new URL(request.url).pathname;
 if(path==='/api/player'&&request.method==='GET')return json({name:'La Voix Divine',stream_url:'https://icecast3.getstreamhosting.com/proxy/radiodivinessl/live',logo_url:'/assets/radiolavoixdivine.png'});
 if(!['/api/support','/api/support/ticket','/api/support/unlock','/api/support/lock','/api/legal/request'].includes(path))return null;
 if(request.method==='GET'&&path==='/api/support'){
  return json({unlocked:true,public:true,videos:(await env.DB.prepare('SELECT id,topic,title,description,video_id FROM help_videos ORDER BY topic,id LIMIT 50').all()).results});
 }
 if(request.method!=='POST')throw new HttpError(405,'Method not allowed.');
 const current=await browserWrite(request,env,now),body=await readJson(request,30000),ip=request.headers.get('CF-Connecting-IP')||'unknown';
 if(path==='/api/support/unlock'){
  await limit(env.DB,'support-unlock-ip',ip,10,900,now);await limit(env.DB,'support-unlock-global','all',100,3600,now);
  if(!env.SUPPORT_PASSCODE_HASH||await digest(String(body.passcode||''))!==env.SUPPORT_PASSCODE_HASH)throw new HttpError(400,'Incorrect passcode.');
  await env.DB.prepare('INSERT INTO support_grants VALUES (?,?) ON CONFLICT(session_hash) DO UPDATE SET expires=excluded.expires').bind(current.token_hash,now+28800).run();return json({status:'ok'});
 }
 if(path==='/api/support/lock'){await env.DB.prepare('DELETE FROM support_grants WHERE session_hash=?').bind(current.token_hash).run();return json({status:'ok'});}
 if(path==='/api/support/ticket'){
  await limit(env.DB,'ticket-ip',ip,5,3600,now);await limit(env.DB,'ticket-global','all',100,3600,now);
  await deps.human(request,env,body.turnstile_token,'support-ticket',now);
  const payload={};for(const [key,max] of [['name',100],['email',254],['subject',120],['message',3000]]){if(typeof body[key]!=='string'||!body[key].trim()||body[key].length>max)throw new HttpError(400,'Complete your name, email, subject and message.');payload[key]=body[key].trim();}
  if(!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(payload.email))throw new HttpError(400,'Enter a valid email.');
  payload.device_code=String(body.device_code||'').trim();if(payload.device_code.length>32)throw new HttpError(400,'Device code is too long.');
  const id=randomHex(16);await env.DB.prepare('INSERT INTO legal_requests(id,kind,encrypted_payload,created_at) VALUES (?,?,?,?)').bind(id,'support',await encrypt(env,JSON.stringify(payload)),now).run();
  return json({status:'ok',reference:id,message:'Your support ticket was submitted successfully.'});
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
