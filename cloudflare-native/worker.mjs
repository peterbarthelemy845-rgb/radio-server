import {streamCheckRoutes} from './stream-check.mjs';
import {supportStatusRoutes} from './support-status.mjs';
import {controlRoutes,telemetryStatements,approvalStatements,pollControls,revokeControlStatements} from './radio-controls.mjs';
import {supportRoutes} from './admin-support.mjs';
import {overviewRoutes} from './admin-overview.mjs';
import {mobileRoutes} from './mobile.mjs';
import {reportsRoutes,recordListening} from './reports.mjs';
import {backupRoutes,scheduledBackup,expireBackups} from './backups.mjs';
import {newsResponse} from './news.mjs';
// Independent Cloudflare foundation. No Render origin, proxy, or local disk.
// Only the routes explicitly implemented here are available.
import {json,digest,randomHex,HttpError,limit,readJson} from './security.mjs';
export {digest,randomHex,HttpError,limit} from './security.mjs';
import {authRoutes,processMail} from './owner-auth.mjs';
import {phoneRoutes} from './phone-link.mjs';
import {adminRoutes} from './admin.mjs';
import {communityRoutes} from './community.mjs';
import {authenticate,deviceRoutes} from './devices.mjs';
import {adsRoutes} from './local-ads.mjs';
import {inventoryStatements} from './saved-inventory.mjs';
import {sessionCleanupStatements} from './session-maintenance.mjs';
import {publicStation,directoryResponse} from './public-directory.mjs';
import {publicStaticPath,publicHeadPath,rewritePublicHtml} from './public-pages.mjs';
import {publicArtworkResponse} from './public-artwork.mjs';
export async function handle(request,env,now=Math.floor(Date.now()/1000)) {
  const url=new URL(request.url), path=url.pathname;
  if(request.method==='HEAD'&&publicHeadPath(path)){
    const response=await handle(new Request(request,{method:'GET'}),env,now);void response.body?.cancel().catch(()=>{});return new Response(null,response);
  }
  if(path==='/api/stream-status'&&request.method==='GET'){
    const rows=await env.DB.prepare("SELECT DISTINCT station_code FROM listening_sessions WHERE qualified=1 AND last_seen>? LIMIT 1000").bind(now-90).all();return json({recently_played:rows.results.map(r=>String(r.station_code)),note:'Recent radio reports only. No report does not mean the stream is unavailable.'});
  }
  if(path==='/api/haitian-times'&&request.method==='GET')return newsResponse(request);
  const mobileResponse=await mobileRoutes(request,env,now);if(mobileResponse)return mobileResponse;
  const streamCheckResponse=await streamCheckRoutes(request,env,now);if(streamCheckResponse)return streamCheckResponse;
  const ownerResponse=await authRoutes(request,env,now);
  if(ownerResponse)return ownerResponse;
  const controlResponse=await controlRoutes(request,env,now);if(controlResponse)return controlResponse;
  const phoneResponse=await phoneRoutes(request,env,now);
  if(phoneResponse)return phoneResponse;
  const adResponse=await adsRoutes(request,env,now);
  if(adResponse)return adResponse;
  const reportsResponse=await reportsRoutes(request,env,now);if(reportsResponse)return reportsResponse;
  const backupsResponse=await backupRoutes(request,env,now);if(backupsResponse)return backupsResponse;
  const supportResponse=await supportRoutes(request,env,now);if(supportResponse)return supportResponse;
  const overviewResponse=await overviewRoutes(request,env,now);if(overviewResponse)return overviewResponse;
  const adminResponse=await adminRoutes(request,env,now);
  if(adminResponse)return adminResponse;
  const supportStatusResponse=await supportStatusRoutes(request,env,now);if(supportStatusResponse)return supportStatusResponse;
  const communityResponse=await communityRoutes(request,env,now);
  if(communityResponse)return communityResponse;
  const deviceResponse=await deviceRoutes(request,env,now);
  if(deviceResponse)return deviceResponse;
  if(path==='/health' && request.method==='GET') {
    await env.DB.prepare('SELECT 1 AS healthy').first();
    if(env.MEDIA)await env.MEDIA.head('health-probe-does-not-exist');
    return json({status:'ok',backend:'cloudflare-native',preview:env.MIGRATION_PREVIEW!=='false',
      private_media_configured:Boolean(env.MEDIA)});
  }
  const artwork=path.match(/^\/artwork\/([a-f0-9]{64}\.png)$/);
  if(artwork && request.method==='GET') {
    return publicArtworkResponse(request,env,artwork[1]);
  }
  if(request.method==='GET' && path==='/api/stations') {
    return directoryResponse(request,env);
  }
  if(request.method==='GET'&&path==='/api/device/default-station')return json({name:'La Voix Divine',url:'https://icecast3.getstreamhosting.com/proxy/radiodivinessl/live',listener_code:'',logo_url:'/assets/radiolavoixdivine.png'});
  if(request.method==='GET'&&path==='/api/device/station-revisions'){
    const values=url.searchParams.getAll('codes'),input=values[0]||'';
    const codes=input.split(',');
    if(values.length!==1||input.length>699||codes.length>100||codes.some(code=>!(/^[1-9][0-9]{1,5}$/).test(code)))
      throw new HttpError(400,'Choose up to 100 saved station codes.');
    const unique=[...new Set(codes.map(Number))];
    // A radio asks only about its saved codes. Names, URLs, contact data, and
    // unapproved changes never enter this compact public revision manifest.
    const rows=await env.DB.prepare(`SELECT CAST(code AS TEXT) AS listener_code,CAST(updated_at AS TEXT) AS revision
      FROM stations WHERE status='published' AND code IN (${unique.map(()=>'?').join(',')}) ORDER BY code`)
      .bind(...unique).all();
    return json({stations:rows.results});
  }
  const deviceLookup=path.match(/^\/api\/device\/stations\/([0-9]{2,6})$/);
  if(deviceLookup&&request.method==='GET'){const station=await publicStation(env.DB,deviceLookup[1]);return station?json(station):json({message:'Station not found.'},404);}
  const lookup=path.match(/^\/api\/stations\/([0-9]{2,6})$/);
  if(lookup && request.method==='GET') {
    const station=await publicStation(env.DB,lookup[1]);
    return station?json(station):json({message:'Station not found.'},404);
  }
  if(path==='/api/radio/poll' && request.method==='POST') {
    const body=await readJson(request), id=await authenticate(request,env.DB,body);
    await limit(env.DB,'radio-poll',id,12,60,now);
    const statements=[env.DB.prepare('UPDATE radios SET last_seen=? WHERE id=?').bind(now,id),
      ...await inventoryStatements(env,id,body,now),...telemetryStatements(env,id,body,now),
      env.DB.prepare(`UPDATE pair_claims SET state='expired' WHERE radio_id=? AND state='waiting'
        AND (expires<=? OR NOT EXISTS(SELECT 1 FROM sessions s WHERE s.token_hash=pair_claims.session_hash AND s.expires>?))`).bind(id,now,now)];
    const ack=body.ack_id,result=body.ack_status;
    if(typeof ack==='string' && /^[0-9a-f]{32}$/.test(ack) && ['added','failed'].includes(result))
      statements.push(env.DB.prepare(`UPDATE radio_commands SET state=? WHERE id=? AND radio_id=?
        AND state IN ('pending','delivered') AND expires>?`).bind(result,ack,id,now));
    // A physically authenticated radio is the only actor permitted to approve a phone.
    const claim=body.pair_claim_id,decision=body.pair_decision;
    let decisionAck='',claimResult='';
    if(typeof claim==='string'&&/^[0-9a-f]{32}$/.test(claim)&&['approve','deny'].includes(decision)){
      statements.push(...approvalStatements(env,id,claim,decision,body,now));
      decisionAck=claim;
    }
    statements.push(env.DB.prepare(`UPDATE radio_commands SET state='expired' WHERE radio_id=?
      AND expires<=? AND state IN ('pending','delivered')`).bind(id,now));
    statements.push(env.DB.prepare(`UPDATE radio_commands SET state='failed' WHERE radio_id=? AND state IN ('pending','delivered')
      AND NOT EXISTS(SELECT 1 FROM phone_radios p WHERE p.radio_id=radio_commands.radio_id AND p.session_hash=radio_commands.session_hash AND p.expires>?)`).bind(id,now));
    await env.DB.batch(statements);
    await recordListening(env,id,body.playing_station_code,now);
    if(decisionAck)claimResult=(await env.DB.prepare('SELECT state FROM pair_claims WHERE id=? AND radio_id=?').bind(claim,id).first())?.state||'';
    const pair=await env.DB.prepare(`SELECT c.id,c.confirmation_code,EXISTS(SELECT 1 FROM radio_control_claims sc WHERE sc.claim_id=c.id) AS control_scope FROM pair_claims c
      WHERE c.radio_id=? AND c.state='waiting' AND c.expires>?
      AND EXISTS(SELECT 1 FROM sessions s WHERE s.token_hash=c.session_hash AND s.expires>?) ORDER BY c.created_at DESC LIMIT 1`).bind(id,now,now).first();
    // Lease and choose in one statement; duplicate polls cannot claim the same command concurrently.
    const command=await env.DB.prepare(`UPDATE radio_commands SET state='delivered',lease=? WHERE id=(
      SELECT c.id FROM radio_commands c JOIN stations s ON s.code=c.station_code
      JOIN phone_radios p ON p.radio_id=c.radio_id AND p.session_hash=c.session_hash
      WHERE c.radio_id=? AND c.state IN ('pending','delivered') AND c.expires>? AND c.lease<=?
      AND s.status='published' AND p.expires>? ORDER BY c.created_at LIMIT 1)
      RETURNING id,station_code,expires`).bind(now+60,id,now,now,now).first();
    const linked=Boolean(await env.DB.prepare('SELECT 1 FROM phone_radios WHERE radio_id=? AND expires>?').bind(id,now).first());
    const control=await pollControls(env,id,body,now);
    return json({...control,linked,command_id:command?.id||'',station_code:command?String(command.station_code):'',
      command_expires_in:command?Math.max(0,command.expires-now):0,pair_claim_id:pair?.id||'',
      pair_check:pair?.confirmation_code||'',pair_scope:pair?.control_scope?'control':'add',claim_decision_ack:decisionAck,claim_result:claimResult});
  }
  if(path==='/api/radio/link/reset'&&request.method==='POST'){
    const body=await readJson(request),id=await authenticate(request,env.DB,body);
    await limit(env.DB,'radio-reset',id,20,3600,now);
    await env.DB.batch([
      ...revokeControlStatements(env,id),
      env.DB.prepare('DELETE FROM phone_radios WHERE radio_id=?').bind(id),
      env.DB.prepare('DELETE FROM radio_pairs WHERE radio_id=?').bind(id),
      env.DB.prepare("UPDATE pair_claims SET state='cancelled' WHERE radio_id=? AND state IN ('waiting','approved')").bind(id),
      env.DB.prepare("UPDATE radio_commands SET state='failed' WHERE radio_id=? AND state IN ('pending','delivered')").bind(id),
    ]);
    return json({status:'ok'});
  }
  if(env.ASSETS && request.method==='GET' && publicStaticPath(path)){
    const target=new URL(request.url);if(!path.startsWith('/assets/')&&!['/manifest.webmanifest','/sw.js','/offline.html'].includes(path))target.pathname=/^\/radiolavoixdivine\/?$/.test(path)?'/station-player.html':'/index.html';
    const assetRequest=new Request(target,request);
    // The app shell is rewritten per route, so its upstream file ETag cannot
    // validate a station's metadata or bypass a fresh publication check.
    if(!path.startsWith('/assets/')&&!['/manifest.webmanifest','/sw.js'].includes(path)){assetRequest.headers.delete('If-None-Match');assetRequest.headers.delete('If-Modified-Since');}
    const asset=await env.ASSETS.fetch(assetRequest);
    const html=asset.headers.get('Content-Type')?.includes('text/html');
    let response=new Response(asset.body,asset);
    if(html&&asset.status===200){let text=await response.text();if(env.MIGRATION_PREVIEW==='false')text=text.replace('<aside class="preview">Test website — your current radio website has not switched yet.</aside>','');const rewritten=await rewritePublicHtml(text,request,env);response=new Response(rewritten.html,{status:rewritten.status,headers:asset.headers});response.headers.delete('Content-Length');response.headers.delete('ETag');}
    // Stable public asset URLs may be stored, but must revalidate on every use.
    // HTML, service-worker entrypoints and private/API responses stay no-store.
    const publicAsset=path.startsWith('/assets/')&&!html&&[200,304].includes(response.status)&&!response.headers.has('Set-Cookie');
    response.headers.set('Cache-Control',publicAsset?'public, max-age=0, must-revalidate':'no-store');
    response.headers.set('X-Content-Type-Options','nosniff');
    response.headers.set('Referrer-Policy','strict-origin-when-cross-origin');
    response.headers.set('Content-Security-Policy',"default-src 'self'; script-src 'self' https://challenges.cloudflare.com; frame-src https://challenges.cloudflare.com https://www.youtube-nocookie.com; object-src 'none'; base-uri 'self'; form-action 'self'; frame-ancestors 'none'; img-src 'self' blob: data: https:; media-src 'self' https:; connect-src 'self' https://challenges.cloudflare.com");
    return response;
  }
  return json({message:'Page or feature not found.'},404);
}
function transportSecurity(request,response){
  if(request.method==='HEAD'&&response.body){void response.body.cancel().catch(()=>{});response=new Response(null,response);}
  if(new URL(request.url).protocol!=='https:')return response;
  // Redirect and asset responses may have immutable headers. Preserve their
  // status, cookies and body while applying this host's HTTPS policy.
  const secured=new Response(response.body,response);
  secured.headers.set('Strict-Transport-Security','max-age=15552000');
  return secured;
}
export async function fetchHandler(request,env,ctx) {
  try{const response=await handle(request,env);
    if(ctx&&request.method==='POST'&&/^\/api\/(?:(?:owner|admin)\/|support\/(?:ticket|status\/request)$)/.test(new URL(request.url).pathname)&&response.ok)
      ctx.waitUntil(processMail(env));
    return transportSecurity(request,response);
  }catch(error){
    if(error instanceof HttpError)return transportSecurity(request,json({message:error.message},error.status));
    // Never log raw URLs, query strings, bodies, headers, exception messages or
    // stacks: any of those can contain contact details or private codes.
    const reference=randomHex(8),pathname=new URL(request.url).pathname;
    const category=pathname.startsWith('/api/admin/')?'admin':pathname.startsWith('/api/owner/')?'owner':pathname.startsWith('/api/support')?'support':pathname.startsWith('/api/radio/')?'radio':pathname.startsWith('/api/phone/')?'phone':pathname.startsWith('/api/')?'api':pathname.startsWith('/assets/')?'asset':'page';
    const errorCategory=['D1_ERROR','D1_EXEC_ERROR','D1_TYPE_ERROR'].includes(error?.name)?'database':['OperationError','DataError'].includes(error?.name)?'cryptography':error?.name==='TypeError'?'runtime_type':'runtime';
    console.error(JSON.stringify({event:'request_failed',error_reference:reference,method:['GET','POST','HEAD','PUT','PATCH','DELETE','OPTIONS'].includes(request.method)?request.method:'other',route_category:category,error_category:errorCategory,status:503}));
    return transportSecurity(request,json({message:'Service temporarily unavailable.',error_reference:reference},503));
  }
}
export async function cleanup(env,now=Math.floor(Date.now()/1000)) {
  await env.DB.batch([
    env.DB.prepare("UPDATE mail_outbox SET state='failed',encrypted_payload='',lease=0 WHERE expires<=? AND state!='sent'").bind(now),
    env.DB.prepare('DELETE FROM rate_limits WHERE expires<?').bind(now),
    env.DB.prepare("UPDATE pair_claims SET state='expired' WHERE state='waiting' AND expires<=?").bind(now),
    env.DB.prepare("UPDATE radio_commands SET state='expired' WHERE state IN ('pending','delivered') AND expires<=?").bind(now),
    env.DB.prepare(`UPDATE radio_commands SET state='failed' WHERE state IN ('pending','delivered')
      AND NOT EXISTS(SELECT 1 FROM phone_radios p WHERE p.radio_id=radio_commands.radio_id AND p.session_hash=radio_commands.session_hash AND p.expires>?)`).bind(now),
    env.DB.prepare("UPDATE radio_control_commands SET state='expired' WHERE expires<=? AND state IN ('pending','delivered')").bind(now),
    ...sessionCleanupStatements(env,now),
    env.DB.prepare('DELETE FROM radio_telemetry WHERE reported_at<?').bind(now-86400),
    env.DB.prepare('DELETE FROM share_events WHERE created_at<?').bind(now-93*86400),
    env.DB.prepare('DELETE FROM ad_receipts WHERE expires<?').bind(now-86400),
    env.DB.prepare('DELETE FROM listening_sessions WHERE last_seen<?').bind(now-86400),
  ]);
}
export default {fetch:fetchHandler,async scheduled(event,env){await cleanup(env);await processMail(env);const now=Math.floor((event.scheduledTime||Date.now())/1000);await scheduledBackup(env,now);if(new Date(now*1000).getUTCMinutes()===10)await expireBackups(env,now);}};
