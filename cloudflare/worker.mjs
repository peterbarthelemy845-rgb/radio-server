import {unifyNavigation} from './shared-nav.mjs';
// Migration stage 1: Cloudflare front door; Render still owns persistent data.
const ORIGIN_HOST = 'radio-server-z0hb.onrender.com';

export async function proxy(request, env, fetchOrigin = fetch) {
  const path=new URL(request.url).pathname;
  const legacyTargets={'/station/ads':'/station-edit?view=ads','/admin/local-ads':'/admin?view=ads','/admin/local-ads/main':'/admin?view=ads','/admin/viewership':'/admin?view=reports','/admin/reports':'/admin?view=reports','/admin/backups':'/admin?view=backups'};
  if(legacyTargets[path]&&request.method==='GET')return Response.redirect(new URL(legacyTargets[path],request.url).href,302);
  if(/^\/(?:station\/ads\/|admin\/(?:local-ads\/|backups\/))/.test(path))return Response.json({message:'This old endpoint is retired. Open the current station editor or admin dashboard.'},{status:410,headers:{'Cache-Control':'no-store'}});

  // Completed features use the independent Worker through a private service
  // binding, preserving the real hostname, browser cookies and Origin checks.
  const nativePath=['/','/radiolavoixdivine','/radiolavoixdivine/','/add-station','/station-edit','/admin','/device','/support','/terms','/privacy','/copyright','/counter-notice','/api/session','/api/events','/api/player','/api/haitian-times','/api/stations','/api/support','/api/legal/request','/api/radio/enroll','/api/radio/link/start','/api/radio/link/reset','/api/radio/poll'].includes(path)||/^\/(?:assets\/|artwork\/|station\/[0-9]|api\/(?:owner\/|admin\/|phone\/|device\/|support\/|stations\/))/.test(path);
  const nativeAds=['/api/ads/submit','/api/radio/ad','/api/radio/ad/displayed','/api/radio/ad/pixels'].includes(path)||/^\/(?:advertise\/[0-9]|api\/ad-artwork\/)/.test(path);
  if(env.NATIVE&&(nativePath||nativeAds))return env.NATIVE.fetch(request);
  const origin = new URL(env.ORIGIN_URL);
  if (origin.protocol !== 'https:' || origin.hostname !== ORIGIN_HOST ||
      origin.port || origin.username || origin.password) {
    return new Response('Invalid origin configuration.', {status: 503});
  }
  const incoming = new URL(request.url);
  const target = new URL(origin.origin);
  // Dedicated radio address retains the requested URL in the browser while
  // serving the existing player. Other paths, including device APIs, are intact.
  target.pathname = incoming.pathname;
  target.search = incoming.search;
  const headers = new Headers(request.headers);
  // Never let visitors choose the upstream host or impersonate a trusted proxy.
  for (const name of ['host', 'forwarded', 'x-forwarded-host', 'x-forwarded-proto',
    'x-forwarded-for', 'x-real-ip']) headers.delete(name);
  // Retain Origin and CSRF/session headers; do not weaken the application's checks.
  let upstream;
  try {
    upstream = await fetchOrigin(new Request(target, {
      method: request.method, headers,
      body: ['GET', 'HEAD'].includes(request.method) ? undefined : request.body,
      duplex: 'half',
      redirect: 'manual',
    }), {cf: {cacheTtl: 0, cacheEverything: false}});
  } catch {
    return new Response('The radio website is temporarily unavailable. Please try again.', {
      status: 502, headers: {'Cache-Control': 'no-store', 'Content-Type': 'text/plain; charset=utf-8'},
    });
  }
  const responseHeaders = new Headers(upstream.headers);
  // Keep private pages, pairing commands and session-bearing responses out of cache.
  responseHeaders.set('Cache-Control', 'no-store');
  const location = responseHeaders.get('Location');
  if (location) {
    const destination = new URL(location, target);
    if (destination.origin === origin.origin) {
      destination.protocol = incoming.protocol;
      destination.host = incoming.host;
      responseHeaders.set('Location', destination.href);
    }
  }
  return unifyNavigation(new Response(upstream.body, {status: upstream.status, headers: responseHeaders}),path);
}

export default {fetch(request, env) { return proxy(request, env); }};
