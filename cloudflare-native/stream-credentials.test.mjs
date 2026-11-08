import {test} from 'node:test';
import assert from 'node:assert/strict';
import {publicStreamUrl} from './public-stream-url.mjs';
import {authRoutes} from './owner-auth.mjs';
import {streamCheckRoutes} from './stream-check.mjs';
import {operationsFixture} from './operations-fixture.mjs';

test('shared stream validation rejects private query credentials without disclosing their value',()=>{
 for(const key of ['token','access_token','access-token','AUTHORIZATION','auth','api_key','api-key','key','password','pass','secret','signature','sig','s%69g']){
  const address='https://stream.example.com/live?'+key+'=do-not-publish';
  assert.throws(()=>publicStreamUrl(address),error=>error.status===400&&!error.message.includes('do-not-publish'));
 }
 for(const address of ['https://stream.example.com/live?listen=1','http://stream.example.com:8000/;stream.mp3?type=.mp3','https://stream.example.com/live?format=mp3&bitrate=128'])assert.equal(publicStreamUrl(address),address);
});

test('owner stream edits cannot save private query credentials by bypassing the signup form',async()=>{
 const f=await operationsFixture();f.owner();
 await assert.rejects(authRoutes(f.request('/api/owner/station',{stream_url:'https://stream.example.com/live?token=do-not-publish',bio:'Updated station'}),f.env,f.now),error=>error.status===400&&!error.message.includes('do-not-publish'));
 assert.equal(f.sqlite.prepare('SELECT stream_url FROM stations WHERE code=?').get(f.station).stream_url,'https://example.com/live');
});

test('optional stream checks reject credential-bearing URLs before provider or stream requests',async()=>{
 const f=await operationsFixture();f.env.STREAM_CHECK_PUBLIC_FETCH='true';let checks=0,fetches=0;
 await assert.rejects(streamCheckRoutes(f.request('/api/owner/stream-check',{stream_url:'https://stream.example.com/live?api_key=do-not-publish',turnstile_token:'test'}),f.env,f.now,{human:async()=>{checks++;},fetch:async()=>{fetches++;throw Error('Unexpected stream request');}}),error=>error.status===400);
 assert.equal(checks,0);assert.equal(fetches,0);
});
