import {publicStreamUrl} from './public-stream-url.mjs';
import {HttpError,json,digest,randomHex,mac,otp,encrypt,decrypt,limit,readJson,session,browserWrite,human} from './security.mjs';
import {screenStation} from './moderation.mjs';
import {stationState,ownerRevision,stationStateGuard,stationName} from './station-edits.mjs';
import {metadataOptions,stationMetadata} from './station-metadata.mjs';
import {attachStreamCheck,streamPublicationAllowed,streamOwnerStatus,requireStreamSaveCheck,assertStreamSaveCheck} from './stream-verification.mjs';
const VERSION='radio-locals-native-2026-11-02';
const RIGHTS='I represent this station and have streaming and artwork rights. I accept the station terms and privacy notice.';
const emailPattern=/^[^\s@\r\n]{1,64}@[^\s@\r\n]+\.[^\s@\r\n]+$/;
const mask=email=>email[0]+'***@'+email.split('@')[1];
export function streamUrl(value){return publicStreamUrl(value);}
export async function artwork(env,file,stableKey,beforePut){
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
  const key=stableKey||randomHex()+'.png';
  if(!/^[a-f0-9]{64}\.png$/.test(key))throw new Error('Invalid internal artwork key.');
  if(beforePut)await beforePut();
  await env.MEDIA.put('sanitized/'+key,sanitized,{httpMetadata:{contentType:'image/png'},customMetadata:{sanitizer_version:'1'}});
  return key;
}
async function verificationValues(env,now,deletion=false){
  const id=randomHex(16),code=otp(),mail=randomHex(16),expires=now+900;
  const codeHash=await mac(env,'email:'+id+':'+code);
  const payload=await encrypt(env,JSON.stringify({text:`Your private Radio Locals ${deletion?'station deletion':'verification'} code is ${code}.\n\n${deletion?'This code confirms removal of your station. Only enter it if you requested deletion.':'Enter it on the page where you requested it.'} It expires in 15 minutes and works once. Never share it. If you did not request this email, ignore it.`}));
  return {id,mail,expires,codeHash,payload};
}
async function verification(env,current,station,purpose,now,deletion=false){
  const {id,mail,expires,codeHash,payload}=await verificationValues(env,now,deletion);
  await env.DB.batch([
    env.DB.prepare("UPDATE email_verifications SET consumed_at=? WHERE session_hash=? AND purpose=? AND consumed_at IS NULL AND (purpose!='registration' OR station_code=?)")
      .bind(now,current.token_hash,purpose,station.code),
    env.DB.prepare('INSERT INTO email_verifications(id,session_hash,station_code,purpose,code_hash,expires,created_at) VALUES (?,?,?,?,?,?,?)')
      .bind(id,current.token_hash,station.code,purpose,deletion?'delete:'+codeHash:codeHash,expires,now),
    env.DB.prepare('INSERT INTO mail_outbox(id,recipient,subject,encrypted_payload,due,expires) VALUES (?,?,?,?,?,?)')
      .bind(mail,station.contact_email,deletion?'Confirm Radio Locals station deletion':'Your Radio Locals verification code',payload,now,expires),
    ...(purpose==='registration'?[env.DB.prepare("UPDATE registration_requests SET verification_id=? WHERE session_hash=? AND station_code=? AND state='complete'")
      .bind(id,current.token_hash,station.code)]:[]),
  ]);
  return {verification_id:id,verification_email:mask(station.contact_email),expires_in:900};
}
async function registrationResponse(env,current,row,now){
  const saved=await env.DB.prepare(`SELECT v.id,v.expires,v.consumed_at,s.contact_email,s.email_verified_at,s.status,s.stream_url FROM email_verifications v
    JOIN stations s ON s.code=v.station_code WHERE v.id=? AND v.session_hash=? AND v.station_code=? AND v.purpose='registration'`)
    .bind(row.verification_id,current.token_hash,row.station_code).first();
  if(!saved||['deleted','suspended'].includes(saved.status))throw new HttpError(409,'This signup is no longer available. Please start again.');
  if(saved.email_verified_at!==null)throw new HttpError(409,'This station is already registered. Sign in to edit it.');
  if(saved.consumed_at!==null)throw new HttpError(409,'This sign-in was cancelled. Reload the page and start again.');
  await attachStreamCheck(env,current.token_hash,row.station_code,saved.stream_url,'initial',now);
  return json({status:'ok',verification_id:saved.id,verification_email:mask(saved.contact_email),expires_in:Math.max(0,saved.expires-now)});
}
export async function processMail(env,now=Math.floor(Date.now()/1000)){
  if(!env.EMAIL||!env.DATA_ENCRYPTION_KEY)return;
  // A Worker can stop after claiming its final attempt. Once that lease is
  // over, no retry is allowed: report a terminal failure instead of leaving
  // the job looking in progress until its original expiry days later.
  await env.DB.prepare(`UPDATE mail_outbox SET state='failed',encrypted_payload='',lease=0
    WHERE id IN (SELECT id FROM mail_outbox WHERE state='sending' AND attempts>=5 AND lease<=? ORDER BY lease LIMIT 100)`).bind(now).run();
  // Drain a small batch after an outage. Earlier expiry prioritizes private
  // verification codes over day/week-long receipts without inspecting content.
  // The persisted global budget also bounds parallel request/cron senders.
  const deadline=Date.now()+8000;
  for(let sent=0;sent<10&&Date.now()<deadline;sent++){
    const job=await env.DB.prepare(`UPDATE mail_outbox SET state='sending',attempts=attempts+1,lease=?
      WHERE id=(SELECT id FROM mail_outbox WHERE state IN ('pending','sending') AND attempts<5
        AND due<=? AND lease<=? AND expires>? ORDER BY expires,due,id LIMIT 1)
      RETURNING *`).bind(now+60,now,now,now).first();
    if(!job)return;
    try{await limit(env.DB,'mail-send-global','all',60,60,now);}
    catch(error){
      // A budget deferral is not a provider attempt and must not consume a retry.
      await env.DB.prepare("UPDATE mail_outbox SET state='pending',attempts=attempts-1,lease=0 WHERE id=? AND lease=?").bind(job.id,now+60).run();
      if(error instanceof HttpError&&error.status===429)return;
      throw error;
    }
    try{
      const payload=JSON.parse(await decrypt(env,job.encrypted_payload));
      await env.EMAIL.send({from:'info@radiolocals.com',to:job.recipient,subject:job.subject,text:payload.text});
      await env.DB.prepare("UPDATE mail_outbox SET state='sent',encrypted_payload='',lease=0 WHERE id=? AND lease=?")
        .bind(job.id,now+60).run();
    }catch{
      await env.DB.prepare("UPDATE mail_outbox SET state=?,due=?,lease=0,encrypted_payload=CASE WHEN ? THEN '' ELSE encrypted_payload END WHERE id=? AND lease=?")
        .bind(job.attempts>=5?'failed':'pending',now+Math.min(120,15*job.attempts),Number(job.attempts>=5),job.id,now+60).run();
    }
  }
}
export async function authRoutes(request,env,now,deps={human}){
  const path=new URL(request.url).pathname;
  if(path==='/api/session'&&request.method==='GET'){
    await limit(env.DB,'session-create',request.headers.get('CF-Connecting-IP')||'unknown',60,60,now);
    const current=await session(request,env,now,true),response=json({csrf:current.csrf,turnstile_site_key:env.TURNSTILE_SITE_KEY||'',agreement_version:VERSION,server_time:now,
      owner_station:current.owner_expires>now?current.owner_station:null,owner_expires:current.owner_station&&current.owner_expires>now?current.owner_expires:null});
    if(current.setCookie)response.headers.set('Set-Cookie',current.setCookie);return response;
  }
  if(path==='/api/owner/artwork'&&request.method==='GET'){
    const current=await session(request,env,now);
    if(!current.owner_station||current.owner_expires<=now)throw new HttpError(401,'Please sign in.');
    const station=await env.DB.prepare("SELECT COALESCE(e.artwork_key,s.artwork_key) AS artwork_key FROM stations s LEFT JOIN station_edits e ON e.station_code=s.code WHERE s.code=? AND s.status NOT IN ('deleted','suspended')").bind(current.owner_station).first();
    const key=station?.artwork_key;
    const object=key&&/^[a-f0-9]{64}\.png$/.test(key)&&env.MEDIA?await env.MEDIA.get('sanitized/'+key):null;
    if(!object||object.customMetadata?.sanitizer_version!=='1')throw new HttpError(404,'Artwork not found.');
    return new Response(object.body,{headers:{'Content-Type':'image/png','Cache-Control':'private, no-store','X-Content-Type-Options':'nosniff','Content-Security-Policy':"default-src 'none'; sandbox"}});
  }
  if(!['/api/owner/register','/api/owner/login','/api/owner/recover-code','/api/owner/verify','/api/owner/station','/api/owner/logout','/api/owner/resend','/api/owner/delete','/api/owner/stream-review'].includes(path))return null;
  if(path==='/api/owner/station'&&request.method==='GET'){
    const current=await session(request,env,now);
    if(!current.owner_station||current.owner_expires<=now)throw new HttpError(401,'Please sign in.');
    const {station,pending}=await stationState(env,current.owner_station);
    if(!station)return json({message:'Station not found.'},404);
    if(['deleted','suspended'].includes(station.status))throw new HttpError(403,'Station cannot be edited.');
    const draft=pending||station,revision=await ownerRevision(env,station,pending);
    return json({owner_expires:current.owner_expires,server_time:now,metadata_options:metadataOptions,station:{code:station.code,name:draft.name,stream_url:draft.stream_url,bio:draft.bio,language:draft.language,category:draft.category,zip_code:draft.zip_code,status:station.status,artwork_url:draft.artwork_key?'/api/owner/artwork':'',revision,review_pending:!!pending,stream_check:await streamOwnerStatus(env,station,pending,now,current.token_hash),approved:{name:station.name,stream_url:station.stream_url,bio:station.bio,language:station.language,category:station.category,zip_code:station.zip_code,status:station.status}}});
  }
  if(request.method!=='POST')throw new HttpError(405,'Method not allowed.');
  const current=await browserWrite(request,env,now);
  await limit(env.DB,'owner-write',current.token_hash,30,900,now);
  const body=await readJson(request,path==='/api/owner/register'||path==='/api/owner/station'?4300000:4096);
  if(path==='/api/owner/logout'){
    // A verification already waiting to commit must not restore the editing
    // grant after sign-out. Its existing CAS also checks consumed_at is null.
    await env.DB.batch([
      env.DB.prepare('UPDATE email_verifications SET consumed_at=?,code_hash=\'\' WHERE session_hash=? AND consumed_at IS NULL').bind(now,current.token_hash),
      env.DB.prepare('UPDATE sessions SET owner_station=NULL,owner_expires=NULL WHERE token_hash=?').bind(current.token_hash)
    ]);
    return json({status:'ok'});
  }
  if(path==='/api/owner/stream-review'){
    if(!current.owner_station||current.owner_expires<=now)throw new HttpError(401,'Please sign in.');
    const {station,pending}=await stationState(env,current.owner_station);
    if(!station||!station.email_verified_at||['deleted','suspended','pending_email'].includes(station.status))throw new HttpError(403,'Station cannot be reviewed.');
    if(typeof body.revision!=='string'||body.revision!==await ownerRevision(env,station,pending))throw new HttpError(409,'This station changed. Refresh your station before testing again.');
    // Retired client flow: an owner cannot replace a required successful check
    // with a private-save/manual-review request. Admin remediation is separate.
    throw new HttpError(428,'Test your stream and get a pass before saving.');
  }
  if(path==='/api/owner/delete'){
    if(!current.owner_station||current.owner_expires<=now)throw new HttpError(401,'Please sign in.');
    if(!body.verification_id){
      await limit(env.DB,'delete-email',current.token_hash,3,900,now);
      const station=await env.DB.prepare("SELECT code,contact_email FROM stations WHERE code=? AND status!='deleted'").bind(current.owner_station).first();
      if(!station)throw new HttpError(404,'Station not found.');
      const result=await verification(env,current,station,'edit',now,true);
      return json({status:'verification_required',...result});
    }
    if(body.confirm!==true)throw new HttpError(400,'Confirm station removal.');
    const id=String(body.verification_id),code=String(body.code||'');
    if(!/^[a-f0-9]{32}$/.test(id)||!/^\d{6}$/.test(code))throw new HttpError(400,'Enter the 6-digit email code.');
    const check=await env.DB.prepare(`UPDATE email_verifications SET attempts=attempts+1 WHERE id=? AND session_hash=? AND station_code=? AND consumed_at IS NULL AND expires>? AND attempts<5 RETURNING *`).bind(id,current.token_hash,current.owner_station,now).first();
    if(!check||check.code_hash!=='delete:'+await mac(env,'email:'+id+':'+code))throw new HttpError(400,'Incorrect or expired deletion code.');
    const proof=check.code_hash+':'+randomHex(16),guard='EXISTS (SELECT 1 FROM email_verifications WHERE id=? AND session_hash=? AND station_code=? AND consumed_at=? AND code_hash=?)';
    const proofArgs=[id,current.token_hash,current.owner_station,now,proof];
    const updates=await env.DB.batch([
      env.DB.prepare('UPDATE email_verifications SET consumed_at=?,code_hash=? WHERE id=? AND session_hash=? AND station_code=? AND consumed_at IS NULL AND expires>? AND code_hash=? RETURNING id')
        .bind(now,proof,id,current.token_hash,current.owner_station,now,check.code_hash),
      env.DB.prepare(`UPDATE stations SET status='deleted',updated_at=? WHERE code=? AND ${guard}`).bind(now,current.owner_station,...proofArgs),
      env.DB.prepare(`UPDATE radio_commands SET state='failed' WHERE station_code=? AND state IN ('pending','delivered') AND ${guard}`).bind(current.owner_station,...proofArgs),
      env.DB.prepare(`UPDATE sessions SET owner_station=NULL,owner_expires=NULL WHERE owner_station=? AND ${guard}`).bind(current.owner_station,...proofArgs)
    ]);
    if(!updates[0]?.results?.[0])throw new HttpError(400,'Code already used.');
    return json({status:'ok',message:'Station removed from the directory.'});
  }
  if(path==='/api/owner/register'){
    await deps.human(request,env,body.turnstile_token,'station-submit',now);
    const name=stationName(body.name),bio=String(body.bio||'').trim(),email=String(body.email||'').trim().toLowerCase(),metadata=stationMetadata(body);
    if(bio.length>250||email.length>254||!emailPattern.test(email))throw new HttpError(400,'Check the station bio and email.');
    if(body.rights_confirmed!==true||body.agreement_version!==VERSION)throw new HttpError(400,'Confirm station rights and the current terms.');
    let requestId=body.request_id;
    if(requestId!==undefined&&(typeof requestId!=='string'||!/^[a-f0-9]{32}$/.test(requestId)))throw new HttpError(400,'Refresh the signup page and try again.');
    const url=streamUrl(body.stream_url),location=String(body.location||'').slice(0,80);
    const payloadHash=await digest(JSON.stringify([name,url,bio,email,location,VERSION,body.artwork?.name,body.artwork?.base64,...(metadata.language||metadata.category?[metadata.language,metadata.category]:[]),...(metadata.zip_code?['zip_code',metadata.zip_code]:[])]));
    // Older open forms have no retry ID. Keep their in-progress signup safe
    // without forcing a reload or storing any private draft in the browser.
    if(requestId===undefined)requestId=(await mac(env,'legacy-registration:'+current.token_hash+':'+payloadHash)).slice(0,32);
    const prior=await env.DB.prepare('SELECT * FROM registration_requests WHERE session_hash=? AND request_id=?').bind(current.token_hash,requestId).first();
    if(prior&&prior.payload_hash!==payloadHash)throw new HttpError(409,'Signup details changed. Please submit a new signup request.');
    if(prior?.expires<=now)throw new HttpError(409,'This signup request expired. Reload the page and start again.');
    if(prior?.state==='complete')return registrationResponse(env,current,prior,now);
    const streamSave=await requireStreamSaveCheck(env,current.token_hash,url,now);
    await limit(env.DB,'register-ip',request.headers.get('CF-Connecting-IP')||'unknown',5,86400,now);
    await limit(env.DB,'register-global','all',100,86400,now);
    const lease=randomHex(16);
    const claimed=await env.DB.prepare(`INSERT INTO registration_requests(session_hash,request_id,payload_hash,lease_token,lease_until,created_at,expires)
      SELECT ?,?,?,?,?,?,? WHERE ${streamSave.sql} ON CONFLICT(session_hash,request_id) DO UPDATE SET lease_token=excluded.lease_token,lease_until=excluded.lease_until
      WHERE state='pending' AND lease_until<=? AND payload_hash=excluded.payload_hash RETURNING *`)
      .bind(current.token_hash,requestId,payloadHash,lease,now+120,now,now+86400,...streamSave.values,now).first();
    if(!claimed){await assertStreamSaveCheck(env,streamSave);throw new HttpError(409,'This signup is still processing. Please try again shortly.');}
    let uploadedKey;
    try{
      // A crashed attempt can safely replace this same private object on retry.
      await assertStreamSaveCheck(env,streamSave);
      const key=await artwork(env,body.artwork,await mac(env,'registration-art:'+current.token_hash+':'+requestId)+'.png',()=>assertStreamSaveCheck(env,streamSave));uploadedKey=key;
      const values=await verificationValues(env,now),agreementHash=await digest(RIGHTS);
      const guard="session_hash=? AND request_id=? AND lease_token=? AND lease_until>MAX(?,unixepoch()) AND state='pending' AND "+streamSave.sql;
      const owner=[current.token_hash,requestId,lease,now,...streamSave.values];
      await env.DB.batch([
        env.DB.prepare(`INSERT INTO stations(name,stream_url,bio,location,contact_email,artwork_key,created_at,updated_at,language,category,zip_code)
          SELECT ?,?,?,?,?,?,?,?,?,?,? WHERE EXISTS (SELECT 1 FROM registration_requests WHERE ${guard} AND station_code IS NULL)`)
          .bind(name,url,bio,location,email,key,now,now,metadata.language,metadata.category,metadata.zip_code,...owner),
        env.DB.prepare(`UPDATE registration_requests SET station_code=last_insert_rowid() WHERE ${guard} AND station_code IS NULL AND changes()>0`).bind(...owner),
        env.DB.prepare(`INSERT INTO agreement_acceptances(station_code,agreement_version,agreement_hash,accepted_at)
          SELECT station_code,?,?,? FROM registration_requests WHERE ${guard} AND station_code IS NOT NULL`).bind(VERSION,agreementHash,now,...owner),
        env.DB.prepare(`UPDATE email_verifications SET consumed_at=? WHERE session_hash=? AND purpose='registration' AND consumed_at IS NULL
          AND station_code=(SELECT station_code FROM registration_requests WHERE ${guard})`).bind(now,current.token_hash,...owner),
        env.DB.prepare(`INSERT INTO email_verifications(id,session_hash,station_code,purpose,code_hash,expires,created_at)
          SELECT ?,session_hash,station_code,'registration',?,?,? FROM registration_requests WHERE ${guard} AND station_code IS NOT NULL`)
          .bind(values.id,values.codeHash,values.expires,now,...owner),
        env.DB.prepare(`INSERT INTO mail_outbox(id,recipient,subject,encrypted_payload,due,expires)
          SELECT ?,?,'Your Radio Locals verification code',?,?,? FROM registration_requests WHERE ${guard} AND station_code IS NOT NULL`)
          .bind(values.mail,email,values.payload,now,values.expires,...owner),
        env.DB.prepare(`UPDATE registration_requests SET state='complete',verification_id=?,lease_until=0 WHERE ${guard} AND station_code IS NOT NULL`)
          .bind(values.id,...owner),
        // D1 batches are transactional, but unixepoch() can change between
        // statements. A guard becoming false halfway through must roll back
        // ALL preceding writes, not commit an unlinked station or partial mail.
        // The deliberately invalid state hits the existing table CHECK only
        // when this exact lease did not finish every required operation.
        env.DB.prepare(`INSERT INTO registration_requests(session_hash,request_id,payload_hash,state,lease_token,lease_until,created_at,expires)
          SELECT ?,?,?,'registration_commit_assertion_failed',?,0,?,?
          WHERE NOT EXISTS(SELECT 1 FROM registration_requests completed
            JOIN stations saved ON saved.code=completed.station_code
            JOIN email_verifications verified ON verified.id=completed.verification_id AND verified.station_code=saved.code AND verified.session_hash=completed.session_hash
            WHERE completed.session_hash=? AND completed.request_id=? AND completed.payload_hash=? AND completed.lease_token=? AND completed.state='complete' AND completed.lease_until=0
              AND completed.verification_id=? AND saved.name=? AND saved.stream_url=? AND saved.bio=? AND saved.location=? AND saved.contact_email=? AND saved.artwork_key=? AND saved.language=? AND saved.category=? AND saved.zip_code=? AND saved.status='pending_email'
              AND verified.purpose='registration' AND verified.code_hash=? AND verified.expires=? AND verified.consumed_at IS NULL
              AND EXISTS(SELECT 1 FROM agreement_acceptances accepted WHERE accepted.station_code=saved.code AND accepted.agreement_version=? AND accepted.agreement_hash=?)
              AND EXISTS(SELECT 1 FROM mail_outbox queued WHERE queued.id=? AND queued.recipient=? AND queued.encrypted_payload=? AND queued.due=? AND queued.expires=?)
              AND ?>MAX(?,unixepoch()) AND ${streamSave.sql})`)
          .bind(current.token_hash,requestId,payloadHash,lease,now,now+86400,
            current.token_hash,requestId,payloadHash,lease,values.id,name,url,bio,location,email,key,metadata.language,metadata.category,metadata.zip_code,values.codeHash,values.expires,
            VERSION,agreementHash,values.mail,email,values.payload,now,values.expires,claimed.lease_until,now,...streamSave.values)
      ]);
      const complete=await env.DB.prepare("SELECT * FROM registration_requests WHERE session_hash=? AND request_id=? AND state='complete'").bind(current.token_hash,requestId).first();
      if(!complete){await assertStreamSaveCheck(env,streamSave);throw new HttpError(409,'This signup is still processing. Please try again shortly.');}
      return registrationResponse(env,current,complete,now);
    }catch(error){
      try{await env.DB.prepare("UPDATE registration_requests SET lease_until=0 WHERE session_hash=? AND request_id=? AND lease_token=? AND state='pending'").bind(current.token_hash,requestId,lease).run();}catch{}
      // An invalidated proof or failed transaction must not retain an orphaned
      // private upload. Never delete artwork that a completed save references.
      if(uploadedKey)try{if(!await env.DB.prepare('SELECT 1 FROM stations WHERE artwork_key=? UNION SELECT 1 FROM station_edits WHERE artwork_key=?').bind(uploadedKey,uploadedKey).first())await env.MEDIA.delete?.('sanitized/'+uploadedKey);}catch{}
      // A failed final assertion has already rolled the transaction back. Use
      // the public proof error when it expired; otherwise a lost lease is a
      // retryable signup conflict rather than an internal SQL error.
      try{await assertStreamSaveCheck(env,streamSave);}catch(proofError){if(proofError instanceof HttpError&&proofError.status===428)throw proofError;}
      if(String(error?.message||'').includes("state IN ('pending','complete')"))throw new HttpError(409,'This signup changed while it was processing. Please try again.');
      throw error;
    }
  }
  if(path==='/api/owner/recover-code'){
    // Bound invalid bot checks as well as email deliveries. Apply the same
    // limits and response to unknown emails so this cannot identify owners.
    await limit(env.DB,'owner-recovery-ip',request.headers.get('CF-Connecting-IP')||'unknown',10,900,now);
    await limit(env.DB,'owner-recovery-session',current.token_hash,3,900,now);
    const email=String(body.email||'').trim().toLowerCase();
    if(email.length>254||!emailPattern.test(email))throw new HttpError(400,'Enter your registered email.');
    await limit(env.DB,'owner-recovery-email',email,3,900,now);
    await deps.human(request,env,body.turnstile_token,'station-code-recovery',now);
    await limit(env.DB,'owner-recovery-cooldown',email,1,60,now);
    const {results:stations}=await env.DB.prepare(`SELECT code,name FROM stations WHERE contact_email=?
      AND email_verified_at IS NOT NULL AND status NOT IN ('deleted','suspended') ORDER BY code LIMIT 101`).bind(email).all();
    if(stations.length){
      const entries=stations.slice(0,100).map(station=>`${station.name}: station code #${station.code}`).join('\n');
      const text=`Your registered Radio Locals stations:\n\n${entries}\n\n${stations.length>100?'Only the first 100 stations are shown. Contact support for help with additional stations.\n\n':''}Use your registered email and station code on the Radio Locals sign-in page. Sign-in still requires a new private email verification code.\n\nIf you did not request this email, you can ignore it.`;
      await env.DB.prepare('INSERT INTO mail_outbox(id,recipient,subject,encrypted_payload,due,expires) VALUES (?,?,?,?,?,?)')
        .bind(randomHex(16),email,'Your Radio Locals station code',await encrypt(env,JSON.stringify({text})),now,now+900).run();
    }
    return json({status:'ok',message:'If this email has a registered station, its station code will arrive shortly.'});
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
    const prior=await env.DB.prepare('SELECT station_code,purpose,created_at,code_hash FROM email_verifications WHERE id=? AND session_hash=? AND consumed_at IS NULL')
      .bind(String(body.verification_id||''),current.token_hash).first();
    if(!prior||prior.created_at>now-60)throw new HttpError(400,'Wait a minute before requesting another code.');
    const station=await env.DB.prepare("SELECT code,contact_email FROM stations WHERE code=? AND status NOT IN ('suspended','deleted')").bind(prior.station_code).first();
    if(!station)throw new HttpError(400,'Please start again.');
    return json({status:'ok',...await verification(env,current,station,prior.purpose,now,prior.purpose==='edit'&&prior.code_hash.startsWith('delete:'))});
  }
  if(path==='/api/owner/verify'){
    await limit(env.DB,'email-verify-ip',request.headers.get('CF-Connecting-IP')||'unknown',30,900,now);
    const id=String(body.verification_id||''),code=String(body.code||'');
    if(!/^[a-f0-9]{32}$/.test(id)||!/^\d{6}$/.test(code))throw new HttpError(400,'Enter the 6-digit email code.');
    // Count every attempt atomically before comparing; an email code permits at most five guesses.
    const check=await env.DB.prepare(`UPDATE email_verifications SET attempts=attempts+1 WHERE id=? AND session_hash=?
      AND consumed_at IS NULL AND expires>? AND attempts<5 RETURNING *`).bind(id,current.token_hash,now).first();
    if(!check||check.code_hash!==await mac(env,'email:'+id+':'+code))throw new HttpError(400,'Incorrect or expired code.');
    const proof=check.code_hash+':'+randomHex(16);
    const consumedGuard='EXISTS (SELECT 1 FROM email_verifications WHERE id=? AND session_hash=? AND consumed_at=? AND code_hash=?)';
    const proofArgs=[id,current.token_hash,now,proof];
    const updates=[
      env.DB.prepare(`UPDATE email_verifications SET consumed_at=?,code_hash=? WHERE id=? AND session_hash=?
        AND consumed_at IS NULL AND expires>? AND code_hash=? AND EXISTS (SELECT 1 FROM stations WHERE code=email_verifications.station_code
          AND status NOT IN ('deleted','suspended') AND ((email_verifications.purpose='registration' AND status='pending_email')
          OR (email_verifications.purpose='edit' AND email_verified_at IS NOT NULL))) RETURNING station_code,purpose`).bind(now,proof,id,current.token_hash,now,check.code_hash),
      env.DB.prepare(`UPDATE sessions SET owner_station=?,owner_expires=? WHERE token_hash=? AND ${consumedGuard}`)
        .bind(check.station_code,now+1800,current.token_hash,...proofArgs)
    ];
    if(check.purpose==='registration')updates.push(env.DB.prepare(`UPDATE stations SET email_verified_at=?,
      status='pending_review',updated_at=? WHERE code=? AND status='pending_email' AND ${consumedGuard}`).bind(now,now,check.station_code,...proofArgs));
    const results=await env.DB.batch(updates);
    const consumed=results[0]?.results?.[0];
    if(!consumed)throw new HttpError(400,'Incorrect or expired code.');
    const currentStation=await stationState(env,consumed.station_code);
    if(currentStation.station)await attachStreamCheck(env,current.token_hash,consumed.station_code,(currentStation.pending||currentStation.station).stream_url,currentStation.pending?.revision||'initial',now);
    const approved=await screenStation(env,consumed.station_code,fetch,now);
    const afterCheck=await stationState(env,consumed.station_code),streamRequired=afterCheck.station?!await streamPublicationAllowed(env,afterCheck.station,afterCheck.pending,now):true;
    return json({status:'ok',message:approved?'Station added successfully!':consumed.purpose==='registration'?(streamRequired?'Email verified. Test your stream before saving your station.':'Email verified. Your station is awaiting safety review.'):'Signed in.',station_code:String(consumed.station_code),owner_expires:now+1800,server_time:now,registration_completed:consumed.purpose==='registration',review_required:consumed.purpose==='registration'&&!approved,stream_check_required:streamRequired});
  }
  if(path==='/api/owner/station'){
    if(!current.owner_station||current.owner_expires<=now)throw new HttpError(401,'Please sign in.');
    const {station,pending}=await stationState(env,current.owner_station);
    if(!station||['deleted','suspended'].includes(station.status))throw new HttpError(403,'Station cannot be edited.');
    if(typeof body.revision!=='string'||body.revision!==await ownerRevision(env,station,pending))throw new HttpError(409,'This station has changed. Review the latest saved version before saving again.');
    const draft=pending||station,name=stationName(body.name===undefined?draft.name:body.name),url=streamUrl(body.stream_url),bio=String(body.bio||'').trim(),metadata=stationMetadata(body,draft);
    if(bio.length>250)throw new HttpError(400,'Bio must be 250 characters or fewer.');
    const streamSave=await requireStreamSaveCheck(env,current.token_hash,url,now,station);
    await assertStreamSaveCheck(env,streamSave);
    const key=body.artwork?await artwork(env,body.artwork,undefined,()=>assertStreamSaveCheck(env,streamSave)):draft.artwork_key;
    const guard=stationStateGuard(station,pending),editRevision=randomHex(16);
    if(name===draft.name&&url===draft.stream_url&&bio===draft.bio&&key===draft.artwork_key&&metadata.language===draft.language&&metadata.category===draft.category&&metadata.zip_code===draft.zip_code){
      await assertStreamSaveCheck(env,streamSave);
      if(!await env.DB.prepare('SELECT 1 WHERE '+guard.sql).bind(...guard.values).first())throw new HttpError(409,'This station has changed. Review the latest saved version before saving again.');
      await attachStreamCheck(env,current.token_hash,station.code,url,pending?.revision||'initial',now,streamSave);
      await assertStreamSaveCheck(env,streamSave);
      const approved=station.status==='published'&&!pending?true:await screenStation(env,station.code,fetch,now,pending?.revision);
      const latest=await stationState(env,station.code);
      const sameTarget=latest.pending?.revision===pending?.revision&&(latest.pending||latest.station?.name===name&&latest.station?.stream_url===url&&latest.station?.bio===bio&&latest.station?.artwork_key===key&&latest.station?.language===metadata.language&&latest.station?.category===metadata.category&&latest.station?.zip_code===metadata.zip_code),promoted=approved&&!latest.pending&&latest.station?.status==='published'&&latest.station.name===name&&latest.station.stream_url===url&&latest.station.bio===bio&&latest.station.artwork_key===key&&latest.station.language===metadata.language&&latest.station.category===metadata.category&&latest.station.zip_code===metadata.zip_code;
      if(!latest.station||['deleted','suspended'].includes(latest.station.status)||!sameTarget&&!promoted)throw new HttpError(409,'This station changed. Refresh and review it again.');
      const streamRequired=!await streamPublicationAllowed(env,latest.station,latest.pending,now);
      return json({status:'ok',unchanged:station.status==='published'&&!pending||!approved,review_required:!approved,stream_check_required:streamRequired,message:station.status==='published'&&!pending?'No changes to save.':approved?'Station saved successfully.':streamRequired?'Your stream check is no longer current. Test your stream again before saving.':'Station saved for safety review.'});
    }
    const changed=await env.DB.prepare(`INSERT INTO station_edits(station_code,revision,base_updated_at,stream_url,bio,artwork_key,created_at,name,language,category,zip_code)
      SELECT ?,?,?,?,?,?,?,?,?,?,? WHERE ${guard.sql} AND ${streamSave.sql}
      ON CONFLICT(station_code) DO UPDATE SET revision=excluded.revision,base_updated_at=excluded.base_updated_at,stream_url=excluded.stream_url,bio=excluded.bio,artwork_key=excluded.artwork_key,created_at=excluded.created_at,name=excluded.name,language=excluded.language,category=excluded.category,zip_code=excluded.zip_code RETURNING revision`)
      .bind(station.code,editRevision,station.updated_at,url,bio,key,now,name,metadata.language,metadata.category,metadata.zip_code,...guard.values,...streamSave.values).first();
    if(!changed){
      if(body.artwork&&key!==draft.artwork_key)try{if(!await env.DB.prepare('SELECT 1 FROM stations WHERE artwork_key=? UNION SELECT 1 FROM station_edits WHERE artwork_key=?').bind(key,key).first())await env.MEDIA.delete?.('sanitized/'+key);}catch{}
      await assertStreamSaveCheck(env,streamSave);throw new HttpError(409,'This station has changed. Review the latest saved version before saving again.');
    }
    await attachStreamCheck(env,current.token_hash,station.code,url,editRevision,now,streamSave);
    let approved=await screenStation(env,station.code,fetch,now,editRevision);
    const latest=await stationState(env,station.code);
    if(!latest.station||['deleted','suspended'].includes(latest.station.status))throw new HttpError(409,'This station has changed. Review the latest saved version before saving again.');
    if(latest.pending?.revision!==editRevision){
      approved=!latest.pending&&latest.station.status==='published'&&latest.station.name===name&&latest.station.stream_url===url&&latest.station.bio===bio&&latest.station.artwork_key===key&&latest.station.language===metadata.language&&latest.station.category===metadata.category&&latest.station.zip_code===metadata.zip_code;
      if(!approved)throw new HttpError(409,'This station has changed. Review the latest saved version before saving again.');
    }
    const streamRequired=!await streamPublicationAllowed(env,latest.station,latest.pending,now);
    return json({status:'ok',review_required:!approved,stream_check_required:streamRequired,message:approved?'Changes saved successfully.':streamRequired?'Your stream check is no longer current. Test your stream again before saving.':'Changes saved for safety review.'});
  }
  return null;
}
