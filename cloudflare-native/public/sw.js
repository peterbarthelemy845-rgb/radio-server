'use strict';
const CACHE='radio-locals-public-v2';
// Only this public offline page and its assets are stored. Radio/API/admin data,
// sign-in forms and private artwork are never added to the service-worker cache.
const PUBLIC_FILES=['/offline.html','/assets/offline.css','/assets/pwa-offline.js','/assets/radio-app-192.png'];
self.addEventListener('install',event=>{event.waitUntil(caches.open(CACHE).then(cache=>cache.addAll(PUBLIC_FILES)).then(()=>self.skipWaiting()));});
self.addEventListener('activate',event=>{event.waitUntil(caches.keys().then(keys=>Promise.all(keys.filter(key=>key.startsWith('radio-locals-public-')&&key!==CACHE).map(key=>caches.delete(key)))).then(()=>self.clients.claim()));});
self.addEventListener('fetch',event=>{
 const {request}=event,url=new URL(request.url);
 if(request.method!=='GET'||url.origin!==self.location.origin||url.pathname.startsWith('/api/'))return;
 if(request.mode==='navigate'){
  event.respondWith(fetch(request).catch(async()=>await caches.match('/offline.html')||Response.error()));return;
 }
 if(PUBLIC_FILES.includes(url.pathname))event.respondWith(fetch(request).catch(async()=>await caches.match(url.pathname)||Response.error()));
});
