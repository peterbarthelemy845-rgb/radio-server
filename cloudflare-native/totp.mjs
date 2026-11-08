import {digest} from './security.mjs';
function decode(secret){let bits=0,value=0,out=[];const text=secret.replace(/\s|=/g,'').toUpperCase();
 if(!/^[A-Z2-7]{16,128}$/.test(text))throw new Error('Invalid authenticator configuration.');
 for(const c of text){value=(value<<5)|'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567'.indexOf(c);bits+=5;if(bits>=8){bits-=8;out.push((value>>>bits)&255);}}
 return new Uint8Array(out);
}
export async function totpAt(secret,counter){const data=new Uint8Array(8);let n=BigInt(counter);for(let i=7;i>=0;i--){data[i]=Number(n&255n);n>>=8n;}
 const key=await crypto.subtle.importKey('raw',decode(secret),{name:'HMAC',hash:'SHA-1'},false,['sign']);
 const hash=new Uint8Array(await crypto.subtle.sign('HMAC',key,data)),offset=hash[19]&15;
 const number=((hash[offset]&127)<<24)|(hash[offset+1]<<16)|(hash[offset+2]<<8)|hash[offset+3];
 return String(number%1000000).padStart(6,'0');
}
// Validation is separate from consumption so a caller can commit the used step
// in the same transaction as the authorization it permits.
export async function matchTotp(env,code,now){if(typeof code!=='string'||!/^\d{6}$/.test(code)||!env.ADMIN_TOTP_SECRET)return null;
 try{const secret=env.ADMIN_TOTP_SECRET.replace(/\s/g,'').toUpperCase(),secretHash=await digest(secret);
  for(const offset of [0,-1,1]){const counter=Math.floor(now/30)+offset;
   if(await totpAt(secret,counter)!==code)continue;
   return {secretHash,counter};
  }
 }catch{return null;}return null;
}
export async function consumeTotp(env,code,now){
 const match=await matchTotp(env,code,now);if(!match)return false;
 try{const used=await env.DB.prepare('INSERT INTO admin_mfa_used(secret_hash,counter) VALUES (?,?) ON CONFLICT DO NOTHING RETURNING counter').bind(match.secretHash,match.counter).first();
  return Boolean(used);
 }catch{return false;}
}
