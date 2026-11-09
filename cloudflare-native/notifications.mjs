import {digest,encrypt,randomHex,HttpError} from './security.mjs';

// Subjects and message templates are application-owned. Reviewed content, stream
// URLs, artwork paths, sign-in codes and advertiser contact details stay out of mail.
const messages={
 'station-approved':['Your Radio Locals station is approved','Your station is approved and published on Radio Locals.'],
 'station-needs-changes':['Your Radio Locals station needs changes','Your station needs changes and is currently suspended from Radio Locals. Station editing is unavailable while it is suspended.'],
 'station-removed':['Your Radio Locals station was removed','Your station has been removed from Radio Locals.'],
 'ad-cleared':['Your Radio Locals advertisement passed review','An advertisement for your station passed administrator safety review. Sign in to review and approve it before it can appear on radios.'],
 'ad-approved':['Your Radio Locals advertisement is approved','An advertisement for your station was approved by the station owner. It can appear on compatible radios during its scheduled dates.'],
 'ad-removed':['Your Radio Locals advertisement was removed','An advertisement for your station was removed and will no longer appear on radios.']
};
export function decisionReason(value,fallback=''){
 if(value===undefined||value===null||value==='')return fallback;
 if(typeof value!=='string'||value.length>300||/[\x00-\x1f\x7f]/.test(value))throw new HttpError(400,'Enter a short reason of up to 300 characters.');
 const reason=value.trim();
 // Notification reasons are explanations, never a channel for links or secrets.
 if(/(?:https?:\/\/|www\.|\b(?:[a-z0-9-]+\.)+[a-z]{2,}(?:[\/?:#]|\b)|(?:^|\s)\/\S+|\b(?:token|password|passcode|secret|credentials?|api[ _-]?key|otp|verification[ _-]?code|bearer)\b|\bsk-[a-z0-9_-]+|\b[a-f0-9]{32,}\b|\b\d{6}\b)/i.test(reason))throw new HttpError(400,'Keep the reason free of links, email addresses, and private security details.');
 return reason||fallback;
}
export async function ownerNotification(env,{kind,stationCode,recipient,event,adId,reason=''}){
 const message=messages[kind];
 if(!message||!Number.isSafeInteger(stationCode)||stationCode<10||typeof recipient!=='string'||recipient.length>254||!/^[^\s@\r\n]+@[^\s@\r\n]+\.[^\s@\r\n]+$/.test(recipient)||adId!==undefined&&!/^[a-f0-9]{32}$/.test(adId))throw new Error('Invalid owner notification.');
 const nextStep=kind==='station-needs-changes'?'Contact Radio Locals Support for help: https://radiolocals.com/support':'Use the Radio Locals website to sign in.';
 const explanation=decisionReason(reason),text=`${message[1]}\n\nStation code: ${stationCode}${adId?'\nAdvertisement reference: '+adId:''}${explanation?'\n\nReason: '+explanation:''}\n\n${nextStep} Never share your sign-in code.`;
 return {id:'owner-notice:'+await digest(JSON.stringify([kind,stationCode,event])),recipient,subject:message[0],encrypted_payload:await encrypt(env,JSON.stringify({text}))};
}
// A private operation marker gates every side effect of the optimistic update.
// Mail deduplication is independent: an old retained notice must not suppress
// policy/audit/command changes after a restore repeats a legitimate decision.
export async function commitOwnerNotification(env,now,mutation,notice,after=[]){
 const operation=randomHex(16),guard='EXISTS (SELECT 1 FROM notification_operations WHERE id=?)';
 const results=await env.DB.batch([
  mutation,
  env.DB.prepare('INSERT INTO notification_operations(id) SELECT ? WHERE changes()>0').bind(operation),
  ...(notice?[env.DB.prepare(`INSERT INTO mail_outbox(id,recipient,subject,encrypted_payload,due,expires) SELECT ?,?,?,?,?,? WHERE ${guard} ON CONFLICT(id) DO NOTHING`).bind(notice.id,notice.recipient,notice.subject,notice.encrypted_payload,now,now+7*86400,operation)]:[]),
  ...after.map(({sql,values=[]})=>env.DB.prepare(sql.replaceAll('OWNER_NOTIFICATION_APPLIED',guard)).bind(...values,operation)),
  env.DB.prepare('DELETE FROM notification_operations WHERE id=?').bind(operation)
 ]);
 if(notice)notice.queued=Number(results[2]?.meta?.changes??results[2]?.changes??0)>0;
 return Number(results[0]?.meta?.changes??results[0]?.changes??0)>0;
}
