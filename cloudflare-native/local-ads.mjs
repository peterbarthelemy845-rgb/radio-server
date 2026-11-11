import {json,readJson,session,browserWrite,limit,human,randomHex,digest,mac,HttpError} from './security.mjs';
import {artwork} from './owner-auth.mjs';import {scanCreative} from './moderation.mjs';import {adPixels} from './ad-pixels.mjs';import {authenticate} from './devices.mjs';
import {decisionReason,ownerNotification,commitOwnerNotification} from './notifications.mjs';
const RIGHTS='I am authorized to advertise this business and have rights to the submitted text and artwork. I permit screening and display on compatible radios.';
const VERSION='local-business-submissions-2026-11-03';
const activeAds="a.status IN ('pending_review','approved') AND (p.end_at IS NULL OR p.end_at>?)";
function adSubmissionResponse(row){return json({status:'ok',reference:row.ad_id,message:row.scanner_passed?'Advertisement submitted for station-owner approval.':'Advertisement submitted for administrator and station-owner review.'});}
async function admin(env,current,now){return env.ADMIN_TOTP_SECRET&&await env.DB.prepare('SELECT 1 FROM admin_sessions a JOIN admin_mfa_sessions m ON a.session_hash=m.session_hash WHERE a.session_hash=? AND a.expires>? AND m.expires>?').bind(current.token_hash,now,now).first();}
async function owner(env,current,code,now){return current.owner_expires>now&&current.owner_station===code;}
export async function adsRoutes(request,env,now,deps={human,artwork,scanCreative,adPixels}){
 const url=new URL(request.url),path=url.pathname;if(!['/api/ads/submit','/api/owner/ads','/api/admin/ads','/api/radio/ad','/api/radio/ad/displayed','/api/radio/ad/pixels'].includes(path)&&!/^\/api\/ad-artwork\/[a-f0-9]{32}$/.test(path))return null;
 if(path.startsWith('/api/radio/'))return radioAds(request,env,now);
 const current=request.method==='GET'?await session(request,env,now):await browserWrite(request,env,now);
 if(path==='/api/ads/submit'&&request.method==='POST'){
  const ip=request.headers.get('CF-Connecting-IP')||'unknown';await limit(env.DB,'ad-submit-attempt-ip',ip,20,900,now);await limit(env.DB,'ad-submit-attempt-global','all',60,60,now);
  const body=await readJson(request,4300000);await deps.human(request,env,body.turnstile_token,'advertise-submit',now);
  const code=Number(body.station_code);if(!Number.isInteger(code)||code<10||code>999999)throw new HttpError(400,'Choose a valid station.');
  for(const [field,max] of [['business',32],['message',42],['email',254]])if(typeof body[field]!=='string'||!body[field].trim()||body[field].length>max||/[\x00-\x1f]/.test(body[field]))throw new HttpError(400,'Check the business name, message, phone and email.');
  if(!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(body.email.trim())||body.rights_confirmed!==true)throw new HttpError(400,'Enter your email and confirm advertisement rights.');
  if(typeof body.phone!=='string'||body.phone.length>32||/[\x00-\x1f]/.test(body.phone))throw new HttpError(400,'Check the phone number.');
  const parseDate=value=>{if(!value)return null;if(!/^20\d{2}-\d{2}-\d{2}$/.test(value))throw new HttpError(400,'Check advertisement dates.');const stamp=Date.parse(value+'T00:00:00Z')/1000;if(!Number.isFinite(stamp)||new Date(stamp*1000).toISOString().slice(0,10)!==value)throw new HttpError(400,'Check advertisement dates.');return stamp;};
  const startDate=parseDate(body.start_date),endDate=parseDate(body.end_date),payloadHash=await digest(JSON.stringify([code,body.business.trim(),body.message.trim(),body.email.trim().toLowerCase(),body.phone.trim(),body.start_date||'',body.end_date||'',VERSION,body.artwork?.name,body.artwork?.base64]));
  let requestId=body.request_id;if(requestId!==undefined&&(typeof requestId!=='string'||!/^[a-f0-9]{32}$/.test(requestId)))throw new HttpError(400,'Refresh the advertisement form and try again.');
  // Existing open forms also get a stable session-scoped retry identity.
  if(requestId===undefined)requestId=(await mac(env,'legacy-ad:'+current.token_hash+':'+payloadHash)).slice(0,32);
  const prior=await env.DB.prepare('SELECT * FROM ad_requests WHERE session_hash=? AND request_id=?').bind(current.token_hash,requestId).first();
  if(prior&&prior.payload_hash!==payloadHash)throw new HttpError(409,'Advertisement details changed. Start a new submission.');
  if(prior?.expires<=now)throw new HttpError(409,'This advertisement request expired. Start a new submission.');
  if(prior?.state==='complete')return adSubmissionResponse(prior);
  if(prior?.lease_until>now)throw new HttpError(409,'This advertisement is still processing. Please try again shortly.');
  if(!await env.DB.prepare("SELECT 1 FROM stations WHERE code=? AND status='published'").bind(code).first())throw new HttpError(404,'Station not found.');
  const quota=await env.DB.prepare(`SELECT (SELECT count(*) FROM local_ads a LEFT JOIN ad_policy p ON p.ad_id=a.id WHERE a.station_code=? AND ${activeAds}) station_count,(SELECT count(*) FROM local_ads a LEFT JOIN ad_policy p ON p.ad_id=a.id WHERE ${activeAds}) total_count`).bind(code,now,now).first();if(quota.station_count>=20||quota.total_count>=200)throw new HttpError(409,'Ad limit reached.');
  const startAt=startDate||prior?.created_at||now,endAt=endDate?endDate+86400:startAt+30*86400;if(startAt<now-86400||startAt>now+365*86400||endAt<=startAt||endAt>startAt+90*86400)throw new HttpError(400,'Choose an ad period of up to 90 days.');
  const lease=randomHex(16),claimed=await env.DB.prepare(`INSERT INTO ad_requests(session_hash,request_id,payload_hash,lease_token,lease_until,ad_id,created_at,expires)
   VALUES (?,?,?,?,?,?,?,?) ON CONFLICT(session_hash,request_id) DO UPDATE SET lease_token=excluded.lease_token,lease_until=excluded.lease_until
   WHERE state='pending' AND lease_until<=? AND payload_hash=excluded.payload_hash RETURNING *`).bind(current.token_hash,requestId,payloadHash,lease,now+120,randomHex(16),now,now+86400,now).first();
  if(!claimed)throw new HttpError(409,'This advertisement is still processing. Please try again shortly.');
  // Keep an early short abuse window, but reserve the day-long processing
  // allowance for validated submissions that passed the bot check.
  try{
   if(!claimed.allowance_reserved){await limit(env.DB,'ad-submit-ip',ip,5,86400,now);await limit(env.DB,'ad-submit-authorized','all',60,86400,now);await env.DB.prepare("UPDATE ad_requests SET allowance_reserved=1 WHERE session_hash=? AND request_id=? AND lease_token=? AND state='pending'").bind(current.token_hash,requestId,lease).run();}
   // Separate pilot processing budgets bound repeated failed attempts of one
   // draft. Completed retries above never spend this CPU/media allowance.
   // Increase these alongside the validated-submission limits as usage grows.
   await limit(env.DB,'ad-processing-ip',ip,15,86400,now);await limit(env.DB,'ad-processing-global','all',120,86400,now);
   // One stable private object per draft lets a failed transaction retry without
   // creating orphan copies. Do not delete these keys in a stale lease's catch:
   // a newer retry may already be using the same objects.
   const key=await deps.artwork(env,body.artwork,await mac(env,'ad-artwork:'+current.token_hash+':'+requestId)+'.png'),object=await env.MEDIA.get('sanitized/'+key);let pixels;
   try{const resized=(await env.IMAGES.input(object.body).transform({width:256,height:76,fit:'cover'}).output({format:'image/png',anim:false})).response();if(!resized.ok)throw Error();pixels=await deps.adPixels(await resized.arrayBuffer());}catch{throw new HttpError(400,'The sponsor image could not be prepared. Try another image.');}
   const pixelsKey=await mac(env,'ad-pixels:'+current.token_hash+':'+requestId)+'.bin';await env.MEDIA.put('ad-pixels/'+pixelsKey,pixels,{httpMetadata:{contentType:'application/octet-stream'},customMetadata:{pixel_version:'1'}});
   const safe=await deps.scanCreative(env,body.business+'\n'+body.message+'\n'+body.phone,key),id=claimed.ad_id,guard="session_hash=? AND request_id=? AND lease_token=? AND state='pending'",values=[current.token_hash,requestId,lease];
   await env.DB.batch([
   env.DB.prepare(`INSERT INTO local_ads(id,station_code,business,contact_email,message,artwork_key,created_at)
    SELECT ?,?,?,?,?,?,? WHERE EXISTS(SELECT 1 FROM ad_requests WHERE ${guard}) AND (SELECT count(*) FROM local_ads a LEFT JOIN ad_policy p ON p.ad_id=a.id WHERE a.station_code=? AND ${activeAds})<20 AND (SELECT count(*) FROM local_ads a LEFT JOIN ad_policy p ON p.ad_id=a.id WHERE ${activeAds})<200 AND EXISTS (SELECT 1 FROM stations WHERE code=? AND status='published')`)
    .bind(id,code,body.business.trim(),body.email.trim().toLowerCase(),body.message.trim(),key,claimed.created_at,...values,code,now,now,code),
   env.DB.prepare(`INSERT INTO ad_policy(ad_id,phone,scanner_passed,pixels_key,start_at,end_at,rights_version,rights_hash) SELECT ?,?,?,?,?,?,?,? WHERE EXISTS(SELECT 1 FROM local_ads WHERE id=?) AND EXISTS(SELECT 1 FROM ad_requests WHERE ${guard})`).bind(id,body.phone.trim(),safe?1:0,pixelsKey,startAt,endAt,VERSION,await digest(RIGHTS),id,...values),
   env.DB.prepare(`UPDATE ad_requests SET state='complete',scanner_passed=?,lease_until=0 WHERE ${guard} AND EXISTS(SELECT 1 FROM ad_policy WHERE ad_id=ad_requests.ad_id)`).bind(safe?1:0,...values)
   ]);
   const completed=await env.DB.prepare("SELECT * FROM ad_requests WHERE session_hash=? AND request_id=? AND state='complete'").bind(current.token_hash,requestId).first();if(!completed)throw new HttpError(409,'Ad limit reached or station unavailable.');return adSubmissionResponse(completed);
  }catch(error){try{await env.DB.prepare("UPDATE ad_requests SET lease_until=0 WHERE session_hash=? AND request_id=? AND lease_token=? AND state='pending'").bind(current.token_hash,requestId,lease).run();}catch{}throw error;}
 }
 const isAdmin=await admin(env,current,now);
 const art=path.match(/^\/api\/ad-artwork\/([a-f0-9]{32})$/);
 if(art&&request.method==='GET'){
  const ad=await env.DB.prepare("SELECT station_code,artwork_key FROM local_ads WHERE id=? AND status!='deleted'").bind(art[1]).first();if(!ad||(!isAdmin&&!await owner(env,current,ad.station_code,now)))throw new HttpError(404,'Artwork not found.');
  const object=await env.MEDIA.get('sanitized/'+ad.artwork_key);if(!object||object.customMetadata?.sanitizer_version!=='1')throw new HttpError(404,'Artwork not found.');return new Response(object.body,{headers:{'Content-Type':'image/png','Cache-Control':'private, no-store','X-Content-Type-Options':'nosniff','Content-Security-Policy':"default-src 'none'; sandbox"}});
 }
 const administrative=path==='/api/admin/ads';if(administrative?!isAdmin:(!current.owner_station||current.owner_expires<=now))throw new HttpError(403,'Please sign in.');
 if(request.method==='GET'){
  const rows=await env.DB.prepare(`SELECT a.id,a.station_code,a.business,a.message,a.status,a.contact_email,p.scanner_passed,p.owner_approved,p.end_at,p.phone,(SELECT count(*) FROM ad_impressions i WHERE i.ad_id=a.id) AS reported_displays FROM local_ads a JOIN ad_policy p ON p.ad_id=a.id WHERE a.status!='deleted' AND (?=1 OR a.station_code=?) ORDER BY a.created_at DESC LIMIT 200`).bind(isAdmin&&administrative?1:0,current.owner_station||0).all();return json({ads:rows.results,free_pilot:true});
 }
 if(request.method!=='POST')throw new HttpError(405,'Method not allowed.');
 await limit(env.DB,'ad-review',current.token_hash,60,900,now);const body=await readJson(request),ad=await env.DB.prepare("SELECT a.*,p.scanner_passed,p.owner_approved,s.contact_email AS owner_contact_email,s.email_verified_at AS owner_verified_at FROM local_ads a JOIN ad_policy p ON p.ad_id=a.id JOIN stations s ON s.code=a.station_code WHERE a.id=? AND a.status!='deleted'").bind(String(body.id||'')).first();
 if(!ad||(!administrative&&ad.station_code!==current.owner_station))throw new HttpError(404,'Ad not found.');
 if(!['delete',administrative?'clear':'approve'].includes(body.action))throw new HttpError(400,'Choose an available action.');
 if(body.action==='clear'&&ad.scanner_passed===1||body.action==='approve'&&ad.status==='approved'&&ad.owner_approved===1)return json({status:'ok',notification_queued:false});
 if(body.action==='approve'&&!ad.scanner_passed)throw new HttpError(409,'Administrator review is required first.');
 const reason=decisionReason(body.reason,body.action==='delete'?'This advertisement is no longer approved for display.':''),notice=ad.owner_verified_at?await ownerNotification(env,{kind:{delete:'ad-removed',clear:'ad-cleared',approve:'ad-approved'}[body.action],stationCode:ad.station_code,recipient:ad.owner_contact_email,event:[ad.id,ad.created_at,ad.business,ad.message,ad.artwork_key,ad.status,ad.scanner_passed,ad.owner_approved],adId:ad.id,reason}):null;
 const reviewed='a.id=? AND a.station_code=? AND a.business=? AND a.message=? AND a.artwork_key IS ? AND a.contact_email=? AND a.created_at=? AND a.status=? AND p.scanner_passed=? AND p.owner_approved=? AND s.contact_email=? AND s.email_verified_at IS ?',values=[ad.id,ad.station_code,ad.business,ad.message,ad.artwork_key,ad.contact_email,ad.created_at,ad.status,ad.scanner_passed,ad.owner_approved,ad.owner_contact_email,ad.owner_verified_at];
 const mutation=body.action==='clear'?
  env.DB.prepare(`UPDATE ad_policy SET scanner_passed=1 WHERE ad_id=? AND EXISTS (SELECT 1 FROM local_ads a JOIN ad_policy p ON p.ad_id=a.id JOIN stations s ON s.code=a.station_code WHERE ${reviewed})`).bind(ad.id,...values):
  env.DB.prepare(`UPDATE local_ads SET status=? WHERE id=? AND EXISTS (SELECT 1 FROM local_ads a JOIN ad_policy p ON p.ad_id=a.id JOIN stations s ON s.code=a.station_code WHERE ${reviewed})`).bind(body.action==='delete'?'deleted':'approved',ad.id,...values);
 const after=[];
 if(body.action==='approve')after.push({sql:'UPDATE ad_policy SET owner_approved=1 WHERE ad_id=? AND OWNER_NOTIFICATION_APPLIED',values:[ad.id]});
 if(administrative)after.push({sql:'INSERT INTO admin_audit(id,actor_hash,station_code,action,created_at) SELECT ?,?,?,?,? WHERE OWNER_NOTIFICATION_APPLIED',values:[randomHex(16),current.token_hash,ad.station_code,(body.action==='clear'?'ad-safety-clear:':'ad-delete:')+ad.id,now]});
 if(!await commitOwnerNotification(env,now,mutation,notice,after))throw new HttpError(409,'Advertisement changed. Refresh and review it again.');
 return json({status:'ok',notification_queued:Boolean(notice?.queued)});
}
async function radioAds(request,env,now){const url=new URL(request.url),path=url.pathname;
 if(path==='/api/radio/ad/pixels'&&request.method==='GET'){
  const token=url.searchParams.get('token')||'';if(!/^[a-f0-9]{64}$/.test(token))throw new HttpError(404,'Ad unavailable.');
  const receipt=await env.DB.prepare(`SELECT r.radio_id,p.pixels_key FROM ad_receipts r JOIN local_ads a ON a.id=r.ad_id JOIN ad_policy p ON p.ad_id=a.id JOIN stations s ON s.code=a.station_code WHERE r.token_hash=? AND r.expires>? AND a.status='approved' AND p.scanner_passed=1 AND p.owner_approved=1 AND s.status='published'`).bind(await digest(token),now).first();
  if(!receipt)throw new HttpError(404,'Ad unavailable.');await authenticate(request,env.DB,{radio_id:receipt.radio_id});
  const object=await env.MEDIA.get('ad-pixels/'+receipt.pixels_key);if(!object||object.size!==38912||object.customMetadata?.pixel_version!=='1')throw new HttpError(404,'Ad unavailable.');return new Response(object.body,{headers:{'Content-Type':'application/octet-stream','Content-Length':'38912','Cache-Control':'private, no-store','X-Content-Type-Options':'nosniff'}});
 }
 if(request.method!=='POST')throw new HttpError(405,'Method not allowed.');const body=await readJson(request),id=await authenticate(request,env.DB,body);await limit(env.DB,'ad-radio',id,20,60,now);
 if(path==='/api/radio/ad/displayed'){
  await env.DB.prepare(`INSERT INTO ad_impressions(receipt_id,ad_id,created_at) SELECT r.id,r.ad_id,? FROM ad_receipts r JOIN local_ads a ON a.id=r.ad_id WHERE r.id=? AND r.radio_id=? AND r.expires>? AND a.status='approved' ON CONFLICT DO NOTHING`).bind(now,String(body.receipt||''),id,now).run();return json({status:'ok'});
 }
 const code=String(body.station_code||'');if(!/^\d{2,6}$/.test(code))return json({ad:null});
 const ad=await env.DB.prepare(`SELECT a.id,a.business,a.message,p.phone FROM local_ads a JOIN ad_policy p ON p.ad_id=a.id JOIN stations s ON s.code=a.station_code WHERE a.station_code=? AND a.status='approved' AND p.owner_approved=1 AND p.scanner_passed=1 AND p.start_at<=? AND p.end_at>? AND s.status='published' ORDER BY (SELECT count(*) FROM ad_impressions i WHERE i.ad_id=a.id),a.created_at LIMIT 1`).bind(Number(code),now,now).first();if(!ad)return json({ad:null});
 const receipt=randomHex(16),token=randomHex();
 // The display window and its receipt are one transaction. A storage failure
 // must not suppress advertising for thirty minutes without delivering an ad.
 await env.DB.batch([
  env.DB.prepare(`INSERT INTO ad_device_windows(radio_id,next_at) SELECT ?,? WHERE EXISTS
   (SELECT 1 FROM local_ads a JOIN ad_policy p ON p.ad_id=a.id JOIN stations s ON s.code=a.station_code
    WHERE a.id=? AND a.status='approved' AND p.owner_approved=1 AND p.scanner_passed=1 AND p.start_at<=? AND p.end_at>? AND s.status='published')
   ON CONFLICT(radio_id) DO UPDATE SET next_at=excluded.next_at WHERE ad_device_windows.next_at<=?`).bind(id,now+1800,ad.id,now,now,now),
  env.DB.prepare('INSERT INTO ad_receipts SELECT ?,?,?,?,?,? WHERE changes()>0').bind(receipt,id,ad.id,await digest(token),now+60,now)
 ]);
 if(!await env.DB.prepare('SELECT 1 FROM ad_receipts WHERE id=? AND radio_id=?').bind(receipt,id).first())return json({ad:null});
 return json({ad:{brand:ad.business,message:ad.message,phone:ad.phone,receipt,pixels_path:'/api/radio/ad/pixels?token='+token,width:256,height:76,expires_in:60}});
}
