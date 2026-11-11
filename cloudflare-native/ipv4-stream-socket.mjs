import {publicStreamUrl,isIPv4} from './public-stream-url.mjs';

// A small HTTP client for public numeric IPv4 listening URLs. Worker fetch does
// not support direct IP targets. Hostnames must continue using strictly-public
// fetch, never a socket/DNS preflight that could introduce DNS rebinding.
// This adapter never returns upstream bytes to a website client. Its only caller
// samples audio under the existing authenticated/rate-limited stream-check gate.
const MAX_HEADER=16384,MAX_LINE=2048,MAX_HEADERS=64,MAX_WIRE=65536,MAX_READS=128,MAX_CHUNK_LINE=128;
const encoder=new TextEncoder();
const failure=()=>new Error('Stream response could not be confirmed');
function ignore(promise){try{Promise.resolve(promise).catch(()=>{});}catch{}}
function printable(value){return !/[\u0000-\u0008\u000a-\u001f\u007f]/.test(value);}
function abortable(promise,signal){
 if(!signal)return Promise.resolve(promise);
 if(signal.aborted)return Promise.reject(failure());
 return new Promise((resolve,reject)=>{
  const stop=()=>reject(failure());signal.addEventListener('abort',stop,{once:true});
  Promise.resolve(promise).then(resolve,reject).finally(()=>signal.removeEventListener('abort',stop));
 });
}

