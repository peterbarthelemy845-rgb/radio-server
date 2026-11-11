import {json,hex} from './security.mjs';
const maximumThumbnail=256*1024;
const bytesOf=async object=>new Uint8Array(typeof object.arrayBuffer==='function'?await object.arrayBuffer():await new Response(object.body).arrayBuffer());
const sha256=async bytes=>hex(await crypto.subtle.digest('SHA-256',bytes));
function validThumbnail(bytes){
 if(bytes.length<33||bytes.length>maximumThumbnail||![137,80,78,71,13,10,26,10].every((value,index)=>bytes[index]===value)||String.fromCharCode(...bytes.slice(12,16))!=='IHDR')return false;
 const view=new DataView(bytes.buffer,bytes.byteOffset,bytes.byteLength),width=view.getUint32(16),height=view.getUint32(20);return width>0&&height>0&&width<=192&&height<=192;
}
const matched=(header,etag)=>header?.split(',').some(value=>value.trim()==='*'||value.trim().replace(/^W\//,'')===etag);
export async function publicArtworkResponse(request,env,key){
 const params=new URL(request.url).searchParams,thumbnail=params.has('size');
 if(thumbnail&&(params.getAll('size').length!==1||params.get('size')!=='192'))return json({message:'Choose the 192-pixel thumbnail.'},400);
 // Publication is checked before bucket lookup and before a conditional304.
 const approved=await env.DB.prepare("SELECT 1 FROM stations WHERE artwork_key=? AND status='published' LIMIT 1").bind(key).first();
 if(!approved||!env.MEDIA)return json({message:'Artwork not found.'},404);
 const source=await env.MEDIA.get('sanitized/'+key);
 if(!source||source.customMetadata?.sanitizer_version!=='1'||source.size>3*1024*1024)return json({message:'Artwork not found.'},404);
 const headers={'Content-Type':'image/png','X-Content-Type-Options':'nosniff','Content-Security-Policy':"default-src 'none'; sandbox",'Cache-Control':thumbnail?'public, max-age=0, must-revalidate':'no-store'};
 if(!thumbnail)return new Response(source.body,{headers});
 let sourceBytes,sourceVersion=source.httpEtag||source.etag;
 if(!sourceVersion){sourceBytes=await bytesOf(source);if(sourceBytes.length>3*1024*1024)return json({message:'Artwork not found.'},404);sourceVersion=await sha256(sourceBytes);}
 const cacheKey='thumbnails/v1/192/'+key,cached=await env.MEDIA.get(cacheKey);let bytes;
 if(cached&&cached.size<=maximumThumbnail&&cached.customMetadata?.thumbnail_version==='1'&&cached.customMetadata?.source_version===String(sourceVersion)){
  const candidate=await bytesOf(cached);if(validThumbnail(candidate))bytes=candidate;
 }
 if(!bytes){
  if(!env.IMAGES)return json({message:'Thumbnail processing is not ready.'},503);
  try{
   const input=sourceBytes?new Blob([sourceBytes]).stream():source.body,output=(await env.IMAGES.input(input).transform({width:192,height:192,fit:'contain'}).output({format:'image/png',anim:false})).response();
   if(!output.ok)throw Error('Thumbnail transform');bytes=new Uint8Array(await output.arrayBuffer());if(!validThumbnail(bytes))throw Error('Thumbnail output');
   await env.MEDIA.put(cacheKey,bytes,{httpMetadata:{contentType:'image/png'},customMetadata:{thumbnail_version:'1',sanitizer_version:'1',source_version:String(sourceVersion)}});
  }catch{return json({message:'Thumbnail could not be prepared.'},503);}
 }
 const etag='"'+await sha256(bytes)+'"';headers.ETag=etag;headers['Content-Length']=String(bytes.length);
 if(!await env.DB.prepare("SELECT 1 FROM stations WHERE artwork_key=? AND status='published' LIMIT 1").bind(key).first())return json({message:'Artwork not found.'},404);
 return new Response(matched(request.headers.get('If-None-Match'),etag)?null:bytes,{status:matched(request.headers.get('If-None-Match'),etag)?304:200,headers});
}
