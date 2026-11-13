import {mac,HttpError} from './security.mjs';
import {streamPublicationGuard} from './stream-verification.mjs';
export const stationColumns='code,name,bio,stream_url,contact_email,artwork_key,status,email_verified_at,updated_at,language,category';
export function stationName(value){
 const name=String(value||'').trim();if(!name)throw new HttpError(400,'Enter a station name.');
 if(/[\x00-\x1f\x7f]/.test(name)||new TextEncoder().encode(name).length>96)throw new HttpError(400,'Shorten the station name so it fits on the radio.');
 return name;
}
export async function stationState(env,code){
 const station=await env.DB.prepare('SELECT '+stationColumns+' FROM stations WHERE code=?').bind(code).first();
 if(!station)return {station:null,pending:null};
 const pending=await env.DB.prepare('SELECT station_code,revision,base_updated_at,stream_url,bio,artwork_key,created_at,name,language,category FROM station_edits WHERE station_code=?').bind(code).first();
 return {station,pending};
}
export async function ownerRevision(env,station,pending){return mac(env,'owner-station:'+JSON.stringify([station,pending]));}
// Recheck both the approved row and exact proposal after every asynchronous step.
export function stationStateGuard(station,pending){
 const sql=`EXISTS (SELECT 1 FROM stations live WHERE live.code=? AND live.name=? AND live.bio=? AND live.stream_url=? AND live.contact_email=? AND live.artwork_key IS ? AND live.status=? AND live.email_verified_at IS ? AND live.updated_at=? AND live.language=? AND live.category=?) AND `+
  (pending?'EXISTS (SELECT 1 FROM station_edits proposal WHERE proposal.station_code=? AND proposal.revision=? AND proposal.name=? AND proposal.language=? AND proposal.category=?)':'NOT EXISTS (SELECT 1 FROM station_edits proposal WHERE proposal.station_code=?)');
 const values=[station.code,station.name,station.bio,station.stream_url,station.contact_email,station.artwork_key,station.status,station.email_verified_at,station.updated_at,station.language,station.category,station.code,...(pending?[pending.revision,pending.name,pending.language,pending.category]:[])];
 return {sql,values};
}
export function publishStationEdit(env,station,pending,now,streamOverride=false){
 const guard=stationStateGuard(station,pending),stream=streamOverride?{sql:'1=1',values:[]}:streamPublicationGuard(station,pending,now);
 return env.DB.prepare(`UPDATE stations SET name=?,stream_url=?,bio=?,artwork_key=?,language=?,category=?,status='published',updated_at=? WHERE code=? AND ${guard.sql} AND ${stream.sql}`)
  .bind(stationName(pending.name),pending.stream_url,pending.bio,pending.artwork_key,pending.language,pending.category,Math.max(now,station.updated_at+1),station.code,...guard.values,...stream.values);
}
