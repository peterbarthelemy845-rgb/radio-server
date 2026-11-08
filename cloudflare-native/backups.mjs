import {json,encrypt,decrypt,randomHex,readJson,limit,HttpError} from './security.mjs';import {administrator} from './access.mjs';
export const BACKUP_TABLES=['stations','radios','radio_pairs','radio_station_inventory','monthly_activity','agreement_acceptances','local_ads','ad_policy','ad_impressions','listening_daily','share_events','help_videos','legal_requests','legal_actions','support_replies'];
const validMedia=key=>/^(?:sanitized\/[a-f0-9]{64}\.png|ad-pixels\/[a-f0-9]{64}\.bin)$/.test(key);
async function audit(env,actor,action,now){await env.DB.prepare('INSERT INTO admin_audit(id,actor_hash,action,created_at) VALUES (?,?,?,?)').bind(randomHex(16),actor,action,now).run();}
export async function createBackup(env,now,kind='manual'){
 const id=randomHex(16),day=new Date(now*1000).toISOString().slice(0,10);
 const claimed=await env.DB.prepare("INSERT INTO backup_runs(id,day,kind,state,created_at) VALUES (?,?,?,'running',?) ON CONFLICT DO NOTHING RETURNING id").bind(id,day,kind,now).first();if(!claimed)return null;
 try{
  // D1 batch reads use one transaction so related tables have a consistent view.
  const results=await env.DB.batch(BACKUP_TABLES.map(table=>env.DB.prepare('SELECT * FROM '+table+' LIMIT 1001'))),tables={};let count=0;
  for(let i=0;i<results.length;i++){const rows=results[i].results||[];count+=rows.length;if(rows.length>1000||count>3000)throw Error('Backup size limit reached.');tables[BACKUP_TABLES[i]]=rows;}
  const keys=new Set();for(const row of [...tables.stations,...tables.local_ads])if(row.artwork_key)keys.add('sanitized/'+row.artwork_key);for(const row of tables.ad_policy)if(row.pixels_key)keys.add('ad-pixels/'+row.pixels_key);
  if(keys.size>100)throw Error('Backup media limit reached.');let size=0;const media=[];
  for(const key of keys){if(!validMedia(key))throw Error('Unexpected media path.');const object=await env.MEDIA.get(key);if(!object)throw Error('A referenced media file is missing.');size+=object.size;if(size>50*1024*1024)throw Error('Backup media size limit reached.');await env.MEDIA.put('backups/'+id+'/media/'+key,object.body,{httpMetadata:object.httpMetadata,customMetadata:object.customMetadata});media.push(key);}
  const snapshot={version:1,created_at:now,tables,media},serialized=JSON.stringify(snapshot);if(new TextEncoder().encode(serialized).length>8*1024*1024)throw Error('Backup manifest size limit reached.');await env.MEDIA.put('backups/'+id+'/manifest.enc',await encrypt(env,serialized),{httpMetadata:{contentType:'application/octet-stream'}});
  await env.DB.prepare("UPDATE backup_runs SET state='ready',completed_at=?,record_count=?,media_count=? WHERE id=?").bind(now,count,media.length,id).run();return {id,records:count,media:media.length};
 }catch(error){await env.DB.prepare("UPDATE backup_runs SET state='failed',error='Backup did not complete. Check storage and size limits.' WHERE id=?").bind(id).run();throw new HttpError(503,'Backup did not complete. Existing data is unchanged.');}
}
export async function restoreBackup(env,id,now){
 const run=await env.DB.prepare("SELECT 1 FROM backup_runs WHERE id=? AND state='ready'").bind(id).first();if(!run)throw new HttpError(404,'Backup not found.');const object=await env.MEDIA.get('backups/'+id+'/manifest.enc');if(!object||object.size>12*1024*1024)throw new HttpError(400,'Backup manifest unavailable.');let snapshot;try{snapshot=JSON.parse(await decrypt(env,await object.text()));}catch{throw new HttpError(400,'Backup could not be authenticated.');}
 if(snapshot.version!==1||!snapshot.tables||!Array.isArray(snapshot.media)||snapshot.media.length>100||Object.keys(snapshot.tables).some(t=>!BACKUP_TABLES.includes(t)))throw new HttpError(400,'Unsupported backup.');
 const statements=[];let count=0;
 for(const table of BACKUP_TABLES){
  // Older snapshots omit tables added in migrations 0010 and 0011. Preserve
  // newer inventory reports and support correspondence during a legacy restore.
  const rows=['radio_station_inventory','support_replies'].includes(table)&&!Object.hasOwn(snapshot.tables,table)?[]:snapshot.tables[table];
  if(!Array.isArray(rows)||rows.length>1000)throw new HttpError(400,'Invalid backup table.');const schema=(await env.DB.prepare('PRAGMA table_info('+table+')').all()).results,columns=schema.map(c=>c.name),primary=schema.filter(c=>c.pk).map(c=>c.name);for(let row of rows){count++;
  // Snapshots made before migration 0009 cannot recover a display code from its
  // HMAC. Only this newly added nullable column may be absent in older rows.
  if(table==='radio_pairs'&&row&&typeof row==='object'&&!Array.isArray(row)&&columns.includes('code_encrypted')&&!Object.hasOwn(row,'code_encrypted'))row={...row,code_encrypted:null};
  if(count>3000||!row||Object.keys(row).length!==columns.length||Object.keys(row).some(c=>!columns.includes(c))||Object.values(row).some(v=>v!==null&&!['string','number'].includes(typeof v)))throw new HttpError(400,'Invalid backup row.');const updates=columns.filter(c=>!primary.includes(c)).map(c=>c+'=excluded.'+c).join(',');statements.push(env.DB.prepare('INSERT INTO '+table+'('+columns.join(',')+') VALUES ('+columns.map(()=>'?').join(',')+') ON CONFLICT DO UPDATE SET '+updates).bind(...columns.map(c=>row[c])));}}
 // Check every saved media object before touching the live database.
 for(const key of snapshot.media){if(!validMedia(key)||!await env.MEDIA.head('backups/'+id+'/media/'+key))throw new HttpError(400,'Backup media is incomplete.');}
 for(const key of snapshot.media){const media=await env.MEDIA.get('backups/'+id+'/media/'+key);await env.MEDIA.put(key,media.body,{httpMetadata:media.httpMetadata,customMetadata:media.customMetadata});}
 statements.push(env.DB.prepare('DELETE FROM registration_requests'),env.DB.prepare('UPDATE sessions SET owner_station=NULL,owner_expires=NULL'),env.DB.prepare('DELETE FROM support_ticket_grants'),env.DB.prepare('DELETE FROM support_status_verifications'),env.DB.prepare('DELETE FROM radio_control_commands'),env.DB.prepare('DELETE FROM radio_control_grants'),env.DB.prepare('DELETE FROM radio_telemetry'),env.DB.prepare('DELETE FROM phone_radios'),env.DB.prepare("UPDATE pair_claims SET state='cancelled' WHERE state IN ('waiting','approved')"),env.DB.prepare("UPDATE radio_commands SET state='failed' WHERE state IN ('pending','delivered')"),env.DB.prepare('DELETE FROM listening_sessions'));
 await env.DB.batch(statements);return {records:count};
}
export async function backupRoutes(request,env,now){const url=new URL(request.url),path=url.pathname;if(path!=='/api/admin/backups')return null;const current=await administrator(request,env,now);
 if(request.method==='GET'){const backups=(await env.DB.prepare('SELECT id,day,kind,state,created_at,completed_at,record_count,media_count,error FROM backup_runs ORDER BY created_at DESC LIMIT 50').all()).results;return json({backups,note:'Encrypted snapshots include station data and copies of referenced media. Restore merges saved records and replaces matching IDs; newer records are kept. Owner and phone sessions are revoked. Daily retention is 14 days. Cloudflare secrets are not included.'});}
 if(request.method!=='POST')throw new HttpError(405,'Method not allowed.');await limit(env.DB,'backup-admin',current.token_hash,6,3600,now);const body=await readJson(request,2048);
 if(body.action==='create'){const backup=await createBackup(env,now);await audit(env,current.token_hash,'backup-create:'+backup.id,now);return json({backup,message:'Backup created.'});}
 if(body.action==='restore'&&body.confirm==='RESTORE'&&/^[a-f0-9]{32}$/.test(body.id||'')){const result=await restoreBackup(env,body.id,now);await audit(env,current.token_hash,'backup-restore:'+body.id,now);return json({message:'Saved records and media restored. Station owners and phones must sign in or link again.',...result});}
 throw new HttpError(400,'Choose Create backup or explicitly confirm RESTORE.');
}
export async function scheduledBackup(env,now){const date=new Date(now*1000);if(date.getUTCHours()!==5||date.getUTCMinutes()!==0){const existing=await env.DB.prepare('SELECT 1 FROM backup_runs LIMIT 1').first();if(existing)return;}await createBackup(env,now,'daily');}
export async function expireBackups(env,now){const rows=(await env.DB.prepare("SELECT id FROM backup_runs WHERE created_at<? ORDER BY created_at LIMIT 3").bind(now-14*86400).all()).results;for(const row of rows){const listed=await env.MEDIA.list({prefix:'backups/'+row.id+'/',limit:250});if(listed.objects.length)await env.MEDIA.delete(listed.objects.map(o=>o.key));if(!listed.truncated)await env.DB.prepare('DELETE FROM backup_runs WHERE id=?').bind(row.id).run();}}
