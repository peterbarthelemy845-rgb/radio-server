// Approximate US ZIP locations from GeoNames, CC BY 4.0.
// See zip-data-source.json and ZIP-DATA-NOTICE.md for source and transformations.
import rows from './us-zip-centroids.json' with {type:'json'};

export const ZIP_RADIUS_MILES=25;
const earthMiles=3958.7613,radians=Math.PI/180,points=new Map(),latitudeBands=new Map(),cache=new Map();
for(const [zip,latitude,longitude] of rows){
 const point={zip,latitude,longitude};points.set(zip,point);
 const band=Math.floor(latitude*2);if(!latitudeBands.has(band))latitudeBands.set(band,[]);latitudeBands.get(band).push(point);
}
export function zipLocationKnown(zip){return typeof zip==='string'&&points.has(zip);}
// ZIP centroids are approximate areas, not a listener's precise location.
export function zipDistanceMiles(from,to){
 const origin=points.get(from),target=points.get(to);if(!origin||!target)return null;
 const halfLat=(target.latitude-origin.latitude)*radians/2,halfLon=(target.longitude-origin.longitude)*radians/2;
 const haversine=Math.sin(halfLat)**2+Math.cos(origin.latitude*radians)*Math.cos(target.latitude*radians)*Math.sin(halfLon)**2;
 return 2*earthMiles*Math.asin(Math.sqrt(Math.min(1,Math.max(0,haversine))));
}
export function nearbyZipCodes(zip){
 if(typeof zip!=='string'||zip.length!==5||!/^\d{5}$/.test(zip))return [];
 const origin=points.get(zip);if(!origin)return [zip];
 if(cache.has(zip)){const result=cache.get(zip);cache.delete(zip);cache.set(zip,result);return result;}
 const angular=ZIP_RADIUS_MILES/earthMiles,latitudeDelta=angular/radians,latitude=origin.latitude*radians;
 const longitudeDelta=Math.abs(origin.latitude)+latitudeDelta>=90?180:Math.asin(Math.sin(angular)/Math.cos(latitude))/radians;
 const found=new Map([[zip,0]]);
 for(let band=Math.floor((origin.latitude-latitudeDelta)*2);band<=Math.floor((origin.latitude+latitudeDelta)*2);band++)for(const point of latitudeBands.get(band)||[]){
  const deltaLatitude=point.latitude-origin.latitude;if(Math.abs(deltaLatitude)>latitudeDelta)continue;
  const deltaLongitude=((point.longitude-origin.longitude+540)%360)-180;if(Math.abs(deltaLongitude)>longitudeDelta)continue;
  const halfLat=deltaLatitude*radians/2,halfLon=deltaLongitude*radians/2;
  const haversine=Math.sin(halfLat)**2+Math.cos(latitude)*Math.cos(point.latitude*radians)*Math.sin(halfLon)**2;
  const distance=2*earthMiles*Math.asin(Math.sqrt(Math.min(1,Math.max(0,haversine))));
  if(distance<=ZIP_RADIUS_MILES)found.set(point.zip,distance);
 }
 const result=Object.freeze([...found.keys()].sort((a,b)=>found.get(a)-found.get(b)||(a===zip?-1:b===zip?1:a.localeCompare(b))));cache.set(zip,result);if(cache.size>128)cache.delete(cache.keys().next().value);return result;
}
