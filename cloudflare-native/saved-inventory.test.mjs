import {test} from 'node:test';
import assert from 'node:assert/strict';
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
