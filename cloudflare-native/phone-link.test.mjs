import {test} from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {readFileSync} from 'node:fs';
import {phoneRoutes} from './phone-link.mjs';
import {authRoutes} from './owner-auth.mjs';
import {digest,mac,encrypt,decrypt} from './security.mjs';
import {handle} from './worker.mjs';
const now=1800000000,host='https://native.example',radio='a'.repeat(32),secret='b'.repeat(64);
async function fixture(){
  const sqlite=new DatabaseSync(':memory:');sqlite.exec(readFileSync(new URL('./migrations/0001_core.sql',import.meta.url),'utf8'));
  sqlite.exec(readFileSync(new URL('./migrations/0008_reports_backups.sql',import.meta.url),'utf8'));
  sqlite.exec(readFileSync(new URL('./migrations/0009_device_code.sql',import.meta.url),'utf8'));
  sqlite.exec(readFileSync(new URL('./migrations/0010_saved_inventory.sql',import.meta.url),'utf8'));sqlite.exec(readFileSync(new URL('./migrations/0012_radio_controls.sql',import.meta.url),'utf8'));
  sqlite.exec(readFileSync(new URL('./migrations/0015_station_command_origin.sql',import.meta.url),'utf8'));
  sqlite.exec(readFileSync(new URL('./migrations/0016_current_station_presence.sql',import.meta.url),'utf8'));
  const DB={prepare(sql){let args=[];const q={bind(...v){args=v;return q;},async first(){return sqlite.prepare(sql).get(...args)||null;},async all(){return {results:sqlite.prepare(sql).all(...args)};},async run(){return sqlite.prepare(sql).run(...args);}};return q;},async batch(qs){sqlite.exec('BEGIN');try{for(const q of qs)await q.run();sqlite.exec('COMMIT');}catch(e){sqlite.exec('ROLLBACK');throw e;}}};
  const env={DB,DATA_ENCRYPTION_KEY:'e'.repeat(64)};
  sqlite.prepare('INSERT INTO radios VALUES (?,?,?,?,?)').run(radio,await digest(secret),'My radio',now,now);
  sqlite.prepare('INSERT INTO radio_pairs(radio_id,code_hash,expires) VALUES (?,?,0)').run(radio,await mac(env,'device-code:1234'));
  sqlite.prepare("INSERT INTO stations(name,stream_url,contact_email,status,created_at,updated_at) VALUES ('Test','https://example.com/live','owner@example.com','published',?,?)").run(now,now);
  async function browser(){const res=await authRoutes(new Request(host+'/api/session'),env,now);const state=await res.json(),cookie=res.headers.get('set-cookie').split(';')[0];
    return {hash:await digest(cookie.split('=')[1]),async get(path='radios',at=now){return phoneRoutes(new Request(host+'/api/phone/'+path,{headers:{Cookie:cookie}}),env,at);},async post(path,body){return phoneRoutes(new Request(host+'/api/phone/'+path,{method:'POST',headers:{Cookie:cookie,Origin:host,'X-CSRF-Token':state.csrf,'Content-Type':'application/json'},body:JSON.stringify(body)}),env,now,{human:async()=>{}});}};}
  async function poll(body,at=now){return handle(new Request(host+'/api/radio/poll',{method:'POST',headers:{Authorization:'Bearer '+secret,'Content-Type':'application/json'},body:JSON.stringify({radio_id:radio,...body})}),env,at);}
  return {sqlite,env,browser,poll};
}

test('actual device code is encrypted and visible only after this phone receives physical approval',async()=>{
  const f=await fixture(),one=await f.browser(),two=await f.browser();
  assert.deepEqual((await(await one.get()).json()).radios,[]);
  const claim=await(await one.post('claim',{device_code:' 12-34 '})).json();
  const stored=f.sqlite.prepare('SELECT code_hash,code_encrypted FROM radio_pairs').get();
  assert.notEqual(stored.code_encrypted,'1234');
  assert.match(stored.code_encrypted,/^[a-f0-9]{24}:[a-f0-9]+$/);
  assert.equal(await decrypt(f.env,stored.code_encrypted),'1234');
  assert.deepEqual((await(await one.get()).json()).radios,[]);
  assert.deepEqual((await(await two.get()).json()).radios,[]);
  const approved=await(await f.poll({pair_claim_id:claim.claim_id,pair_decision:'approve'})).json();
  assert.equal(approved.device_code,undefined);
  const response=await one.get(),result=await response.json();
  assert.equal(response.headers.get('Cache-Control'),'no-store');
  assert.equal(result.radios[0].device_code,'1234');
  assert.deepEqual(Object.keys(result.radios[0]).sort(),['current_station','device_code','id','last_seen','name','online']);
  assert.ok(!JSON.stringify(result).includes(stored.code_encrypted));
  assert.ok(!JSON.stringify(result).includes(stored.code_hash));
  assert.ok(!JSON.stringify(result).includes(secret));
  assert.deepEqual((await(await two.get()).json()).radios,[]);
  f.sqlite.prepare('UPDATE phone_radios SET expires=?').run(now);
  assert.deepEqual((await(await one.get()).json()).radios,[]);
});

