import {test} from 'node:test';import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';import {runInNewContext} from 'node:vm';
import {handle} from './worker.mjs';
const origin='https://native.example',publicFiles=['/offline.html','/assets/offline.css','/assets/pwa-offline.js','/assets/radio-app-192.png'];
const source=path=>readFileSync(new URL('./public'+path,import.meta.url));
function serviceWorker(){
 const events={},added=[],deleted=[],network=[],matches=[];let skip=0,claim=0,online=true;
 const stored=new Map(publicFiles.map(path=>[path,'public offline asset '+path]));
 const caches={async open(name){assert.equal(name,'radio-locals-public-v2');return {async addAll(paths){added.push(...paths);}};},async keys(){return ['radio-locals-public-v0','radio-locals-public-v1','radio-locals-public-v2','unrelated-cache'];},async delete(name){deleted.push(name);return true;},async match(path){matches.push(path);return stored.has(path)?new Response(stored.get(path)):undefined;}};
 const self={location:{origin},addEventListener(name,fn){events[name]=fn;},async skipWaiting(){skip++;},clients:{async claim(){claim++;}}};
 runInNewContext(source('/sw.js').toString(),{self,caches,URL,Response,fetch:async request=>{network.push(request);if(!online)throw Error('offline');return new Response('private network response '+request.url);}});
 async function lifecycle(name){let done;events[name]({waitUntil(promise){done=promise;}});await done;}
 function fetchEvent(path,options={}){let response;const request={url:path.startsWith('http')?path:origin+path,method:'GET',mode:'cors',...options};events.fetch({request,respondWith(promise){assert.equal(response,undefined);response=Promise.resolve(promise);}});return {request,response};}
 return {events,added,deleted,network,matches,stored,lifecycle,fetchEvent,offline(){online=false;},skip:()=>skip,claim:()=>claim};
}
test('service-worker install stores only public offline resources and activation retires only its old cache',async()=>{const f=serviceWorker();await f.lifecycle('install');assert.deepEqual(f.added,publicFiles);assert.equal(f.skip(),1);await f.lifecycle('activate');assert.deepEqual(f.deleted,['radio-locals-public-v0','radio-locals-public-v1']);assert.equal(f.claim(),1);assert.equal(f.network.length,0);});
test('service worker leaves API calls, private artwork, writes and other origins untouched',()=>{const f=serviceWorker();
 for(const [path,options] of [
  ['/api/admin/stations',{}],['/api/owner/artwork',{}],['/api/radio/poll',{method:'POST'}],['/api/admin/legal?private=1',{mode:'navigate'}],
  ['/artwork/'+'a'.repeat(64)+'.png',{}],['/api/ad-artwork/'+'b'.repeat(32),{}],['/private/report.pdf',{}],['/assets/site.js',{}],
  ['https://elsewhere.example/offline.html',{mode:'navigate'}],['/offline.html',{method:'POST'}]
 ])assert.equal(f.fetchEvent(path,options).response,undefined,path);
 assert.equal(f.network.length,0);assert.equal(f.matches.length,0);assert.equal(f.added.length,0);
});
test('navigation returns live private responses without storing them and falls back only to public offline HTML',async()=>{const f=serviceWorker();await f.lifecycle('install');
 for(const path of ['/','/admin','/station-edit','/station/10']){const live=f.fetchEvent(path,{mode:'navigate',headers:{Cookie:'private session'}});assert.match(await(await live.response).text(),/private network response/);assert.equal(f.network.at(-1),live.request);}
 assert.equal(f.matches.length,0);assert.deepEqual(f.added,publicFiles);
 f.offline();for(const path of ['/admin','/station-edit','/station/10']){const offline=await f.fetchEvent(path,{mode:'navigate'}).response;assert.equal(await offline.text(),'public offline asset /offline.html');}
 assert.deepEqual(f.matches,['/offline.html','/offline.html','/offline.html']);assert.deepEqual(f.added,publicFiles);
 f.stored.delete('/offline.html');assert.equal((await f.fetchEvent('/admin',{mode:'navigate'}).response).type,'error');
});
test('offline asset fallback uses only the public allowlist and never stores network content',async()=>{const f=serviceWorker();
 const live=await f.fetchEvent('/assets/offline.css?theme=1').response;assert.match(await live.text(),/private network response/);assert.equal(f.added.length,0);
 f.offline();for(const path of publicFiles){const result=await f.fetchEvent(path+'?ignored=1').response;assert.equal(await result.text(),'public offline asset '+path);}
 assert.deepEqual(f.matches,publicFiles);assert.equal(f.added.length,0);assert.equal(f.fetchEvent('/assets/admin-tools.js').response,undefined);
});
function installUi({standalone=false,protocol='https:'}={}){
 const events={},nodes=[],registrations=[],containers=[];function element(tag){const node={tag,children:[],hidden:false,setAttribute(){},append(...children){this.children.push(...children);},showModal(){this.shown=true;},close(){this.shown=false;}};nodes.push(node);return node;}
 const document={createElement:element,body:{append(...children){containers.push(...children);}}};const navigator={serviceWorker:{async register(...args){registrations.push(args);}}};
 runInNewContext(source('/assets/pwa.js').toString(),{document,navigator,location:{protocol},matchMedia:()=>({matches:standalone}),window:{addEventListener(name,fn){events[name]=fn;}},$:()=>({append(...children){containers.push(...children);}})});
 return {events,nodes,registrations,button:nodes.find(node=>node.tag==='button'),dialog:nodes.find(node=>node.tag==='dialog')};
}
test('offline support registers the root worker over HTTPS without adding install controls',async()=>{const f=installUi();await f.events.load();assert.equal(f.registrations.length,1);assert.equal(f.registrations[0][0],'/sw.js');assert.equal(f.registrations[0][1].scope,'/');assert.equal(f.registrations[0][1].updateViaCache,'none');assert.equal(installUi({protocol:'http:'}).events.load,undefined);assert.equal(f.nodes.length,0);assert.equal(f.events.beforeinstallprompt,undefined);assert.equal(f.events.appinstalled,undefined);});

