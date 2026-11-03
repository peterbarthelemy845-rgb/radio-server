const encoder=new TextEncoder();
export class HttpError extends Error{constructor(status,message){super(message);this.status=status;}}
export const json=(value,status=200)=>new Response(JSON.stringify(value),{status,headers:{
  'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store','X-Content-Type-Options':'nosniff',
  'Referrer-Policy':'strict-origin-when-cross-origin','Content-Security-Policy':"default-src 'none'; frame-ancestors 'none'"}});
export async function digest(value){return hex(await crypto.subtle.digest('SHA-256',encoder.encode(value)));}
export function hex(bytes){return Array.from(new Uint8Array(bytes),x=>x.toString(16).padStart(2,'0')).join('');}
export function randomHex(size=32){return hex(crypto.getRandomValues(new Uint8Array(size)));}
function keyBytes(env){
  if(!/^[a-f0-9]{64}$/.test(env.DATA_ENCRYPTION_KEY||''))throw new HttpError(503,'Secure configuration is not ready.');
  return Uint8Array.from(env.DATA_ENCRYPTION_KEY.match(/../g),x=>parseInt(x,16));
}
export async function mac(env,text){const key=await crypto.subtle.importKey('raw',keyBytes(env),{name:'HMAC',hash:'SHA-256'},false,['sign']);
  return hex(await crypto.subtle.sign('HMAC',key,encoder.encode(text)));}
export async function encrypt(env,value){const iv=crypto.getRandomValues(new Uint8Array(12));
  const key=await crypto.subtle.importKey('raw',keyBytes(env),'AES-GCM',false,['encrypt']);
  return hex(iv)+':'+hex(await crypto.subtle.encrypt({name:'AES-GCM',iv},key,encoder.encode(value)));}
export async function decrypt(env,value){const [ivHex,dataHex]=value.split(':');
  const parse=s=>Uint8Array.from(s.match(/../g)||[],x=>parseInt(x,16));
  const key=await crypto.subtle.importKey('raw',keyBytes(env),'AES-GCM',false,['decrypt']);
  return new TextDecoder().decode(await crypto.subtle.decrypt({name:'AES-GCM',iv:parse(ivHex)},key,parse(dataHex)));}
export function otp(){const ceiling=Math.floor(0x100000000/1000000)*1000000;let n;
  do{n=crypto.getRandomValues(new Uint32Array(1))[0];}while(n>=ceiling);return String(n%1000000).padStart(6,'0');}
export async function limit(db,scope,identity,maximum,seconds,now){
  const key=scope+':'+await digest(identity);
  const row=await db.prepare(`INSERT INTO rate_limits(key,count,expires) VALUES (?,1,?) ON CONFLICT(key) DO UPDATE SET
    count=CASE WHEN expires<=? THEN 1 ELSE count+1 END,
    expires=CASE WHEN expires<=? THEN excluded.expires ELSE expires END RETURNING count`)
    .bind(key,now+seconds,now,now).first();
  if(row.count>maximum)throw new HttpError(429,'Too many attempts. Please try again later.');
}
export async function readJson(request,maximum=4096){
  if(!request.headers.get('content-type')?.startsWith('application/json'))throw new HttpError(415,'JSON required.');
  if(Number(request.headers.get('content-length'))>maximum)throw new HttpError(413,'Request too large.');
  const reader=request.body?.getReader();let size=0,parts=[];
  if(reader)for(;;){const {done,value}=await reader.read();if(done)break;size+=value.byteLength;
    if(size>maximum){await reader.cancel();throw new HttpError(413,'Request too large.');}parts.push(value);}
  let body;try{body=JSON.parse(await new Blob(parts).text());}catch{throw new HttpError(400,'Invalid JSON.');}
  if(!body||Array.isArray(body)||typeof body!=='object')throw new HttpError(400,'JSON object required.');return body;
}
export async function session(request,env,now,create=false){
  const cookie=request.headers.get('Cookie')?.match(/(?:^|;\s*)__Host-rl_session=([a-f0-9]{64})(?:;|$)/)?.[1];
  let token=cookie,hash=token?await digest(token):'',row;
  if(hash)row=await env.DB.prepare('SELECT * FROM sessions WHERE token_hash=? AND expires>?').bind(hash,now).first();
  let setCookie;
  if(!row && create){token=randomHex();hash=await digest(token);const csrf=await mac(env,'csrf:'+token);
    await env.DB.prepare('INSERT INTO sessions(token_hash,csrf_hash,created_at,expires) VALUES (?,?,?,?)')
      .bind(hash,await digest(csrf),now,now+2592000).run();
    row={token_hash:hash,csrf_hash:await digest(csrf),expires:now+2592000};
    setCookie='__Host-rl_session='+token+'; Path=/; Secure; HttpOnly; SameSite=Lax; Max-Age=2592000';}
  if(!row)throw new HttpError(401,'Please reload this page.');
  return {...row,csrf:await mac(env,'csrf:'+token),setCookie};
}
export async function browserWrite(request,env,now){
  const origin=request.headers.get('Origin'),expected=new URL(request.url).origin;
  if(origin!==expected)throw new HttpError(403,'Request origin did not match.');
  const current=await session(request,env,now);
  const token=request.headers.get('X-CSRF-Token')||'';
  if(token.length!==64||await digest(token)!==current.csrf_hash)throw new HttpError(403,'Please refresh the page and try again.');
  return current;
}
export async function human(request,env,token,action,now){
  // Apply shared abuse limits before contacting the verification provider.
  const ip=request.headers.get('CF-Connecting-IP')||'unknown';
  await limit(env.DB,'human-ip',ip,20,900,now);await limit(env.DB,'human-global','all',120,60,now);
  if(!env.TURNSTILE_SECRET_KEY||!env.TURNSTILE_SITE_KEY)throw new HttpError(503,'Security check is not configured.');
  if(typeof token!=='string'||token.length<1||token.length>2048)throw new HttpError(400,'Complete the security check.');
  let result;try{
    const response=await fetch('https://challenges.cloudflare.com/turnstile/v0/siteverify',{
      method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({secret:env.TURNSTILE_SECRET_KEY,response:token}),
      signal:AbortSignal.timeout(8000),redirect:'manual'});
    result=response.ok?await response.json():null;
  }catch{throw new HttpError(503,'Security check is temporarily unavailable.');}
  if(result?.success!==true||result.action!==action||result.hostname!==new URL(request.url).hostname)
    throw new HttpError(400,'Security check failed. Please try again.');
}
