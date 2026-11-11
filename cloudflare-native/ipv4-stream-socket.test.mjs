import {test} from 'node:test';
import assert from 'node:assert/strict';
import {ipv4StreamResponse} from './ipv4-stream-socket.mjs';

const url='http://162.244.81.219:8020/live',encode=value=>new TextEncoder().encode(value);
const concat=(...parts)=>{const result=new Uint8Array(parts.reduce((sum,part)=>sum+part.length,0));let size=0;for(const part of parts){result.set(part,size);size+=part.length;}return result;};
const mp3=()=>{const bytes=new Uint8Array(417);bytes.set([255,251,144,0]);return bytes;};
function fake(parts,{opened,write,close,stall=false}={}){
 const state={calls:[],sent:[],closes:0,cancels:0};
 state.connect=(address,options)=>{
  state.calls.push({address,options});let index=0;
  return {opened:opened||Promise.resolve({}),closed:Promise.resolve(),
   readable:new ReadableStream({pull(controller){if(index<parts.length)controller.enqueue(parts[index++]);else if(!stall)controller.close();else return new Promise(()=>{});},cancel(){state.cancels++;}}),
   writable:new WritableStream({write(bytes){state.sent.push(new TextDecoder().decode(bytes));return write?.();}}),
   close(){state.closes++;return close?.();}};
 };
 return state;
}
async function sample(response){const reader=response.body.getReader(),parts=[];try{for(;;){const next=await reader.read();if(next.done)break;parts.push(next.value);}}finally{await reader.cancel();}return concat(...parts);}
function response(body=mp3(),headers='Content-Type: audio/mpeg\r\n',status='HTTP/1.1 200 OK'){return concat(encode(status+'\r\n'+headers+'\r\n'),body);}

test('numeric IPv4 uses a fixed bounded GET without credentials, decoding or browser headers',async()=>{
 const state=fake([response()]),input=url+'?sid=2&path=%0D%0AX-Evil%3Ayes';
 const result=await ipv4StreamResponse(input,{connect:state.connect});
 assert.deepEqual(await sample(result),mp3());assert.equal(result.ok,true);assert.equal(result.status,200);
 assert.deepEqual(state.calls,[{address:{hostname:'162.244.81.219',port:8020},options:{secureTransport:'off',allowHalfOpen:false}}]);
 assert.equal(state.closes,1);assert.equal(state.sent.length,1);
 const sent=state.sent[0];assert.ok(sent.startsWith('GET /live?sid=2&path=%0D%0AX-Evil%3Ayes HTTP/1.1\r\nHost: 162.244.81.219:8020\r\n'));
 assert.match(sent,/Range: bytes=0-8191\r\n/);assert.match(sent,/Icy-MetaData: 0\r\n/);assert.match(sent,/Accept-Encoding: identity\r\n/);
 assert.match(sent,/Connection: close\r\n\r\n$/);assert.doesNotMatch(sent,/Cookie|Authorization|X-CSRF|X-Evil:yes/);
});

test('private, reserved, disguised, credential-bearing and hostname URLs never open raw sockets',async()=>{
 const state=fake([]);
 for(const input of ['http://127.0.0.1:8000/live','http://2130706433/live','http://0x7f000001/live','http://0177.0.0.1/live','http://127.1/live','http://169.254.169.254/','http://10.0.0.1/','http://192.0.2.1/','http://[::ffff:127.0.0.1]/','https://user:secret@8.8.8.8/live','https://8.8.8.8/live?token=secret','https://stream.example.com/live'])
  await assert.rejects(ipv4StreamResponse(input,{connect:state.connect}),undefined,input);
 assert.equal(state.calls.length,0);
});

test('HTTPS always requests runtime TLS with the actual IP and never retries plaintext',async()=>{
 for(const input of ['https://8.8.8.8/live','https://8.8.8.8:8443/live']){
  const state=fake([],{opened:Promise.reject(new Error('certificate name mismatch'))});
  await assert.rejects(ipv4StreamResponse(input,{connect:state.connect}),/certificate name mismatch/);
  assert.equal(state.calls.length,1);assert.equal(state.calls[0].address.hostname,'8.8.8.8');assert.equal(state.calls[0].options.secureTransport,'on');
  assert.equal(state.calls[0].address.port,input.includes('8443')?8443:443);assert.equal(state.sent.length,0);assert.equal(state.closes,1);
 }
});

