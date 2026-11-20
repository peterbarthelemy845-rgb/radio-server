import {json,randomHex,otp,HttpError,limit} from './security.mjs';

const reference=value=>typeof value==='string'&&/^[a-f0-9]{32}$/.test(value);
export async function cancelControlAuthorization(env,hash,body,now){
 const id=body.radio_id,request=body.request_id;
 if(!reference(id)||!reference(request))throw new HttpError(400,'A valid radio and approval request reference are required.');
 await limit(env.DB,'control-cancel-phone',hash,30,60,now);
 if(!await env.DB.prepare('SELECT 1 FROM phone_radios WHERE session_hash=? AND radio_id=?').bind(hash,id).first())return json({state:'cancelled'});
 await env.DB.batch([
  env.DB.prepare(`INSERT INTO radio_control_requests(session_hash,request_id,radio_id,state,created_at,expires)
   VALUES (?,?,?,'cancelled',?,?) ON CONFLICT(session_hash,request_id) DO UPDATE SET
   state='cancelled',expires=MAX(radio_control_requests.expires,excluded.expires)
   WHERE radio_control_requests.radio_id=excluded.radio_id`).bind(hash,request,id,now,now+900),
  env.DB.prepare(`UPDATE pair_claims SET state='cancelled' WHERE session_hash=? AND radio_id=? AND state='waiting'
   AND EXISTS(SELECT 1 FROM radio_control_claims c WHERE c.claim_id=pair_claims.id)
   AND id=(SELECT claim_id FROM radio_control_requests WHERE session_hash=? AND request_id=? AND radio_id=? AND state='cancelled')`).bind(hash,id,hash,request,id)
 ]);
 // Deliberately leave previously approved controls intact. This only withdraws
 // the waiting prompt; the browser must never send a removal after dismissal.
 return json({state:'cancelled'});
}

export async function referencedControlAuthorization(env,hash,id,body,now){
 if(body.request_id===undefined)return null;
 const request=body.request_id;if(!reference(request))throw new HttpError(400,'A valid approval request reference is required.');
 const readReceipt=()=>env.DB.prepare(`SELECT r.state AS request_state,c.id,c.confirmation_code,c.expires FROM radio_control_requests r
  LEFT JOIN pair_claims c ON c.id=r.claim_id AND c.session_hash=r.session_hash AND c.radio_id=r.radio_id
  WHERE r.session_hash=? AND r.request_id=? AND r.radio_id=? AND r.expires>?
  AND EXISTS(SELECT 1 FROM sessions s JOIN phone_radios p ON p.session_hash=s.token_hash WHERE s.token_hash=r.session_hash AND s.expires>? AND p.radio_id=r.radio_id AND p.expires>?)`).bind(hash,request,id,now,now,now).first();
 const respond=receipt=>{
  if(!receipt||receipt.request_state==='cancelled')throw new HttpError(409,'This approval request was cancelled. Start again if you still want to remove the station.');
  if(!receipt.id)throw new HttpError(409,'Another request is waiting on this radio. Try again shortly.');
  return json({claim_id:receipt.id,confirmation_code:receipt.confirmation_code,scope:'control',expires_in:Math.max(0,receipt.expires-now)});
 };
 // Reconcile lost responses without spending another physical-prompt allowance.
 const previous=await readReceipt();if(previous)return respond(previous);
 await limit(env.DB,'control-authorize-phone',hash,5,900,now);await limit(env.DB,'control-authorize-radio',id,5,900,now);
 const claim=randomHex(16),check=otp().slice(0,4);
 await env.DB.batch([
  env.DB.prepare("UPDATE pair_claims SET state='expired' WHERE radio_id=? AND state='waiting' AND expires<=?").bind(id,now),
  env.DB.prepare(`INSERT INTO radio_control_requests(session_hash,request_id,radio_id,state,created_at,expires)
   SELECT ?,?,?,'active',?,? WHERE EXISTS(SELECT 1 FROM phone_radios p JOIN sessions s ON s.token_hash=p.session_hash
    WHERE p.session_hash=? AND p.radio_id=? AND p.expires>? AND s.expires>?) ON CONFLICT DO NOTHING`).bind(hash,request,id,now,now+900,hash,id,now,now),
  env.DB.prepare(`INSERT INTO pair_claims(id,radio_id,session_hash,confirmation_code,state,expires,created_at)
   SELECT ?,?,?,?,'waiting',?,? WHERE EXISTS(SELECT 1 FROM radio_control_requests r JOIN phone_radios p ON p.session_hash=r.session_hash AND p.radio_id=r.radio_id
    JOIN sessions s ON s.token_hash=r.session_hash WHERE r.session_hash=? AND r.request_id=? AND r.radio_id=? AND r.state='active' AND r.claim_id IS NULL
    AND r.expires>? AND p.expires>? AND s.expires>?) ON CONFLICT DO NOTHING`).bind(claim,id,hash,check,now+180,now,hash,request,id,now,now,now),
  env.DB.prepare('INSERT INTO radio_control_claims(claim_id) SELECT id FROM pair_claims WHERE id=? ON CONFLICT DO NOTHING').bind(claim),
  env.DB.prepare(`UPDATE radio_control_requests SET claim_id=? WHERE session_hash=? AND request_id=? AND radio_id=? AND state='active' AND claim_id IS NULL
   AND EXISTS(SELECT 1 FROM pair_claims c JOIN radio_control_claims scope ON scope.claim_id=c.id WHERE c.id=? AND c.session_hash=? AND c.radio_id=?)`).bind(claim,hash,request,id,claim,hash,id)
 ]);
 return respond(await readReceipt());
}
