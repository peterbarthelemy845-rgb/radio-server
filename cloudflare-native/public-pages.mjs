import {publicStation} from './public-directory.mjs';
const pages=new Set(['/','/radiolavoixdivine','/radiolavoixdivine/','/add-station','/create-station','/station-edit','/admin','/device','/support','/wifi-setup','/terms','/privacy','/copyright','/counter-notice','/manifest.webmanifest','/sw.js','/offline.html']);
export const publicStaticPath=path=>pages.has(path)||/^\/(?:station|advertise)\/[0-9]{2,6}$/.test(path)||/^\/assets\/[a-z0-9.-]+$/.test(path);
export const publicHeadPath=path=>publicStaticPath(path)||/^\/artwork\/[a-f0-9]{64}\.png$/.test(path)||path==='/api/stations'||path==='/api/stations/batch'||/^\/api\/(?:device\/)?stations\/[0-9]{2,6}$/.test(path)||path==='/health';
export function publicOrigin(env){try{const url=new URL(env.PUBLIC_ORIGIN||'https://radiolocals.com');if(url.protocol==='https:'&&!url.username&&!url.password)return url.origin;}catch{}return 'https://radiolocals.com';}
const escape=value=>String(value).replace(/[&<>"']/g,char=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]));
const titles={'/offline.html':'Offline','/':'Radio','/support':'Support','/device':'Support','/wifi-setup':'Wi-Fi setup','/add-station':'Create your station','/create-station':'Create your station','/station-edit':'Edit your station','/admin':'Administrator','/terms':'Station terms','/privacy':'Privacy','/copyright':'Copyright and contact','/counter-notice':'Counter-notice','/radiolavoixdivine':'La Voix Divine','/radiolavoixdivine/':'La Voix Divine'};
export async function rewritePublicHtml(html,request,env){
 const path=new URL(request.url).pathname,stationPath=path.match(/^\/station\/([0-9]{2,6})$/),origin=publicOrigin(env);
 let title=(titles[path]||(/^\/advertise\//.test(path)?'Advertise on a station':'Radio'))+' · Radio Locals',metadata='',status=200;
 if(stationPath){
  const station=await publicStation(env.DB,stationPath[1]);
  if(station){
   title=station.name+' · Radio Locals';const description=('Add '+station.name+' to your radio. '+(station.bio||'')).replace(/\s+/g,' ').trim().slice(0,240),canonical=origin+'/station/'+station.listener_code,image=origin+(station.logo_url||'/assets/radio-signin-logo.webp');
   metadata='<link rel="canonical" href="'+escape(canonical)+'"><meta name="description" content="'+escape(description)+'"><meta property="og:type" content="website"><meta property="og:site_name" content="Radio Locals"><meta property="og:title" content="'+escape(station.name)+'"><meta property="og:description" content="'+escape(description)+'"><meta property="og:url" content="'+escape(canonical)+'"><meta property="og:image" content="'+escape(image)+'"><meta name="twitter:card" content="summary_large_image"><meta name="twitter:title" content="'+escape(station.name)+'"><meta name="twitter:description" content="'+escape(description)+'"><meta name="twitter:image" content="'+escape(image)+'">';
  }else{title='Station not found · Radio Locals';status=404;metadata='<meta name="robots" content="noindex">';}
 }
 html=html.replace(/<title\b[^>]*>[\s\S]*?<\/title>/i,'<title>'+escape(title)+'</title>');
 if(metadata)html=html.replace(/<\/head\s*>/i,metadata+'</head>');
 return {html,status};
}