test('headers and complete chunked audio work across arbitrary byte boundaries, including legacy ICY',async()=>{
 for(const status of ['HTTP/1.0 200 OK','HTTP/1.1 206 Partial Content','ICY 200 OK']){
  const content=concat(encode(status+'\r\nContent-Type: audio/mpeg\r\nTransfer-Encoding: chunked\r\n\r\n1a1;test=yes\r\n'),mp3(),encode('\r\n0\r\nX-End: yes\r\n\r\n'));
  const state=fake(Array.from({length:Math.ceil(content.length/7)},(_,i)=>content.subarray(i*7,i*7+7)));
  const result=await ipv4StreamResponse(url,{connect:state.connect});assert.deepEqual(await sample(result),mp3());assert.equal(state.closes,1);
 }
});

test('redirect response exposes only the status/location for caller revalidation and can be cancelled immediately',async()=>{
 const state=fake([response(encode('secret response'), 'Location: http://127.0.0.1/private\r\nX-Secret: private\r\n','HTTP/1.1 302 Found')],{stall:true});
 const result=await ipv4StreamResponse(url,{connect:state.connect});assert.equal(result.status,302);assert.equal(result.ok,false);
 assert.equal(result.headers.get('Location'),'http://127.0.0.1/private');assert.equal(result.headers.get('X-Secret'),null);
 await result.body.cancel();assert.equal(state.closes,1);
});

test('ambiguous framing, compression, unsolicited metadata and malformed headers fail closed',async()=>{
 for(const headers of [
  'Content-Length: 417\r\nTransfer-Encoding: chunked\r\n','Content-Length: -1\r\n','Content-Length: 1\r\nContent-Length: 1\r\n',
  'Content-Type: audio/mpeg\r\nContent-Type: audio/mpeg\r\n','Transfer-Encoding: gzip, chunked\r\n','Content-Encoding: gzip\r\n',
  'Icy-MetaInt: 16000\r\n','Location: /a\r\nLocation: /b\r\n','X-Fold: first\r\n second\r\n','Invalid header\r\n','X-Control: bad\x00value\r\n',
  'X-Long: '+'a'.repeat(2049)+'\r\n',Array.from({length:65},(_,i)=>'X-'+i+': a\r\n').join(''),
  Array.from({length:12},(_,i)=>'X-'+i+': '+'a'.repeat(1500)+'\r\n').join('')]){
  const state=fake([response(mp3(),headers)]);await assert.rejects(ipv4StreamResponse(url,{connect:state.connect}),undefined,headers.slice(0,50));assert.equal(state.closes,1);
 }
 for(const status of ['HTTP/2 200 OK','HTTP/1.1 100 Continue','ICY 200 OK\nX-Injection: yes']){
  const state=fake([response(mp3(),'Content-Type: audio/mpeg\r\n',status)]);await assert.rejects(ipv4StreamResponse(url,{connect:state.connect}));assert.equal(state.closes,1);
 }
});

test('malformed/truncated chunk bodies, oversized wire reads and empty-read loops are bounded',async()=>{
 for(const content of [encode('z\r\n'),encode('1\r\naXX'),encode('0\r\n'+'X: '+'a'.repeat(2049)+'\r\n\r\n'),encode('1'.repeat(129)+'\r\n')]){
  const state=fake([response(content,'Content-Type: audio/mpeg\r\nTransfer-Encoding: chunked\r\n')]);
  await assert.rejects(sample(await ipv4StreamResponse(url,{connect:state.connect})));assert.equal(state.closes,1);
 }
 const large=fake([response(new Uint8Array(65536))]);await assert.rejects(ipv4StreamResponse(url,{connect:large.connect}));assert.equal(large.closes,1);
 const empty=fake(Array.from({length:130},()=>new Uint8Array()));await assert.rejects(ipv4StreamResponse(url,{connect:empty.connect}));assert.equal(empty.closes,1);
 const short=fake([response(encode('short'),'Content-Length: 10\r\n')]);await assert.rejects(sample(await ipv4StreamResponse(url,{connect:short.connect})));assert.equal(short.closes,1);
});

test('the shared abort deadline interrupts connect, write, header and body stalls, without awaiting close',async()=>{
 for(const stage of ['connect','write','headers','body']){
  const state=fake(stage==='body'?[response(new Uint8Array())]:[],{
   opened:stage==='connect'?new Promise(()=>{}):undefined,write:stage==='write'?()=>new Promise(()=>{}):undefined,
   close:()=>new Promise(()=>{}),stall:true});
  const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),20),start=Date.now();
  try{await assert.rejects((async()=>{const result=await ipv4StreamResponse(url,{connect:state.connect,signal:controller.signal});await sample(result);})());}
  finally{clearTimeout(timer);}
  assert.ok(Date.now()-start<1000,stage);assert.equal(state.closes,1,stage);
 }
 const controller=new AbortController();controller.abort();const state=fake([]);await assert.rejects(ipv4StreamResponse(url,{connect:state.connect,signal:controller.signal}));assert.equal(state.calls.length,0);
});
