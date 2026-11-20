// Windows alternative to package-radio.py: package only verified public source.
const fs=require('node:fs');
const path=require('node:path');
const crypto=require('node:crypto');
const {execFileSync}=require('node:child_process');
const assert=require('node:assert/strict');

const here=__dirname,workspace=path.resolve(here,'../../../..');
const source=path.join(workspace,'outputs/cloudflare-arduino/waveshare_radio');
const version='2026.11.19.1';
const target=path.join(here,'public/assets/waveshare-radio.zip');
const download=path.join(workspace,'outputs/waveshare_radio-auto-station-updates.zip');
const temporary=target+'.'+crypto.randomBytes(8).toString('hex')+'.building';
const sha=bytes=>crypto.createHash('sha256').update(bytes).digest('hex');
const notes=fs.readFileSync(path.join(source,'BUILD-RESULT.txt'),'utf8');
assert(notes.includes('Verified Arduino compile')&&notes.includes('Firmware version: '+version)&&notes.includes('Arduino CLI compile exit status: 0'),'Verified compile evidence for this release is missing.');
assert(fs.readFileSync(path.join(source,'waveshare_radio.ino'),'utf8').includes('RADIO_FIRMWARE_VERSION = "'+version+'"'),'Sketch and release versions differ.');

const allowed=new Set(['.ino','.h','.cpp','.c','.md','.txt','.cjs','.json']);
function collect(dir,prefix=''){
 return fs.readdirSync(dir,{withFileTypes:true}).sort((a,b)=>a.name.localeCompare(b.name)).flatMap(entry=>{
  if(entry.name.startsWith('.')||['cloudflare_provisioning.h','SHA256.json'].includes(entry.name))return [];
  const relative=prefix+entry.name,absolute=path.join(dir,entry.name);
  return entry.isDirectory()?collect(absolute,relative+'/'):entry.isFile()&&allowed.has(path.extname(entry.name).toLowerCase())?[relative]:[];
 });
}
const files=collect(source),manifest={};
const provisioning=path.join(source,'cloudflare_provisioning.h');
const privateValues=fs.existsSync(provisioning)?[...fs.readFileSync(provisioning,'utf8').matchAll(/#define\s+RADIO_[A-Z0-9_]*(?:TOKEN|SECRET|KEY|ID)\s+"([^"\r\n]{16,})"/g)].map(match=>match[1]):[];
for(const relative of files){
 const bytes=fs.readFileSync(path.join(source,relative)),text=bytes.toString('utf8');
 assert(!relative.toLowerCase().includes('provisioning'),'Private provisioning must not be distributed.');
 if(/\.(?:ino|h|cpp|c)$/.test(relative))assert(![...text.matchAll(/#define\s+RADIO_ENROLLMENT_TOKEN\s+"([^"]*)"/g)].some(match=>match[1]),'Private provisioning must stay outside public source.');
 assert(!privateValues.some(value=>bytes.includes(Buffer.from(value))),'A public file contains private provisioning data.');
 manifest[relative]=sha(bytes);
}
const manifestPath=path.join(source,'SHA256.json');
fs.writeFileSync(manifestPath,JSON.stringify(manifest,null,2)+'\n');
const expected=new Map(Object.entries(manifest).map(([name,hash])=>['waveshare_radio/'+name,hash]));
expected.set('waveshare_radio/SHA256.json',sha(fs.readFileSync(manifestPath)));

// A static PowerShell script uses .NET's standard ZIP writer and independently
// reopens/decompresses every entry. Paths are environment values, never code.
const script=String.raw`
$ErrorActionPreference='Stop'
Add-Type -AssemblyName System.IO.Compression.FileSystem
$source=$env:RADIO_PACKAGE_SOURCE
$target=$env:RADIO_PACKAGE_TARGET
$manifest=Get-Content -LiteralPath (Join-Path $source 'SHA256.json') -Raw | ConvertFrom-Json
$archive=[System.IO.Compression.ZipFile]::Open($target,[System.IO.Compression.ZipArchiveMode]::Create)
try {
 foreach($relative in @($manifest.PSObject.Properties.Name)+@('SHA256.json')) {
  [System.IO.Compression.ZipFileExtensions]::CreateEntryFromFile($archive,(Join-Path $source $relative),('waveshare_radio/'+$relative),[System.IO.Compression.CompressionLevel]::Optimal) | Out-Null
 }
} finally {$archive.Dispose()}
$archive=[System.IO.Compression.ZipFile]::OpenRead($target)
try {
 $records=@(foreach($entry in $archive.Entries) {
  $stream=$entry.Open();$hasher=[System.Security.Cryptography.SHA256]::Create()
  try { $hash=([BitConverter]::ToString($hasher.ComputeHash($stream))).Replace('-','').ToLowerInvariant() }
  finally {$stream.Dispose();$hasher.Dispose()}
  [pscustomobject]@{name=$entry.FullName;hash=$hash}
 })
 ConvertTo-Json -InputObject $records -Compress
} finally {$archive.Dispose()}
`;
try{
 const output=execFileSync('pwsh.exe',['-NoLogo','-NoProfile','-NonInteractive','-Command',script],{encoding:'utf8',windowsHide:true,env:{...process.env,RADIO_PACKAGE_SOURCE:source,RADIO_PACKAGE_TARGET:temporary},maxBuffer:1024*1024});
 const records=JSON.parse(output.trim());assert.equal(records.length,expected.size,'The ZIP member count differs from its manifest.');
 const seen=new Set();for(const record of records){assert(!seen.has(record.name),'Duplicate ZIP member.');seen.add(record.name);assert.equal(record.hash,expected.get(record.name),'ZIP integrity or manifest verification failed.');assert(!record.name.toLowerCase().includes('provisioning'),'Private provisioning must not be distributed.');}
 fs.renameSync(temporary,target);fs.copyFileSync(target,download);
 assert.equal(sha(fs.readFileSync(target)),sha(fs.readFileSync(download)),'The download copy differs.');
 fs.writeFileSync(path.join(here,'public/assets/radio-release.json'),JSON.stringify({version,sketch_url:'/assets/waveshare-radio.zip'})+'\n');
 console.log(JSON.stringify({version,files:expected.size,bytes:fs.statSync(target).size,sha256:sha(fs.readFileSync(target)),download,privateProvisioningExcluded:true,manifestVerified:true}));
}finally{if(fs.existsSync(temporary))fs.unlinkSync(temporary);}
