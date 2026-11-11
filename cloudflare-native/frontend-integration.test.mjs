import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {Script} from 'node:vm';
test('all ordered classic browser scripts share a compatible global scope',()=>{
 const html=readFileSync(new URL('./public/index.html',import.meta.url),'utf8');
 const paths=[...html.matchAll(/<script src="(\/assets\/[^" ]+\.js)" defer><\/script>/g)].map(match=>match[1]);
 assert.equal(paths.length,[...html.matchAll(/<script\b/g)].length);
 const loader=readFileSync(new URL('./public/assets/feature-loader.js',import.meta.url),'utf8');
 const featureFiles=new Script(loader.slice(0,loader.indexOf('const appFeatureRequests'))+'\nappFeatureFiles;').runInNewContext();
 const lazy=Object.values(featureFiles).flatMap(feature=>feature.js);for(const file of lazy)assert.match(file,/^[a-z0-9.-]+\.js$/,'lazy scripts must stay on the application-owned allowlist');
 const allPaths=[...new Set([...paths,...lazy.map(file=>'/assets/'+file)])];
 assert.ok(allPaths.length>paths.length,'integration must also include the specialized lazy scripts');
 const source=allPaths.map(path=>readFileSync(new URL('./public'+path,import.meta.url),'utf8')).join('\n;\n');
 assert.doesNotThrow(()=>new Script(source,{filename:'integrated-browser-scripts.js'}));
});
