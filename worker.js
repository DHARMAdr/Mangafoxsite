/* =====================================================================
   MangaFlow proxy - worker.js  (Cloudflare Worker, free plan is enough)
   WHY: Browsers will not let a web page read another website directly (CORS). This tiny server
        fetches the page for you and adds the header that permits your site to read the answer.
        Free public proxies are unreliable, so owning one is the dependable fix.
   SECURITY (round 7) - an open proxy is a free tool for strangers (and for attackers hiding behind YOUR address).
   This version therefore:
     1. answers only the sites listed in ALLOWED (set it! an empty list means "anyone" and prints a warning header);
     2. optional TOKEN: put  ?k=YOURSECRET  in the proxy address you paste into MangaFlow (see below);
     3. refuses private / local targets (localhost, 10.x, 192.168.x ...), non-web addresses and your own Worker;
     4. passes on only web-page, JSON, text and picture answers (no .zip / .exe downloads), max MAX_BYTES;
     5. a small per-visitor rate limit (best effort: it lives in one Worker instance only);
     6. never passes cookies from other sites.
   Honest limit: a TOKEN written in a web page can be read by anyone who opens the page, so ALLOWED (origin check)
   is the main lock and TOKEN only stops casual use. For stronger protection use Cloudflare Access or rate-limit rules.
   IMPROVE: add a cache (caches.default), and rotate User-Agents.

   DEPLOY (about 3 minutes, no coding):
   1. Make a free account at https://dash.cloudflare.com
   2. Left menu: Workers & Pages -> Create -> Create Worker -> name it e.g. "mangaflow-proxy" -> Deploy
   3. Click "Edit code", delete everything, paste THIS file, click Deploy.
   4. Copy the address, e.g. https://mangaflow-proxy.YOURNAME.workers.dev
   5. In MangaFlow: Settings (gear) -> "Your own CORS proxy" ->
        https://mangaflow-proxy.YOURNAME.workers.dev/?url={url}
      (with a token:  https://mangaflow-proxy.YOURNAME.workers.dev/?k=YOURSECRET&url={url} )
   ===================================================================== */

// Sites allowed to use this proxy. Empty list = anyone (fine for testing, risky long term).
// Example: ['https://yourname.github.io']   (the file:// pages you open locally send "null")
const ALLOWED = [];
const TOKEN = '';                      // optional secret, e.g. 'x7Kq29'. Empty = no token needed.
const MAX_BYTES = 80 * 1024 * 1024;    // largest answer passed on
const PER_MINUTE = 600;                // requests per visitor per minute (a 50-chapter download is many requests)
const OK_TYPES = /^(text\/|application\/(json|xhtml\+xml|xml|javascript)|image\/|font\/|application\/octet-stream$)/i;
const hits = new Map();                // visitor -> [timestamps]

// Private / local targets are never allowed.
function isPrivateHost(h) {
  h = h.replace(/^\[|\]$/g, '').toLowerCase();
  if (h === 'localhost' || h.endsWith('.local') || h.endsWith('.internal') || h === '::1' || h.startsWith('fe80') || h.startsWith('fc') || h.startsWith('fd')) return true;
  const m = h.match(/^(\d+)\.(\d+)\.(\d+)\.(\d+)$/);
  if (!m) return false;
  const [a, b] = [+m[1], +m[2]];
  return a === 0 || a === 10 || a === 127 || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || (a === 100 && b >= 64 && b <= 127) || a >= 224;
}

export default {
  async fetch(request) {
    const origin = request.headers.get('Origin') || '';
    const cors = {
      'Access-Control-Allow-Origin': ALLOWED.length ? origin : '*',
      'Access-Control-Allow-Methods': 'GET, OPTIONS',
      'Access-Control-Allow-Headers': '*'
    };

    if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors });
    if (ALLOWED.length && !ALLOWED.includes(origin)) return new Response('forbidden origin', { status: 403, headers: cors });
    if (request.method !== 'GET') return new Response('GET only', { status: 405, headers: cors });

    const self = new URL(request.url);
    const q = self.searchParams;
    if (TOKEN && q.get('k') !== TOKEN) return new Response('forbidden', { status: 403, headers: cors });
    // Rate limit per visitor (best effort).
    const who = request.headers.get('CF-Connecting-IP') || origin || 'anon', now = Date.now();
    const list = (hits.get(who) || []).filter(t => now - t < 60000);
    if (list.length >= PER_MINUTE) return new Response('too many requests, wait a minute', { status: 429, headers: cors });
    list.push(now); hits.set(who, list);
    if (hits.size > 5000) hits.clear();
    const target = q.get('url');
    // Some sites fill their chapter list by a POST request. MangaFlow asks for it as  &method=POST&body=...
    const post = (q.get('method') || '').toUpperCase() === 'POST';
    // ROUND 8: &ref=<chapter address> is sent as the Referer, because many picture hosts only answer requests that
    // look like they come from the manga site. Only a real http(s) address is accepted.
    let ref = null; try { const r = new URL(q.get('ref') || ''); if (/^https?:$/.test(r.protocol)) ref = r.href; } catch { /* no ref */ }
    if (!target || !/^https?:\/\//i.test(target)) return new Response('missing ?url=', { status: 400, headers: cors });
    { let tu; try { tu = new URL(target); } catch { return new Response('bad url', { status: 400, headers: cors }); }
      if (isPrivateHost(tu.hostname) || tu.hostname === self.hostname) return new Response('blocked target', { status: 403, headers: cors }); }

    try {
      const t = new URL(target);
      const init = {
        redirect: 'follow',
        headers: {
          // Looks like a normal browser so simple bot filters let the request through.
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36',
          'Accept': 'text/html,application/xhtml+xml,*/*;q=0.8',
          'Accept-Language': 'en-US,en;q=0.9',
          'Referer': ref || (t.origin + '/')
        }
      };
      if (post) {
        init.method = 'POST';
        init.body = q.get('body') || '';
        init.headers['Content-Type'] = 'application/x-www-form-urlencoded; charset=UTF-8';
        init.headers['X-Requested-With'] = 'XMLHttpRequest';
        init.headers['Origin'] = t.origin;
        init.headers['Accept'] = '*/*';
      }
      const res = await fetch(target, init);
      const ctype = res.headers.get('content-type') || '';
      if (ctype && !OK_TYPES.test(ctype)) return new Response('blocked file type: ' + ctype, { status: 415, headers: cors });
      if (+res.headers.get('content-length') > MAX_BYTES) return new Response('answer too big', { status: 413, headers: cors });
      const h = new Headers(res.headers);
      h.delete('set-cookie');                // never pass cookies of other sites on
      h.set('X-Content-Type-Options', 'nosniff');
      if (!ALLOWED.length) h.set('X-MangaFlow-Warning', 'ALLOWED is empty: anyone can use this proxy');
      Object.entries(cors).forEach(([k, v]) => h.set(k, v));
      h.delete('content-security-policy');
      h.delete('x-frame-options');
      h.delete('content-encoding');          // body is already decoded by the runtime
      return new Response(res.body, { status: res.status, headers: h });
    } catch (e) {
      return new Response('proxy error: ' + e.message, { status: 502, headers: cors });
    }
  }
};
