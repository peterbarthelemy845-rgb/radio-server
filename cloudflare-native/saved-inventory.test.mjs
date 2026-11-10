import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {runInNewContext} from 'node:vm';
import {operationsFixture} from './operations-fixture.mjs';
import {handle} from './worker.mjs';
import {phoneRoutes} from './phone-link.mjs';
import {authRoutes} from './owner-auth.mjs';
import {digest} from './security.mjs';

const id='a'.repeat(32),other='c'.repeat(32),secret='b'.repeat(64);
async function fixture(){
  const f=await operationsFixture();
  for(const radio of [id,other])f.sqlite.prepare('INSERT INTO radios(id,secret_hash,created_at,last_seen) VALUES (?,?,?,?)').run(radio,await digest(secret),f.now,f.now);
  f.sqlite.prepare('INSERT INTO phone_radios SELECT token_hash,?,? FROM sessions').run(id,f.now+300);
  const next=f.sqlite.prepare("INSERT INTO stations(name,stream_url,contact_email,status,created_at,updated_at) VALUES ('Second','https://example.net/live','other@example.net','published',?,?) RETURNING code").get(f.now,f.now).code;
  return {...f,next,async poll(body={},radio=id,token=secret,at=f.now){return handle(new Request('https://radiolocals.com/api/radio/poll',{method:'POST',headers:{Authorization:'Bearer '+token,'Content-Type':'application/json'},body:JSON.stringify({radio_id:radio,...body})}),f.env,at);},
    async inventory(radio=id,at=f.now){return (await phoneRoutes(f.request('/api/phone/stations?radio_id='+radio),f.env,at)).json();}};
}

test('old firmware and command history leave saved inventory unknown',async()=>{
  const f=await fixture();
  f.sqlite.prepare("INSERT INTO radio_commands(id,radio_id,station_code,state,created_at,expires) VALUES (?,?,?,'added',?,?)").run('d'.repeat(32),id,f.station,f.now,f.now+300);
  await f.poll();
  const result=await f.inventory();
  assert.deepEqual(result.confirmed_station_codes,[String(f.station)]);
  assert.equal(result.saved_station_codes,null);
  assert.equal(result.inventory_reported_at,null);
  assert.equal(f.sqlite.prepare('SELECT count(*) n FROM radio_station_inventory').get().n,0);
});

test('complete device snapshots overwrite removals and distinguish an empty report',async()=>{
  const f=await fixture();
  await f.poll({saved_station_codes:[String(f.station),String(f.next)]});
  assert.deepEqual((await f.inventory()).saved_station_codes,[String(f.station),String(f.next)]);
  await f.poll({saved_station_codes:[String(f.next)]},id,secret,f.now+10);
  assert.deepEqual((await f.inventory()).saved_station_codes,[String(f.next)]);
  await f.poll({saved_station_codes:[]},id,secret,f.now+20);
  const result=await f.inventory();
  assert.deepEqual(result.saved_station_codes,[]);
  assert.equal(result.inventory_reported_at,f.now+20);
  await f.poll({},id,secret,f.now+30);
  assert.equal((await f.inventory()).inventory_reported_at,f.now+20,'absent fields cannot fabricate freshness');
  assert.deepEqual((await f.inventory()).saved_station_codes,[]);
});

test('snapshot reporting is authenticated and isolated to the device identity',async()=>{
  const f=await fixture();
  await assert.rejects(f.poll({saved_station_codes:['10']},id,'e'.repeat(64)),e=>e.status===401);
  assert.equal((await f.inventory()).saved_station_codes,null);
  await f.poll({saved_station_codes:[String(f.station)]},other);
  assert.equal((await f.inventory()).saved_station_codes,null);
  await assert.rejects(f.inventory(other),e=>e.status===403);
  await assert.rejects(f.inventory(id,f.now+300),e=>e.status===403,'expired phone grants cannot inspect inventory');
});

test('inventory lookup requires this browser grant and retains no-store caching',async()=>{
  const f=await fixture();await f.poll({saved_station_codes:['10']});
  const response=await phoneRoutes(f.request('/api/phone/stations?radio_id='+id),f.env,f.now);
  assert.equal(response.headers.get('Cache-Control'),'no-store');
  const browser=await authRoutes(new Request('https://radiolocals.com/api/session'),f.env,f.now);
  const cookie=browser.headers.get('set-cookie').split(';')[0];
  await assert.rejects(phoneRoutes(new Request('https://radiolocals.com/api/phone/stations?radio_id='+id,{headers:{Cookie:cookie}}),f.env,f.now),e=>e.status===403,'another browser has no grant for the same radio');
  const current=await f.env.DB.prepare('SELECT session_hash FROM phone_radios WHERE radio_id=?').bind(id).first();
  f.sqlite.prepare('DELETE FROM phone_radios WHERE session_hash=?').run(current.session_hash);
  await assert.rejects(f.inventory(),e=>e.status===403);
});

