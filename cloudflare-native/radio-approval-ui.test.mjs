import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {runInNewContext} from 'node:vm';

const source=readFileSync(new URL('./public/assets/listener-usability.js',import.meta.url),'utf8');
const approvalSource=source.slice(source.indexOf('function showRadioApproval('),source.indexOf('let sharedConfirmationGeneration='));
function fixture(appI18n){
  function node(tagName='p'){return {tagName:tagName.toUpperCase(),className:'',dataset:{},children:[],textContent:'',set innerHTML(_){throw Error('Approval values must remain literal text');},replaceChildren(...children){this.children=children;}};}
  const show=runInNewContext(approvalSource+';showRadioApproval;',{document:{createElement:node},window:appI18n?{appI18n}:{}});
  return {show,node};
}

test('radio approval displays all four digits alone and protects them from translation',()=>{
  const {show,node}=fixture(),target=node();show(target,'0583');
  assert.equal(target.children.length,2);const [number,instruction]=target.children;
  assert.equal(number.tagName,'STRONG');assert.equal(number.className,'radio-approval-number');assert.equal(number.textContent,'0583');assert.equal(number.dataset.i18nSkip,'1');assert.equal(number.dataset.i18n,undefined);
  assert.equal(instruction.tagName,'SPAN');assert.equal(instruction.className,'radio-approval-instruction');assert.equal(instruction.dataset.i18n,'pairing.approve');assert.equal(instruction.textContent,'Match this number and tap Allow on your radio.');
});

test('approval replaces the previous prompt and never interprets response text as markup',()=>{
  const {show,node}=fixture(),target=node(),value='<img src=x onerror=alert(1)>';
  show(target,'1234');const previous=target.children[0];show(target,value);
  assert.equal(target.children.length,2);assert.notEqual(target.children[0],previous);assert.equal(target.children[0].textContent,value);assert.equal(target.children[0].children.length,0);assert.equal(target.children[0].dataset.i18nSkip,'1');
});

test('approval instruction uses the current translation without translating the number',()=>{
  const calls=[],translated='Konpare nimewo sa a epi peze Pèmèt sou radyo ou.';
  const {show,node}=fixture({t:key=>{calls.push(key);return translated;}}),target=node();show(target,5831);
  assert.deepEqual(calls,['pairing.approve']);assert.equal(target.children[0].textContent,'5831');assert.equal(target.children[1].textContent,translated);assert.equal(target.children[1].dataset.i18n,'pairing.approve');
});

test('approval keeps a readable English instruction when the translation key is unavailable',()=>{
  for(const result of ['pairing.approve','',undefined,null]){
    const {show,node}=fixture({t:()=>result}),target=node();show(target,'5831');
    assert.equal(target.children[1].textContent,'Match this number and tap Allow on your radio.');assert.equal(target.children[0].textContent,'5831');
  }
});