test('missing, expired, corrupted, or stale stored device codes are never displayed',async()=>{
  const f=await fixture(),phone=await f.browser();
  const claim=await(await phone.post('claim',{device_code:'1234'})).json();
  await f.poll({pair_claim_id:claim.claim_id,pair_decision:'approve'});
  for(const value of [null,'corrupted',await encrypt(f.env,'5678'),await encrypt(f.env,'1234!')]){
    f.sqlite.prepare('UPDATE radio_pairs SET code_encrypted=?').run(value);
    assert.equal((await(await phone.get()).json()).radios[0].device_code,null);
  }
  f.sqlite.prepare('UPDATE radio_pairs SET code_encrypted=?,expires=?').run(await encrypt(f.env,'1234'),now);
  assert.equal((await(await phone.get()).json()).radios[0].device_code,null);
  f.sqlite.exec('DELETE FROM radio_pairs');
  assert.equal((await(await phone.get()).json()).radios[0].device_code,null);
});

test('unlink and physical reset revoke display of the saved device code',async()=>{
  const f=await fixture(),phone=await f.browser();
  let claim=await(await phone.post('claim',{device_code:'1234'})).json();
  await f.poll({pair_claim_id:claim.claim_id,pair_decision:'approve'});
  await phone.post('unlink',{radio_id:radio});
  assert.deepEqual((await(await phone.get()).json()).radios,[]);
  assert.ok(f.sqlite.prepare('SELECT code_encrypted FROM radio_pairs').get().code_encrypted);
  claim=await(await phone.post('claim',{device_code:'1234'})).json();
  await f.poll({pair_claim_id:claim.claim_id,pair_decision:'approve'});
  await handle(new Request(host+'/api/radio/link/reset',{method:'POST',headers:{Authorization:'Bearer '+secret,'Content-Type':'application/json'},body:JSON.stringify({radio_id:radio})}),f.env,now);
  assert.deepEqual((await(await phone.get()).json()).radios,[]);
  assert.equal(f.sqlite.prepare('SELECT code_encrypted FROM radio_pairs').get(),undefined);
});
test('phone cannot add until physical approval, then command is deduplicated and acknowledged',async()=>{
  const f=await fixture(),phone=await f.browser();
  await assert.rejects(phone.post('add',{radio_id:radio,station_code:'10'}),e=>e.status===403);
  const claim=await (await phone.post('claim',{device_code:'1234'})).json();
  assert.match(claim.confirmation_code,/^\d{4}$/);
  assert.equal((await (await phone.post('claim/status',{claim_id:claim.claim_id})).json()).state,'waiting');
  await f.poll({pair_claim_id:claim.claim_id,pair_decision:'approve'});
  const command=await (await phone.post('add',{radio_id:radio,station_code:'10'})).json();
  assert.equal((await (await phone.post('add',{radio_id:radio,station_code:'10'})).json()).command_id,command.command_id);
  await f.poll({ack_id:command.command_id,ack_status:'added'});
  assert.equal((await (await phone.post('command/status',{command_id:command.command_id})).json()).state,'added');
});
test('another browser cannot replace a pending pairing request or inspect it',async()=>{
  const f=await fixture(),one=await f.browser(),two=await f.browser();
  const claim=await (await one.post('claim',{device_code:'1234'})).json();
  await assert.rejects(two.post('claim',{device_code:'1234'}),e=>e.status===409);
  await assert.rejects(two.post('claim/status',{claim_id:claim.claim_id}),e=>e.status===404);
  const again=await (await one.post('claim',{device_code:'1234'})).json();
  assert.equal(again.claim_id,claim.claim_id);
});

