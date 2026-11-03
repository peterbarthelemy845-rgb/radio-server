import {json,digest,mac,randomHex,HttpError,limit,readJson,session,browserWrite,otp,human} from './security.mjs';

// Phone grants permit station additions only. Device secrets never reach browsers.
export async function phoneRoutes(request,env,now,deps={human}) {
  const path=new URL(request.url).pathname;
  if(!path.startsWith('/api/phone/'))return null;
  if(request.method==='GET'&&path==='/api/phone/radios'){
    const current=await session(request,env,now);
    const rows=await env.DB.prepare(`SELECT r.id,r.name,r.last_seen FROM phone_radios p JOIN radios r ON r.id=p.radio_id
      WHERE p.session_hash=? AND p.expires>? ORDER BY r.name`).bind(current.token_hash,now).all();
    const response=json({radios:rows.results.map(r=>({...r,online:r.last_seen>now-120}))});
    if(current.setCookie)response.headers.set('Set-Cookie',current.setCookie);
    return response;
  }
  if(request.method!=='POST')throw new HttpError(405,'Method not allowed.');
  const current=await browserWrite(request,env,now),body=await readJson(request);
  const ip=request.headers.get('CF-Connecting-IP')||'unknown';
  if(path==='/api/phone/claim'){
    await limit(env.DB,'claim-ip',ip,5,900,now);
    await limit(env.DB,'claim-global','all',60,60,now);
    await deps.human(request,env,body.turnstile_token,'radio-link',now);
    const code=String(body.device_code||'').replace(/[-\s]/g,'').toUpperCase();
    if(!/^(?:[0-9]{4,8}|[A-Z0-9]{8})$/.test(code))throw new HttpError(400,'Check the device code on your radio.');
    const pair=await env.DB.prepare(`SELECT radio_id FROM radio_pairs WHERE code_hash=? AND (expires=0 OR expires>?)`)
      .bind(await mac(env,'device-code:'+code),now).first();
    if(!pair)throw new HttpError(400,'Check the device code on your radio.');
    await limit(env.DB,'claim-radio',pair.radio_id,5,900,now);
    await env.DB.prepare("UPDATE pair_claims SET state='expired' WHERE radio_id=? AND state='waiting' AND expires<=?")
      .bind(pair.radio_id,now).run();
    // An existing request is returned only to its initiating browser. Concurrent
    // requests cannot replace a number already shown for physical approval.
    const id=randomHex(16),check=otp().slice(0,4);
    await env.DB.prepare(`INSERT INTO pair_claims(id,radio_id,session_hash,confirmation_code,state,expires,created_at)
      VALUES (?,?,?,?,'waiting',?,?) ON CONFLICT DO NOTHING`)
      .bind(id,pair.radio_id,current.token_hash,check,now+180,now).run();
    const claim=await env.DB.prepare(`SELECT id,confirmation_code,session_hash FROM pair_claims
      WHERE radio_id=? AND state='waiting' AND expires>?`).bind(pair.radio_id,now).first();
    if(!claim||claim.session_hash!==current.token_hash)throw new HttpError(409,'Another request is waiting on this radio. Try again shortly.');
    return json({claim_id:claim.id,confirmation_code:claim.confirmation_code});
  }
  if(path==='/api/phone/claim/status'){
    await limit(env.DB,'claim-status',current.token_hash,40,60,now);
    const claim=await env.DB.prepare('SELECT state,expires,radio_id FROM pair_claims WHERE id=? AND session_hash=?')
      .bind(String(body.claim_id||''),current.token_hash).first();
    if(!claim)throw new HttpError(404,'Request not found.');
    return json({state:claim.expires<=now?'expired':claim.state,radio_id:claim.state==='approved'&&claim.expires>now?claim.radio_id:undefined});
  }
  if(path==='/api/phone/add'){
    await limit(env.DB,'phone-add',current.token_hash,20,60,now);
    const id=String(body.radio_id||''),code=String(body.station_code||'');
    const grant=await env.DB.prepare('SELECT 1 FROM phone_radios WHERE radio_id=? AND session_hash=? AND expires>?')
      .bind(id,current.token_hash,now).first();
    if(!grant)throw new HttpError(403,'Connect this phone to your radio first.');
    if(!/^[0-9]{2,6}$/.test(code)||!await env.DB.prepare("SELECT 1 FROM stations WHERE code=? AND status='published'").bind(Number(code)).first())
      throw new HttpError(404,'Station not found.');
    await env.DB.prepare("UPDATE radio_commands SET state='expired' WHERE radio_id=? AND expires<=? AND state IN ('pending','delivered')").bind(id,now).run();
    await env.DB.prepare(`INSERT INTO radio_commands(id,radio_id,station_code,state,created_at,expires)
      VALUES (?,?,?,'pending',?,?) ON CONFLICT DO NOTHING`).bind(randomHex(16),id,Number(code),now,now+300).run();
    const command=await env.DB.prepare(`SELECT id FROM radio_commands WHERE radio_id=? AND station_code=?
      AND state IN ('pending','delivered') AND expires>?`).bind(id,Number(code),now).first();
    if(!command)throw new HttpError(409,'Please try again.');
    return json({command_id:command.id,state:'pending'});
  }
  if(path==='/api/phone/command/status'){
    await limit(env.DB,'command-status',current.token_hash,40,60,now);
    const command=await env.DB.prepare(`SELECT c.state,c.expires FROM radio_commands c JOIN phone_radios p ON p.radio_id=c.radio_id
      WHERE c.id=? AND p.session_hash=? AND p.expires>?`).bind(String(body.command_id||''),current.token_hash,now).first();
    if(!command)throw new HttpError(404,'Request not found.');
    return json({state:['added','failed'].includes(command.state)?command.state:command.expires<=now?'expired':command.state});
  }
  throw new HttpError(404,'Not found.');
}
