import {HttpError,json,mac} from './security.mjs';
import {metadataOptions,metadataValue} from './station-metadata.mjs';
import {nearbyZipCodes,zipLocationKnown,ZIP_RADIUS_MILES} from './zip-locations.mjs';

const stationColumns=`CAST(code AS TEXT) AS listener_code,CAST(updated_at AS TEXT) AS revision,name,stream_url AS url,bio,language,category,zip_code,
 'Internet Radio' AS subtitle,CASE WHEN artwork_key IS NULL AND name='La Voix Divine' AND stream_url='https://icecast3.getstreamhosting.com/proxy/radiodivinessl/live' THEN '/assets/radiolavoixdivine.png' WHEN artwork_key IS NULL THEN '' ELSE '/artwork/'||artwork_key END AS logo_url,
 CASE WHEN artwork_key IS NULL AND name='La Voix Divine' AND stream_url='https://icecast3.getstreamhosting.com/proxy/radiodivinessl/live' THEN '/assets/radiolavoixdivine.png' WHEN artwork_key IS NULL THEN '' ELSE '/artwork/'||artwork_key||'?size=192' END AS logo_thumb_url`;
export function foldDirectorySearch(value){return String(value).normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase();}
export async function publicStation(db,code){return db.prepare(`SELECT ${stationColumns} FROM stations WHERE code=? AND status='published'`).bind(Number(code)).first();}
export async function publicStationBatch(request,env){
 const params=new URL(request.url).searchParams,values=params.getAll('codes'),input=values[0]||'',codes=input.split(',');
 if(values.length!==1||input.length>699||codes.length>100||codes.some(code=>!/^[1-9][0-9]{1,5}$/.test(code)))throw new HttpError(400,'Choose up to 100 station codes.');
 const unique=[...new Set(codes.map(Number))],rows=await env.DB.prepare(`SELECT ${stationColumns} FROM stations WHERE status='published' AND code IN (${unique.map(()=>'?').join(',')}) ORDER BY code`).bind(...unique).all();
 return json({stations:rows.results});
}
const encode=value=>btoa(String.fromCharCode(...new TextEncoder().encode(JSON.stringify(value)))).replaceAll('+','-').replaceAll('/','_').replace(/=+$/,'');
function decode(value){return JSON.parse(new TextDecoder().decode(Uint8Array.from(atob(value.replaceAll('-','+').replaceAll('_','/')),char=>char.charCodeAt(0))));}
function sameSignature(a,b){if(a.length!==b.length)return false;let difference=0;for(let i=0;i<a.length;i++)difference|=a.charCodeAt(i)^b.charCodeAt(i);return difference===0;}
export async function directoryResponse(request,env){
 const params=new URL(request.url).searchParams;
 for(const key of ['q','limit','cursor','language','category','zip_code'])if(params.getAll(key).length>1)throw new HttpError(400,'Use one value per station filter.');
 const language=metadataValue('language',params.get('language')||''),category=metadataValue('category',params.get('category')||''),zip_code=metadataValue('zip_code',params.get('zip_code')||'');
 const zip_radius_miles=zip_code?ZIP_RADIUS_MILES:null,zip_location_known=zip_code?zipLocationKnown(zip_code):null;
 const clauses=[],bindings=[];for(const [field,value] of Object.entries({language,category}))if(value){clauses.push(field+'=?');bindings.push(value);}
 if(zip_code){clauses.push('zip_code IN (SELECT value FROM json_each(?))');bindings.push(JSON.stringify(nearbyZipCodes(zip_code)));}
 const filters=clauses.length?' AND '+clauses.join(' AND '):'';
 const raw=params.get('q')||'';if(raw.length>96)throw new HttpError(400,'Search with 96 characters or fewer.');
 const query=foldDirectorySearch(raw.trim().replace(/^#\s*(?=\d)/,'')),explicit=params.has('limit'),limit=explicit?Number(params.get('limit')):params.has('q')||language||category||zip_code?50:1000;
 if(!Number.isInteger(limit)||limit<1||limit>(explicit?100:1000)||explicit&&!/^[1-9][0-9]{0,2}$/.test(params.get('limit')))throw new HttpError(400,'Choose a page size from 1 to 100.');
 let after=0,ceiling;
 const cursor=params.get('cursor');
 if(cursor){
  if(cursor.length>1024||!/^[A-Za-z0-9_-]+\.[a-f0-9]{64}$/.test(cursor))throw new HttpError(400,'Start this station search again.');
  const [data,signature]=cursor.split('.');if(!sameSignature(signature,await mac(env,'public-directory:'+data)))throw new HttpError(400,'Start this station search again.');
  let value;try{value=decode(data);}catch{throw new HttpError(400,'Start this station search again.');}
  if(value.v!==3||value.q!==query||value.language!==language||value.category!==category||value.zip_code!==zip_code||value.zip_radius_miles!==zip_radius_miles||value.limit!==limit||!Number.isSafeInteger(value.after)||!Number.isSafeInteger(value.ceiling)||value.after<0||value.ceiling<value.after||value.ceiling>2147483647)throw new HttpError(400,'Start this station search again.');
  after=value.after;ceiling=value.ceiling;
 }else ceiling=Number((await env.DB.prepare("SELECT MAX(code) AS ceiling FROM stations WHERE status='published'"+filters).bind(...bindings).first())?.ceiling||0);
 const stations=[];let scanned=0,hasMore=false,last=after;
 // A bounded scan preserves the browser's exact Unicode accent folding without
 // an unbounded table load or an incompatible SQLite-only approximation.
 while(last<ceiling&&scanned<1000){
  const batchSize=query?Math.min(200,1000-scanned):limit+1;
  const rows=(await env.DB.prepare(`SELECT ${stationColumns} FROM stations WHERE status='published'${filters} AND code>? AND code<=? ORDER BY code LIMIT ?`).bind(...bindings,last,ceiling,batchSize).all()).results;
  if(!rows.length)break;
  for(const station of rows){
   const match=!query||foldDirectorySearch(station.name+' '+station.listener_code).includes(query);
   if(match&&stations.length===limit){hasMore=true;break;}
   last=Number(station.listener_code);scanned++;if(match)stations.push(station);
  }
  if(hasMore||rows.length<batchSize)break;
  if(scanned>=1000&&last<ceiling)hasMore=true;
 }
 let next_cursor=null;
 if(hasMore){const data=encode({v:3,after:last,ceiling,q:query,language,category,zip_code,zip_radius_miles,limit});next_cursor=data+'.'+await mac(env,'public-directory:'+data);}
 const facets={};for(const [field,key] of [['language','languages'],['category','categories']]){const counts=(await env.DB.prepare(`SELECT ${field} AS value,count(*) AS count FROM stations WHERE status='published' AND ${field}!='' GROUP BY ${field}`).all()).results;facets[key]=metadataOptions[key].flatMap(option=>{const count=Number(counts.find(item=>item.value===option.value)?.count||0);return count?[{...option,count}]:[];});}
 return json({stations,has_more:hasMore,next_cursor,limit,query,language,category,zip_code,zip_radius_miles,zip_location_known,scanned_count:scanned,facets,metadata_options:metadataOptions});
}
