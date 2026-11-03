// Migration stage 1: Cloudflare front door; Render still owns persistent data.
const ORIGIN_HOST = 'radio-server-z0hb.onrender.com';

export async function proxy(request, env, fetchOrigin = fetch) {
  const origin = new URL(env.ORIGIN_URL);
  if (origin.protocol !== 'https:' || origin.hostname !== ORIGIN_HOST ||
      origin.port || origin.username || origin.password) {
    return new Response('Invalid origin configuration.', {status: 503});
  }
  const incoming = new URL(request.url);
  const target = new URL(origin.origin);
  // Dedicated radio address retains the requested URL in the browser while
  // serving the existing player. Other paths, including device APIs, are intact.
  target.pathname = ['/radiolavoixdivine','/radiolavoixdivine/'].includes(incoming.pathname) && ['GET','HEAD'].includes(request.method) ? '/' : incoming.pathname;
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
  return new Response(upstream.body, {status: upstream.status, headers: responseHeaders});
}

export default {fetch(request, env) { return proxy(request, env); }};