test('a Device Code reset, replacement or expiry between lookup and insertion cannot create a stale pairing request',async()=>{
  for(const change of ['reset','replace','expire']){
    const f=await fixture(),phone=await f.browser(),prepare=f.env.DB.prepare.bind(f.env.DB);let raced=false;
    f.env.DB.prepare=sql=>{
      const query=prepare(sql);
      if(sql.startsWith('INSERT INTO pair_claims(')){
        const run=query.run.bind(query);query.run=async()=>{
          raced=true;
          if(change==='reset')await handle(new Request(host+'/api/radio/link/reset',{method:'POST',headers:{Authorization:'Bearer '+secret,'Content-Type':'application/json'},body:JSON.stringify({radio_id:radio})}),f.env,now);
          else if(change==='replace')f.sqlite.prepare('UPDATE radio_pairs SET code_hash=? WHERE radio_id=?').run(await mac(f.env,'device-code:5678'),radio);
          else f.sqlite.prepare('UPDATE radio_pairs SET expires=? WHERE radio_id=?').run(now,radio);
          return run();
        };
      }
      return query;
    };
    await assert.rejects(phone.post('claim',{device_code:'1234'}),e=>e.status===400);
    assert.equal(raced,true,change);assert.equal(f.sqlite.prepare("SELECT count(*) n FROM pair_claims WHERE state='waiting'").get().n,0,change);
    const polled=await(await f.poll({})).json();assert.equal(polled.pair_claim_id,'');assert.equal(polled.linked,false);
  }
});

test('an expired or logged-out initiating session cannot insert a pairing request after its earlier authorization check',async()=>{
  for(const change of ['expire','logout']){
    const f=await fixture(),phone=await f.browser(),prepare=f.env.DB.prepare.bind(f.env.DB);let raced=false;
    f.env.DB.prepare=sql=>{
      const query=prepare(sql);
      if(sql.startsWith('INSERT INTO pair_claims(')){
        const run=query.run.bind(query);query.run=async()=>{
          raced=true;
          if(change==='logout')await phone.post('logout',{});
          else f.sqlite.prepare('UPDATE sessions SET expires=? WHERE token_hash=?').run(now,phone.hash);
          return run();
        };
      }
      return query;
    };
    await assert.rejects(phone.post('claim',{device_code:'1234'}),e=>e.status===401);
    assert.equal(raced,true,change);assert.equal(f.sqlite.prepare('SELECT count(*) n FROM pair_claims').get().n,0,change);
    assert.equal((await(await f.poll({})).json()).pair_claim_id,'');
  }
});
test('denied and expired claims never grant station control; repeated guesses are limited',async()=>{
  const f=await fixture(),phone=await f.browser();
  const claim=await (await phone.post('claim',{device_code:'1234'})).json();
  await f.poll({pair_claim_id:claim.claim_id,pair_decision:'deny'});
  await assert.rejects(phone.post('add',{radio_id:radio,station_code:'10'}),e=>e.status===403);
  f.sqlite.prepare('UPDATE pair_claims SET expires=? WHERE id=?').run(now-1,claim.claim_id);
  assert.equal((await (await phone.post('claim/status',{claim_id:claim.claim_id})).json()).state,'expired');
  for(let i=0;i<4;i++)await assert.rejects(phone.post('claim',{device_code:'0000'}),e=>e.status===400);
  await assert.rejects(phone.post('claim',{device_code:'1234'}),e=>e.status===429);
});
test('revocation and station suspension block additional commands and status access',async()=>{
  const f=await fixture(),phone=await f.browser();const claim=await (await phone.post('claim',{device_code:'1234'})).json();
  await f.poll({pair_claim_id:claim.claim_id,pair_decision:'approve'});
  f.sqlite.exec("UPDATE stations SET status='suspended'");
  await assert.rejects(phone.post('add',{radio_id:radio,station_code:'10'}),e=>e.status===404);
  f.sqlite.exec("UPDATE stations SET status='published'");
  const command=await (await phone.post('add',{radio_id:radio,station_code:'10'})).json();
  f.sqlite.exec('DELETE FROM phone_radios');
  await assert.rejects(phone.post('command/status',{command_id:command.command_id}),e=>e.status===404);
  await assert.rejects(phone.post('add',{radio_id:radio,station_code:'10'}),e=>e.status===403);
});

