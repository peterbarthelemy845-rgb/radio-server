import {digest,encrypt,HttpError} from './security.mjs';

// Subjects and message templates are application-owned. Reviewed content, stream
// URLs, artwork paths, sign-in codes and advertiser contact details stay out of mail.
const messages={
 'station-approved':['Your Radio Locals station is approved','Your station is approved and published on Radio Locals.'],
 'station-needs-changes':['Your Radio Locals station needs changes','Your station needs changes before it can be published. Sign in to update the station details and submit them for review.'],
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
 const explanation=decisionReason(reason),text=`${message[1]}\n\nStation code: ${stationCode}${adId?'\nAdvertisement reference: '+adId:''}${explanation?'\n\nReason: '+explanation:''}\n\nUse the Radio Locals website to sign in. Never share your sign-in code.`;
 return {id:'owner-notice:'+await digest(JSON.stringify([kind,stationCode,event])),recipient,subject:message[0],encrypted_payload:await encrypt(env,JSON.stringify({text}))};
}
// D1 batch is transactional. changes() links the outbox insertion to the exact
// optimistic update immediately before it. Following writes additionally match
// this attempt's random ciphertext, so stale/retried actions cannot add an audit
// entry, change a second table, or enqueue another message.
export async function commitOwnerNotification(env,now,mutation,notice,after=[]){
 const guard=notice?'EXISTS (SELECT 1 FROM mail_outbox WHERE id=? AND encrypted_payload=?)':'changes()>0';
 const results=await env.DB.batch([
  mutation,
  ...(notice?[env.DB.prepare(`INSERT INTO mail_outbox(id,recipient,subject,encrypted_payload,due,expires) SELECT ?,?,?,?,?,? WHERE changes()>0 ON CONFLICT(id) DO NOTHING`).bind(notice.id,notice.recipient,notice.subject,notice.encrypted_payload,now,now+7*86400)]:[]),
  // Unverified contacts receive no mail. In that path follow-up statements form
  // a changes() chain (the audit insert precedes any optional command cleanup).
  ...after.map(({sql,values=[]})=>env.DB.prepare(sql.replaceAll('OWNER_NOTIFICATION_APPLIED',guard)).bind(...values,...(notice?[notice.id,notice.encrypted_payload]:[])))
 ]);
 return Number(results[0]?.meta?.changes??results[0]?.changes??0)>0;
}