test('invalid inventory payloads cannot overwrite an accepted snapshot or acknowledge commands',async()=>{
  const f=await fixture();await f.poll({saved_station_codes:['10']});
  const command='d'.repeat(32);
  f.sqlite.prepare("INSERT INTO radio_commands(id,radio_id,station_code,state,created_at,expires) VALUES (?,?,?,'delivered',?,?)").run(command,id,f.station,f.now,f.now+300);
  for(const invalid of [null,'10',{},[10],['1'],['000000'],['10; DROP TABLE stations'],['1234567'],['10\n'],Array(101).fill('10')]){
    await assert.rejects(f.poll({saved_station_codes:invalid,ack_id:command,ack_status:'added'}),e=>e.status===400);
    assert.deepEqual((await f.inventory()).saved_station_codes,['10']);
    assert.equal(f.sqlite.prepare('SELECT state FROM radio_commands WHERE id=?').get(command).state,'delivered');
  }
});

test('maximum-sized reports normalize duplicate codes and map only published stations',async()=>{
  const f=await fixture();
  await f.poll({saved_station_codes:Array(100).fill('000010')});
  assert.deepEqual((await f.inventory()).saved_station_codes,['10']);
  f.sqlite.prepare("UPDATE stations SET status='suspended' WHERE code=?").run(f.next);
  await f.poll({saved_station_codes:['10',String(f.next),'999999']});
  assert.deepEqual((await f.inventory()).saved_station_codes,['10']);
  f.sqlite.prepare("UPDATE stations SET status='suspended' WHERE code=?").run(f.station);
  assert.deepEqual((await f.inventory()).saved_station_codes,[],'previously reported entries are hidden when suspended');
});

test('all 100 distinct six-digit saved codes fit the bounded report and storage',async()=>{
  const f=await fixture(),codes=[];
  const insert=f.sqlite.prepare("INSERT INTO stations(code,name,stream_url,contact_email,status,created_at,updated_at) VALUES (?,'Saved','https://example.net/live','owner@example.net','published',?,?)");
  for(let i=0;i<100;i++){const code=900000+i;insert.run(code,f.now,f.now);codes.push(String(code));}
  await f.poll({saved_station_codes:codes});
  assert.deepEqual((await f.inventory()).saved_station_codes,codes);
  assert.ok(f.sqlite.prepare('SELECT length(station_codes_json) n FROM radio_station_inventory WHERE radio_id=?').get(id).n<=1000);
});

test('repeated reports are idempotent and an older server snapshot cannot replace a newer one',async()=>{
  const f=await fixture();
  await f.poll({saved_station_codes:['10']},id,secret,f.now+20);
  await f.poll({saved_station_codes:['10']},id,secret,f.now+20);
  assert.equal(f.sqlite.prepare('SELECT count(*) n FROM radio_station_inventory WHERE radio_id=?').get(id).n,1);
  await f.poll({saved_station_codes:[]},id,secret,f.now+10);
  const result=await f.inventory();assert.deepEqual(result.saved_station_codes,['10']);assert.equal(result.inventory_reported_at,f.now+20);
});

test('saved inventory migration can be reapplied safely',async()=>{
  const f=await fixture();
  const {readFile}=await import('node:fs/promises');
  f.sqlite.exec(await readFile(new URL('./migrations/0010_saved_inventory.sql',import.meta.url),'utf8'));
  await f.poll({saved_station_codes:[]});assert.deepEqual((await f.inventory()).saved_station_codes,[]);
});

// Exercise the browser inventory decision with the real saved/offline renderers.
// The data source is controlled so late radio-selection responses can be tested.
const listenerUi=readFileSync(new URL('./public/assets/listener-usability.js',import.meta.url),'utf8');
const siteUi=readFileSync(new URL('./public/assets/site.js',import.meta.url),'utf8');
function confirmationFixture(){
  const nodes=new Map(),statuses=[],selections=[],requests=[],answers=[];
  const $=id=>{if(!nodes.has(id))nodes.set(id,{hidden:false,disabled:false,textContent:'',dataset:{}});return nodes.get(id);};
  $('shareForm').elements={radio_id:{value:'radio-one'}};
  $('deviceLabel').hidden=true;
  const context={$,window:{appI18n:{t:key=>key==='busy.checking'?'Checking…':key}},rememberSelectedRadio:radio=>selections.push(radio),loadRadioInventory:async radio=>{requests.push(radio);if(!answers.length)throw Error('Missing inventory response');return await answers.shift();},setSharedStatus:(text,kind)=>statuses.push({text,kind})};
  runInNewContext("let sharedCode='10',sharedOpenGeneration=1,shareRunning=false,sharedOfflineRadios=new Set();"+siteUi.slice(siteUi.indexOf('function setSharedSavedState('),siteUi.indexOf('function renderSharedWaitButton('))+listenerUi.slice(listenerUi.indexOf('let sharedConfirmationGeneration='),listenerUi.indexOf("$('shareForm').elements.radio_id.addEventListener")),context);
  return {$,statuses,selections,requests,answers,check:runInNewContext('updateStationConfirmation',context),set:code=>runInNewContext(code,context)};
}
function pendingInventory(){let resolve;const promise=new Promise(yes=>{resolve=yes;});return {promise,resolve};}

