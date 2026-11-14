import {json,session,browserWrite,readJson,limit,HttpError} from './security.mjs';import {administrator} from './access.mjs';
export async function recordListening(env,id,code,now){
 if(!/^\d{2,6}$/.test(String(code||''))||!await env.DB.prepare("SELECT 1 FROM stations WHERE code=? AND status='published'").bind(Number(code)).first()){await env.DB.prepare('DELETE FROM listening_sessions WHERE radio_id=? AND last_seen<=?').bind(id,now).run();return;}
 const boundary=Math.floor(now/86400)*86400,station=Number(code);
 const statements=[
  env.DB.prepare(`INSERT INTO listening_sessions(radio_id,station_code,started,last_seen) VALUES (?,?,?,?) ON CONFLICT(radio_id) DO UPDATE SET credit=CASE WHEN station_code=excluded.station_code AND last_seen>=?-90 AND ?-started>=60 THEN CASE WHEN qualified=0 THEN ?-started ELSE ?-last_seen END ELSE 0 END,qualified=CASE WHEN station_code=excluded.station_code AND last_seen>=?-90 THEN qualified ELSE 0 END,started=CASE WHEN station_code=excluded.station_code AND last_seen>=?-90 THEN started ELSE ? END,station_code=excluded.station_code,last_seen=? WHERE listening_sessions.last_seen<?`).bind(id,station,now,now,now,now,now,now,now,now,now,now,now),
 ];
 // Credit belongs to the interval before this report, not its arrival date.
 // Qualification plus the 90-second continuity bound limits normal credit to
 // under 150 seconds, so it can intersect at most these two UTC dates.
 for(const start of [boundary-86400,boundary]){
  const day=new Date(start*1000).toISOString().slice(0,10),month=day.slice(0,7);
  const interval=`WITH interval AS (SELECT station_code,radio_id,MAX(last_seen-credit,?) AS start_at,MIN(last_seen,?) AS end_at
   FROM listening_sessions WHERE radio_id=? AND last_seen=? AND credit>0)`;
  statements.push(
   env.DB.prepare(`${interval} INSERT INTO monthly_activity(month,station_code,radio_id,first_seen,last_seen)
    SELECT ?,station_code,radio_id,start_at,end_at FROM interval WHERE end_at>start_at
    ON CONFLICT(month,station_code,radio_id) DO UPDATE SET first_seen=MIN(monthly_activity.first_seen,excluded.first_seen),last_seen=MAX(monthly_activity.last_seen,excluded.last_seen)`)
    .bind(start,start+86400,id,now,month),
   env.DB.prepare(`${interval} INSERT INTO listening_daily(day,station_code,reported_seconds)
    SELECT ?,station_code,end_at-start_at FROM interval WHERE end_at>start_at
    ON CONFLICT(day,station_code) DO UPDATE SET reported_seconds=reported_seconds+excluded.reported_seconds`)
    .bind(start,start+86400,id,now,day)
  );
 }
 statements.push(env.DB.prepare('UPDATE listening_sessions SET qualified=CASE WHEN credit>0 THEN 1 ELSE qualified END,credit=0 WHERE radio_id=? AND last_seen=?').bind(id,now));
 await env.DB.batch(statements);
}
export async function reportsRoutes(request,env,now){const path=new URL(request.url).pathname;if(!['/api/events','/api/owner/reports','/api/admin/reports'].includes(path))return null;
 if(path==='/api/events'){
  if(request.method!=='POST')throw new HttpError(405,'Method not allowed.');const current=await browserWrite(request,env,now);await limit(env.DB,'share-ip',request.headers.get('CF-Connecting-IP')||'unknown',60,60,now);await limit(env.DB,'share-global','all',10000,86400,now);const body=await readJson(request,2048);
  if(!/^[a-f0-9]{32}$/.test(body.event_id||'')||!['facebook','whatsapp','more'].includes(body.channel)||!/^\d{2,6}$/.test(String(body.station_code)))throw new HttpError(400,'Invalid share event.');
  if(body.phase!==undefined&&!['attempt','outcome'].includes(body.phase))throw new HttpError(400,'Invalid share event phase.');
  if(body.phase==='outcome'){
   if(!['share_sheet_completed','cancelled','link_copied','manual_link_shown'].includes(body.outcome))throw new HttpError(400,'Invalid share outcome.');
   const record=await env.DB.prepare('SELECT s.session_hash,e.station_code,e.channel FROM share_event_states s JOIN share_events e ON e.id=s.event_id WHERE s.event_id=?').bind(body.event_id).first();
   if(!record||record.session_hash!==current.token_hash)throw new HttpError(404,'Share event not found.');
   if(record.station_code!==Number(body.station_code)||record.channel!==body.channel)throw new HttpError(409,'Share event does not match.');
   await env.DB.prepare("UPDATE share_event_states SET outcome=?,reported_at=? WHERE event_id=? AND session_hash=? AND outcome='attempted'").bind(body.outcome,now,body.event_id,current.token_hash).run();
   return json({status:'ok'});
  }
  const existing=await env.DB.prepare('SELECT session_hash FROM share_event_states WHERE event_id=?').bind(body.event_id).first();
  if(existing&&existing.session_hash!==current.token_hash)throw new HttpError(409,'This share event already exists.');
  await env.DB.batch([
   env.DB.prepare(`INSERT INTO share_events SELECT ?,?,?,? WHERE EXISTS(SELECT 1 FROM stations WHERE code=? AND status='published') ON CONFLICT(id) DO NOTHING`).bind(body.event_id,Number(body.station_code),body.channel,now,Number(body.station_code)),
   env.DB.prepare(`INSERT INTO share_event_states(event_id,session_hash,outcome,reported_at) SELECT ?,?,'attempted',? WHERE EXISTS(SELECT 1 FROM share_events WHERE id=? AND station_code=? AND channel=?) ON CONFLICT(event_id) DO NOTHING`).bind(body.event_id,current.token_hash,now,body.event_id,Number(body.station_code),body.channel)
  ]);return json({status:'ok'});
 }
 if(request.method!=='GET')throw new HttpError(405,'Method not allowed.');const admin=path==='/api/admin/reports',current=admin?await administrator(request,env,now):await session(request,env,now);if(!admin&&(!current.owner_station||current.owner_expires<=now))throw new HttpError(401,'Please sign in.');
 const month=new URL(request.url).searchParams.get('month')||new Date(now*1000).toISOString().slice(0,7);if(!/^20\d{2}-(?:0[1-9]|1[0-2])$/.test(month))throw new HttpError(400,'Choose a valid month.');const start=Date.parse(month+'-01T00:00:00Z')/1000,date=new Date(start*1000);date.setUTCMonth(date.getUTCMonth()+1);const end=date.getTime()/1000;
 const stations=await env.DB.prepare(`SELECT s.code,s.name,s.status,(SELECT count(*) FROM monthly_activity m WHERE m.station_code=s.code AND m.month=?) active_radios,(SELECT coalesce(sum(reported_seconds),0) FROM listening_daily d WHERE d.station_code=s.code AND substr(d.day,1,7)=?) reported_seconds,(SELECT count(*) FROM listening_sessions l WHERE l.station_code=s.code AND l.qualified=1 AND l.last_seen>?) listening_now,(SELECT count(*) FROM share_events e WHERE e.station_code=s.code AND e.created_at>=? AND e.created_at<?) share_clicks FROM stations s WHERE s.status!='deleted' AND (?=1 OR s.code=?) ORDER BY active_radios DESC,share_clicks DESC,s.code LIMIT 1000`).bind(month,month,now-90,start,end,admin?1:0,current.owner_station||0).all();
 const shares=await env.DB.prepare('SELECT station_code,channel,count(*) clicks FROM share_events WHERE created_at>=? AND created_at<? AND (?=1 OR station_code=?) GROUP BY station_code,channel').bind(start,end,admin?1:0,current.owner_station||0).all();
 const outcomes=await env.DB.prepare("SELECT e.station_code,COALESCE(s.outcome,'attempted') AS outcome,count(*) count FROM share_events e LEFT JOIN share_event_states s ON s.event_id=e.id WHERE e.created_at>=? AND e.created_at<? AND (?=1 OR e.station_code=?) GROUP BY e.station_code,COALESCE(s.outcome,'attempted')").bind(start,end,admin?1:0,current.owner_station||0).all();
 return json({month,timezone:'UTC',stations:stations.results,shares:shares.results,share_outcomes:outcomes.results,note:'Radio counts and listening time are device reports, not verified people. Share attempts and browser-reported outcomes are separate. Share sheet completed means the browser resolved its share request; delivery or reading by a recipient is not verified. Billing is not active.'});
}
