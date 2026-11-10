import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {runInNewContext} from 'node:vm';
const source=readFileSync(new URL('./public/assets/support-device-helper.js',import.meta.url),'utf8');
function fixture({value='',selected='one',initialRadios=[]}={}){
 const events=new Map(),fieldEvents=new Map(),formEvents=new Map(),frames=[];
 const field={value,disabled:false,addEventListener(name,fn){fieldEvents.set(name,fn);}},form={dataset:{},attributes:{},elements:{device_code:field},addEventListener(name,fn){formEvents.set(name,fn);},getAttribute(name){return this.attributes[name]??null;}};
 runInNewContext(source,{$:id=>id==='ticketForm'?form:null,readSelectedRadio:()=>selected,radioCardViews:new Map(initialRadios.map(radio=>[radio.id,{radio}])),queueMicrotask:fn=>frames.push(fn),window:{addEventListener(name,fn){events.set(name,fn);}}});
 const event=(name,detail)=>events.get(name)?.({detail});
 return {field,form,status(radios){event('radio-status-updated',{radios});},unavailable(){event('radio-status-updated',{unavailable:true});},select(id){selected=id;event('radio-selection-changed');},type(value){field.value=value;fieldEvents.get('input')?.();},settle(){while(frames.length)frames.shift()();},reset(){formEvents.get('reset')?.();field.value='';},busyEnd(){delete form.dataset.busy;delete form.attributes['aria-busy'];formEvents.get('form-busy-changed')?.();}};
}
const one={id:'one',device_code:'3961',current_station_code:'13'},two={id:'two',device_code:'7777',current_station_code:'14'};

test('support pre-fills only the selected linked Device Code, including known radios at startup',()=>{
 const f=fixture();f.status([one,two]);assert.equal(f.field.value,'3961');
 const loaded=fixture({initialRadios:[one,two],selected:'two'});assert.equal(loaded.field.value,'7777');
 const noSelection=fixture({selected:''});noSelection.status([one]);assert.equal(noSelection.field.value,'');
});

test('selection changes replace only an owned autofill and never a manually entered other device',()=>{
 const f=fixture();f.status([one,two]);f.select('two');assert.equal(f.field.value,'7777');f.type('1234');f.select('one');f.status([{...one,device_code:'4444'}]);assert.equal(f.field.value,'1234');
 const manual=fixture({value:'3961',initialRadios:[one,two]});manual.select('two');assert.equal(manual.field.value,'3961');
});

test('a user edit retains ownership even when it matches the old autofill',()=>{
 const f=fixture();f.status([one,two]);f.type('3961');f.select('two');assert.equal(f.field.value,'3961');
});

test('unlink clears an owned autofill but preserves a user supplied Device Code',()=>{
 const f=fixture();f.status([one]);f.select('');assert.equal(f.field.value,'');f.status([]);assert.equal(f.field.value,'');
 const manual=fixture();manual.status([one]);manual.type('1234');manual.select('');manual.status([]);assert.equal(manual.field.value,'1234');
});

test('removing the selected radio or resetting its Device Code updates only the helper value',()=>{
 const f=fixture();f.status([one,two]);f.status([two]);assert.equal(f.field.value,'');f.status([{...one,device_code:'5555'}]);assert.equal(f.field.value,'5555');
});

test('support never mistakes current station codes for Device Codes or invents a selection',()=>{
 const f=fixture();f.status([{id:'one',current_station_code:'13'}]);assert.equal(f.field.value,'');f.status([{id:'two',device_code:'7777'}]);assert.equal(f.field.value,'');
});

test('unavailable status retains a known linked code without assuming the radio is unlinked',()=>{
 const f=fixture();f.status([one]);f.unavailable();assert.equal(f.field.value,'3961');
});

test('busy support submissions defer autofill changes until unlocked',()=>{
 const f=fixture();f.status([one,two]);f.form.dataset.busy='1';f.select('two');assert.equal(f.field.value,'3961');f.busyEnd();assert.equal(f.field.value,'7777');
 f.form.attributes['aria-busy']='true';f.select('');f.status([]);assert.equal(f.field.value,'7777');f.busyEnd();assert.equal(f.field.value,'');
});

test('a manual override during a busy request is not overwritten on completion',()=>{
 const f=fixture();f.status([one,two]);f.form.dataset.busy='1';f.select('two');f.type('9000');f.busyEnd();assert.equal(f.field.value,'9000');
});

test('resetting a support draft fills the selected radio after the native form reset',()=>{
 const f=fixture();f.status([one,two]);f.type('1234');f.select('two');f.reset();assert.equal(f.field.value,'');f.settle();assert.equal(f.field.value,'7777');
});

test('manually clearing the optional Device Code stays blank through status and selection changes until reset',()=>{
 const f=fixture();f.status([one,two]);assert.equal(f.field.value,'3961');f.type('');f.status([one,two]);f.select('two');f.unavailable();assert.equal(f.field.value,'');f.form.dataset.busy='1';f.select('one');f.busyEnd();assert.equal(f.field.value,'');
 f.reset();f.settle();assert.equal(f.field.value,'3961');f.select('two');assert.equal(f.field.value,'7777');
});
