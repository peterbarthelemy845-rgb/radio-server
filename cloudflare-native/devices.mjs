import {digest,mac,encrypt,json,readJson,limit,HttpError} from './security.mjs';
export function credentials(request,body){const id=body.radio_id,auth=request.headers.get('Authorization')||'';
 if(typeof id!=='string'||!/^[a-f0-9]{32}$/.test(id)||!/^Bearer [a-f0-9]{64}$/.test(auth))throw new HttpError(401,'Radio authentication required.');return {id,secret:auth.slice(7)};}
export async function authenticate(request,db,body){const {id,secret}=credentials(request,body);if(!await db.prepare('SELECT id FROM radios WHERE id=? AND secret_hash=?').bind(id,await digest(secret)).first())throw new HttpError(401,'Radio authentication required.');return id;}
export async function deviceRoutes(request,env,now){const path=new URL(request.url).pathname;
 if(!['/api/radio/enroll','/api/radio/link/start'].includes(path)||request.method!=='POST')return null;
 const body=await readJson(request),{id,secret}=credentials(request,body),hash=await digest(secret);
 await limit(env.DB,'device-start-ip',request.headers.get('CF-Connecting-IP')||'unknown',60,3600,now);
 if(path==='/api/radio/enroll'){
  const token=String(body.enrollment_token||'');if(!/^[a-f0-9]{64}$/.test(token))throw new HttpError(403,'A factory enrollment token is required.');
  await limit(env.DB,'device-enroll-global','all',200,86400,now);const tokenHash=await digest(token);
  // Enrollment is administrative, single-use and short-lived. Arbitrary visitors
  // cannot fill the device registry by choosing a public ID and secret.
  await env.DB.batch([
   env.DB.prepare(`INSERT INTO radios(id,secret_hash,name,created_at,last_seen) SELECT ?,?,'My radio',?,? FROM device_enrollments WHERE token_hash=? AND expires>? AND consumed_at IS NULL AND NOT EXISTS (SELECT 1 FROM radios WHERE id=?)`).bind(id,hash,now,now,tokenHash,now,id),
   env.DB.prepare(`UPDATE device_enrollments SET consumed_at=?,radio_id=? WHERE token_hash=? AND expires>? AND consumed_at IS NULL AND EXISTS (SELECT 1 FROM radios WHERE id=? AND secret_hash=? AND created_at=?)`).bind(now,id,tokenHash,now,id,hash,now)
  ]);
  const enrolled=await env.DB.prepare('SELECT 1 FROM device_enrollments WHERE token_hash=? AND radio_id=? AND consumed_at IS NOT NULL').bind(tokenHash,id).first();
  if(!enrolled)throw new HttpError(403,'Enrollment token is invalid or already used.');await authenticate(request,env.DB,body);return json({status:'ok'});
 }
 await authenticate(request,env.DB,body);await limit(env.DB,'device-start',id,30,3600,now);
 const existing=await env.DB.prepare('SELECT code_hash FROM radio_pairs WHERE radio_id=? AND (expires=0 OR expires>?)').bind(id,now).first();
 const stable=body.stable_pair_code;
 if(stable!==undefined&&(!/^[0-9]{4,8}$/.test(stable)))throw new HttpError(400,'Invalid device code.');
 if(existing){if(!stable||existing.code_hash!==await mac(env,'device-code:'+stable))throw new HttpError(409,'Reset the device code before replacing it.');
  await env.DB.prepare('UPDATE radio_pairs SET code_encrypted=? WHERE radio_id=? AND code_hash=? AND (expires=0 OR expires>?)').bind(await encrypt(env,stable),id,existing.code_hash,now).run();
  return json({pair_code:stable,persistent:true,expires_in:0});}
 for(let attempt=0;attempt<30;attempt++){
  // Start short, then expand after collisions so a growing fleet cannot exhaust
  // the four-digit pool. Existing stable codes are never changed here.
  const digits=Math.min(8,4+Math.floor(attempt/5)),minimum=10**(digits-1);
  const number=crypto.getRandomValues(new Uint32Array(1))[0];const code=attempt===0&&stable?stable:String(minimum+number%(9*minimum)),codeHash=await mac(env,'device-code:'+code);
  // Unique indices reject collisions; no existing radio's code can be replaced.
  await env.DB.prepare('INSERT INTO radio_pairs(radio_id,code_hash,expires,code_encrypted) VALUES (?,?,0,?) ON CONFLICT DO NOTHING').bind(id,codeHash,await encrypt(env,code)).run();
  const row=await env.DB.prepare('SELECT code_hash FROM radio_pairs WHERE radio_id=?').bind(id).first();
  if(row?.code_hash===codeHash)return json({pair_code:code,persistent:true,expires_in:0});
  if(row)throw new HttpError(409,'Device code changed. Try again.');
 }
 throw new HttpError(503,'Unable to allocate a device code.');
}
