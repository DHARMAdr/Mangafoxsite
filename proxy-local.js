/* =====================================================================
   MangaFlow local server - proxy-local.js   (runs on YOUR computer, no account, no packages)
   WHY: Browsers block pages from reading other sites (CORS). This program does two jobs:
        1. serves MangaFlow itself at  http://localhost:8787
        2. fetches other sites for it at /proxy?url=...  (adding the header that allows it)
        Because the site and the proxy share one address, NO settings are needed - app.js detects it.
        Your home connection also passes many bot checks that block cloud proxies.
   USE: install Node.js (https://nodejs.org), then double-click start-manga.bat
        (or run:  node proxy-local.js ). A browser tab opens by itself. Keep the window open.
   LIMIT: works on the computer that runs it (not on your phone).
   SECURITY (round 7) - why a local proxy must be careful:
     Any website you visit could try to call http://localhost:8787 from your browser and use it to read
     things on your home network (your router, a printer, other PCs). So this program:
       1. refuses to fetch private / local addresses (127.x, 10.x, 192.168.x, 172.16-31.x, 169.254.x, ::1 ...)
          - the check is done on the real IP the name points to, for every redirect too;
       2. answers browsers only when the request comes from this program's own page (Origin check) or from a
          site listed in ALLOWED_ORIGINS below, and only when the Host header is localhost (stops DNS-rebinding);
       3. allows only http/https targets, caps the size of an answer and the number of requests per minute;
       4. sends safe headers with its own files (nosniff, no framing, no referrer).
     For tests only: set the environment variable MF_ALLOW_PRIVATE=1 to allow private targets.
   IMPROVE: add a small cache, an allow-list of sites, and a "stop" button.
   ===================================================================== */
const http = require('http');
const https = require('https');
const fs = require('fs');
const path = require('path');
const { exec } = require('child_process');
const net = require('net');
const dns = require('dns');
const PORT = 8787;

// SECURITY SETTINGS (round 7) -------------------------------------------------
// Extra websites that may use this proxy from a browser, e.g. ['https://yourname.github.io'].
// Leave it empty to allow only the page served by this program itself.
const ALLOWED_ORIGINS = [];
const OWN_ORIGINS = ['http://localhost:' + PORT, 'http://127.0.0.1:' + PORT];
const ALLOW_PRIVATE = process.env.MF_ALLOW_PRIVATE === '1';   // tests only
const MAX_BYTES = 80 * 1024 * 1024;       // biggest answer we pass on (a very large manga page picture)
const MAX_PER_MINUTE = 900;               // requests per minute (a 50-chapter download uses many)
const hits = [];                          // timestamps of recent requests

// Is this IP address a private / local one? (IPv4 and IPv6)
function isPrivateIp(ip) {
  if (net.isIPv6(ip)) {
    const v = ip.toLowerCase();
    if (v === '::1' || v === '::' || v.startsWith('fe80') || v.startsWith('fc') || v.startsWith('fd')) return true;
    const m = v.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/);        // IPv4 written inside IPv6
    return m ? isPrivateIp(m[1]) : false;
  }
  const p = ip.split('.').map(Number);
  if (p.length !== 4 || p.some(n => !(n >= 0 && n <= 255))) return true;   // strange = refuse
  return p[0] === 0 || p[0] === 10 || p[0] === 127 || (p[0] === 169 && p[1] === 254) ||
         (p[0] === 172 && p[1] >= 16 && p[1] <= 31) || (p[0] === 192 && p[1] === 168) ||
         (p[0] === 100 && p[1] >= 64 && p[1] <= 127) || p[0] >= 224;
}
// Used by https.request: looks the name up ITSELF and refuses private results (no gap between check and connect).
function safeLookup(host, opts, cb) {
  dns.lookup(host, opts, (err, address, family) => {
    if (err) return cb(err);
    const list = Array.isArray(address) ? address.map(a => a.address) : [address];
    if (!ALLOW_PRIVATE && list.some(isPrivateIp)) return cb(new Error('blocked: private address'));
    cb(null, address, family);
  });
}

