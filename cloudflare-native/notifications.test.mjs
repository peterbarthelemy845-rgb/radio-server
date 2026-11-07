import {test} from 'node:test';import assert from 'node:assert/strict';
import {ownerNotification,decisionReason} from './notifications.mjs';import {decrypt} from './security.mjs';
const env={DATA_ENCRYPTION_KEY:'a'.repeat(64)},adId='b'.repeat(32);
test('owner notifications use fixed subjects, encrypted plain text and revision decision keys',async()=>{
 const options={kind:'station-needs-changes',stationCode:10,recipient:'owner@example.com',event:{revision:1,stream_url:'https://private.example/?token=private-token'},reason:'Please replace the station artwork.'};
 const notice=await ownerNotification(env,options),again=await ownerNotification(env,options),updated=await ownerNotification(env,{...options,event:{revision:2}}),differentDecision=await ownerNotification(env,{...options,kind:'station-approved'});
 assert.equal(notice.id,again.id);assert.notEqual(notice.encrypted_payload,again.encrypted_payload);assert.notEqual(notice.id,updated.id);assert.notEqual(notice.id,differentDecision.id);
 assert.equal(notice.subject,'Your Radio Locals station needs changes');assert.equal(notice.encrypted_payload.includes(options.reason),false);
 const payload=JSON.parse(await decrypt(env,notice.encrypted_payload));assert.deepEqual(Object.keys(payload),['text']);assert.match(payload.text,/Station code: 10/);assert.match(payload.text,/Please replace the station artwork/);assert.equal(payload.text.includes('private.example'),false);assert.equal(payload.text.includes('private-token'),false);
 const ad=await ownerNotification(env,{kind:'ad-removed',stationCode:10,recipient:'owner@example.com',event:adId,adId});assert.match(JSON.parse(await decrypt(env,ad.encrypted_payload)).text,/Advertisement reference: b+/);
});
test('notification explanations are bounded and exclude links, email addresses and credentials',()=>{
 assert.equal(decisionReason(undefined,'Default explanation.'),'Default explanation.');assert.equal(decisionReason('  Please update the artwork.  '),'Please update the artwork.');
 for(const reason of ['x'.repeat(301),'Header\r\nBcc: other@example.com','See https://private.example/?token=abc','Visit example.com/private','Email owner@example.com','Use /api/private?token=abc','Password is hunter2','Bearer abc','verification code 123456','sk-proj-private','a'.repeat(64)])assert.throws(()=>decisionReason(reason),e=>e.status===400,reason);
});
test('invalid recipient, header injection and private artwork paths cannot form notifications',async()=>{
 const options={kind:'ad-approved',stationCode:10,recipient:'owner@example.com',event:1,adId};
 for(const invalid of [{recipient:'owner@example.com\r\nBcc: other@example.com'},{adId:'/api/private'},{kind:'Injected subject\n'},{stationCode:'10'}])await assert.rejects(ownerNotification(env,{...options,...invalid}));
});
