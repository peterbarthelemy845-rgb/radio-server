// All website traffic is handled by the Cloudflare application service.
export async function proxy(request,env){
 const path=new URL(request.url).pathname;
  const legacyTargets={'/device':'/support','/station/ads':'/station-edit?view=ads','/admin/local-ads':'/admin?view=ads','/admin/local-ads/main':'/admin?view=ads','/admin/viewership':'/admin?view=reports','/admin/reports':'/admin?view=reports','/admin/backups':'/admin?view=backups'};
  if(legacyTargets[path]&&request.method==='GET')return Response.redirect(new URL(legacyTargets[path],request.url).href,302);
  if(/^\/(?:station\/ads\/|admin\/(?:local-ads\/|backups\/))/.test(path))return Response.json({message:'This old endpoint is retired. Open the current station editor or admin dashboard.'},{status:410,headers:{'Cache-Control':'no-store'}});

 if(!env.NATIVE)return new Response('Website temporarily unavailable.',{status:503,headers:{'Cache-Control':'no-store'}});
 try{return await env.NATIVE.fetch(request);}catch{return new Response('Website temporarily unavailable.',{status:503,headers:{'Cache-Control':'no-store'}});}
}
export default {fetch(request,env){return proxy(request,env);}};