// Only these files are served (pdfmaker.js was added in round 2) (stops anyone reading other files on your PC).
const FILES = {
  '/': 'index.html', '/index.html': 'index.html',
  '/style.css': 'style.css', '/app.js': 'app.js', '/pdfmaker.js': 'pdfmaker.js', '/chapter-slider.js': 'chapter-slider.js'   // round 10: optional slider add-on
};
const TYPES = { '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8', '.js': 'text/javascript; charset=utf-8' };

// CORS headers are built per request (see corsFor) so only allowed pages can read answers.
const CORS_BASE = {
  'Access-Control-Allow-Methods': 'GET, OPTIONS',
  'Access-Control-Allow-Headers': '*',
  'Access-Control-Allow-Private-Network': 'true',
  'Vary': 'Origin'
};
let CORS = CORS_BASE;                       // replaced for each request by the server below

// post = null for a normal GET, or { body: 'a=1&b=2' } for the POST some sites use to fill their chapter list.
function get(target, hops = 0, post = null, ref = null) {
  return new Promise((resolve, reject) => {
    const u = new URL(target);
    if (u.protocol !== 'http:' && u.protocol !== 'https:') return reject(new Error('only http/https'));
    const bare = u.hostname.replace(/^\[|\]$/g, '');
    if (!ALLOW_PRIVATE && (net.isIP(bare) ? isPrivateIp(bare) : /^(localhost|.*\.local|.*\.internal)$/i.test(bare))) return reject(new Error('blocked: private address'));
    const lib = u.protocol === 'https:' ? https : http;
    // ROUND 8: many picture hosts only answer when the request seems to come from the manga site (they check the
    // "Referer"). The page passes the chapter address as &ref=...; we send it as the Referer. Without it the
    // old behaviour (the host's own address) is used.
    const isPicture = /\.(jpe?g|png|webp|avif|gif)$/i.test(u.pathname);
    const headers = {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36',
      'Accept': isPicture ? 'image/avif,image/webp,image/apng,image/*,*/*;q=0.8' : 'text/html,application/xhtml+xml,*/*;q=0.8',
      'Accept-Language': 'en-US,en;q=0.9',
      'Referer': ref || (u.origin + '/')
    };
    if (post) {
      headers['Accept'] = '*/*';
      headers['Content-Type'] = 'application/x-www-form-urlencoded; charset=UTF-8';
      headers['Content-Length'] = Buffer.byteLength(post.body);
      headers['X-Requested-With'] = 'XMLHttpRequest';
      headers['Origin'] = u.origin;
    }
    const req = lib.request(u, { method: post ? 'POST' : 'GET', headers, lookup: safeLookup }, res => {
      if (!post && [301, 302, 303, 307, 308].includes(res.statusCode) && res.headers.location && hops < 5) {
        res.resume();
        return resolve(get(new URL(res.headers.location, target).href, hops + 1, null, ref));   // the next hop is checked again
      }
      const len = +res.headers['content-length'] || 0;
      if (len > MAX_BYTES) { res.destroy(); return reject(new Error('answer too big')); }
      resolve(res);
    });
    req.on('error', reject);
    req.setTimeout(20000, () => req.destroy(new Error('timeout')));
    if (post) req.write(post.body);
    req.end();
  });
}

