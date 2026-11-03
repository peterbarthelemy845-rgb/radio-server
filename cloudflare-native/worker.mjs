// Independent Cloudflare foundation. No Render origin, proxy, or local disk.
// Only the routes explicitly implemented here are available in this staging build.
import {json,digest,randomHex,HttpError,limit,readJson} from './security.mjs';
export {digest,randomHex,HttpError,limit} from './security.mjs';
import {authRoutes,processMail} from './owner-auth.mjs';
import {phoneRoutes} from './phone-link.mjs';
async function authenticate(request, db, body) {
  const id=body.radio_id, auth=request.headers.get('Authorization')||'';
  if(typeof id!=='string'|| !/^[0-9a-f]{32}$/.test(id)||!/^Bearer [0-9a-f]{64}$/.test(auth))throw new HttpError(401,'Radio authentication required.');
  const hash=await digest(auth.slice(7));
  const row=await db.prepare('SELECT id FROM radios WHERE id=? AND secret_hash=?').bind(id,hash).first();
  if(!row)throw new HttpError(401,'Radio authentication required.');
  return id;
}
async function publicStation(db,code) {
  return db.prepare(`SELECT CAST(code AS TEXT) AS listener_code,name,stream_url AS url,bio,
    'Internet Radio' AS subtitle, CASE WHEN artwork_key IS NULL THEN '' ELSE '/artwork/'||artwork_key END AS logo_url
    FROM stations WHERE code=? AND status='published'`).bind(Number(code)).first();
}
export async function handle(request,env,now=Math.floor(Date.now()/1000)) {
  const url=new URL(request.url), path=url.pathname;
  const ownerResponse=await authRoutes(request,env,now);
  if(ownerResponse)return ownerResponse;
  const phoneResponse=await phoneRoutes(request,env,now);
  if(phoneResponse)return phoneResponse;
  if(path==='/health' && request.method==='GET') {
    await env.DB.prepare('SELECT 1 AS healthy').first();
    if(env.MEDIA)await env.MEDIA.head('health-probe-does-not-exist');
    return json({status:'ok',backend:'cloudflare-native',preview:true,
      private_media_configured:Boolean(env.MEDIA),
      implemented:['public-directory','station-code-lookup','authenticated-radio-poll','radio-unlink'],
      cutover_ready:false});
  }
  const artwork=path.match(/^\/artwork\/([a-f0-9]{64}\.png)$/);
  if(artwork && request.method==='GET') {
    // A bucket object is never public merely because its name is known. Only
    // sanitized artwork attached to a currently published station may be served.
    const approved=await env.DB.prepare("SELECT 1 FROM stations WHERE artwork_key=? AND status='published' LIMIT 1")
      .bind(artwork[1]).first();
    if(!approved || !env.MEDIA)return json({message:'Artwork not found.'},404);
    const object=await env.MEDIA.get('sanitized/'+artwork[1]);
    if(!object || object.customMetadata?.sanitizer_version!=='1' || object.size>3*1024*1024)
      return json({message:'Artwork not found.'},404);
    return new Response(object.body,{headers:{'Content-Type':'image/png','X-Content-Type-Options':'nosniff',
      'Content-Security-Policy':"default-src 'none'; sandbox",'Cache-Control':'no-store'}});
  }
  if(request.method==='GET' && path==='/api/stations') {
    const rows=await env.DB.prepare(`SELECT CAST(code AS TEXT) AS listener_code,name,stream_url AS url,bio,
      'Internet Radio' AS subtitle,CASE WHEN artwork_key IS NULL THEN '' ELSE '/artwork/'||artwork_key END AS logo_url
      FROM stations WHERE status='published' ORDER BY code LIMIT 1000`).all();
    return json({stations:rows.results});
  }
  const lookup=path.match(/^\/api\/stations\/([0-9]{2,6})$/);
  if(lookup && request.method==='GET') {
    const station=await publicStation(env.DB,lookup[1]);
    return station?json(station):json({message:'Station not found.'},404);
  }
  if(path==='/api/radio/poll' && request.method==='POST') {
    const body=await readJson(request), id=await authenticate(request,env.DB,body);
    await limit(env.DB,'radio-poll',id,12,60,now);
    const statements=[env.DB.prepare('UPDATE radios SET last_seen=? WHERE id=?').bind(now,id)];
    const ack=body.ack_id,result=body.ack_status;
    if(typeof ack==='string' && /^[0-9a-f]{32}$/.test(ack) && ['added','failed'].includes(result))
      statements.push(env.DB.prepare(`UPDATE radio_commands SET state=? WHERE id=? AND radio_id=?
        AND state IN ('pending','delivered') AND expires>?`).bind(result,ack,id,now));
    // A physically authenticated radio is the only actor permitted to approve a phone.
    const claim=body.pair_claim_id,decision=body.pair_decision;
    let decisionAck='',claimResult='';
    if(typeof claim==='string'&&/^[0-9a-f]{32}$/.test(claim)&&['approve','deny'].includes(decision)){
      statements.push(env.DB.prepare(`UPDATE pair_claims SET state=CASE WHEN expires<=? THEN 'expired'
        WHEN ?='approve' THEN 'approved' ELSE 'denied' END
        WHERE id=? AND radio_id=? AND state='waiting'`).bind(now,decision,claim,id));
      statements.push(env.DB.prepare(`INSERT INTO phone_radios(session_hash,radio_id,expires)
        SELECT session_hash,radio_id,? FROM pair_claims WHERE id=? AND radio_id=? AND state='approved' AND expires>?
        ON CONFLICT(session_hash,radio_id) DO NOTHING`).bind(now+2592000,claim,id,now));
      decisionAck=claim;
    }
    statements.push(env.DB.prepare(`UPDATE radio_commands SET state='expired' WHERE radio_id=?
      AND expires<=? AND state IN ('pending','delivered')`).bind(id,now));
    await env.DB.batch(statements);
    if(decisionAck)claimResult=(await env.DB.prepare('SELECT state FROM pair_claims WHERE id=? AND radio_id=?').bind(claim,id).first())?.state||'';
    const pair=await env.DB.prepare(`SELECT id,confirmation_code FROM pair_claims
      WHERE radio_id=? AND state='waiting' AND expires>? ORDER BY created_at DESC LIMIT 1`).bind(id,now).first();
    // Lease and choose in one statement; duplicate polls cannot claim the same command concurrently.
    const command=await env.DB.prepare(`UPDATE radio_commands SET state='delivered',lease=? WHERE id=(
      SELECT c.id FROM radio_commands c JOIN stations s ON s.code=c.station_code
      WHERE c.radio_id=? AND c.state IN ('pending','delivered') AND c.expires>? AND c.lease<=?
      AND s.status='published' ORDER BY c.created_at LIMIT 1)
      RETURNING id,station_code,expires`).bind(now+60,id,now,now).first();
    const linked=Boolean(await env.DB.prepare('SELECT 1 FROM phone_radios WHERE radio_id=? AND expires>?').bind(id,now).first());
    return json({linked,command_id:command?.id||'',station_code:command?String(command.station_code):'',
      command_expires_in:command?Math.max(0,command.expires-now):0,pair_claim_id:pair?.id||'',
      pair_check:pair?.confirmation_code||'',claim_decision_ack:decisionAck,claim_result:claimResult});
  }
  if(path==='/api/radio/link/reset'&&request.method==='POST'){
    const body=await readJson(request),id=await authenticate(request,env.DB,body);
    await limit(env.DB,'radio-reset',id,20,3600,now);
    await env.DB.batch([
      env.DB.prepare('DELETE FROM phone_radios WHERE radio_id=?').bind(id),
      env.DB.prepare('DELETE FROM radio_pairs WHERE radio_id=?').bind(id),
      env.DB.prepare("UPDATE pair_claims SET state='cancelled' WHERE radio_id=? AND state IN ('waiting','approved')").bind(id),
      env.DB.prepare("UPDATE radio_commands SET state='failed' WHERE radio_id=? AND state IN ('pending','delivered')").bind(id),
    ]);
    return json({status:'ok'});
  }
  if(env.ASSETS && request.method==='GET' && (['/','/add-station','/station-edit'].includes(path)||/^\/station\/[0-9]{2,6}$/.test(path)||/^\/assets\/[a-z0-9.-]+$/.test(path))){
    const target=new URL(request.url);if(!path.startsWith('/assets/'))target.pathname='/index.html';
    const asset=await env.ASSETS.fetch(new Request(target,request));
    const response=new Response(asset.body,asset);
    response.headers.set('Cache-Control','no-store');
    response.headers.set('X-Content-Type-Options','nosniff');
    response.headers.set('Referrer-Policy','strict-origin-when-cross-origin');
    response.headers.set('Content-Security-Policy',"default-src 'self'; script-src 'self' https://challenges.cloudflare.com; frame-src https://challenges.cloudflare.com; object-src 'none'; base-uri 'self'; form-action 'self'; frame-ancestors 'none'; img-src 'self' blob: data:; connect-src 'self' https://challenges.cloudflare.com");
    return response;
  }
  return json({message:'This feature has not migrated yet. This is an isolated test backend.',preview:true},404);
}
export async function fetchHandler(request,env,ctx) {
  try{const response=await handle(request,env);
    if(ctx&&request.method==='POST'&&new URL(request.url).pathname.startsWith('/api/owner/')&&response.ok)
      ctx.waitUntil(processMail(env));
    return response;
  }catch(error){
    return json({message:error instanceof HttpError?error.message:'Service temporarily unavailable.'},
      error instanceof HttpError?error.status:503);
  }
}
export async function cleanup(env,now=Math.floor(Date.now()/1000)) {
  await env.DB.batch([
    env.DB.prepare("UPDATE mail_outbox SET state='failed',encrypted_payload='',lease=0 WHERE expires<=? AND state!='sent'").bind(now),
    env.DB.prepare("UPDATE email_verifications SET code_hash='' WHERE expires<=? OR consumed_at IS NOT NULL").bind(now),
    env.DB.prepare('DELETE FROM rate_limits WHERE expires<?').bind(now),
    env.DB.prepare("UPDATE pair_claims SET state='expired' WHERE state='waiting' AND expires<=?").bind(now),
    env.DB.prepare("UPDATE radio_commands SET state='expired' WHERE state IN ('pending','delivered') AND expires<=?").bind(now),
    env.DB.prepare('DELETE FROM phone_radios WHERE expires<=?').bind(now),
  ]);
}
export default {fetch:fetchHandler,async scheduled(_event,env){await cleanup(env);await processMail(env);}};
