import {test} from 'node:test';import assert from 'node:assert/strict';
import {operationsFixture} from './operations-fixture.mjs';import {adminRoutes} from './admin.mjs';import {encrypt} from './security.mjs';
async function fixture(){const f=await operationsFixture();f.env.ADMIN_EMAIL='admin@example.com';const payload=await encrypt(f.env,JSON.stringify({name:'Listener',email:'listener@example.com',subject:'Help',message:'Please review this request.'}));
 f.add=(i,kind='support',at=f.now)=>f.sqlite.prepare('INSERT INTO legal_requests(id,kind,encrypted_payload,created_at) VALUES (?,?,?,?)').run(i.toString(16).padStart(32,'0'),kind,payload,at);
 f.list=async query=>(await adminRoutes(f.request('/api/admin/legal'+query),f.env,f.now)).json();return f;}
test('request list filters before pagination so support traffic cannot hide pending legal requests',async()=>{const f=await fixture();f.admin();f.add(999,'privacy',f.now-1);for(let i=0;i<201;i++)f.add(i,'support');
 const legal=await f.list('?kind=legal');assert.equal(legal.requests.length,1);assert.equal(legal.requests[0].kind,'privacy');assert.equal(legal.has_more,false);assert.equal(legal.next_cursor,null);
 const support=await f.list('?kind=support');assert.equal(support.requests.length,200);assert.equal(support.requests.every(row=>row.kind==='support'),true);assert.equal(support.has_more,true);
});
test('stable timestamp-and-ID cursors expose every older ticket without duplicates',async()=>{const f=await fixture();f.admin();for(let i=0;i<205;i++)f.add(i);
 const first=await f.list('?kind=support');assert.equal(first.requests.length,200);assert.equal(first.has_more,true);f.add(999,'support',f.now+1);
 const second=await f.list('?kind=support&cursor='+encodeURIComponent(first.next_cursor));assert.equal(second.requests.length,5);assert.equal(second.has_more,false);assert.equal(second.next_cursor,null);
 const ids=[...first.requests,...second.requests].map(row=>row.id);assert.equal(new Set(ids).size,205);assert.deepEqual([...ids].sort(),Array.from({length:205},(_,i)=>i.toString(16).padStart(32,'0')));
 assert.equal((await f.list('')).requests.length,200);
});
test('request pagination retains admin MFA and rejects invalid filters or cursors',async()=>{const f=await fixture();await assert.rejects(f.list('?kind=legal'),e=>e.status===401);f.admin();
 for(const query of ['?kind=other','?cursor=bad','?cursor=9007199254740992:'+'a'.repeat(32),'?cursor=-1:'+'a'.repeat(32)])await assert.rejects(f.list(query),e=>e.status===400);
 f.sqlite.exec('DELETE FROM admin_mfa_sessions');await assert.rejects(f.list('?kind=support'),e=>e.status===401);
});
