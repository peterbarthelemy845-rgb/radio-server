import {json,encrypt,decrypt,randomHex,readJson,limit,HttpError} from './security.mjs';import {administrator} from './access.mjs';
import {publicStreamUrl} from './public-stream-url.mjs';
import {stationName} from './station-edits.mjs';
import {stationMetadata} from './station-metadata.mjs';
import {STREAM_CHECK_LIFETIME} from './stream-verification.mjs';
export const BACKUP_TABLES=['stations','station_edits','station_stream_checks','radios','radio_pairs','radio_station_inventory','monthly_activity','agreement_acceptances','local_ads','ad_policy','ad_impressions','listening_daily','share_events','help_videos','legal_requests','legal_actions','support_replies'];
const MAX_RECORDS=50000,MAX_MEDIA=250,MAX_MANIFEST_BYTES=8*1024*1024,MAX_MEDIA_BYTES=50*1024*1024;
// AES-GCM adds a 16-byte tag; the existing envelope hex-encodes ciphertext
// plus its 12-byte IV and one separator. Every accepted manifest must restore.
const MAX_ENCRYPTED_MANIFEST_BYTES=MAX_MANIFEST_BYTES*2+57;
const RETRY_SECONDS=15*60,RUN_LEASE_SECONDS=60*60;
const validMedia=key=>/^(?:sanitized\/[a-f0-9]{64}\.png|ad-pixels\/[a-f0-9]{64}\.bin)$/.test(key);
function validateStationEditSnapshot(stations,edits,media){
 const approved=new Map(stations.map(row=>[row.code,row])),seen=new Set();
 for(const edit of edits){
  const station=approved.get(edit.station_code);
  if(!Number.isSafeInteger(edit.station_code)||seen.has(edit.station_code)||!station||!['published','pending_review'].includes(station.status)||!station.email_verified_at||!Number.isSafeInteger(edit.base_updated_at)||edit.base_updated_at!==station.updated_at||typeof edit.revision!=='string'||!/^[a-f0-9]{32}$/.test(edit.revision)||typeof edit.stream_url!=='string'||edit.stream_url.length>1024||typeof edit.bio!=='string'||edit.bio.length>250||!Number.isSafeInteger(edit.created_at)||edit.created_at<0||edit.artwork_key!==null&&(typeof edit.artwork_key!=='string'||!/^[a-f0-9]{64}\.png$/.test(edit.artwork_key)))throw new HttpError(400,'Invalid proposed station changes in backup.');
  try{publicStreamUrl(edit.stream_url);if(typeof edit.name!=='string'||stationName(edit.name)!==edit.name)throw Error('name');}catch{throw new HttpError(400,'Invalid proposed station changes in backup.');}
  if(media&&edit.artwork_key&&!media.has('sanitized/'+edit.artwork_key))throw new HttpError(400,'Backup media is incomplete.');seen.add(edit.station_code);
 }
}
// Old URL checks are not part of the current approved/proposed station state.
// Use the same filter in the capacity preflight and transactional snapshot.
function backupTableFilter(table){return table==='station_stream_checks'?`EXISTS (SELECT 1 FROM stations saved_station WHERE saved_station.code=station_stream_checks.station_code AND (saved_station.stream_url=station_stream_checks.stream_url OR EXISTS (SELECT 1 FROM station_edits saved_edit WHERE saved_edit.station_code=saved_station.code AND saved_edit.stream_url=station_stream_checks.stream_url AND saved_edit.revision=station_stream_checks.revision)))`:'1';}
function validateStationStreamChecks(stations,edits,checks,createdAt){
 const approved=new Map(stations.map(row=>[row.code,row])),proposals=new Map(edits.map(row=>[row.station_code,row])),seen=new Set();
 if(!Number.isSafeInteger(createdAt)||createdAt<0)throw new HttpError(400,'Invalid stream check evidence in backup.');
 for(const check of checks){
  const station=approved.get(check.station_code),pending=proposals.get(check.station_code),key=JSON.stringify([check.station_code,check.stream_url]);
  if(!Number.isSafeInteger(check.station_code)||check.station_code<10||!station||seen.has(key)||typeof check.stream_url!=='string'||typeof check.revision!=='string'||check.revision!=='initial'&&!/^[a-f0-9]{32}$/.test(check.revision)||check.session_hash!==null||!Number.isSafeInteger(check.checked_at)||check.checked_at<0||check.checked_at>createdAt||!Number.isSafeInteger(check.expires)||check.expires<0||check.checked_at===0&&check.expires!==0||check.checked_at>0&&(check.expires<=check.checked_at||check.expires-check.checked_at>STREAM_CHECK_LIFETIME)||check.review_requested_at!==null&&(!Number.isSafeInteger(check.review_requested_at)||check.review_requested_at<=0||check.review_requested_at>createdAt))throw new HttpError(400,'Invalid stream check evidence in backup.');
  try{if(publicStreamUrl(check.stream_url)!==check.stream_url)throw Error('normalized');}catch{throw new HttpError(400,'Invalid stream check evidence in backup.');}
  if(check.stream_url!==station.stream_url&&!(pending&&pending.stream_url===check.stream_url&&pending.revision===check.revision))throw new HttpError(400,'Stream check evidence does not match its station snapshot.');
  seen.add(key);
 }
}
function backupLimit(reason){const error=new Error(reason);error.backupReason=reason;return error;}
function auditStatement(env,actor,action,now){return env.DB.prepare('INSERT INTO admin_audit(id,actor_hash,action,created_at) VALUES (?,?,?,?)').bind(randomHex(16),actor,action,now);}
async function audit(env,actor,action,now){await auditStatement(env,actor,action,now).run();}
export async function createBackup(env,now,kind='manual'){
 const id=randomHex(16),day=new Date(now*1000).toISOString().slice(0,10);
 if(kind==='daily'){
  // Preserve failed attempts for diagnosis/retention. Replacing their daily
  // claim and inserting the next attempt is atomic; concurrent crons have one
  // winner, and an old Worker can only write its own archived attempt ID.
  await env.DB.batch([
   env.DB.prepare(`UPDATE backup_runs SET kind='daily-failed',state='failed',error=coalesce(error,'Backup attempt timed out. It will be retried.')
    WHERE day=? AND kind='daily' AND ((state='failed' AND created_at<=?) OR (state='running' AND created_at<=?))`).bind(day,now-RETRY_SECONDS,now-RUN_LEASE_SECONDS),
   env.DB.prepare("INSERT INTO backup_runs(id,day,kind,state,created_at) VALUES (?,?,'daily','running',?) ON CONFLICT DO NOTHING").bind(id,day,now)
  ]);
 }else await env.DB.prepare("INSERT INTO backup_runs(id,day,kind,state,created_at) VALUES (?,?,?,'running',?) ON CONFLICT DO NOTHING").bind(id,day,kind,now).run();
 if(!await env.DB.prepare("SELECT 1 FROM backup_runs WHERE id=? AND state='running'").bind(id).first())return null;
 try{
  const schemas=await env.DB.batch(BACKUP_TABLES.map(table=>env.DB.prepare('PRAGMA table_info('+table+')')));
  const sizes=BACKUP_TABLES.map((table,i)=>{const columns=schemas[i].results.map(c=>c.name),overhead=1+columns.reduce((n,c)=>n+JSON.stringify(c).length+2,0);
   // json_quote sizes escaped UTF-8 values without loading their text into the
   // Worker. The extra byte per row covers array separators.
   return `SELECT count(*) AS records,coalesce(sum(${overhead}+${columns.map(c=>'length(CAST(json_quote('+c+') AS BLOB))').join('+')}),0)+count(*) AS bytes FROM ${table} WHERE ${backupTableFilter(table)}`;}).join(' UNION ALL ');
  const results=await env.DB.batch([
   env.DB.prepare(`WITH totals AS (SELECT sum(records) AS records,sum(bytes) AS bytes FROM (${sizes}))
    UPDATE backup_runs SET record_count=(SELECT records FROM totals),error=CASE
     WHEN (SELECT records FROM totals)>${MAX_RECORDS} THEN 'Backup capacity reached: more than 50,000 records.'
     WHEN (SELECT bytes FROM totals)>${MAX_MANIFEST_BYTES-65536} THEN 'Backup capacity reached: database snapshot exceeds 8 MiB.' ELSE NULL END
    WHERE id=? AND state='running' RETURNING record_count,error`).bind(id),
   ...BACKUP_TABLES.map(table=>env.DB.prepare(`SELECT * FROM ${table} WHERE EXISTS
    (SELECT 1 FROM backup_runs WHERE id=? AND state='running' AND error IS NULL) AND ${backupTableFilter(table)} LIMIT ${MAX_RECORDS+1}`).bind(id))
  ]),preflight=results[0].results?.[0],tables={};let count=0;
  if(!preflight)throw backupLimit('Backup attempt was superseded. Try again.');
  if(preflight.error)throw backupLimit(preflight.error);
  for(let i=0;i<BACKUP_TABLES.length;i++){const rows=results[i+1].results||[];count+=rows.length;if(rows.length>MAX_RECORDS||count>MAX_RECORDS)throw backupLimit('Backup capacity reached: more than 50,000 records.');tables[BACKUP_TABLES[i]]=rows;}
  if(count!==preflight.record_count)throw backupLimit('Backup snapshot was incomplete. Try again.');
  validateStationEditSnapshot(tables.stations,tables.station_edits);
  tables.station_stream_checks=tables.station_stream_checks.map(row=>({...row,session_hash:null}));
  validateStationStreamChecks(tables.stations,tables.station_edits,tables.station_stream_checks,now);
  const keys=new Set();for(const row of [...tables.stations,...tables.station_edits,...tables.local_ads])if(row.artwork_key)keys.add('sanitized/'+row.artwork_key);for(const row of tables.ad_policy)if(row.pixels_key)keys.add('ad-pixels/'+row.pixels_key);
  if(keys.size>MAX_MEDIA)throw backupLimit('Backup capacity reached: more than 250 media files.');let size=0;const media=[];
  for(const key of keys){if(!validMedia(key))throw backupLimit('Backup contains an unexpected media path.');const object=await env.MEDIA.get(key);if(!object)throw backupLimit('A referenced media file is missing.');size+=object.size;if(size>MAX_MEDIA_BYTES)throw backupLimit('Backup capacity reached: media exceeds 50 MiB.');await env.MEDIA.put('backups/'+id+'/media/'+key,object.body,{httpMetadata:object.httpMetadata,customMetadata:object.customMetadata});media.push(key);}
  const snapshot={version:1,created_at:now,tables,media},serialized=JSON.stringify(snapshot);if(new TextEncoder().encode(serialized).length>MAX_MANIFEST_BYTES)throw backupLimit('Backup capacity reached: database snapshot exceeds 8 MiB.');await env.MEDIA.put('backups/'+id+'/manifest.enc',await encrypt(env,serialized),{httpMetadata:{contentType:'application/octet-stream'}});
  if(!await env.DB.prepare("UPDATE backup_runs SET state='ready',completed_at=?,record_count=?,media_count=? WHERE id=? AND state='running' RETURNING id").bind(now,count,media.length,id).first())throw backupLimit('Backup attempt was superseded. Try again.');return {id,records:count,media:media.length};
 }catch(error){const reason=error.backupReason||'Check storage availability and try again.';await env.DB.prepare("UPDATE backup_runs SET state='failed',error=? WHERE id=? AND state='running'").bind(reason,id).run();throw new HttpError(503,'Backup did not complete. '+reason+' Existing data is unchanged.');}
}
export async function restoreBackup(env,id,now,actor=null){
 const run=await env.DB.prepare("SELECT 1 FROM backup_runs WHERE id=? AND state='ready'").bind(id).first();if(!run)throw new HttpError(404,'Backup not found.');const object=await env.MEDIA.get('backups/'+id+'/manifest.enc');if(!object||object.size>MAX_ENCRYPTED_MANIFEST_BYTES)throw new HttpError(400,'Backup manifest unavailable.');let snapshot;try{const plain=await decrypt(env,await object.text());if(new TextEncoder().encode(plain).length>MAX_MANIFEST_BYTES)throw Error('manifest capacity');snapshot=JSON.parse(plain);}catch{throw new HttpError(400,'Backup could not be authenticated.');}
 if(snapshot.version!==1||!snapshot.tables||!Array.isArray(snapshot.media)||snapshot.media.length>MAX_MEDIA||Object.keys(snapshot.tables).some(t=>!BACKUP_TABLES.includes(t)))throw new HttpError(400,'Unsupported backup.');
 // Old snapshots contain no classifications. Restore blank optional values,
 // never guess from artwork/names or inherit a newer live station's metadata.
 for(const table of ['stations','station_edits'])if(Array.isArray(snapshot.tables[table]))snapshot.tables[table]=snapshot.tables[table].map(row=>row&&typeof row==='object'&&!Array.isArray(row)?{...row,...stationMetadata(row)}:row);
 const legacyStreamChecks=!Object.hasOwn(snapshot.tables,'station_stream_checks');
 // A legacy snapshot did not record this publication gate. Preserve proposal
 // bases while keeping its restored stations private until they are reviewed.
 if(legacyStreamChecks&&Array.isArray(snapshot.tables.stations))snapshot.tables.stations=snapshot.tables.stations.map(row=>row&&typeof row==='object'&&!['deleted','suspended'].includes(row.status)&&(row.email_verified_at||row.status==='published')?{...row,status:row.email_verified_at?'pending_review':'pending_email'}:row);
 // Before proposed names were introduced, each proposal implicitly kept its
 // approved station name. Recover only that same snapshot's approved name.
 if(Array.isArray(snapshot.tables.station_edits)&&Array.isArray(snapshot.tables.stations)){
  const names=new Map(snapshot.tables.stations.map(row=>[row?.code,row?.name]));
  snapshot.tables.station_edits=snapshot.tables.station_edits.map(row=>row&&typeof row==='object'&&!Array.isArray(row)&&!Object.hasOwn(row,'name')?{...row,name:names.get(row.station_code)}:row);
 }
 const statements=[];let count=0;
 for(const table of BACKUP_TABLES){
  // Older snapshots omit tables added in migrations 0010 and 0011. Preserve
  // newer inventory reports and support correspondence during a legacy restore.
  const rows=['radio_station_inventory','support_replies','station_edits','station_stream_checks'].includes(table)&&!Object.hasOwn(snapshot.tables,table)?[]:snapshot.tables[table];
  if(!Array.isArray(rows)||rows.length>MAX_RECORDS)throw new HttpError(400,'Invalid backup table.');const schema=(await env.DB.prepare('PRAGMA table_info('+table+')').all()).results,columns=schema.map(c=>c.name),primary=schema.filter(c=>c.pk).map(c=>c.name),updates=columns.filter(c=>!primary.includes(c)).map(c=>c+'=excluded.'+c).join(','),sql='INSERT INTO '+table+'('+columns.join(',')+') VALUES ('+columns.map(()=>'?').join(',')+') ON CONFLICT DO UPDATE SET '+updates;for(let row of rows){count++;
  // Snapshots made before migration 0009 cannot recover a display code from its
  // HMAC. Only this newly added nullable column may be absent in older rows.
  if(table==='radio_pairs'&&row&&typeof row==='object'&&!Array.isArray(row)&&columns.includes('code_encrypted')&&!Object.hasOwn(row,'code_encrypted'))row={...row,code_encrypted:null};
  if(count>MAX_RECORDS||!row||Object.keys(row).length!==columns.length||Object.keys(row).some(c=>!columns.includes(c))||Object.values(row).some(v=>v!==null&&!['string','number'].includes(typeof v)))throw new HttpError(400,'Invalid backup row.');statements.push(env.DB.prepare(sql).bind(...columns.map(c=>row[c])));}}
 const edits=snapshot.tables.station_edits||[];validateStationEditSnapshot(snapshot.tables.stations,edits,new Set(snapshot.media));
 validateStationStreamChecks(snapshot.tables.stations,edits,snapshot.tables.station_stream_checks||[],snapshot.created_at);
 // The approved station row and its proposals are one snapshot. In particular,
 // a legacy snapshot must not leave a newer proposal attached to restored data.
 statements.unshift(env.DB.prepare('DELETE FROM station_edits WHERE station_code IN (SELECT value FROM json_each(?))').bind(JSON.stringify(snapshot.tables.stations.map(row=>row.code))));
 statements.unshift(env.DB.prepare('DELETE FROM station_stream_checks WHERE station_code IN (SELECT value FROM json_each(?))').bind(JSON.stringify(snapshot.tables.stations.map(row=>row.code))));
 // Check every saved media object before touching the live database. R2 copies
 // are prepared first and cannot be rolled back by the later D1 transaction.
 for(const key of snapshot.media){if(!validMedia(key)||!await env.MEDIA.head('backups/'+id+'/media/'+key))throw new HttpError(400,'Backup media is incomplete.');}
 for(const key of snapshot.media){const media=await env.MEDIA.get('backups/'+id+'/media/'+key);await env.MEDIA.put(key,media.body,{httpMetadata:media.httpMetadata,customMetadata:media.customMetadata});}
 statements.push(env.DB.prepare('DELETE FROM stream_check_results'),env.DB.prepare('DELETE FROM registration_requests'),env.DB.prepare("UPDATE email_verifications SET consumed_at=?,code_hash='' WHERE consumed_at IS NULL").bind(now),env.DB.prepare('UPDATE sessions SET owner_station=NULL,owner_expires=NULL'),env.DB.prepare('DELETE FROM support_ticket_grants'),env.DB.prepare('DELETE FROM support_status_verifications'),env.DB.prepare('DELETE FROM radio_control_commands'),env.DB.prepare('DELETE FROM radio_control_grants'),env.DB.prepare('DELETE FROM radio_telemetry'),env.DB.prepare('DELETE FROM phone_radios'),env.DB.prepare("UPDATE pair_claims SET state='cancelled' WHERE state IN ('waiting','approved')"),env.DB.prepare("UPDATE radio_commands SET state='failed' WHERE state IN ('pending','delivered')"),env.DB.prepare('DELETE FROM listening_sessions'));
 if(actor!==null)statements.push(auditStatement(env,actor,'backup-restore:'+id,now));
 await env.DB.batch(statements);return {records:count};
}
export async function backupRoutes(request,env,now){const url=new URL(request.url),path=url.pathname;if(path!=='/api/admin/backups')return null;const current=await administrator(request,env,now);
 if(request.method==='GET'){const backups=(await env.DB.prepare('SELECT id,day,kind,state,created_at,completed_at,record_count,media_count,error FROM backup_runs ORDER BY created_at DESC LIMIT 50').all()).results;return json({backups,note:'Encrypted snapshots include station data, proposed changes, current stream check evidence without session provenance, and copies of referenced media. Restore merges saved records and replaces matching IDs; newer records are kept. Proposed changes and stream evidence for each restored station are replaced by its snapshot, or cleared for older backups. Legacy backups without stream evidence restore active stations privately for review. Owner and phone sessions are revoked, and temporary stream check receipts are cleared. Database restore and its audit commit together; media copies happen first. Capacity is 50,000 records, an 8 MiB manifest, and 250 media files totaling 50 MiB; larger snapshots fail explicitly. Failed daily attempts retry after 15 minutes. Daily retention is 14 days. Cloudflare secrets are not included.'});}
 if(request.method!=='POST')throw new HttpError(405,'Method not allowed.');await limit(env.DB,'backup-admin',current.token_hash,6,3600,now);const body=await readJson(request,2048);
 if(body.action==='create'){const backup=await createBackup(env,now);await audit(env,current.token_hash,'backup-create:'+backup.id,now);return json({backup,message:'Backup created.'});}
 if(body.action==='restore'&&body.confirm==='RESTORE'&&/^[a-f0-9]{32}$/.test(body.id||'')){const result=await restoreBackup(env,body.id,now,current.token_hash);return json({message:'Saved records and media restored. Station owners and phones must sign in or link again.',...result});}
 throw new HttpError(400,'Choose Create backup or explicitly confirm RESTORE.');
}
export async function scheduledBackup(env,now){const date=new Date(now*1000);if(date.getUTCHours()<5){const existing=await env.DB.prepare('SELECT 1 FROM backup_runs LIMIT 1').first();if(existing)return;}await createBackup(env,now,'daily');}
export async function expireBackups(env,now){const rows=(await env.DB.prepare("SELECT id FROM backup_runs WHERE created_at<? ORDER BY created_at LIMIT 3").bind(now-14*86400).all()).results;for(const row of rows){const listed=await env.MEDIA.list({prefix:'backups/'+row.id+'/',limit:250});if(listed.objects.length)await env.MEDIA.delete(listed.objects.map(o=>o.key));if(!listed.truncated)await env.DB.prepare('DELETE FROM backup_runs WHERE id=?').bind(row.id).run();}}
