import {publicStreamUrl} from './public-stream-url.mjs';
import {randomHex,HttpError} from './security.mjs';

export const STREAM_CHECK_LIFETIME=3600;
const requiredCheck=()=>new HttpError(428,'Test your stream and get a pass before saving.');
// Saving is stricter than publication review: a new registration/stream must
// have a fresh receipt from THIS browser. Capture its server nonce so a newer
// check (even another pass) cannot silently replace the proof during an await.
export async function requireStreamSaveCheck(env,sessionHash,url,now,station){
 const canonical=publicStreamUrl(url);
 let approvedUrl;try{if(station?.status==='published')approvedUrl=publicStreamUrl(station.stream_url);}catch{}
 if(station?.status==='published'&&approvedUrl===canonical)return {
  sql:"EXISTS(SELECT 1 FROM stations save_live WHERE save_live.code=? AND save_live.status='published' AND save_live.stream_url=?)",values:[station.code,station.stream_url]
 };
 const receipt=await env.DB.prepare(`SELECT result.check_id FROM stream_check_results result JOIN sessions source_session ON source_session.token_hash=result.session_hash
  WHERE result.session_hash=? AND result.stream_url=? AND result.checked_at>0 AND result.checked_at<=? AND result.expires>MAX(?,unixepoch()) AND source_session.expires>MAX(?,unixepoch())`)
  .bind(sessionHash,canonical,now,now,now).first();
 if(!receipt||!/^[a-f0-9]{32}$/.test(receipt.check_id))throw requiredCheck();
 return {sql:`EXISTS(SELECT 1 FROM stream_check_results save_receipt JOIN sessions save_session ON save_session.token_hash=save_receipt.session_hash
  WHERE save_receipt.session_hash=? AND save_receipt.stream_url=? AND save_receipt.check_id=? AND save_receipt.checked_at>0 AND save_receipt.checked_at<=? AND save_receipt.expires>MAX(?,unixepoch()) AND save_session.expires>MAX(?,unixepoch()))`,values:[sessionHash,canonical,receipt.check_id,now,now,now]};
}
export async function assertStreamSaveCheck(env,guard){
 if(!await env.DB.prepare('SELECT 1 WHERE '+guard.sql).bind(...guard.values).first())throw requiredCheck();
}
const changes=result=>Number(result?.meta?.changes??result?.changes??0)>0;
function target(station,pending){
 try{
  const code=Number(station?.code),revision=pending?.revision||'initial';
  if(!Number.isSafeInteger(code)||code<10||typeof revision!=='string'||revision!=='initial'&&!/^[a-f0-9]{32}$/.test(revision))return null;
  return {code,url:publicStreamUrl(pending?.stream_url??station?.stream_url),revision};
 }catch{return null;}
}
function currentTarget(code,url,revision){
 return revision==='initial'?{
  sql:`EXISTS(SELECT 1 FROM stations stream_live WHERE stream_live.code=? AND stream_live.stream_url=? AND stream_live.status IN ('pending_email','pending_review','published') AND NOT EXISTS(SELECT 1 FROM station_edits stream_edit WHERE stream_edit.station_code=stream_live.code))`,values:[code,url]
 }:{
  sql:`EXISTS(SELECT 1 FROM station_edits stream_edit JOIN stations stream_live ON stream_live.code=stream_edit.station_code WHERE stream_edit.station_code=? AND stream_edit.stream_url=? AND stream_edit.revision=? AND stream_edit.base_updated_at=stream_live.updated_at AND stream_live.status IN ('pending_review','published'))`,values:[code,url,revision]
 };
}

