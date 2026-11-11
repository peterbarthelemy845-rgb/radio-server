import {browserWrite,human,HttpError,json,limit,readJson} from './security.mjs';
import {publicStreamUrl,isIPv4} from './public-stream-url.mjs';
import {beginStreamCheck,completeStreamCheck} from './stream-verification.mjs';
import {ipv4StreamResponse} from './ipv4-stream-socket.mjs';

// Deployment requirement, not replaceable by a DNS preflight lookup:
// https://developers.cloudflare.com/workers/configuration/compatibility-flags/#global-fetch-strictly-public
// Global fetch must route strictly over the public Internet. Never replace it
// with a service/VPC binding or a local Node fetch configured for private access.
const MAX_SAMPLE=8192,TIMEOUT_MS=6000,MAX_REDIRECTS=2;
const negative=()=>json({result:'not_confirmed',audio_response:false,message:'Audio response could not be confirmed. You can still save the stream URL.'});
const positive=()=>json({result:'audio_response',audio_response:true,message:'Stream responded with audio data. Playback is not verified.'});
const text=(bytes,start,length)=>String.fromCharCode(...bytes.subarray(start,start+length));
function audioSample(bytes,type){
 if(!/^(?:audio\/(?:mpeg|mp3|aac|aacp|ogg|wav|wave|x-wav|flac|x-flac)|application\/(?:ogg|octet-stream))$/.test(type)||bytes.length<16)return false;
 if(text(bytes,0,4)==='OggS'&&bytes.length>=32)return true;
 if(text(bytes,0,4)==='fLaC')return true;
 if(text(bytes,0,4)==='RIFF'&&text(bytes,8,4)==='WAVE')return true;
 let start=0;
 if(text(bytes,0,3)==='ID3'){
  if(bytes.subarray(6,10).some(byte=>byte>127))return false;
  start=10+bytes[6]*2097152+bytes[7]*16384+bytes[8]*128+bytes[9];
 }
 // Require a complete frame with a valid size/rate header. An ID3 tag or a
 // misleading audio Content-Type alone is not evidence of an audio response.
 for(let i=start;i+7<bytes.length&&i<start+1024;i++){
  if(bytes[i]!==255)continue;
  const second=bytes[i+1],third=bytes[i+2];
  if((second&0xf6)===0xf0){
   const rate=(third>>2)&15,length=((bytes[i+3]&3)<<11)|(bytes[i+4]<<3)|(bytes[i+5]>>5);
   if(rate<=12&&length>=7&&length<=bytes.length-i)return true;
  }
  const version=(second>>3)&3,layer=(second>>1)&3,bitrate=third>>4,rate=(third>>2)&3;
  if((second&0xe0)!==0xe0||version===1||layer!==1||bitrate===0||bitrate===15||rate===3)continue;
  const table=version===3?[0,32,40,48,56,64,80,96,112,128,160,192,224,256,320]:[0,8,16,24,32,40,48,56,64,80,96,112,128,144,160];
  const sampleRate=[44100,48000,32000][rate]/(version===3?1:version===2?2:4);
  const length=Math.floor((version===3?144:72)*table[bitrate]*1000/sampleRate)+((third>>1)&1);
  if(length>=24&&length<=bytes.length-i)return true;
 }
 return false;
}
function abortable(promise,signal){
 if(signal.aborted)return Promise.reject(new Error('Check timed out'));
 return new Promise((resolve,reject)=>{
  const stop=()=>reject(new Error('Check timed out'));
  signal.addEventListener('abort',stop,{once:true});
  Promise.resolve(promise).then(resolve,reject).finally(()=>signal.removeEventListener('abort',stop));
 });
}
function cancel(body){try{Promise.resolve(body?.cancel()).catch(()=>{});}catch{}}
function target(value,request,env){
 const url=new URL(publicStreamUrl(value));
 const ownHosts=new Set([new URL(request.url).hostname]);
 try{if(env.PUBLIC_ORIGIN)ownHosts.add(new URL(env.PUBLIC_ORIGIN).hostname);}catch{}
 for(const own of ownHosts)if(url.hostname===own||url.hostname.endsWith('.'+own))throw new Error('Own application target');
 return url;
}
export async function streamCheckRoutes(request,env,now,deps={human}){
 if(new URL(request.url).pathname!=='/api/owner/stream-check')return null;
 if(request.method!=='POST')throw new HttpError(405,'Method not allowed.');
 const current=await browserWrite(request,env,now);
 // Failed bot checks and invalid payloads consume their allowance before any
 // provider call, DNS resolution, or external connection can take place.
 await limit(env.DB,'stream-check-ip',request.headers.get('CF-Connecting-IP')||'unknown',10,900,now);
 await limit(env.DB,'stream-check-session',current.token_hash,6,900,now);
 await limit(env.DB,'stream-check-global','all',60,60,now);
 const body=await readJson(request,4096),validated=publicStreamUrl(body.stream_url);
 await (deps.human||human)(request,env,body.turnstile_token,'stream-check',now);
 if(env.STREAM_CHECK_PUBLIC_FETCH!=='true')throw new HttpError(503,'Stream checking is temporarily unavailable.');
 const checkId=await beginStreamCheck(env,current.token_hash,validated,now);
 const finish=async passed=>{const stored=await completeStreamCheck(env,current.token_hash,validated,checkId,passed,now);return passed&&stored?positive():negative();};
 let url;try{url=target(validated,request,env);}catch{return finish(false);}
 const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),TIMEOUT_MS);
 let reader;
 try{
  for(let hop=0;hop<=MAX_REDIRECTS;hop++){
   const response=await abortable(isIPv4(url.hostname)?ipv4StreamResponse(url,{connect:deps.connect,signal:controller.signal}):(deps.fetch||fetch)(url.href,{
    method:'GET',redirect:'manual',cache:'no-store',signal:controller.signal,
    headers:{Accept:'audio/*, application/ogg;q=0.9, application/octet-stream;q=0.5','Range':'bytes=0-8191','Icy-MetaData':'0'}
   }),controller.signal);
   if(response.redirected){cancel(response.body);return await finish(false);}
   if([301,302,303,307,308].includes(response.status)){
    cancel(response.body);const location=response.headers.get('Location');if(!location||hop===MAX_REDIRECTS)return await finish(false);
    const next=target(new URL(location,url).href,request,env);
    if(url.protocol==='https:'&&next.protocol!=='https:')return await finish(false);
    url=next;continue;
   }
   if(!response.ok||!response.body){cancel(response.body);return await finish(false);}
   const type=(response.headers.get('Content-Type')||'').split(';',1)[0].trim().toLowerCase();
   if(!/^(?:audio\/(?:mpeg|mp3|aac|aacp|ogg|wav|wave|x-wav|flac|x-flac)|application\/(?:ogg|octet-stream))$/.test(type)){cancel(response.body);return await finish(false);}
   reader=response.body.getReader();const sample=new Uint8Array(MAX_SAMPLE);let size=0,reads=0;
   while(size<MAX_SAMPLE&&reads++<64){
    const {done,value}=await abortable(reader.read(),controller.signal);if(done)break;
    if(!value?.byteLength)continue;const take=Math.min(value.byteLength,MAX_SAMPLE-size);sample.set(value.subarray(0,take),size);size+=take;
    if(audioSample(sample.subarray(0,size),type))return await finish(true);
   }
   return await finish(false);
  }
 }catch{return await finish(false);}
 finally{
  clearTimeout(timer);controller.abort();
  // Do not await an upstream's cancellation promise: cancellation itself must
  // never extend the overall deadline or retain the audio stream indefinitely.
  cancel(reader);try{reader?.releaseLock();}catch{}
 }
 return finish(false);
}
