import {HttpError} from './security.mjs';

// Keep this bound aligned with MAX_STATIONS in the radio firmware. Reports are
// complete snapshots; command acknowledgements are never used as inventory.
export const MAX_SAVED_STATIONS=100;
export async function inventoryStatements(env,id,body,now){
  if(!Object.hasOwn(body,'saved_station_codes'))return [];
  const supplied=body.saved_station_codes;
  if(!Array.isArray(supplied)||supplied.length>MAX_SAVED_STATIONS||supplied.some(code=>
    typeof code!=='string'||code.length<2||code.length>6||/[^0-9]/.test(code)||Number(code)<10))
    throw new HttpError(400,'Saved station codes must be a complete list of up to 100 station codes.');
  const codes=[...new Set(supplied.map(code=>Number(code)))];
  // A removed or suspended directory entry must not block pairing/command
  // acknowledgements. Only codes that map to published entries are exposed.
  const rows=codes.length?(await env.DB.prepare(`SELECT CAST(code AS TEXT) AS code FROM stations
    WHERE status='published' AND code IN (${codes.map(()=>'?').join(',')}) ORDER BY stations.code`)
    .bind(...codes).all()).results:[];
  return [env.DB.prepare(`INSERT INTO radio_station_inventory(radio_id,station_codes_json,reported_at,all_station_codes_json)
    VALUES (?,?,?,?) ON CONFLICT(radio_id) DO UPDATE SET
    station_codes_json=excluded.station_codes_json,reported_at=excluded.reported_at,all_station_codes_json=excluded.all_station_codes_json
    WHERE excluded.reported_at>=radio_station_inventory.reported_at`)
    .bind(id,JSON.stringify(rows.map(row=>row.code)),now,JSON.stringify(codes.sort((a,b)=>a-b).map(String)))];
}

// Only a linked browser's private endpoint calls this helper. Do not expose
// unpublished station metadata; numeric saved codes are enough for removal.
export async function removableInventory(env,id){
  const row=await env.DB.prepare(`SELECT COALESCE(i.all_station_codes_json,i.station_codes_json) AS codes FROM radio_station_inventory i
    JOIN radio_telemetry t ON t.radio_id=i.radio_id WHERE i.radio_id=? AND t.station_removal_version=1`).bind(id).first();
  return row?{removable_station_codes:JSON.parse(row.codes)}:{};
}

export async function savedInventory(env,id){
  const inventory=await env.DB.prepare('SELECT reported_at FROM radio_station_inventory WHERE radio_id=?').bind(id).first();
  if(!inventory)return {saved_station_codes:null,inventory_reported_at:null};
  const rows=await env.DB.prepare(`SELECT CAST(s.code AS TEXT) AS code
    FROM radio_station_inventory i, json_each(i.station_codes_json) c
    JOIN stations s ON s.code=c.value AND s.status='published'
    WHERE i.radio_id=? ORDER BY s.code LIMIT 100`).bind(id).all();
  return {saved_station_codes:rows.results.map(row=>row.code),inventory_reported_at:inventory.reported_at};
}
