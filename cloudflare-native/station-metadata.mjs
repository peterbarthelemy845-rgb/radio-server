import {HttpError} from './security.mjs';

// Optional owner-selected labels, never inferred from names or stream URLs.
const freeze=items=>Object.freeze(items.map(([value,label])=>Object.freeze({value,label})));
export const metadataOptions=Object.freeze({
 languages:freeze([['en','English'],['ht','Haitian Creole'],['fr','French'],['es','Spanish'],['pt','Portuguese'],['other','Other']]),
 categories:freeze([['christian','Christian'],['news_talk','News & talk'],['music','Music'],['culture','Culture'],['other','Other']])
});
export function metadataValue(field,value){
 const choices=field==='language'?metadataOptions.languages:field==='category'?metadataOptions.categories:null;
 if(!choices||typeof value!=='string'||value!==''&&!choices.some(item=>item.value===value))throw new HttpError(400,'Choose a valid station '+field+'.');
 return value;
}
export function stationMetadata(input,fallback={}){
 return Object.fromEntries(['language','category'].map(field=>[field,metadataValue(field,Object.hasOwn(input,field)?input[field]:fallback[field]??'')]));
}
