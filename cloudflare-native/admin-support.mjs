import {administrator} from './access.mjs';
import {json,readJson,limit,encrypt,decrypt,mac,randomHex,HttpError} from './security.mjs';

const emailAddress=/^[a-z0-9.!#$%&'*+/=?^_`{|}~-]{1,64}@(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/i;
const states={new:'new',open:'new',review:'review',in_review:'review',closed:'closed'};
async function ticket(env,id){
 if(typeof id!=='string'||!/^[a-f0-9]{32}$/.test(id))throw new HttpError(400,'Choose a support ticket.');
 const row=await env.DB.prepare("SELECT r.id,r.kind,r.state,r.created_at,r.encrypted_payload,COALESCE(f.folder,'inbox') AS folder,COALESCE(f.reason,'') AS spam_reason FROM legal_requests r LEFT JOIN support_ticket_flags f ON f.ticket_id=r.id WHERE r.id=? AND r.kind='support'").bind(id).first();
 if(!row)throw new HttpError(404,'Support ticket not found.');
 return {id:row.id,kind:row.kind,state:row.state,created_at:row.created_at,folder:row.folder,spam_reason:row.spam_reason,payload:JSON.parse(await decrypt(env,row.encrypted_payload))};
}
async function recorded(env,id,requestId){return env.DB.prepare('SELECT id,request_hash,outbox_id FROM support_replies WHERE ticket_id=? AND request_id=?').bind(id,requestId).first();}
function result(record,state,duplicate){return json({status:'ok',state,reply_queued:Boolean(record.outbox_id),duplicate,
 message:duplicate?'This update was already recorded. No additional email was queued.':record.outbox_id?'Reply saved and queued for email delivery.':'Ticket status updated.'});}

export async function supportRoutes(request,env,now){
 const url=new URL(request.url);if(!['/api/admin/support','/api/admin/support/list','/api/admin/support/folder'].includes(url.pathname))return null;
 const current=await administrator(request,env,now);
 if(url.pathname==='/api/admin/support/list'){
  if(request.method!=='GET')throw new HttpError(405,'Method not allowed.');
  await limit(env.DB,'support-admin-list',current.token_hash,60,60,now);
  const folder=url.searchParams.get('folder')||'inbox',cursor=url.searchParams.get('cursor');if(!['inbox','spam'].includes(folder))throw new HttpError(400,'Choose a support folder.');
  let before=null,beforeId='';if(cursor!==null){const match=/^(inbox|spam):(\d{1,16}):([a-f0-9]{32})$/.exec(cursor);if(!match||match[1]!==folder||!Number.isSafeInteger(Number(match[2])))throw new HttpError(400,'Invalid support folder page.');before=Number(match[2]);beforeId=match[3];}
  const rows=(await env.DB.prepare(`SELECT r.*,COALESCE(f.folder,'inbox') AS folder,COALESCE(f.reason,'') AS spam_reason FROM legal_requests r
   LEFT JOIN support_ticket_flags f ON f.ticket_id=r.id WHERE r.kind='support' AND COALESCE(f.folder,'inbox')=?
   AND (? IS NULL OR r.created_at<? OR (r.created_at=? AND r.id<?)) ORDER BY r.created_at DESC,r.id DESC LIMIT 201`).bind(folder,before,before,before,beforeId).all()).results;
  const hasMore=rows.length>200,page=rows.slice(0,200),last=page.at(-1);
  return json({folder,requests:await Promise.all(page.map(async row=>({id:row.id,kind:row.kind,state:row.state,created_at:row.created_at,folder:row.folder,spam_reason:row.spam_reason,payload:JSON.parse(await decrypt(env,row.encrypted_payload))}))),has_more:hasMore,next_cursor:hasMore?folder+':'+last.created_at+':'+last.id:null});
 }
 if(url.pathname==='/api/admin/support/folder'){
  if(request.method!=='POST')throw new HttpError(405,'Method not allowed.');
  const body=await readJson(request),item=await ticket(env,body.ticket_id);
  if(!['inbox','spam'].includes(body.folder)||typeof body.request_id!=='string'||!/^[-A-Za-z0-9_]{16,128}$/.test(body.request_id))throw new HttpError(400,'Choose a folder and a valid request reference.');
  const requestHash=await mac(env,'support-folder:'+JSON.stringify([item.id,body.folder]));
  const recordedFolder=()=>env.DB.prepare('SELECT id,request_hash FROM support_folder_actions WHERE ticket_id=? AND request_id=?').bind(item.id,body.request_id).first();
  let prior=await recordedFolder();if(prior){if(prior.request_hash!==requestHash)throw new HttpError(409,'This request reference was used for a different folder change.');return json({status:'ok',folder:item.folder,duplicate:true,message:'This folder change was already recorded.'});}
  await limit(env.DB,'support-admin',current.token_hash,60,3600,now);
  const id=randomHex(16),operation=randomHex(16),reason=body.folder==='spam'?'manual':'';
  await env.DB.batch([
   env.DB.prepare(`INSERT INTO support_folder_actions(id,ticket_id,request_id,request_hash,operation_token,actor_hash,folder,created_at) VALUES (?,?,?,?,?,?,?,?) ON CONFLICT(ticket_id,request_id) DO NOTHING`).bind(id,item.id,body.request_id,requestHash,operation,current.token_hash,body.folder,now),
   env.DB.prepare(`INSERT INTO support_ticket_flags(ticket_id,folder,reason,updated_at,actor_hash) SELECT ?,?,?,?,? WHERE EXISTS(SELECT 1 FROM support_folder_actions WHERE id=? AND operation_token=?)
    ON CONFLICT(ticket_id) DO UPDATE SET folder=excluded.folder,reason=excluded.reason,updated_at=excluded.updated_at,actor_hash=excluded.actor_hash`).bind(item.id,body.folder,reason,now,current.token_hash,id,operation),
   env.DB.prepare(`INSERT INTO legal_actions(id,request_id,action,notes,created_at) SELECT ?,?,?,?,? WHERE EXISTS(SELECT 1 FROM support_folder_actions WHERE id=? AND operation_token=?)`).bind(id,item.id,body.folder==='spam'?'support_spam':'support_restore',body.folder==='spam'?'Moved to Spam. No email was sent.':'Restored to the support inbox. No email was sent.',now,id,operation)
  ]);
  prior=await recordedFolder();if(!prior||prior.request_hash!==requestHash)throw new HttpError(409,'This request reference was used for a different folder change.');
  return json({status:'ok',folder:(await ticket(env,item.id)).folder,duplicate:prior.id!==id,message:body.folder==='spam'?'Ticket moved to Spam.':'Ticket restored to the support inbox.'});
 }
 if(request.method==='GET'){
  const item=await ticket(env,url.searchParams.get('ticket_id'));
  const rows=(await env.DB.prepare(`SELECT r.id,r.encrypted_payload,r.created_at,m.state AS delivery_state,m.attempts
   FROM support_replies r LEFT JOIN mail_outbox m ON m.id=r.outbox_id
   WHERE r.ticket_id=? AND r.outbox_id IS NOT NULL ORDER BY r.created_at DESC,r.rowid DESC LIMIT 200`).bind(item.id).all()).results;
  const messages=await Promise.all(rows.reverse().map(async row=>{const payload=JSON.parse(await decrypt(env,row.encrypted_payload));return {id:row.id,body:payload.body,recipient:payload.recipient,...(payload.author==='customer'?{author:'customer'}:{}),created_at:row.created_at,delivery:{state:row.delivery_state||'unavailable',attempts:row.attempts||0}};}));
  const history=(await env.DB.prepare('SELECT action,notes,created_at FROM legal_actions WHERE request_id=? ORDER BY created_at DESC,rowid DESC LIMIT 200').bind(item.id).all()).results;
  return json({ticket:item,messages,history});
 }
 if(request.method!=='POST')throw new HttpError(405,'Method not allowed.');
 const body=await readJson(request,30000),item=await ticket(env,body.ticket_id);
 if(typeof body.request_id!=='string'||!/^[-A-Za-z0-9_]{16,128}$/.test(body.request_id))throw new HttpError(400,'A valid request reference is required. Refresh and try again.');
 if(body.reply!==undefined&&typeof body.reply!=='string'||typeof body.reply==='string'&&body.reply.length>4000)throw new HttpError(400,'Replies must be at most 4,000 characters.');
 const reply=(body.reply||'').trim(),state=states[body.state];
 if(!['new','review','closed'].includes(state))throw new HttpError(400,'Choose a ticket status.');
 // The original encrypted ticket is the only source of the email address.
 // Neither a client-supplied recipient nor a legal complaint can be mailed here.
 const recipient=String(item.payload.email||'').trim().toLowerCase();
 if(reply&&(!emailAddress.test(recipient)||recipient.length>254))throw new HttpError(400,'This ticket has no valid reply email address.');
 const requestHash=await mac(env,'support-update:'+JSON.stringify([item.id,reply,state]));
 let existing=await recorded(env,item.id,body.request_id);
 if(existing){if(existing.request_hash!==requestHash)throw new HttpError(409,'This request reference was used for a different update. Refresh and try again.');return result(existing,item.state,true);}
 if(reply&&item.folder==='spam')throw new HttpError(409,'Restore this ticket from Spam before sending a reply.');
 await limit(env.DB,'support-admin',current.token_hash,60,3600,now);
 if(reply)await limit(env.DB,'support-reply-recipient',recipient,10,3600,now);
 const id=randomHex(16),operation=randomHex(16),outboxId=reply?'support-reply:'+id:null;
 const encrypted=await encrypt(env,JSON.stringify({body:reply,recipient:reply?recipient:null}));
 const statements=[env.DB.prepare(`INSERT INTO support_replies(id,ticket_id,request_id,request_hash,operation_token,actor_hash,encrypted_payload,state,outbox_id,created_at)
   SELECT ?,?,?,?,?,?,?,?,?,? WHERE (?='' OR NOT EXISTS(SELECT 1 FROM support_ticket_flags WHERE ticket_id=? AND folder='spam')) ON CONFLICT(ticket_id,request_id) DO NOTHING`).bind(id,item.id,body.request_id,requestHash,operation,current.token_hash,encrypted,state,outboxId,now,reply,item.id)];
 // Each mutation is gated on this attempt's private token. An idempotent retry
 // cannot reapply an old status or create another job, including a racing retry.
 if(reply)statements.push(env.DB.prepare(`INSERT INTO mail_outbox(id,recipient,subject,encrypted_payload,due,expires)
   SELECT ?,?,?,?,?,? WHERE EXISTS(SELECT 1 FROM support_replies WHERE id=? AND operation_token=?)`).bind(outboxId,recipient,'Radio Locals support reply - '+item.id,
    await encrypt(env,JSON.stringify({text:'Radio Locals support reply\n\nReference: '+item.id+'\n\n'+reply})),now,now+86400,id,operation));
 statements.push(
  env.DB.prepare('UPDATE legal_requests SET state=? WHERE id=? AND EXISTS(SELECT 1 FROM support_replies WHERE id=? AND operation_token=?)').bind(state,item.id,id,operation),
  env.DB.prepare('INSERT INTO legal_actions(id,request_id,action,notes,created_at) SELECT ?,?,?,?,? WHERE EXISTS(SELECT 1 FROM support_replies WHERE id=? AND operation_token=?)').bind(id,item.id,state,reply?'Support reply queued.':'',now,id,operation)
 );
 await env.DB.batch(statements);
 existing=await recorded(env,item.id,body.request_id);
 if(!existing||existing.request_hash!==requestHash)throw new HttpError(409,'This request reference was used for a different update. Refresh and try again.');
 return result(existing,(await ticket(env,item.id)).state,existing.id!==id);
}