test('unlink cancels this phone’s queued additions and pairing claims while another phone’s command survives',async()=>{
  const f=await fixture(),one=await f.browser(),two=await f.browser();
  const approved=await(await one.post('claim',{device_code:'1234'})).json();
  await f.poll({pair_claim_id:approved.claim_id,pair_decision:'approve'});
  const second=await(await two.post('claim',{device_code:'1234'})).json();
  await f.poll({pair_claim_id:second.claim_id,pair_decision:'approve'});
  f.sqlite.prepare("INSERT INTO stations(name,stream_url,contact_email,status,created_at,updated_at) VALUES ('Second','https://example.com/second','owner@example.com','published',?,?)").run(now,now);
  const own=await(await one.post('add',{radio_id:radio,station_code:'10'})).json();
  const other=await(await two.post('add',{radio_id:radio,station_code:'11'})).json();
  const waiting=await(await one.post('claim',{device_code:'1234'})).json();
  await one.post('unlink',{radio_id:radio});
  assert.equal(f.sqlite.prepare('SELECT state FROM pair_claims WHERE id=?').get(waiting.claim_id).state,'cancelled');
  assert.equal(f.sqlite.prepare('SELECT state FROM pair_claims WHERE id=?').get(approved.claim_id).state,'cancelled');
  assert.equal(f.sqlite.prepare('SELECT state FROM radio_commands WHERE id=?').get(own.command_id).state,'failed');
  assert.equal(f.sqlite.prepare('SELECT state FROM radio_commands WHERE id=?').get(other.command_id).state,'pending');
  const polled=await(await f.poll({pair_claim_id:waiting.claim_id,pair_decision:'approve',ack_id:own.command_id,ack_status:'added'})).json();
  assert.equal(polled.claim_result,'cancelled');assert.equal(polled.command_id,other.command_id);
  assert.equal(f.sqlite.prepare('SELECT 1 FROM phone_radios WHERE session_hash=? AND radio_id=?').get(one.hash,radio),undefined);
  assert.equal(f.sqlite.prepare('SELECT state FROM radio_commands WHERE id=?').get(own.command_id).state,'failed');
});

test('mobile logout cancels pending and delivered additions and stale physical approval cannot relink',async()=>{
  const f=await fixture(),token='f'.repeat(64),hash=await digest(token);
  f.sqlite.prepare('INSERT INTO sessions(token_hash,csrf_hash,created_at,expires) VALUES (?,?,?,?)').run(hash,'mobile-only',now,now+1000);
  f.sqlite.prepare('INSERT INTO phone_radios VALUES (?,?,?)').run(hash,radio,now+1000);
  const post=(path,body)=>phoneRoutes(new Request(host+'/api/phone/'+path,{method:'POST',headers:{Authorization:'Bearer '+token,'Content-Type':'application/json'},body:JSON.stringify(body)}),f.env,now,{human:async()=>{}});
  const command=await(await post('add',{radio_id:radio,station_code:'10'})).json();
  assert.equal((await(await f.poll({})).json()).command_id,command.command_id);
  const claim=await(await post('claim',{device_code:'1234'})).json();
  await post('logout',{});
  const result=await(await f.poll({pair_claim_id:claim.claim_id,pair_decision:'approve'},now+61)).json();
  assert.equal(result.command_id,'');assert.equal(result.linked,false);assert.equal(result.claim_result,'cancelled');
  assert.equal(f.sqlite.prepare('SELECT state FROM radio_commands WHERE id=?').get(command.command_id).state,'failed');
  await assert.rejects(post('add',{radio_id:radio,station_code:'10'}),e=>e.status===401);
});

test('station addition checks the originating grant inside enqueue and delivery statements',async()=>{
  for(const phase of ['enqueue','delivery']){
    const f=await fixture(),phone=await f.browser();
    const claim=await(await phone.post('claim',{device_code:'1234'})).json();await f.poll({pair_claim_id:claim.claim_id,pair_decision:'approve'});
    let queued;
    if(phase==='delivery')queued=await(await phone.post('add',{radio_id:radio,station_code:'10'})).json();
    const prepare=f.env.DB.prepare.bind(f.env.DB);let raced=false;
    f.env.DB.prepare=sql=>{
      const q=prepare(sql),method=phase==='enqueue'?'run':'first';
      if(sql.includes(phase==='enqueue'?'INSERT INTO radio_commands':'UPDATE radio_commands SET state=\'delivered\'')){
        const execute=q[method].bind(q);q[method]=async()=>{raced=true;f.sqlite.prepare('DELETE FROM phone_radios WHERE session_hash=? AND radio_id=?').run(phone.hash,radio);return execute();};
      }
      return q;
    };
    if(phase==='enqueue'){
      await assert.rejects(phone.post('add',{radio_id:radio,station_code:'10'}),e=>e.status===403||e.status===409);
      assert.equal(f.sqlite.prepare('SELECT count(*) n FROM radio_commands').get().n,0);
    }else{
      assert.equal((await(await f.poll({})).json()).command_id,'');
      assert.notEqual(f.sqlite.prepare('SELECT state FROM radio_commands WHERE id=?').get(queued.command_id).state,'delivered');
    }
    assert.equal(raced,true,phase);
  }
});

