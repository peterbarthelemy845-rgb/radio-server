import {test} from 'node:test';
import assert from 'node:assert/strict';
import {operationsFixture} from './operations-fixture.mjs';
import {overviewRoutes} from './admin-overview.mjs';
test('admin overview requires both admin proofs and exposes aggregate counts only',async()=>{
 const f=await operationsFixture();
 await assert.rejects(overviewRoutes(f.request('/api/admin/overview'),f.env,f.now),e=>e.status===401);
 f.admin();
 f.sqlite.prepare("INSERT INTO stations(name,stream_url,contact_email,status,email_verified_at,created_at,updated_at) VALUES ('Pending','https://example.com/live','private@example.com','pending_review',?,?,?)").run(f.now,f.now,f.now);
 f.sqlite.prepare("INSERT INTO legal_requests VALUES ('ticket','support','private encrypted text','new',?)").run(f.now);
 f.sqlite.prepare("INSERT INTO mail_outbox(id,recipient,subject,encrypted_payload,state,due,expires) VALUES ('failed','private@example.com','Private subject','private','failed',?,?)").run(f.now,f.now+30);
 const response=await overviewRoutes(f.request('/api/admin/overview'),f.env,f.now),body=await response.json();
 assert.equal(body.pending_stations,1);assert.equal(body.open_tickets,1);assert.equal(body.online_radios,1);assert.equal(body.failed_emails_7_days,1);assert.equal(body.published_stations,1);
 assert.equal(JSON.stringify(body).includes('private@example.com'),false);assert.equal(JSON.stringify(body).includes('Private subject'),false);assert.match(response.headers.get('cache-control'),/no-store/);
 f.sqlite.exec('DELETE FROM admin_mfa_sessions');await assert.rejects(overviewRoutes(f.request('/api/admin/overview'),f.env,f.now),e=>e.status===401);
});
test('overview excludes old radio heartbeats, closed tickets and old mail failures',async()=>{
 const f=await operationsFixture();f.admin();f.sqlite.prepare('UPDATE radios SET last_seen=?').run(f.now-121);
 f.sqlite.prepare("INSERT INTO legal_requests VALUES ('closed','support','x','closed',?)").run(f.now);
 f.sqlite.prepare("INSERT INTO mail_outbox(id,recipient,subject,encrypted_payload,state,due,expires) VALUES ('old','x@example.com','x','x','failed',?,?)").run(f.now-8*86400,f.now-8*86400+30);
 const body=await(await overviewRoutes(f.request('/api/admin/overview'),f.env,f.now)).json();assert.equal(body.online_radios,0);assert.equal(body.open_tickets,0);assert.equal(body.failed_emails_7_days,0);
});

test('proposed edits count for review while published stations remain live and are never double counted',async()=>{
 const f=await operationsFixture();f.admin();f.sqlite.prepare('UPDATE stations SET email_verified_at=?').run(f.now);const pending=f.sqlite.prepare("INSERT INTO stations(name,stream_url,contact_email,status,email_verified_at,created_at,updated_at) VALUES ('Initial review','https://example.com/live','owner2@example.com','pending_review',?,?,?) RETURNING code").get(f.now,f.now,f.now).code;
 for(const code of [f.station,pending])f.sqlite.prepare('INSERT INTO station_edits VALUES (?,?,?,?,?,?,?,?)').run(code,String(code).padStart(32,'0'),f.now,'https://example.com/proposed','Review me',null,f.now,'Proposed name');
 const body=await(await overviewRoutes(f.request('/api/admin/overview'),f.env,f.now)).json();assert.equal(body.pending_stations,2);assert.equal(body.published_stations,1);assert.equal(JSON.stringify(body).includes('Review me'),false);
});
