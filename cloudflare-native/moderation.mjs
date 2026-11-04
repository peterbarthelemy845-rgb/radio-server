// Only sanitized public-facing station content is sent to the moderation API.
// Any missing configuration, incomplete response, or service failure keeps it private.
const words=['fuck','fucking','fucker','motherfucker','shit','bullshit','asshole','bitch','cunt','porn','porno','pornography','xxx','blowjob','merde','putain','salope','connard','enculer','getmaman','kokomaman','kalanmaman'];
export function needsTextReview(text){
  const clean=text.normalize('NFKD').toLowerCase().replace(/[\p{M}\p{Cf}]/gu,'').replace(/[013457@$!]/g,c=>({'0':'o','1':'i','3':'e','4':'a','5':'s','7':'t','@':'a','$':'s','!':'i'}[c]));
  return words.some(word=>new RegExp('(?:^|[^a-z0-9])'+[...word].map(c=>c+'+').join('[^a-z0-9]*')+'(?:$|[^a-z0-9])').test(clean));
}
export async function scanCreative(env,text,artworkKey,fetcher=fetch){
  if(!env.OPENAI_API_KEY||!env.MEDIA||needsTextReview(text))return false;
  try{
    const art=await env.MEDIA.get('sanitized/'+artworkKey);
    if(!art||art.customMetadata?.sanitizer_version!=='1'||art.size>3*1024*1024)return false;
    const bytes=new Uint8Array(await art.arrayBuffer());let binary='';
    for(let i=0;i<bytes.length;i+=8192)binary+=String.fromCharCode(...bytes.subarray(i,i+8192));
    const response=await fetcher('https://api.openai.com/v1/moderations',{method:'POST',redirect:'manual',signal:AbortSignal.timeout(15000),
      headers:{Authorization:'Bearer '+env.OPENAI_API_KEY,'Content-Type':'application/json'},
      body:JSON.stringify({model:'omni-moderation-latest',input:[{type:'text',text},{type:'image_url',image_url:{url:'data:image/png;base64,'+btoa(binary)}}]})});
    if(!response.ok)return false;
    const data=await response.json(),result=data.results?.[0];
    if(data.results?.length!==1||result?.flagged!==false||!result.categories||!result.category_scores)return false;
    const required=['sexual','sexual/minors','violence','violence/graphic','hate','harassment','self-harm'];
    if(required.some(k=>typeof result.categories[k]!=='boolean'||typeof result.category_scores[k]!=='number'))return false;
    if(Object.values(result.categories).some(v=>v!==false)||Object.values(result.category_scores).some(v=>!Number.isFinite(v)||v<0||v>1))return false;
    // Conservative custom thresholds route borderline results to manual review.
    if(required.some(k=>result.category_scores[k]>=0.2))return false;
    return true;
  }catch{return false;}
}
export async function screenStation(env,code,fetcher=fetch){
  const station=await env.DB.prepare("SELECT code,name,bio,artwork_key,updated_at FROM stations WHERE code=? AND status='pending_review' AND email_verified_at IS NOT NULL").bind(code).first();
  if(!station||!await scanCreative(env,station.name+'\n'+station.bio,station.artwork_key,fetcher))return false;
  try{
    const approved=await env.DB.prepare(`UPDATE stations SET status='published' WHERE code=? AND status='pending_review'
      AND email_verified_at IS NOT NULL AND name=? AND bio=? AND artwork_key=? AND updated_at=? RETURNING code`)
      .bind(code,station.name,station.bio,station.artwork_key,station.updated_at).first();
    return Boolean(approved);
  }catch{return false;}
}
