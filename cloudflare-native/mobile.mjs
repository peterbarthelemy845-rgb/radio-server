import {json,digest,randomHex,readJson,limit,limitSessionCreation,human,HttpError} from './security.mjs';
// Native clients store this listener-only credential in OS secure storage.
// Browser cookies and owner/admin permissions are never exported.
export async function mobileRoutes(request,env,now,deps={human}){
 if(new URL(request.url).pathname!=='/api/mobile/session')return null;
 if(request.method!=='POST')throw new HttpError(405,'Method not allowed.');
 await limit(env.DB,'mobile-create-ip',request.headers.get('CF-Connecting-IP')||'unknown',5,3600,now);
 const body=await readJson(request);await deps.human(request,env,body.turnstile_token,'mobile-session',now);
 await limitSessionCreation(env.DB,now);
 const token=randomHex(),expires=now+2592000;
 await env.DB.prepare('INSERT INTO sessions(token_hash,csrf_hash,created_at,expires) VALUES (?,?,?,?)').bind(await digest(token),'mobile-only',now,expires).run();
 return json({access_token:token,token_type:'Bearer',expires_at:expires,scope:'radio:link radio:read station:add'});
}
