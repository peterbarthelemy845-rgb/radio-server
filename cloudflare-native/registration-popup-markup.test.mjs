import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';

const html=readFileSync(new URL('./public/index.html',import.meta.url),'utf8');
const signup=html.match(/<form id="registerForm">([\s\S]*?)<\/form>/)[1];
const editor=html.match(/<form id="editForm">([\s\S]*?)<\/form>/)[1];
const setup=html.match(/<dialog id="streamSetupDialog"([\s\S]*?)<\/dialog>/)[1];

test('compact signup keeps email after station name and bio only in the signed-in editor',()=>{
 assert.match(signup,/<label><span data-i18n="stationName">[\s\S]*?<input name="name"[^>]*><\/label>\s*<label><span data-i18n="contactEmail">/);
 assert.doesNotMatch(signup,/name="bio"|bioOptional|registration-details/);
 assert.match(editor,/<textarea name="bio"[^>]*maxlength="250"/);
});

test('stream setup edits stay outside signup with one committed URL in the submission',()=>{
 assert.match(signup,/<input id="registrationStreamValue" name="stream_url" type="hidden">/);
 assert.equal([...signup.matchAll(/name="stream_url"/g)].length,1);
 assert.doesNotMatch(signup,/id="stream(?:Host|Port|Protocol|Path|UrlInput)"/);
 assert.doesNotMatch(setup,/name="stream_url"|<form|type="submit"/);
 assert.match(setup,/aria-labelledby="streamSetupTitle"/);
 for(const id of ['streamHost','streamPort','streamProtocol','streamPath','streamUrlInput','streamSetupSave','streamSetupCancel'])assert.ok(setup.includes('id="'+id+'"'),id);
});

test('new signup shows three unselected stream choices and a hidden connection summary',()=>{
 const choices=[...signup.matchAll(/<input[^>]*name="stream_provider"[^>]*>/g)].map(match=>match[0]);
 assert.equal(choices.length,3);
 for(const choice of choices){assert.doesNotMatch(choice,/\schecked(?:\s|>)/);assert.match(choice,/aria-controls="streamSetupDialog"/);}
 assert.match(signup,/id="streamSetupSummary"[^>]*hidden/);
});
