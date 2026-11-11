import {test} from 'node:test';import assert from 'node:assert/strict';import {fetchHandler} from './worker.mjs';
import {readFileSync} from 'node:fs';
const origin='https://radiolocals.com',etag='"public-release-seven"';
test('images shipped in the app shell are served through the real public GET and HEAD routes',async()=>{
 const html=readFileSync(new URL('./public/index.html',import.meta.url),'utf8'),paths=[...new Set([...html.matchAll(/<img\b[^>]*\bsrc="(\/assets\/[^"?#]+)"/g)].map(match=>match[1]))];
 assert.ok(paths.includes('/assets/icecast-logo.svg'));assert.ok(paths.includes('/assets/shoutcast-logo.svg'));
 const seen=[],env={ASSETS:{async fetch(request){const path=new URL(request.url).pathname;seen.push(path);const body=readFileSync(new URL('./public'+path,import.meta.url));return new Response(body,{headers:{'Content-Type':path.endsWith('.svg')?'image/svg+xml':path.endsWith('.webp')?'image/webp':'image/png'}});}}};
 for(const path of paths){const get=await fetchHandler(new Request(origin+path),env),head=await fetchHandler(new Request(origin+path,{method:'HEAD'}),env);assert.equal(get.status,200,path);assert.match(get.headers.get('Content-Type'),/^image\//,path);assert.ok((await get.arrayBuffer()).byteLength>0,path);assert.equal(head.status,200,path);assert.equal(head.headers.get('Content-Type'),get.headers.get('Content-Type'),path);assert.equal(await head.text(),'');assert.equal(seen.filter(value=>value===path).length,2,path);}
});
test('public assets retain ETag and conditional304 metadata, never mutate the source response or require cookie variation',async()=>{
 const seen=[],sources=[],env={ASSETS:{async fetch(request){seen.push(request);const unchanged=request.headers.get('If-None-Match')===etag;const response=new Response(unchanged?null:'safe public javascript',{status:unchanged?304:200,headers:{ETag:etag,'Content-Type':'text/javascript',Vary:'Accept-Encoding'}});sources.push(response);return response;}}};
 const first=await fetchHandler(new Request(origin+'/assets/site.js'),env);assert.equal(await first.text(),'safe public javascript');assert.equal(first.headers.get('cache-control'),'public, max-age=0, must-revalidate');
 const next=await fetchHandler(new Request(origin+'/assets/site.js',{headers:{'If-None-Match':etag,Cookie:'private session'}}),env);assert.equal(next.status,304);assert.equal(await next.text(),'');assert.equal(seen[1].headers.get('If-None-Match'),etag);
 for(const response of [first,next]){assert.equal(response.headers.get('ETag'),etag);assert.equal(response.headers.get('Vary'),'Accept-Encoding');assert.equal(response.headers.get('Set-Cookie'),null);assert.match(response.headers.get('Content-Security-Policy'),/frame-ancestors 'none'/);assert.equal(response.headers.get('Strict-Transport-Security'),'max-age=15552000');}
 assert.equal(sources[0].headers.get('Cache-Control'),null);assert.equal(sources[1].headers.get('Strict-Transport-Security'),null);
});
test('HTML, missing/error assets, redirects, cookie-setting responses and service-worker entrypoints cannot become publicly cached',async()=>{
 for(const [path,status,type,cookie] of [['/admin',200,'text/html',false],['/station-edit',200,'text/html',false],['/assets/missing.js',404,'text/plain',false],['/assets/error.js',503,'text/plain',false],['/assets/redirect.js',302,'text/plain',false],['/assets/site.js',200,'text/javascript',true],['/sw.js',200,'text/javascript',false],['/assets/template.html',200,'text/html',false]]){
  const headers={'Content-Type':type,ETag:etag,...(cookie?{'Set-Cookie':'private=1; Secure; HttpOnly'}:{})},env={MIGRATION_PREVIEW:'false',ASSETS:{fetch:async()=>new Response('public or private content',{status,headers})}};
  const response=await fetchHandler(new Request(origin+path,{headers:{'If-None-Match':etag}}),env);assert.equal(response.status,status,path);assert.equal(response.headers.get('Cache-Control'),'no-store',path);if(cookie)assert.equal(response.headers.get('Set-Cookie'),headers['Set-Cookie']);
 }
});

test('an upstream HTML304 remains bodyless and private without attempting an app-shell rewrite',async()=>{
 const env={MIGRATION_PREVIEW:'false',ASSETS:{fetch:async()=>new Response(null,{status:304,headers:{ETag:etag,'Content-Type':'text/html'}})}};
 const response=await fetchHandler(new Request(origin+'/admin',{headers:{'If-None-Match':etag}}),env);assert.equal(response.status,304);assert.equal(await response.text(),'');assert.equal(response.headers.get('Cache-Control'),'no-store');assert.equal(response.headers.get('ETag'),etag);
});
