import {HttpError,json,digest,randomHex,mac,otp,encrypt,decrypt,limit,readJson,session,browserWrite,human} from './security.mjs';
import {screenStation} from './moderation.mjs';
const VERSION='radio-locals-native-2026-11-02';
const RIGHTS='I represent this station and have streaming and artwork rights. I accept the station terms and privacy notice.';
const emailPattern=/^[^\s@\r\n]{1,64}@[^\s@\r\n]+\.[^\s@\r\n]+$/;
const mask=email=>email[0]+'***@'+email.split('@')[1];
export function streamUrl(value){
  if(typeof value!=='string'||value.length>2048)throw new HttpError(400,'Enter a valid stream URL.');
  let url;try{url=new URL(value);}catch{throw new HttpError(400,'Enter a valid stream URL.');}
  const host=url.hostname.toLowerCase();
  // No server-side fetch is performed. Local addresses and credentials are still
  // rejected so station codes cannot be used as an easy local-network shortcut.
  if(!['https:','http:'].includes(url.protocol)||url.username||url.password||url.hash||
    !host.includes('.')||host==='localhost'||host.endsWith('.local')||host.endsWith('.localhost')||
    host.startsWith('[')||/^\d+(\.\d+){3}$/.test(host))throw new HttpError(400,'Use a public stream hostname.');
  return url.href;
}
export async function artwork(env,file){
  if(!env.IMAGES||!env.MEDIA)throw new HttpError(503,'Artwork processing is not ready.');
  if(!file||typeof file.base64!=='string'||file.base64.length>4194304||typeof file.name!=='string')
    throw new HttpError(400,'Choose a PNG, JPG or WebP image under 3 MB.');
  let bytes;try{bytes=Uint8Array.from(atob(file.base64),x=>x.charCodeAt(0));}catch{throw new HttpError(400,'Invalid image.');}
  if(bytes.length<12||bytes.length>3*1024*1024)throw new HttpError(400,'Choose an image under 3 MB.');
  const png=bytes[0]===137&&String.fromCharCode(...bytes.slice(1,4))==='PNG';
  const jpg=bytes[0]===255&&bytes[1]===216&&bytes[2]===255;
  const webp=String.fromCharCode(...bytes.slice(0,4))==='RIFF'&&String.fromCharCode(...bytes.slice(8,12))==='WEBP';
  if(!((png&&/\.png$/i.test(file.name))||(jpg&&/\.jpe?g$/i.test(file.name))||(webp&&/\.webp$/i.test(file.name))))
    throw new HttpError(400,'The image format does not match its filename.');
  const blob=new Blob([bytes]);let output;
  try{
    const info=await env.IMAGES.info(blob.stream());
    if(!info.width||!info.height||info.width*info.height>4000000)throw new Error('dimensions');
    output=(await env.IMAGES.input(blob.stream()).transform({width:512,height:512,fit:'contain'})
      .output({format:'image/png',anim:false})).response();
    if(!output.ok)throw new Error('decode');
  }catch{throw new HttpError(400,'This image could not be processed. Choose another image under 4 megapixels.');}
  const sanitized=await output.arrayBuffer();
  if(sanitized.byteLength>3*1024*1024)throw new HttpError(400,'Processed image is too large.');
  const key=randomHex()+'.png';
  await env.MEDIA.put('sanitized/'+key,sanitized,{httpMetadata:{contentType:'image/png'},customMetadata:{sanitizer_version:'1'}});
  return key;
}
async function verification(env,current,station,purpose,now){
  const id=randomHex(16),code=otp(),mail=randomHex(16),expires=now+900;
  const codeHash=await mac(env,'email:'+id+':'+code);
  const payload=await encrypt(env,JSON.stringify({text:`Your private Radio Locals verification code is ${code}.\n\nEnter it on the page where you requested it. It expires in 15 minutes and works once. Never share it. If you did not request this email, ignore it.`}));
  await env.DB.batch([
    env.DB.prepare('UPDATE email_verifications SET consumed_at=? WHERE session_hash=? AND purpose=? AND consumed_at IS NULL')
      .bind(now,current.token_hash,purpose),
    env.DB.prepare('INSERT INTO email_verifications(id,session_hash,station_code,purpose,code_hash,expires,created_at) VALUES (?,?,?,?,?,?,?)')
      .bind(id,current.token_hash,station.code,purpose,codeHash,expires,now),
    env.DB.prepare('INSERT INTO mail_outbox(id,recipient,subject,encrypted_payload,due,expires) VALUES (?,?,?,?,?,?)')
      .bind(mail,station.contact_email,'Your Radio Locals verification code',payload,now,expires),
  ]);
  return {verification_id:id,verification_email:mask(station.contact_email),expires_in:900};
}
export async function processMail(env,now=Math.floor(Date.now()/1000)){
  if(!env.EMAIL||!env.DATA_ENCRYPTION_KEY)return;
  // Retries use a lease persisted in D1; concurrent Workers cannot take the same job.
  const job=await env.DB.prepare(`UPDATE mail_outbox SET state='sending',attempts=attempts+1,lease=?
    WHERE id=(SELECT id FROM mail_outbox WHERE state IN ('pending','sending') AND attempts<5
      AND due<=? AND lease<=? AND expires>? ORDER BY due LIMIT 1)
    RETURNING *`).bind(now+60,now,now,now).first();
  if(!job)return;
  try{
    const payload=JSON.parse(await decrypt(env,job.encrypted_payload));
    await env.EMAIL.send({from:'info@radiolocals.com',to:job.recipient,subject:job.subject,text:payload.text});
    await env.DB.prepare("UPDATE mail_outbox SET state='sent',encrypted_payload='',lease=0 WHERE id=? AND lease=?")
      .bind(job.id,now+60).run();
  }catch{
    await env.DB.prepare("UPDATE mail_outbox SET state=?,due=?,lease=0 WHERE id=? AND lease=?")
      .bind(job.attempts>=5?'failed':'pending',now+Math.min(120,15*job.attempts),job.id,now+60).run();
  }
}
export async function authRoutes(request,env,now,deps={human}){
  const path=new URL(request.url).pathname;
  if(path==='/api/session'&&request.method==='GET'){
    await limit(env.DB,'session-create',request.headers.get('CF-Connecting-IP')||'unknown',60,60,now);
    const current=await session(request,env,now,true),response=json({csrf:current.csrf,turnstile_site_key:env.TURNSTILE_SITE_KEY||'',agreement_version:VERSION,
      owner_station:current.owner_expires>now?current.owner_station:null});
    if(current.setCookie)response.headers.set('Set-Cookie',current.setCookie);return response;
  }
  if(path==='/api/owner/artwork'&&request.method==='GET'){
    const current=await session(request,env,now);
    if(!current.owner_station||current.owner_expires<=now)throw new HttpError(401,'Please sign in.');
    const station=await env.DB.prepare("SELECT artwork_key FROM stations WHERE code=? AND status!='deleted'").bind(current.owner_station).first();
    const key=station?.artwork_key;
    const object=key&&/^[a-f0-9]{64}\.png$/.test(key)&&env.MEDIA?await env.MEDIA.get('sanitized/'+key):null;
    if(!object||object.customMetadata?.sanitizer_version!=='1')throw new HttpError(404,'Artwork not found.');
    return new Response(object.body,{headers:{'Content-Type':'image/png','Cache-Control':'private, no-store','X-Content-Type-Options':'nosniff','Content-Security-Policy':"default-src 'none'; sandbox"}});
  }
  if(!['/api/owner/register','/api/owner/login','/api/owner/verify','/api/owner/station','/api/owner/logout','/api/owner/resend','/api/owner/delete'].includes(path))return null;
  if(path==='/api/owner/station'&&request.method==='GET'){
    const current=await session(request,env,now);
    if(!current.owner_station||current.owner_expires<=now)throw new HttpError(401,'Please sign in.');
    const station=await env.DB.prepare('SELECT code,name,stream_url,bio,location,status,artwork_key FROM stations WHERE code=?').bind(current.owner_station).first();
    if(station){station.artwork_url=station.artwork_key?'/api/owner/artwork':'';delete station.artwork_key;}
    return station?json({station}):json({message:'Station not found.'},404);
  }
  if(request.method!=='POST')throw new HttpError(405,'Method not allowed.');
  const current=await browserWrite(request,env,now);
  await limit(env.DB,'owner-write',current.token_hash,30,900,now);
  const body=await readJson(request,path==='/api/owner/register'||path==='/api/owner/station'?4300000:4096);
  if(path==='/api/owner/logout'){
    await env.DB.prepare('UPDATE sessions SET owner_station=NULL,owner_expires=NULL WHERE token_hash=?').bind(current.token_hash).run();
    return json({status:'ok'});
  }
  if(path==='/api/owner/delete'){
    if(!current.owner_station||current.owner_expires<=now)throw new HttpError(401,'Please sign in.');
    if(!body.verification_id){
      await limit(env.DB,'delete-email',current.token_hash,3,900,now);
      const station=await env.DB.prepare("SELECT code,contact_email FROM stations WHERE code=? AND status!='deleted'").bind(current.owner_station).first();
      if(!station)throw new HttpError(404,'Station not found.');
      const result=await verification(env,current,station,'edit',now);
      await env.DB.prepare("UPDATE email_verifications SET code_hash='delete:'||code_hash WHERE id=?").bind(result.verification_id).run();
      return json({status:'verification_required',...result});
    }
    if(body.confirm!==true)throw new HttpError(400,'Confirm station removal.');
    const id=String(body.verification_id),code=String(body.code||'');
    if(!/^[a-f0-9]{32}$/.test(id)||!/^\d{6}$/.test(code))throw new HttpError(400,'Enter the 6-digit email code.');
    const check=await env.DB.prepare(`UPDATE email_verifications SET attempts=attempts+1 WHERE id=? AND session_hash=? AND station_code=? AND consumed_at IS NULL AND expires>? AND attempts<5 RETURNING *`).bind(id,current.token_hash,current.owner_station,now).first();
    if(!check||check.code_hash!=='delete:'+await mac(env,'email:'+id+':'+code))throw new HttpError(400,'Incorrect or expired deletion code.');
    const used=await env.DB.prepare('UPDATE email_verifications SET consumed_at=? WHERE id=? AND consumed_at IS NULL RETURNING id').bind(now,id).first();
    if(!used)throw new HttpError(400,'Code already used.');
    await env.DB.batch([
      env.DB.prepare("UPDATE stations SET status='deleted',updated_at=? WHERE code=?").bind(now,current.owner_station),
      env.DB.prepare("UPDATE radio_commands SET state='failed' WHERE station_code=? AND state IN ('pending','delivered')").bind(current.owner_station),
      env.DB.prepare('UPDATE sessions SET owner_station=NULL,owner_expires=NULL WHERE owner_station=?').bind(current.owner_station)
    ]);
    return json({status:'ok',message:'Station removed from the directory.'});
  }
  if(path==='/api/owner/register'){
    await deps.human(request,env,body.turnstile_token,'station-submit',now);
    await limit(env.DB,'register-ip',request.headers.get('CF-Connecting-IP')||'unknown',5,86400,now);
    await limit(env.DB,'register-global','all',100,86400,now);
    const name=String(body.name||'').trim(),bio=String(body.bio||'').trim(),email=String(body.email||'').trim().toLowerCase();
    if(!name||name.length>96||bio.length>250||email.length>254||!emailPattern.test(email))throw new HttpError(400,'Check the station name, bio and email.');
    if(body.rights_confirmed!==true||body.agreement_version!==VERSION)throw new HttpError(400,'Confirm station rights and the current terms.');
    const url=streamUrl(body.stream_url),key=await artwork(env,body.artwork);
    const station=await env.DB.prepare(`INSERT INTO stations(name,stream_url,bio,location,contact_email,artwork_key,created_at,updated_at)
      VALUES (?,?,?,?,?,?,?,?) RETURNING code,contact_email`).bind(name,url,bio,String(body.location||'').slice(0,80),email,key,now,now).first();
    await env.DB.prepare('INSERT INTO agreement_acceptances(station_code,agreement_version,agreement_hash,accepted_at) VALUES (?,?,?,?)')
      .bind(station.code,VERSION,await digest(RIGHTS),now).run();
    const result=await verification(env,current,station,'registration',now);
    return json({status:'ok',...result});
  }
  if(path==='/api/owner/login'){
    await deps.human(request,env,body.turnstile_token,'station-access',now);
    await limit(env.DB,'owner-login-ip',request.headers.get('CF-Connecting-IP')||'unknown',10,900,now);
    const email=String(body.email||'').trim().toLowerCase(),code=String(body.code||'');
    if(!emailPattern.test(email)||!/^\d{2,6}$/.test(code))throw new HttpError(400,'Enter your registered email and station code.');
    await limit(env.DB,'owner-login-email',email,5,900,now);
    const station=await env.DB.prepare("SELECT code,contact_email FROM stations WHERE code=? AND contact_email=? AND email_verified_at IS NOT NULL AND status NOT IN ('deleted','suspended')")
      .bind(Number(code),email).first();
    // Identical response shape for an unknown station/email; do not disclose ownership.
    const result=station?await verification(env,current,station,'edit',now):{verification_id:randomHex(16),verification_email:mask(email),expires_in:900};
    return json({status:'ok',...result});
  }
  if(path==='/api/owner/resend'){
    await deps.human(request,env,body.turnstile_token,'verification-resend',now);
    await limit(env.DB,'owner-resend',current.token_hash,3,900,now);
    const prior=await env.DB.prepare('SELECT station_code,purpose,created_at FROM email_verifications WHERE id=? AND session_hash=? AND consumed_at IS NULL')
      .bind(String(body.verification_id||''),current.token_hash).first();
    if(!prior||prior.created_at>now-60)throw new HttpError(400,'Wait a minute before requesting another code.');
    const station=await env.DB.prepare("SELECT code,contact_email FROM stations WHERE code=? AND status NOT IN ('suspended','deleted')").bind(prior.station_code).first();
    if(!station)throw new HttpError(400,'Please start again.');
    return json({status:'ok',...await verification(env,current,station,prior.purpose,now)});
  }
  if(path==='/api/owner/verify'){
    await limit(env.DB,'email-verify-ip',request.headers.get('CF-Connecting-IP')||'unknown',30,900,now);
    const id=String(body.verification_id||''),code=String(body.code||'');
    if(!/^[a-f0-9]{32}$/.test(id)||!/^\d{6}$/.test(code))throw new HttpError(400,'Enter the 6-digit email code.');
    // Count every attempt atomically before comparing; an email code permits at most five guesses.
    const check=await env.DB.prepare(`UPDATE email_verifications SET attempts=attempts+1 WHERE id=? AND session_hash=?
      AND consumed_at IS NULL AND expires>? AND attempts<5 RETURNING *`).bind(id,current.token_hash,now).first();
    if(!check||check.code_hash!==await mac(env,'email:'+id+':'+code))throw new HttpError(400,'Incorrect or expired code.');
    const consumed=await env.DB.prepare(`UPDATE email_verifications SET consumed_at=? WHERE id=? AND session_hash=?
      AND consumed_at IS NULL AND expires>? RETURNING station_code,purpose`).bind(now,id,current.token_hash,now).first();
    if(!consumed)throw new HttpError(400,'Incorrect or expired code.');
    const updates=[env.DB.prepare(`UPDATE sessions SET owner_station=?,owner_expires=? WHERE token_hash=?`)
      .bind(consumed.station_code,now+1800,current.token_hash)];
    if(consumed.purpose==='registration')updates.push(env.DB.prepare(`UPDATE stations SET email_verified_at=?,
      status='pending_review',updated_at=? WHERE code=? AND status='pending_email'`).bind(now,now,consumed.station_code));
    await env.DB.batch(updates);
    const approved=await screenStation(env,consumed.station_code);
    return json({status:'ok',message:approved?'Station added successfully!':consumed.purpose==='registration'?'Email verified. Your station is awaiting safety review.':'Signed in.',station_code:String(consumed.station_code),registration_completed:consumed.purpose==='registration',review_required:consumed.purpose==='registration'&&!approved});
  }
  if(path==='/api/owner/station'){
    if(!current.owner_station||current.owner_expires<=now)throw new HttpError(401,'Please sign in.');
    const station=await env.DB.prepare("SELECT code,artwork_key FROM stations WHERE code=? AND status NOT IN ('deleted','suspended')")
      .bind(current.owner_station).first();
    if(!station)throw new HttpError(403,'Station cannot be edited.');
    const url=streamUrl(body.stream_url),bio=String(body.bio||'').trim();
    if(bio.length>250)throw new HttpError(400,'Bio must be 250 characters or fewer.');
    const key=body.artwork?await artwork(env,body.artwork):station.artwork_key;
    await env.DB.prepare("UPDATE stations SET stream_url=?,bio=?,artwork_key=?,status='pending_review',updated_at=? WHERE code=?")
      .bind(url,bio,key,now,station.code).run();
    const approved=await screenStation(env,station.code);
    return json({status:'ok',message:approved?'Changes saved successfully.':'Changes saved for safety review.'});
  }
  return null;
}