export async function ipv4StreamResponse(value,{connect,signal}={}){
 // Revalidate here as well as at the caller: direct/private/special-use and
 // noncanonical numeric spellings must never reach a raw TCP connector.
 const url=new URL(publicStreamUrl(typeof value==='string'?value:value.href));
 if(!isIPv4(url.hostname)||signal?.aborted)throw failure();
 // No direct hostname override, DNS alias, service binding, TLS trust override,
 // source credentials, or retry over HTTP is permitted here.
 connect??=(await import('cloudflare:sockets')).connect;
 if(signal?.aborted)throw failure();
 let socket,reader,closed=false,wire=0,reads=0,buffer=new Uint8Array(0),offset=0;
 const close=()=>{
  if(closed)return;closed=true;signal?.removeEventListener('abort',close);
  try{ignore(reader?.cancel());}catch{}
  try{reader?.releaseLock();}catch{}
  try{ignore(socket?.close());}catch{}
 };
 const alive=()=>{if(closed||signal?.aborted)throw failure();};
 async function refill(){
  alive();if(offset<buffer.length)return true;
  if(++reads>MAX_READS)throw failure();
  const next=await abortable(reader.read(),signal);alive();
  if(next.done)return false;
  if(!(next.value instanceof Uint8Array))throw failure();
  wire+=next.value.byteLength;if(wire>MAX_WIRE)throw failure();
  buffer=next.value;offset=0;return true;
 }
 async function byte(){
  while(offset===buffer.length)if(!await refill())throw failure();
  return buffer[offset++];
 }
 async function line(max=MAX_LINE){
  const parts=[];let size=0;
  for(;;){
   while(offset===buffer.length)if(!await refill())throw failure();
   const end=buffer.indexOf(13,offset),stop=end<0?buffer.length:end,part=buffer.subarray(offset,stop);
   size+=part.length;if(size>max||part.includes(10))throw failure();
   parts.push(String.fromCharCode(...part));offset=stop;
   if(end<0)continue;
   offset++;if(await byte()!==10)throw failure();return parts.join('');
  }
 }
 async function take(max){
  while(offset===buffer.length)if(!await refill())return null;
  const result=buffer.subarray(offset,offset+Math.min(max,buffer.length-offset));offset+=result.length;return result;
 }
 try{
  socket=connect({hostname:url.hostname,port:Number(url.port||(url.protocol==='https:'?443:80))},
   {secureTransport:url.protocol==='https:'?'on':'off',allowHalfOpen:false});
  // Errors on closed/opened must not become unhandled promise rejections when
  // abort interrupts a stalled connection. Every wait uses the caller deadline.
  ignore(socket.closed);ignore(socket.opened);signal?.addEventListener('abort',close,{once:true});
  if(signal?.aborted){close();throw failure();}
  await abortable(socket.opened,signal);alive();reader=socket.readable.getReader();
  const writer=socket.writable.getWriter();
  try{
   // pathname/search stay URL-encoded; never decode them into request-line CRLF.
   const request='GET '+url.pathname+url.search+' HTTP/1.1\r\nHost: '+url.host+'\r\n'+
    'Accept: audio/*, application/ogg;q=0.9, application/octet-stream;q=0.5\r\n'+
    'Range: bytes=0-8191\r\nIcy-MetaData: 0\r\nAccept-Encoding: identity\r\nConnection: close\r\n\r\n';
   await abortable(writer.write(encoder.encode(request)),signal);alive();
  }finally{try{writer.releaseLock();}catch{}}
  const statusLine=await line(),match=/^(?:HTTP\/1\.[01]|ICY) ([2-5][0-9]{2})(?: [\x20-\x7e]*)?$/.exec(statusLine);
  if(!match)throw failure();
  const status=Number(match[1]),headers=new Headers(),seen=new Set();let headerSize=statusLine.length+2;
  for(let count=0;;count++){
   const item=await line();headerSize+=item.length+2;if(headerSize>MAX_HEADER)throw failure();
   if(!item)break;
   if(count>=MAX_HEADERS)throw failure();
   const split=item.indexOf(':'),name=item.slice(0,split).toLowerCase(),value=item.slice(split+1).trim();
   if(split<1||!/^[-!#$%&'*+.^_`|~0-9a-z]+$/.test(name)||!printable(value))throw failure();
   // Reject ambiguous framing/redirect/MIME headers rather than merge them.
   if(['content-length','transfer-encoding','content-encoding','content-type','location','icy-metaint'].includes(name)){
    if(seen.has(name))throw failure();seen.add(name);headers.set(name,value);
   }
  }
  const encoding=(headers.get('content-encoding')||'identity').toLowerCase();
  if(encoding!=='identity')throw failure();
  const transfer=headers.get('transfer-encoding'),length=headers.get('content-length');
  if(transfer&&(transfer.toLowerCase()!=='chunked'||length!==null))throw failure();
  if(length!==null&&(!/^[0-9]{1,15}$/.test(length)||!Number.isSafeInteger(Number(length))))throw failure();
  if(headers.has('icy-metaint')&&headers.get('icy-metaint')!=='0')throw failure();
  let remaining=length===null?Infinity:Number(length),chunkRemaining=0,ended=false;
  async function read(){
   alive();if(ended)return null;
   if(transfer){
    if(chunkRemaining===0){
     const size=await line(MAX_CHUNK_LINE),sizeMatch=/^([0-9a-fA-F]{1,8})(?:;[\x20-\x7e]*)?$/.exec(size);
     if(!sizeMatch)throw failure();chunkRemaining=parseInt(sizeMatch[1],16);
     if(chunkRemaining===0){
      let trailers=0,trailerSize=0;
      for(;;){const item=await line();trailerSize+=item.length+2;if(++trailers>32||trailerSize>MAX_HEADER)throw failure();if(!item)break;}
      ended=true;return null;
     }
    }
    const part=await take(Math.min(chunkRemaining,8192));if(!part)throw failure();chunkRemaining-=part.length;
    if(chunkRemaining===0&&(await byte()!==13||await byte()!==10))throw failure();
    return part;
   }
   if(remaining===0){ended=true;return null;}
   const part=await take(Math.min(remaining,8192));if(!part){if(remaining!==Infinity)throw failure();ended=true;return null;}
   remaining-=part.length;return part;
  }
  const body=new ReadableStream({
   async pull(controller){try{const part=await read();if(part)controller.enqueue(part);else{close();controller.close();}}catch(error){close();controller.error(error);}},
   cancel(){close();}
  },{highWaterMark:0});
  return {ok:status>=200&&status<300,status,headers,body,redirected:false};
 }catch(error){close();throw error;}
}