test('station confirmation identifies a saved station and restores an explicit Add again action',async()=>{
  const f=confirmationFixture(),pending=pendingInventory();f.answers.push(pending.promise);
  const checked=f.check();assert.equal(f.$('shareSubmit').disabled,true);assert.equal(f.$('shareSubmit').textContent,'Checking…');
  pending.resolve({known:true,codes:new Set(['10'])});assert.equal(await checked,true);
  assert.equal(f.$('shareSavedNotice').hidden,false);assert.equal(f.$('shareSubmit').textContent,'Add again');assert.equal(f.$('shareSubmit').disabled,false);assert.equal(f.$('shareSubmit').hidden,false);assert.equal(f.$('shareWifiHelp').hidden,true);assert.equal(f.statuses.at(-1).text,'');
});

test('unknown or unavailable inventory never treats command history or an empty report as saved',async()=>{
  for(const inventory of [{known:true,codes:new Set()},{known:false,codes:new Set(['10'])},{known:false,codes:new Set(),unavailable:true}]){
    const f=confirmationFixture();f.answers.push(inventory);assert.equal(await f.check(),false);
    assert.equal(f.$('shareSavedNotice').hidden,true);assert.equal(f.$('shareSubmit').textContent,'Add station');assert.equal(f.$('shareSubmit').disabled,false);
    if(inventory.unavailable)assert.match(f.statuses.at(-1).text,/could not be checked.*still add/);
  }
});

test('saved inventory and offline status are independent and offer Wi-Fi help without resending',async()=>{
  const f=confirmationFixture();f.set("sharedOfflineRadios.add('radio-one')");f.answers.push({known:true,codes:new Set(['10'])});assert.equal(await f.check(),true);
  assert.equal(f.$('shareSavedNotice').hidden,false);assert.equal(f.$('shareSubmit').hidden,true);assert.equal(f.$('shareWifiHelp').hidden,false);assert.equal(f.$('shareForm').dataset.radioOffline,'1');assert.equal(f.statuses.at(-1).text,'Radio offline. Check power and Wi-Fi.');assert.equal(f.statuses.at(-1).kind,'error');assert.deepEqual(f.requests,['radio-one']);
});

test('a single linked radio can hide its selector without invalidating its inventory result',async()=>{
  const f=confirmationFixture();f.$('radioLabel').hidden=true;f.answers.push({known:true,codes:new Set(['10'])});
  assert.equal(await f.check(),true);assert.deepEqual(f.requests,['radio-one']);
  assert.equal(f.$('shareSavedNotice').hidden,false);assert.equal(f.$('shareSubmit').textContent,'Add again');assert.equal(f.$('shareSubmit').disabled,false);
});

test('a late inventory response for the previous selection cannot unlock or overwrite a newer check',async()=>{
  const f=confirmationFixture(),old=pendingInventory(),current=pendingInventory();f.answers.push(old.promise,current.promise);
  const first=f.check();f.$('shareForm').elements.radio_id.value='radio-two';const second=f.check();
  old.resolve({known:true,codes:new Set(['10'])});assert.equal(await first,undefined);assert.equal(f.$('shareSubmit').disabled,true);assert.equal(f.$('shareSavedNotice').hidden,true);assert.equal(f.statuses.length,0);
  current.resolve({known:true,codes:new Set()});assert.equal(await second,false);assert.equal(f.$('shareSubmit').disabled,false);assert.equal(f.$('shareSubmit').textContent,'Add station');assert.equal(f.$('shareSavedNotice').hidden,true);
});

test('a repeated check for the same radio only lets the latest response restore its button',async()=>{
  const f=confirmationFixture(),old=pendingInventory(),current=pendingInventory();f.answers.push(old.promise,current.promise);const first=f.check(),second=f.check();
  old.resolve({known:true,codes:new Set(['10'])});await first;assert.equal(f.$('shareSubmit').disabled,true);assert.equal(f.$('shareSavedNotice').hidden,true);
  current.resolve({known:true,codes:new Set(['10'])});assert.equal(await second,true);assert.equal(f.$('shareSubmit').disabled,false);assert.equal(f.$('shareSavedNotice').hidden,false);
});

test('manual pairing controls, another station, a reopened popup or active delivery invalidate inventory results',async()=>{
  for(const change of [f=>{f.$('deviceLabel').hidden=false;},f=>f.set("sharedCode='11'"),f=>f.set('sharedOpenGeneration++'),f=>f.set('shareRunning=true')]){
    const f=confirmationFixture(),pending=pendingInventory();f.answers.push(pending.promise);const checked=f.check();change(f);pending.resolve({known:true,codes:new Set(['10'])});assert.equal(await checked,undefined);
    assert.equal(f.$('shareSavedNotice').hidden,true);assert.equal(f.statuses.length,0);
  }
});

test('no selected radio resets saved/offline presentation without reading inventory',async()=>{
  const f=confirmationFixture();f.$('shareForm').elements.radio_id.value='';assert.equal(await f.check(),false);assert.deepEqual(f.requests,[]);assert.equal(f.$('shareSavedNotice').hidden,true);assert.equal(f.$('shareWifiHelp').hidden,true);assert.equal(f.statuses.at(-1).text,'Choose a radio to add this station.');
});
