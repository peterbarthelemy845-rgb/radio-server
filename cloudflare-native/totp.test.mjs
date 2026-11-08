import {test} from 'node:test';import assert from 'node:assert/strict';import {DatabaseSync} from 'node:sqlite';
import {totpAt,matchTotp,consumeTotp} from './totp.mjs';
const secret='GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ';
test('authenticator calculation matches RFC 6238 SHA-1 vectors truncated to six digits',async()=>{
 for(const [time,expected] of [[59,'287082'],[1111111109,'081804'],[1111111111,'050471'],[1234567890,'005924'],[2000000000,'279037'],[20000000000,'353130']])assert.equal(await totpAt(secret,Math.floor(time/30)),expected);
});
test('authenticator accepts clock drift once and fails closed on missing, wrong or replayed code',async()=>{
 const sqlite=new DatabaseSync(':memory:');sqlite.exec('CREATE TABLE admin_mfa_used(secret_hash TEXT,counter INTEGER,PRIMARY KEY(secret_hash,counter))');
 const env={ADMIN_TOTP_SECRET:secret,DB:{prepare(sql){let args;return {bind(...v){args=v;return this;},async first(){return sqlite.prepare(sql).get(...args);}};}}};
 assert.equal(await consumeTotp(env,'000000',59),false);assert.equal(await consumeTotp(env,'287082',60),true);assert.equal(await consumeTotp(env,'287082',60),false);assert.equal(await consumeTotp({...env,ADMIN_TOTP_SECRET:''},'287082',59),false);
});
test('matching a valid authenticator step does not consume it and preserves drift limits',async()=>{let writes=0;const env={ADMIN_TOTP_SECRET:secret,DB:{prepare(){writes++;throw Error('Unexpected database use');}}};
 for(const counter of [59999999,60000000,60000001]){const code=await totpAt(secret,counter),match=await matchTotp(env,code,1800000000);assert.equal(match.counter,counter);assert.match(match.secretHash,/^[a-f0-9]{64}$/);}
 for(const counter of [59999998,60000002])assert.equal(await matchTotp(env,await totpAt(secret,counter),1800000000),null);assert.equal(await matchTotp({...env,ADMIN_TOTP_SECRET:'not a base32 secret'},'000000',1800000000),null);assert.equal(writes,0);
});
