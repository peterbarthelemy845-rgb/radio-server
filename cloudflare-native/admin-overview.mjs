import {json,HttpError,limit} from './security.mjs';
import {administrator} from './access.mjs';

export async function overviewRoutes(request,env,now){
 if(new URL(request.url).pathname!=='/api/admin/overview')return null;
 if(request.method!=='GET')throw new HttpError(405,'Method not allowed.');
 const current=await administrator(request,env,now);
 await limit(env.DB,'admin-overview',current.token_hash,30,60,now);
 const results=await env.DB.batch([
  env.DB.prepare("SELECT count(*) AS count FROM stations WHERE status='pending_review' AND email_verified_at IS NOT NULL"),
  env.DB.prepare("SELECT count(*) AS count FROM local_ads a JOIN stations s ON s.code=a.station_code WHERE a.status='pending_review' AND s.status!='deleted'"),
  env.DB.prepare("SELECT count(*) AS count FROM legal_requests WHERE kind='support' AND state!='closed'"),
  env.DB.prepare('SELECT count(*) AS count FROM radios WHERE last_seen>?').bind(now-120),
  env.DB.prepare("SELECT count(*) AS count FROM mail_outbox WHERE state='failed' AND due>=?" ).bind(now-7*86400),
  env.DB.prepare("SELECT count(*) AS count FROM mail_outbox WHERE state IN ('pending','sending') AND expires>?").bind(now),
  env.DB.prepare("SELECT count(*) AS count FROM stations WHERE status='published'")
 ]);
 const counts=results.map(result=>Number(result.results?.[0]?.count||0));
 return json({pending_stations:counts[0],pending_ads:counts[1],open_tickets:counts[2],online_radios:counts[3],failed_emails_7_days:counts[4],queued_emails:counts[5],published_stations:counts[6],checked_at:now,note:'Online means a radio reported in the last two minutes. Failed email count covers the last seven days; it is not proof of delivery.'});
}