test('expired originating grant prevents delivery even while another phone remains linked',async()=>{
  const f=await fixture(),one=await f.browser(),two=await f.browser();
  for(const phone of [one,two])f.sqlite.prepare('INSERT INTO phone_radios VALUES (?,?,?)').run(phone.hash,radio,now+1000);
  const command=await(await one.post('add',{radio_id:radio,station_code:'10'})).json();
  f.sqlite.prepare('UPDATE phone_radios SET expires=? WHERE session_hash=?').run(now,one.hash);
  const polled=await(await f.poll({})).json();assert.equal(polled.linked,true);assert.equal(polled.command_id,'');
  assert.equal(f.sqlite.prepare('SELECT state FROM radio_commands WHERE id=?').get(command.command_id).state,'failed');
});

test('unlink revocation is atomic when a database write fails',async()=>{
  const f=await fixture(),phone=await f.browser();
  const approved=await(await phone.post('claim',{device_code:'1234'})).json();await f.poll({pair_claim_id:approved.claim_id,pair_decision:'approve'});
  const command=await(await phone.post('add',{radio_id:radio,station_code:'10'})).json();
  const waiting=await(await phone.post('claim',{device_code:'1234'})).json();
  const prepare=f.env.DB.prepare.bind(f.env.DB);
  f.env.DB.prepare=sql=>{const query=prepare(sql);if(sql==='DELETE FROM phone_radios WHERE session_hash=? AND radio_id=?')query.run=async()=>{throw Error('simulated database failure');};return query;};
  await assert.rejects(phone.post('unlink',{radio_id:radio}),/simulated database failure/);
  assert.ok(f.sqlite.prepare('SELECT 1 FROM phone_radios WHERE session_hash=? AND radio_id=?').get(phone.hash,radio));
  assert.equal(f.sqlite.prepare('SELECT state FROM pair_claims WHERE id=?').get(waiting.claim_id).state,'waiting');
  assert.equal(f.sqlite.prepare('SELECT state FROM radio_commands WHERE id=?').get(command.command_id).state,'pending');
});

test('command-origin migration fails closed for legacy queued commands and preserves completed history',async()=>{
  const db=new DatabaseSync(':memory:');db.exec(readFileSync(new URL('./migrations/0001_core.sql',import.meta.url),'utf8'));
  db.prepare('INSERT INTO radios VALUES (?,?,?,?,?)').run(radio,'hash','Radio',now,now);
  db.prepare("INSERT INTO stations(name,stream_url,contact_email,status,created_at,updated_at) VALUES ('Test','https://example.com/live','owner@example.com','published',?,?)").run(now,now);
  for(const [index,state] of ['pending','delivered','added'].entries()){
    // Separate station codes allow the existing per-radio active command uniqueness rule.
    if(index)db.prepare("INSERT INTO stations(name,stream_url,contact_email,status,created_at,updated_at) VALUES ('Test','https://example.com/live','owner@example.com','published',?,?)").run(now,now);
    db.prepare('INSERT INTO radio_commands VALUES (?,?,?,?,?,?,?)').run('legacy-'+state,radio,10+index,state,now,now+300,0);
  }
  db.exec(readFileSync(new URL('./migrations/0015_station_command_origin.sql',import.meta.url),'utf8'));
  assert.deepEqual(db.prepare('SELECT state FROM radio_commands ORDER BY station_code').all().map(row=>row.state),['failed','failed','added']);
});

test('legacy current-station omission preserves listening reports while explicit none clears the display',async()=>{
  const f=await fixture(),phone=await f.browser();
  f.sqlite.prepare('INSERT INTO phone_radios VALUES (?,?,?)').run(phone.hash,radio,now+1000);
  await f.poll({firmware_version:'2026.11.01',playing_station_code:'10'},now);
  await f.poll({firmware_version:'2026.11.01',playing_station_code:'10'},now+60);
  assert.equal((await(await phone.get('radios',now+60)).json()).radios[0].current_station,'Test');
  await f.poll({firmware_version:'2026.11.07',playing_station_code:'10',current_station_code:null},now+61);
  assert.equal((await(await phone.get('radios',now+61)).json()).radios[0].current_station,null);
  await f.poll({firmware_version:'2026.11.07',playing_station_code:'10',current_station_code:'10'},now+62);
  assert.equal((await(await phone.get('radios',now+62)).json()).radios[0].current_station,'Test');
});
