import {HttpError} from './security.mjs';

// Validation for stored station URLs. This is not a DNS rebinding defence:
// network checks must also use Workers' strictly-public global fetch routing.
// Private/special-use IPv4 ranges: IANA IPv4 Special-Purpose Address Registry.
const blockedIPv4=[
 [0,8],[0x0a000000,8],[0x64400000,10],[0x7f000000,8],
 [0xa9fe0000,16],[0xac100000,12],[0xc0000000,24],[0xc0000200,24],
 [0xc0586300,24],[0xc0a80000,16],[0xc6120000,15],
 [0xc6336400,24],[0xcb007100,24],[0xe0000000,4],[0xf0000000,4]
];
export const isIPv4=host=>/^\d+\.\d+\.\d+\.\d+$/.test(host);
function publicIPv4(host){
 const parts=host.split('.').map(Number);if(parts.length!==4||parts.some(part=>!Number.isInteger(part)||part<0||part>255))return false;
 const number=parts.reduce((n,part)=>n*256+part,0);
 return !blockedIPv4.some(([base,bits])=>Math.floor(number/2**(32-bits))===Math.floor(base/2**(32-bits)));
}
export function publicStreamUrl(value){
 const invalid=()=>new HttpError(400,'Use a public HTTP or HTTPS stream URL without sign-in details.');
 // Firmware stores at most 1,024 bytes; URL.href is ASCII after encoding.
 if(typeof value!=='string'||!value||value.length>1024||/[\u0000-\u0020\u007f\\]/.test(value))throw invalid();
 let url;try{url=new URL(value);}catch{throw invalid();}
 if(url.href.length>1024)throw invalid();
 const host=url.hostname.toLowerCase();
 if(!['https:','http:'].includes(url.protocol)||url.username||url.password||url.hash||!host||host.endsWith('.')||host.startsWith('[')||url.port==='0')throw invalid();
 if(isIPv4(host)){if(!publicIPv4(host))throw invalid();}
 else if(!host.includes('.')||host.length>253||!host.split('.').every(label=>/^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/.test(label))||
  /(?:^|\.)(?:localhost|local|internal|lan|home|home\.arpa|arpa|test|invalid|example|onion)$/.test(host))throw invalid();
 return url.href;
}
