import {test} from 'node:test';
import assert from 'node:assert/strict';
import {operationsFixture} from './operations-fixture.mjs';
import {handle} from './worker.mjs';
const png=new Uint8Array(Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Y9Zl1sAAAAASUVORK5CYII=','base64'));
async function fixture(){const f=await operationsFixture(),key='e'.repeat(64)+'.png',transforms=[];f.sqlite.prepare('UPDATE stations SET artwork_key=? WHERE code=?').run(key,f.station);await f.env.MEDIA.put('sanitized/'+key,png,{customMetadata:{sanitizer_version:'1'}});f.env.IMAGES={input(input){return {transform(options){transforms.push(options);return {async output(format){assert.deepEqual(format,{format:'image/png',anim:false});return {response:()=>new Response(png)};}};}};}};return {...f,key,transforms,get:(headers={},query='?size=192',method='GET')=>handle(new Request('https://radiolocals.com/artwork/'+key+query,{headers,method}),f.env,f.now)};}
test('thumbnail transforms are bounded, cached independently and reuse a byte-accurate ETag',async()=>{
 const f=await fixture(),first=await f.get();assert.equal(first.status,200);assert.equal(first.headers.get('Content-Type'),'image/png');assert.deepEqual(new Uint8Array(await first.arrayBuffer()),png);assert.deepEqual(f.transforms,[{width:192,height:192,fit:'contain'}]);assert.ok(f.objects.has('thumbnails/v1/192/'+f.key));
 const etag=first.headers.get('ETag');assert.match(etag,/^"[a-f0-9]{64}"$/);assert.equal(first.headers.get('Cache-Control'),'public, max-age=0, must-revalidate');const next=await f.get({'If-None-Match':'W/'+etag});assert.equal(next.status,304);assert.equal(await next.text(),'');assert.equal(next.headers.get('ETag'),etag);assert.equal(f.transforms.length,1);
 const head=await f.get({},'?size=192','HEAD');assert.equal(head.status,200);assert.equal(await head.text(),'');assert.equal(head.headers.get('ETag'),etag);
});
test('publication and sanitizer checks run before cache and conditional responses',async()=>{
 const f=await fixture(),etag=(await f.get()).headers.get('ETag');f.sqlite.prepare("UPDATE stations SET status='suspended' WHERE code=?").run(f.station);assert.equal((await f.get({'If-None-Match':etag})).status,404);
 f.sqlite.prepare("UPDATE stations SET status='published' WHERE code=?").run(f.station);await f.env.MEDIA.put('sanitized/'+f.key,png,{customMetadata:{}});assert.equal((await f.get({'If-None-Match':etag})).status,404);
});
test('a changed source invalidates its derived cache and a suspension during transformation prevents delivery',async()=>{
 const f=await fixture();await f.get();const changed=png.slice();changed[changed.length-1]^=1;await f.env.MEDIA.put('sanitized/'+f.key,changed,{customMetadata:{sanitizer_version:'1'}});await f.get();assert.equal(f.transforms.length,2);
 await f.env.MEDIA.delete('thumbnails/v1/192/'+f.key);f.env.IMAGES={input(){return {transform(){return {async output(){f.sqlite.prepare("UPDATE stations SET status='suspended'").run();return {response:()=>new Response(png)};}};}};}};assert.equal((await f.get()).status,404);
});
test('unsupported sizes, malformed output and missing image processing fail without exposing original bytes',async()=>{
 const f=await fixture();for(const query of ['?size=10000','?size=192&size=192','?size=javascript'])assert.equal((await f.get({},query)).status,400);
 f.env.IMAGES={input(){return {transform(){return {async output(){return {response:()=>new Response('<script>bad</script>')};}};}};}};const invalid=await f.get();assert.equal(invalid.status,503);assert.doesNotMatch(await invalid.text(),/script|bad/);assert.equal(f.objects.has('thumbnails/v1/192/'+f.key),false);
 delete f.env.IMAGES;assert.equal((await f.get()).status,503);const full=await f.get({},'');assert.equal(full.status,200);assert.equal(full.headers.get('Cache-Control'),'no-store');
});
