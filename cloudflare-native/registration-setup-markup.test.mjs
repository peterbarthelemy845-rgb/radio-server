import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';

const html=readFileSync(new URL('./public/index.html',import.meta.url),'utf8');
const signup=html.match(/<form id="registerForm">([\s\S]*?)<\/form>/)[1];
const editor=html.match(/<form id="editForm">([\s\S]*?)<\/form>/)[1];

test('compact signup keeps email after station name and bio only in the signed-in editor',()=>{
 assert.match(signup,/<label><span data-i18n="stationName">[\s\S]*?<input name="name"[^>]*><\/label>\s*<label><span data-i18n="contactEmail">/);
 assert.doesNotMatch(signup,/name="bio"|bioOptional|registration-details/);
 assert.match(editor,/<textarea name="bio"[^>]*maxlength="250"/);
});

test('stream setup stays inline with one URL in the station submission',()=>{
 assert.match(signup,/<input id="streamUrlInput"[^>]*name="stream_url"/);
 assert.equal([...signup.matchAll(/name="stream_url"/g)].length,1);
 assert.doesNotMatch(html,/<dialog id="streamSetupDialog"|id="streamSetup(?:Save|Cancel|Summary|Edit)"|id="registrationStreamValue"/);
 for(const id of ['streamHost','streamPort','streamProtocol','streamPath','streamUrlInput','streamUrlRow'])assert.ok(signup.includes('id="'+id+'"'),id);
 assert.doesNotMatch(signup,/Generated stream URL/);
 assert.match(signup,/<button[^>]*id="copyGeneratedStream"[^>]*hidden/);
});

test('new signup shows three unselected choices with inline setup collapsed',()=>{
 const choices=[...signup.matchAll(/<input[^>]*name="stream_provider"[^>]*>/g)].map(match=>match[0]);
 assert.equal(choices.length,3);
 for(const choice of choices){assert.doesNotMatch(choice,/\schecked(?:\s|>)|aria-haspopup/);assert.match(choice,/aria-controls="streamSetupPanel"/);}
 assert.match(signup,/id="streamSetupPanel"[^>]*hidden/);
});

test('signed-in editor offers the same inline setup and submits only one stream URL',()=>{
 const choices=[...editor.matchAll(/<input[^>]*name="owner_stream_provider"[^>]*>/g)].map(match=>match[0]);
 assert.equal(choices.length,3);assert.equal(choices.filter(choice=>/\schecked(?:\s|>)/.test(choice)).length,1);
 assert.equal([...editor.matchAll(/name="stream_url"/g)].length,1);
 for(const choice of choices){assert.match(choice,/aria-controls="ownerStreamSetupPanel"/);assert.doesNotMatch(choice,/aria-haspopup/);}
 for(const id of ['ownerStreamSetupPanel','ownerStreamAddressFields','ownerStreamHost','ownerStreamPort','ownerStreamProtocol','ownerStreamPath','ownerStreamUrlRow','ownerStreamUrlInput'])assert.ok(editor.includes('id="'+id+'"'),id);
 assert.doesNotMatch(editor,/Generated stream URL|<dialog/);
});