async function proxy(target, res, post, ref) {
  if (!target || !/^https?:\/\//i.test(target)) { res.writeHead(400, CORS); return res.end('missing ?url='); }
  try {
    const up = await get(target, 0, post, ref);
    const headers = { ...up.headers, ...CORS };
    delete headers['content-security-policy'];
    delete headers['x-frame-options'];
    delete headers['set-cookie'];                                   // never pass cookies of other sites to the page
    res.writeHead(up.statusCode || 502, headers);
    let sent = 0;
    up.on('data', c => { sent += c.length; if (sent > MAX_BYTES) up.destroy(); });
    up.pipe(res);
    console.log(up.statusCode, target);
  } catch (e) {
    console.log('ERROR', target, e.message);
    res.writeHead(502, CORS); res.end('proxy error: ' + e.message);
  }
}

const SAFE_FILE_HEADERS = {
  'X-Content-Type-Options': 'nosniff', 'X-Frame-Options': 'DENY', 'Referrer-Policy': 'no-referrer',
  'Permissions-Policy': 'camera=(), microphone=(), geolocation=()', 'Cross-Origin-Opener-Policy': 'same-origin'
};

const server = http.createServer((req, res) => {
  // 1. Host header must be localhost (blocks DNS-rebinding attacks).
  const host = (req.headers.host || '').toLowerCase();
  if (host !== 'localhost:' + PORT && host !== '127.0.0.1:' + PORT) { res.writeHead(403); return res.end('bad host'); }
  // 2. Origin check: a browser page from another site may not use this proxy unless you listed it.
  const origin = req.headers.origin || '';
  const okOrigin = !origin || OWN_ORIGINS.includes(origin) || ALLOWED_ORIGINS.includes(origin);
  CORS = Object.assign({}, CORS_BASE, okOrigin && origin ? { 'Access-Control-Allow-Origin': origin } : {});
  if (!okOrigin) { res.writeHead(403, CORS); return res.end('forbidden origin'); }
  if (req.headers['sec-fetch-site'] === 'cross-site' && !ALLOWED_ORIGINS.includes(origin)) { res.writeHead(403, CORS); return res.end('forbidden'); }
  if (req.method === 'OPTIONS') { res.writeHead(204, CORS); return res.end(); }
  if (req.method !== 'GET') { res.writeHead(405, CORS); return res.end('GET only'); }
  // 3. Simple rate limit.
  const now = Date.now(); while (hits.length && now - hits[0] > 60000) hits.shift();
  if (hits.length >= MAX_PER_MINUTE) { res.writeHead(429, CORS); return res.end('too many requests, wait a minute'); }
  hits.push(now);
  const u = new URL(req.url, 'http://localhost');
  const target = u.searchParams.get('url');
  // A page-load of "/?url=..." is the app's share link; a fetch() of "/?url=..." is a proxy call.
  const isNavigation = req.headers['sec-fetch-dest'] === 'document';
  const post = (u.searchParams.get('method') || '').toUpperCase() === 'POST' ? { body: u.searchParams.get('body') || '' } : null;
  // &ref=<chapter address>: only a real http(s) address is accepted (anything else is ignored).
  let ref = null; try { const r = new URL(u.searchParams.get('ref') || ''); if (/^https?:$/.test(r.protocol)) ref = r.href; } catch { /* no ref */ }
  if (u.pathname === '/proxy' || (target && u.pathname === '/' && !isNavigation)) return proxy(target, res, post, ref);

  const file = FILES[u.pathname];
  if (!file) { res.writeHead(404); return res.end('not found'); }
  fs.readFile(path.join(__dirname, file), (err, data) => {
    if (err) { res.writeHead(500); return res.end('Cannot read ' + file + ' - keep all MangaFlow files in the same folder as proxy-local.js'); }
    res.writeHead(200, Object.assign({ 'Content-Type': TYPES[path.extname(file)] || 'text/plain' }, SAFE_FILE_HEADERS));
    res.end(data);
  });
});

server.on('error', e => {
  if (e.code === 'EADDRINUSE') console.log('Port ' + PORT + ' is already in use - MangaFlow is probably already running. Open http://localhost:' + PORT);
  else console.log('Server error:', e.message);
});
server.listen(PORT, '127.0.0.1', () => {
  const url = 'http://localhost:' + PORT;
  console.log('MangaFlow is running at ' + url + '  (keep this window open)');
  const cmd = process.platform === 'win32' ? 'start "" ' + url : process.platform === 'darwin' ? 'open ' + url : 'xdg-open ' + url;
  exec(cmd, () => {});
});
