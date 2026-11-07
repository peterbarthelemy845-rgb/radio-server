import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {Script} from 'node:vm';
test('all ordered classic browser scripts share a compatible global scope',()=>{
 const html=readFileSync(new URL('./public/index.html',import.meta.url),'utf8');
 const paths=[...html.matchAll(/<script src="(\/assets\/[^" ]+\.js)" defer><\/script>/g)].map(match=>match[1]);
 assert.equal(paths.length,[...html.matchAll(/<script\b/g)].length);
 const source=paths.map(path=>readFileSync(new URL('./public'+path,import.meta.url),'utf8')).join('\n;\n');
 assert.doesNotThrow(()=>new Script(source,{filename:'integrated-browser-scripts.js'}));
});
