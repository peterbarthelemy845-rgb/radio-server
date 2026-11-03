import {test} from 'node:test';
import assert from 'node:assert/strict';
import {proxy} from './worker.mjs';
const env = {ORIGIN_URL: 'https://radio-server-z0hb.onrender.com'};
test('migrated routes preserve the real URL and never fall back after a native error',async()=>{
 let legacy=0;const bound={...env,NATIVE:{async fetch(request){assert.equal(new URL(request.url).hostname,'radiolocals.com');return new Response('native unavailable',{status:503});}}};
 const response=await proxy(new Request('https://radiolocals.com/api/admin/stations'),bound,async()=>{legacy++;return new Response('legacy');});
 assert.equal(response.status,503);assert.equal(legacy,0);
 await proxy(new Request('https://radiolocals.com/legacy-test'),bound,async()=>{legacy++;return new Response('legacy');});assert.equal(legacy,1);
});
test('retired station player address redirects to the root without contacting an origin',async()=>{
 for(const method of ['GET','HEAD'])for(const path of ['/radiolavoixdivine','/radiolavoixdivine/']){
  const response=await proxy(new Request('https://radiolocals.com'+path+'?source=share',{method}),env,async()=>{throw Error('Origin must not be used');});
  assert.equal(response.status,308);assert.equal(response.headers.get('Location'),'https://radiolocals.com/?source=share');
 }
});

test('preserves POST, query, session and CSRF; removes forged forwarding headers', async () => {
  const request = new Request('https://radiolocals.com/api/add-station?x=1', {
    method:'POST', body:'csrf_token=example', headers:{cookie:'session=private',
      origin:'https://radiolocals.com', 'x-forwarded-host':'attacker.example'},
  });
  const response = await proxy(request, env, async (sent) => {
    assert.equal(sent.url, env.ORIGIN_URL + '/api/add-station?x=1');
    assert.equal(sent.headers.get('cookie'), 'session=private');
    assert.equal(sent.headers.get('origin'), 'https://radiolocals.com');
    assert.equal(sent.headers.get('x-forwarded-host'), null);
    assert.equal(await sent.text(), 'csrf_token=example');
    assert.equal(sent.redirect, 'manual');
    return new Response('ok', {headers:{'Set-Cookie':'session=new; Secure; HttpOnly'}});
  });
  assert.equal(response.headers.get('cache-control'), 'no-store');
  assert.match(response.headers.get('set-cookie'), /HttpOnly/);
});
test('rewrites only origin redirects, not external destinations', async () => {
  for (const [location, expected] of [[env.ORIGIN_URL+'/admin/login','https://radiolocals.com/admin/login'],
    ['https://example.com/login','https://example.com/login']]) {
    const response = await proxy(new Request('https://radiolocals.com/'), env,
      async () => new Response(null,{status:302,headers:{Location:location}}));
    assert.equal(response.headers.get('Location'), expected);
  }
});
test('rejects unapproved upstream and fails safely on outage', async () => {
  let called=false;
  assert.equal((await proxy(new Request('https://radiolocals.com'),
    {ORIGIN_URL:'https://attacker.example'}, async()=>{called=true;})).status,503);
  assert.equal(called,false);
  assert.equal((await proxy(new Request('https://radiolocals.com'),env,
    async()=>{throw new Error('private upstream detail');})).status,502);
});
