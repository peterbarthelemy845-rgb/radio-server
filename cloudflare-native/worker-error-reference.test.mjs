import {test} from 'node:test';import assert from 'node:assert/strict';import {fetchHandler} from './worker.mjs';
import {HttpError} from './security.mjs';
test('validation metadata exposes only bounded retry times, safe field targets and known error codes',async()=>{
 for(const safe of [true,false]){const error=new HttpError(429,'Try again shortly.');Object.assign(error,{retry_after:safe?45:Infinity,field:safe?'stream_path':'private_email@example.com',code:safe?'code_expired':'private_mailbox',private_value:'NEVER RETURN'});const env={DB:{prepare(){throw error;}}};const response=await fetchHandler(new Request('https://radiolocals.com/api/stations'),env),data=await response.json();assert.equal(response.status,429);assert.equal(data.retry_after,safe?45:undefined);assert.equal(data.field,safe?'stream_path':undefined);assert.equal(data.code,safe?'code_expired':undefined);assert.equal(data.private_value,undefined);}
});
test('unexpected failures produce unique safe references without exposing exception, URL, cookie or request-body details',async()=>{
 const secret='private.person@example.com secret-device-3961',logs=[],original=console.error;console.error=value=>logs.push(value);
 try{
  const env={DB:{prepare(){const error=new Error(secret);error.name='D1_ERROR';error.stack='private stack '+secret;throw error;}}},bodies=[];
  for(const suffix of ['?email='+encodeURIComponent(secret),'?device_code=3961']){const response=await fetchHandler(new Request('https://radiolocals.com/api/stations'+suffix,{headers:{Cookie:'private='+secret,Authorization:'Bearer '+secret}}),env);assert.equal(response.status,503);assert.equal(response.headers.get('Cache-Control'),'no-store');bodies.push(await response.json());}
  assert.notEqual(bodies[0].error_reference,bodies[1].error_reference);
  for(let i=0;i<2;i++){const entry=JSON.parse(logs[i]);assert.equal(entry.error_reference,bodies[i].error_reference);assert.match(entry.error_reference,/^[a-f0-9]{16}$/);assert.equal(entry.route_category,'api');assert.equal(entry.error_category,'database');assert.equal(bodies[i].message,'Service temporarily unavailable.');}
  assert.doesNotMatch(JSON.stringify({logs,bodies}),/private\.person|secret-device|3961|private stack|Bearer|email=|device_code=/);
 }finally{console.error=original;}
});
test('expected validation/authentication failures do not create error references or diagnostic noise',async()=>{
 const logs=[],original=console.error;console.error=value=>logs.push(value);try{const response=await fetchHandler(new Request('https://radiolocals.com/api/radio/poll',{method:'POST',headers:{'Content-Type':'application/json'},body:'{}'}),{});assert.equal(response.status,401);const body=await response.json();assert.equal(body.error_reference,undefined);assert.equal(logs.length,0);}finally{console.error=original;}
});
