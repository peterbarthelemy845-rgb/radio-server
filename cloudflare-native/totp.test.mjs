import {test} from 'node:test';import assert from 'node:assert/strict';import {DatabaseSync} from 'node:sqlite';
import {totpAt,consumeTotp} from './totp.mjs';
const secret='GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ';
test('authenticator calculation matches RFC 6238 SHA-1 vectors truncated to six digits',async()=>{
 for(const [time,expected] of [[59,'287082'],[1111111109,'081804'],[1111111111,'050471'],[1234567890,'005924'],[2000000000,'279037'],[20000000000,'353130']])assert.equal(await totpAt(secret,Math.floor(time/30)),expected);
});
test('authenticator accepts clock drift once and fails closed on missing, wrong or replayed code',async()=>{
 const sqlite=new DatabaseSync(':memory:');sqlite.exec('CREATE TABLE admin_mfa_used(secret_hash TEXT,counter INTEGER,PRIMARY KEY(secret_hash,counter))');
 const env={ADMIN_TOTP_SECRET:secret,DB:{prepare(sql){let args;return {bind(...v){args=v;return this;},async first(){return sqlite.prepare(sql).get(...args);}};}}};
 assert.equal(await consumeTotp(env,'000000',59),false);assert.equal(await consumeTotp(env,'287082',60),true);assert.equal(await consumeTotp(env,'287082',60),false);assert.equal(await consumeTotp({...env,ADMIN_TOTP_SECRET:''},'287082',59),false);
});