// Reserving the current server attempt prevents a slower, older check from
// restoring evidence after a newer failure in another tab of the same session.
export async function beginStreamCheck(env,sessionHash,url,now){
 const canonical=publicStreamUrl(url),id=randomHex(16);
 await env.DB.batch([
  env.DB.prepare(`INSERT INTO stream_check_results(session_hash,stream_url,check_id,checked_at,expires) VALUES (?,?,?,0,?) ON CONFLICT(session_hash,stream_url) DO UPDATE SET check_id=excluded.check_id,checked_at=0,expires=excluded.expires`).bind(sessionHash,canonical,id,now+STREAM_CHECK_LIFETIME),
  env.DB.prepare('UPDATE station_stream_checks SET checked_at=0,expires=0 WHERE session_hash=? AND stream_url=?').bind(sessionHash,canonical)
 ]);
 return id;
}
export async function completeStreamCheck(env,sessionHash,url,id,passed,now){
 const canonical=publicStreamUrl(url);
 if(passed)return changes(await env.DB.prepare('UPDATE stream_check_results SET checked_at=?,expires=? WHERE session_hash=? AND stream_url=? AND check_id=?').bind(now,now+STREAM_CHECK_LIFETIME,sessionHash,canonical,id).run());
 const results=await env.DB.batch([
  env.DB.prepare(`UPDATE station_stream_checks SET checked_at=0,expires=0 WHERE session_hash=? AND stream_url=? AND EXISTS(SELECT 1 FROM stream_check_results result WHERE result.session_hash=? AND result.stream_url=? AND result.check_id=?)`).bind(sessionHash,canonical,sessionHash,canonical,id),
  env.DB.prepare('DELETE FROM stream_check_results WHERE session_hash=? AND stream_url=? AND check_id=?').bind(sessionHash,canonical,id)
 ]);
 return changes(results[1]);
}
export async function attachStreamCheck(env,sessionHash,stationCode,url,revision,now,saveGuard={sql:'1',values:[]}){
 let canonical;try{canonical=publicStreamUrl(url);}catch{return false;}
 const selected=target({code:stationCode,stream_url:canonical},revision==='initial'?null:{revision,stream_url:canonical});if(!selected)return false;
 const guard=currentTarget(selected.code,canonical,selected.revision);
 const result=await env.DB.prepare(`INSERT INTO station_stream_checks(station_code,stream_url,revision,checked_at,expires,review_requested_at,session_hash)
  SELECT ?,?,?,receipt.checked_at,receipt.expires,NULL,receipt.session_hash FROM stream_check_results receipt JOIN sessions source_session ON source_session.token_hash=receipt.session_hash
  WHERE receipt.session_hash=? AND receipt.stream_url=? AND receipt.checked_at>0 AND receipt.checked_at<=? AND receipt.expires>MAX(?,unixepoch()) AND source_session.expires>MAX(?,unixepoch()) AND ${guard.sql} AND ${saveGuard.sql}
  ON CONFLICT(station_code,stream_url) DO UPDATE SET revision=excluded.revision,checked_at=excluded.checked_at,expires=excluded.expires,review_requested_at=NULL,session_hash=excluded.session_hash`)
  .bind(selected.code,canonical,selected.revision,sessionHash,canonical,now,now,now,...guard.values,...saveGuard.values).run();
 return changes(result);
}
export function streamPublicationGuard(station,pending,now){
 const selected=target(station,pending);if(!selected)return {sql:'0',values:[]};
 let approvedUrl;try{approvedUrl=publicStreamUrl(station.stream_url);}catch{}
 if(station.status==='published'&&approvedUrl===selected.url)return {
  sql:"EXISTS(SELECT 1 FROM stations stream_live WHERE stream_live.code=? AND stream_live.status='published' AND stream_live.stream_url=?)",values:[selected.code,station.stream_url]
 };
 const guard=currentTarget(selected.code,selected.url,selected.revision);
 return {sql:`(${guard.sql} AND EXISTS(SELECT 1 FROM station_stream_checks evidence WHERE evidence.station_code=? AND evidence.stream_url=? AND evidence.revision=? AND evidence.checked_at>0 AND evidence.checked_at<=? AND evidence.expires>MAX(?,unixepoch())))`,values:[...guard.values,selected.code,selected.url,selected.revision,now,now]};
}
export async function streamPublicationAllowed(env,station,pending,now){
 const guard=streamPublicationGuard(station,pending,now);return !!await env.DB.prepare('SELECT 1 WHERE '+guard.sql).bind(...guard.values).first();
}
export async function requestStreamReview(env,station,pending,now){
 const selected=target(station,pending);if(!selected)return {status:'needs_check'};
 const guard=currentTarget(selected.code,selected.url,selected.revision);
 await env.DB.prepare(`INSERT INTO station_stream_checks(station_code,stream_url,revision,checked_at,expires,review_requested_at,session_hash)
  SELECT ?,?,?,0,0,?,NULL WHERE ${guard.sql} AND EXISTS(SELECT 1 FROM stations review_live WHERE review_live.code=? AND review_live.email_verified_at IS NOT NULL AND review_live.status IN ('pending_review','published'))
  ON CONFLICT(station_code,stream_url) DO UPDATE SET revision=excluded.revision,
  checked_at=CASE WHEN station_stream_checks.revision=excluded.revision THEN station_stream_checks.checked_at ELSE 0 END,
  expires=CASE WHEN station_stream_checks.revision=excluded.revision THEN station_stream_checks.expires ELSE 0 END,
  session_hash=CASE WHEN station_stream_checks.revision=excluded.revision THEN station_stream_checks.session_hash ELSE NULL END,
  review_requested_at=excluded.review_requested_at`).bind(selected.code,selected.url,selected.revision,now,...guard.values,selected.code).run();
 return streamOwnerStatus(env,station,pending,now);
}
export async function streamOwnerStatus(env,station,pending,now,sessionHash){
 const selected=target(station,pending);if(!selected)return {status:'needs_check'};
 const current=currentTarget(selected.code,selected.url,selected.revision);
 if(!await env.DB.prepare('SELECT 1 WHERE '+current.sql).bind(...current.values).first())return {status:'needs_check'};
 const evidence=await env.DB.prepare('SELECT checked_at,expires,review_requested_at FROM station_stream_checks WHERE station_code=? AND stream_url=? AND revision=?').bind(selected.code,selected.url,selected.revision).first();
 if(await streamPublicationAllowed(env,station,pending,now))return {status:'passed',checked_at:evidence?.checked_at||null,expires:evidence?.expires||null,review_requested_at:evidence?.review_requested_at||null};
 if(sessionHash){const receipt=await env.DB.prepare(`SELECT result.checked_at,result.expires FROM stream_check_results result JOIN sessions source_session ON source_session.token_hash=result.session_hash WHERE result.session_hash=? AND result.stream_url=? AND result.checked_at>0 AND result.checked_at<=? AND result.expires>? AND source_session.expires>?`).bind(sessionHash,selected.url,now,now,now).first();if(receipt)return {status:'passed',checked_at:receipt.checked_at,expires:receipt.expires,review_requested_at:evidence?.review_requested_at||null};}
 return {status:evidence?.review_requested_at?'review_requested':'needs_check',checked_at:null,expires:null,review_requested_at:evidence?.review_requested_at||null};
}
