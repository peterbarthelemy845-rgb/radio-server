import {test} from 'node:test';
import assert from 'node:assert/strict';
import {nearbyZipCodes,zipLocationKnown,ZIP_RADIUS_MILES} from './zip-locations.mjs';

test('nearby ZIP search includes neighboring New York ZIPs and excludes distant California',()=>{
 const local=nearbyZipCodes('10001');assert.equal(ZIP_RADIUS_MILES,25);assert.ok(local.includes('10001'));assert.ok(local.includes('10002'));assert.ok(!local.includes('90210'));assert.deepEqual([...local].sort(),local);assert.equal(new Set(local).size,local.length);
});
test('ZIP location data preserves leading zeroes and cached results cannot be mutated',()=>{
 assert.equal(zipLocationKnown('00501'),true);const result=nearbyZipCodes('00501');assert.ok(result.includes('00501'));assert.ok(Object.isFrozen(result));assert.throws(()=>result.push('99999'),TypeError);assert.equal(nearbyZipCodes('00501'),result);
});
test('unknown ZIPs fall back to exact matches and malformed ZIP input never broadens a search',()=>{
 assert.equal(zipLocationKnown('99999'),false);assert.deepEqual(nearbyZipCodes('99999'),['99999']);
 for(const value of ['',12345,null,' 10001','10001\n','10001\u0000','１０００１','10001-0001'])assert.deepEqual(nearbyZipCodes(value),[]);
});