test('manifest, offline dependencies and icon dimensions match installable public assets',()=>{
 const manifest=JSON.parse(source('/manifest.webmanifest'));assert.equal(manifest.name,'Radio Locals');assert.equal(manifest.display,'standalone');assert.equal(manifest.scope,'/');assert.equal(manifest.start_url,'/#radio');
 for(const icon of manifest.icons){assert.match(icon.src,/^\/assets\/radio-app-[a-z0-9-]+\.png$/);const bytes=source(icon.src);assert.equal(bytes.subarray(0,8).toString('hex'),'89504e470d0a1a0a');assert.equal(`${bytes.readUInt32BE(16)}x${bytes.readUInt32BE(20)}`,icon.sizes);}assert.ok(manifest.icons.some(icon=>icon.purpose==='maskable'));
 const offline=source('/offline.html').toString(),dependencies=[...offline.matchAll(/(?:href|src)="([^"]+)"/g)].map(match=>match[1]);assert.deepEqual(dependencies,[...publicFiles.slice(1),'http://192.168.4.1/']);assert.doesNotMatch(offline,/\/api\/|turnstile|type="password"|<form/);
 const index=source('/index.html').toString();assert.match(index,/<link rel="manifest" href="\/manifest.webmanifest">/);assert.match(index,/<script src="\/assets\/pwa.js" defer>/);
});
test('worker routes PWA files directly with their MIME types and keeps application routes on the app shell',async()=>{const fetched=[],mime={'.webmanifest':'application/manifest+json','.js':'text/javascript','.html':'text/html','.css':'text/css','.png':'image/png'};
 const env={MIGRATION_PREVIEW:'false',ASSETS:{async fetch(request){const path=new URL(request.url).pathname;fetched.push(path);const ext=path.slice(path.lastIndexOf('.'));return new Response(source(path),{headers:{'Content-Type':mime[ext]||'application/octet-stream'}});}}};
 for(const path of ['/manifest.webmanifest','/sw.js',...publicFiles,'/assets/pwa.js','/assets/radio-app-512.png','/assets/radio-app-maskable.png']){const response=await handle(new Request(origin+path),env);assert.equal(response.status,200,path);assert.equal(fetched.at(-1),path);assert.equal(response.headers.get('Content-Type'),mime[path.slice(path.lastIndexOf('.'))]);assert.equal(response.headers.get('Cache-Control'),path.startsWith('/assets/')?'public, max-age=0, must-revalidate':'no-store');assert.equal(response.headers.get('X-Content-Type-Options'),'nosniff');if(path==='/offline.html')assert.match(await response.text(),/<title>Offline · Radio Locals<\/title>/);else assert.deepEqual(new Uint8Array(await response.arrayBuffer()),new Uint8Array(source(path)));}
 for(const path of ['/','/admin','/station-edit','/wifi-setup']){const response=await handle(new Request(origin+path),env);assert.equal(response.status,200);assert.equal(fetched.at(-1),'/index.html');}
 const before=fetched.length;assert.equal((await handle(new Request(origin+'/api/not-a-public-asset'),env)).status,404);assert.equal((await handle(new Request(origin+'/manifest.webmanifest',{method:'POST'}),env)).status,404);assert.equal(fetched.length,before);
});
