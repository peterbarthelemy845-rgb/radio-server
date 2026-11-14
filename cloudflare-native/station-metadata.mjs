import {HttpError} from './security.mjs';

// Optional owner-selected labels, never inferred from names or stream URLs.
const freeze=items=>Object.freeze(items.map(([value,label])=>Object.freeze({value,label})));
export const metadataOptions=Object.freeze({
 languages:freeze([['en','English'],['ht','Haitian Creole'],['fr','French'],['es','Spanish'],['pt','Portuguese'],['other','Other']]),
 categories:freeze([['christian','Religion'],['news_talk','News & talk'],['music','Music'],['culture','Culture'],['other','Other']])
});
export function metadataValue(field,value){
 if(field==='zip_code'){
  if(typeof value!=='string'||value!==''&&(value.length!==5||!/^[0-9]{5}$/.test(value)))throw new HttpError(400,'Enter a five-digit ZIP code or leave it blank.');
  return value;
 }
 const choices=field==='language'?metadataOptions.languages:field==='category'?metadataOptions.categories:null;
 if(!choices||typeof value!=='string'||value!==''&&!choices.some(item=>item.value===value))throw new HttpError(400,'Choose a valid station '+field+'.');
 return value;
}
export function stationMetadata(input,fallback={}){
 return Object.fromEntries(['language','category','zip_code'].map(field=>[field,metadataValue(field,Object.hasOwn(input,field)?input[field]:fallback[field]??'')]));
}
// Reads, filters and old snapshots still permit unclassified stations. Only
// a new registration or owner write must supply the two required fields.
export function requiredStationMetadata(input,fallback={}){
 const metadata=stationMetadata(input,fallback);
 if(!metadata.zip_code)throw new HttpError(400,'Enter a 5-digit ZIP code.');
 if(!metadata.category)throw new HttpError(400,'Choose a category.');
 return metadata;
}
