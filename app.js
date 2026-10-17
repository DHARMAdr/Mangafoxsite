/* =====================================================================
   MangaFlow Reader - app.js
   Every section has:  WHY (why it exists)  |  HOW (how it works)  |  IMPROVE (how to make it better later)
   Plain English on purpose: this file is also a lesson for beginners.

   HOW THE WHOLE THING WORKS
   1. You type a URL. Browsers forbid reading other sites directly (CORS), so we ask a small
      "CORS proxy" to fetch the page's HTML for us.
   2. We show that HTML in a sandboxed iframe and intercept link clicks (a mini browser).
   3. "Reading mode" scans the page for chapter links and chapter images, then loads chapters one
      after another into a single endless scroll.
   4. At the end of the page, "Download" builds ONE PDF of every loaded chapter (pdfmaker.js).

   WHAT IS NEW IN THIS VERSION (round 2)
   - Series pages now show their chapter list (the site fills it with JavaScript, we fetch it ourselves)
     and "Read first chapter" works. Links are made safe BEFORE the page finishes loading.
   - Reading mode hides its buttons when you scroll DOWN and shows them only when you scroll UP.
   - Settings has an editable list of CORS proxies. Free ones are added automatically.
   - Arrow buttons are drawn like a keyboard's arrow cluster.
   - History remembers the exact chapter; "Continue reading" reopens it.
   - PDF download of everything loaded in reading mode.
   - Phones get a floating search bar.

   WHAT IS NEW IN ROUND 8
   - Reader keys: ONE row of round 3D buttons (reload chapter, reload all, previous, next, END). End key works too.
   - The manga title hides on scroll down like the other buttons; a search / link bar was added to reading mode.
   - A pasted manga link (or a click on a chapter) opens straight in reading mode.
   - The download dock sits above the keys, starts minimised while you read, and never stops when minimised.
   - Wider picture detection (pictures hidden in scripts, srcset), picture retry through your proxy, polite
     request speed, and BIG error pop-ups with a copyable report for every problem or blocked attack.
   ===================================================================== */
(() => {
  'use strict';

  /* ---------------------------------------------------------------
     0. SECURITY BASICS  (round 7)
     WHY: this is a browser-only site, so the protections are the ones a browser can do by itself:
          1. Anti-clickjacking: if another website shows MangaFlow inside its own frame (to trick clicks),
             we blank the page and open ourselves normally. (A header on your host is stronger, see _headers.)
          2. safeWebUrl(): only http(s) addresses are ever opened or fetched. javascript:, data:, file: ... are refused.
          3. Pages from other sites are cleaned (renderFrame) and shown in a frame WITHOUT scripts.
          4. A Content-Security-Policy in index.html stops any script that is not ours.
          5. Everything shown from the outside is written with textContent (never as HTML), so a manga title like
             "<img onerror=...>" is just text.
     IMPROVE: add a "report a problem" link, and use Subresource Integrity if you ever load a library from a CDN. */
  if (window.top !== window.self) {
    document.documentElement.innerHTML = '';
    try { window.top.location = window.self.location.href; } catch { /* a sandboxed frame may not navigate: stay blank */ }
    return;
  }
  const safeWebUrl = u => { try { const x = new URL(u); return (x.protocol === 'http:' || x.protocol === 'https:') ? x.href : null; } catch { return null; } };

  /* ---------------------------------------------------------------
     1. SMALL HELPERS
     WHY: $ / $$ shorten document.querySelector; `store` wraps localStorage in try/catch because
          it throws in private mode or when full.
     HOW: every saved value gets the prefix "mf_" so we never clash with other sites' data.
     IMPROVE: move to IndexedDB if you store lots of data (offline chapters). */
  const $ = (s, r = document) => r.querySelector(s);
  const $$ = (s, r = document) => Array.from(r.querySelectorAll(s));
  const store = {
    get(k, d) { try { const v = localStorage.getItem('mf_' + k); return v ? JSON.parse(v) : d; } catch { return d; } },
    set(k, v) { try { localStorage.setItem('mf_' + k, JSON.stringify(v)); } catch { /* ignore */ } }
  };

  /* A proxy address pasted without "?url={url}" (e.g. https://NAME.workers.dev/) is completed
     automatically. WHY: without {url} the proxy never learns which page to fetch, so every request
     failed with "Failed to fetch". */
  function fixProxy(p) {
    p = (p || '').trim();
    if (!p || p.includes('{url}')) return p;
    if (/[?&]url=$/i.test(p)) return p + '{url}';
    return p.replace(/\/+$/, '') + '/?url={url}';
  }
  // Short readable name of a proxy, e.g. "api.allorigins.win/raw". Used in lists and error messages.
  const proxyName = tpl => {
    try { const u = new URL(tpl.replace('{url}', 'x')); return u.hostname + (u.pathname.length > 1 ? u.pathname : ''); }
    catch { return tpl; }
  };
  // "example text" that people paste by mistake from the guide. We refuse to save it.
  const isExample = p => /your-worker|YOURNAME|NAME\.workers/i.test(p || '');

  /* ---------------------------------------------------------------
     2. SETTINGS + THEME
     WHY: Remember the user's theme, width, button side and proxy list between visits.
     HOW: `settings` starts with defaults, then saved values are copied over it.
          The proxy list is filled with the free defaults the FIRST time the site is opened
          (or when upgrading from the old one-proxy setting). After that the list is the user's own:
          removing a default does not bring it back, and "Reset to defaults" restores it.
     IMPROVE: add font/zoom, "auto-start reading mode" and image-quality options. */
  const DEFAULT_PROXIES = [
    // NOTE: free public proxies come and go (corsproxy.io now needs a paid key, thingproxy is gone).
    // Treat these as a best-effort fallback only; your own proxy (worker.js) is the reliable route.
    // They can only do simple GET requests (no POST), see proxyList() below.
    'https://api.allorigins.win/raw?url={url}',
    'https://api.codetabs.com/v1/proxy/?quest={url}'
  ];
  const settings = Object.assign({
    proxies: null, width: 820, side: 'right', theme: 'light', arrowKeys: true, tapScroll: true,
    autoRead: true,       // round 8: a pasted manga link opens straight in reading mode
    ver: 0,               // round 8: settings version (used for one-time upgrades below)
    pdfMode: 'small',     // round 10: 'small' = WebP/GIF pages become JPEG 92% (default), 'lossless' = pixel-perfect but 5-10x bigger
    autoFree: 0,          // round 7: clear chapters more than N behind you (0 = off)
    noHistory: false,     // round 7: do not save reading history
    wipeOnClose: false    // round 7: erase history + cache when the tab closes
  }, store.get('settings', {}));
  // ROUND 8 one-time upgrade: the reader keys now live in the LEFT corner. Older saved settings said "right", so
  // switch once (you can still change it back in Settings, and it is not forced again).
  if (settings.ver < 8) { settings.side = 'left'; settings.ver = 8; }
  if (settings.ver < 9) { settings.side = 'right'; settings.ver = 9; }
  if (settings.ver < 10) { settings.pdfMode = 'small'; settings.ver = 10; }       // round 10: lossless made 1 GB for 15 chapters          // round 9: the keys live in the RIGHT corner

  if (!Array.isArray(settings.proxies)) {
    settings.proxies = [];
    const old = fixProxy(settings.proxy);                 // the single proxy saved by the older version
    if (old && !isExample(old)) settings.proxies.push(old);   // keep the user's own proxy, first in the list
    DEFAULT_PROXIES.forEach(p => settings.proxies.push(p));   // then add the free ones automatically
  }
  delete settings.proxy;                                  // old single-proxy field is retired
  settings.proxies = Array.from(new Set(settings.proxies.map(fixProxy).filter(p => p && !isExample(p))));

  function applySettings() {
    document.documentElement.dataset.theme = settings.theme;
    document.documentElement.style.setProperty('--w', settings.width + 'px');
    document.body.dataset.side = settings.side;
    const meta = $('meta[name="theme-color"]');
    if (meta) meta.content = settings.theme === 'dark' ? '#000000' : '#ffffff';
    store.set('settings', settings);
  }
  function toggleTheme() {                       // pure white  <->  pure black
    settings.theme = settings.theme === 'dark' ? 'light' : 'dark';
    applySettings();
  }

  /* ---------------------------------------------------------------
     3. FETCHING PAGES THROUGH A CORS PROXY
     WHY: Without a proxy the browser blocks the request. We ask ALL proxies at the same time and the
          first good answer wins, with a timeout so a dead proxy cannot freeze the app.
          `{url}` is replaced by the encoded page address.
     HOW: proxyList() builds the list. The local launcher (localhost:8787) is added automatically when
          the site is opened from it. POST requests (used for chapter lists) only go to proxies that
          are NOT in the free default list, because free public proxies cannot POST.
     IMPROVE: remember which proxy succeeded last and ask it first; retry with back-off. */
  const cache = new Map();                       // url -> html (so going back / re-reading is instant)

  function proxyList(forPost) {
    const local = /^(localhost|127\.0\.0\.1)$/.test(location.hostname) ? [location.origin + '/proxy?url={url}'] : [];
    if (forPost) return [...local, ...settings.proxies.filter(p => !DEFAULT_PROXIES.includes(p))];
    return [...local, ...settings.proxies];
  }

  /* Ask ONE proxy. Returns the HTML or throws an Error whose message says what went wrong
     (HTTP code, timeout, blocked page). */
  async function askProxy(tpl, url, opt = {}) {
    const host = proxyName(tpl);
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 15000);
    try {
      let full = tpl.replace('{url}', encodeURIComponent(url));
      // POST requests are made by the proxy (browser -> proxy stays a plain GET, so no CORS preflight).
      if (opt.post) full += (full.includes('?') ? '&' : '?') + 'method=POST&body=' + encodeURIComponent(opt.body || '');
      const res = await fetch(full, { signal: ctrl.signal });
      if (!res.ok) throw new Error('HTTP ' + res.status);
      const text = await res.text();
      if (text.length < 200 || !/<html|<body|<!doctype|<div|<a\s/i.test(text)) throw new Error('empty reply');
      // Cloudflare / bot-check pages come back "200 OK" but contain no manga, so treat them as failures.
      if (/Just a moment\.\.\.|cf-browser-verification|Attention Required! \| Cloudflare|challenge-platform/i.test(text) && !/<img[^>]+\.(jpe?g|png|webp)/i.test(text))
        throw new Error('blocked by bot check');
      return text;
    } catch (e) {
      throw new Error(host + ': ' + (e.name === 'AbortError' ? 'timed out after 15s' : e.message));
    } finally { clearTimeout(timer); }
  }

  async function fetchHTML(url, opt = {}) {
    const key = opt.post ? 'POST ' + url + ' ' + (opt.body || '') : url;
    if (cache.has(key)) return cache.get(key);
    const list = proxyList(!!opt.post);
    if (!list.length) throw new Error(opt.post
      ? 'this needs your own proxy (Settings) or start-manga.bat'
      : 'no proxy is set. Open Settings and add one, or press "Reset to defaults".');
    const gateKey = 'p:' + hostOf(url);
    const release = await gate(gateKey, 4, 150);        // round 8: polite - a few page requests at a time per site
    try {
      const text = await Promise.any(list.map(tpl => askProxy(tpl, url, opt)));
      if (cache.size > 40) cache.delete(cache.keys().next().value);   // keep memory small
      cache.set(key, text);
      return text;
    } catch (agg) {
      const why = (agg.errors || [agg]).map(e => e.message).join(' | ');
      const tip = location.protocol === 'file:'
        ? '. Tip: you opened this as a file. Double-click start-manga.bat (needs Node.js) and use the page it opens at http://localhost:8787.'
        : '. Tip: run start-manga.bat, or add your own proxy in Settings (see MANGAFLOW.md).';
      if (/HTTP 429|HTTP 503/.test(why)) coolDown(gateKey, 8000);   // the site said "too many requests": everybody waits
      throw new Error('no proxy could load it — ' + why + tip);
    } finally { release(); }
  }

  /* Parse HTML into a document and work out its <base href>.
     WHY: DOMParser builds a DOM we can query (links, images) without running the site's scripts. */
  async function fetchDoc(url) {
    const html = await fetchHTML(url);
    const doc = new DOMParser().parseFromString(html, 'text/html');
    let base = url;
    const b = doc.querySelector('base[href]');
    if (b) { try { base = new URL(b.getAttribute('href'), url).href; } catch { /* keep url */ } }
    return { doc, base };
  }

  /* ---------------------------------------------------------------
     4. URL HELPERS
     WHY: absUrl turns "/ch/12" into a full address; normalizeInput decides if the user typed a
          URL or a search; unwrap removes DuckDuckGo's redirect wrapper from search results.
     IMPROVE: let users pick a search engine; handle sites that need a "Referer" or cookies. */
  const absUrl = (u, base) => { try { return new URL(u, base).href; } catch { return null; } };
  const sameUrl = (a, b) => a.split('#')[0].replace(/\/$/, '') === b.split('#')[0].replace(/\/$/, '');
  const hostOf = u => { try { return new URL(u).hostname.replace(/^www\./, ''); } catch { return ''; } };
  // "example.com/manga/title" - short text for the search pill and history lines.
  const shortUrl = u => { try { const x = new URL(u); return x.hostname.replace(/^www\./, '') + (x.pathname.length > 1 ? x.pathname : ''); } catch { return u; } };

  function normalizeInput(s) {
    s = (s || '').trim();
    if (!s) return null;
    if (/^https?:\/\//i.test(s)) return s;
    if (/^[\w-]+(\.[\w-]+)+(\/\S*)?$/.test(s)) return 'https://' + s;          // looks like example.com/path
    return 'https://html.duckduckgo.com/html/?q=' + encodeURIComponent(s + ' manga');   // otherwise: search
  }
  function unwrap(u) {
    try {
      const x = new URL(u);
      if (/duckduckgo\.com$/.test(x.hostname) && x.pathname.startsWith('/l/')) {
        const t = x.searchParams.get('uddg'); if (t) return t;
      }
    } catch { /* ignore */ }
    return u;
  }

  /* ---------------------------------------------------------------
     5. ERRORS (BIG POP-UP), TOAST, BUSY, LOADING BAR   (rewritten in round 8)
     WHY: slow proxies feel broken without feedback, and a problem that is only a tiny red line is easy to miss.
          Round 8 turns every problem into a BIG pop-up in the middle of the screen (a modal <dialog>) with
            1. a title and the problem in one plain sentence,
            2. a hint that says what you can do,
            3. a full report you can copy and send to Claude (page address, proxies, what was happening, browser).
     HOW: showError(message, { title, hint, details }) builds the pop-up. explain(message) picks the title and hint
          by looking for key words (bot check, 403, "no images" ...). The same message is not shown again for
          8 seconds, so one broken site cannot bury you in pop-ups. If a pop-up is already open, new problems are
          added to its report instead of opening another one.
          The error handlers at the very bottom of this file (section 16) send EVERY unexpected crash here too.
     IMPROVE: add a "Retry" button that repeats the action that failed, and a "download report" button. */
  const errSeen = new Map();                      // message -> time it was last shown (to stop pop-up floods)

  function explain(msg) {
    const m = msg || '';
    if (/bot check|cloudflare|just a moment|HTTP 40[13]|HTTP 429|HTTP 503|did not let MangaFlow in|slowing down/i.test(m))
      return { title: '\u{1F6AB} The site is blocking MangaFlow',
        hint: 'This site uses bot protection or limits how fast pages can be read. MangaFlow already reads politely (only a few requests at a time, with small pauses) and it does NOT try to get around protection checks. What you can do: wait a few minutes and press Retry, run start-manga.bat (your own home connection is trusted more than a cloud proxy), add your own proxy in Settings, or open the chapter in your normal browser.' };
    if (/LOCKED|login, coins/i.test(m))
      return { title: '\u{1F512} This chapter looks locked',
        hint: 'The page asks for a login, coins or a premium account before it shows the pictures. MangaFlow cannot log in for you and does not bypass that. If you own access, read this chapter on the site itself. Chapters that are free still work. The report below shows what the page contained.' };
    if (/no chapters or chapter images|no images found|no pictures found/i.test(m))
      return { title: '\u{1F5BC} No chapters or pictures found',
        hint: 'The page loaded, but this site builds its chapters or pictures with JavaScript (or hides them), so MangaFlow could not see them. Copy the report below and send it to Claude together with the address of the site: it can be added as a special rule. The report already says what was (and was not) found on the page.' };
    if (/no proxy could load|no proxy is set|failed to fetch|networkerror|timed out|empty reply/i.test(m))
      return { title: '\u{1F310} Could not reach the page',
        hint: 'No proxy could fetch the page. Free public proxies are slow and often blocked. Run start-manga.bat (needs Node.js) or add your own free Cloudflare proxy (worker.js) in Settings. Then try again.' };
    if (/allocation|out of memory|quota|array buffer|memory/i.test(m))
      return { title: '\u{1F4BE} Not enough memory',
        hint: 'The device ran out of memory while making the PDF. Download fewer chapters per file (choose "a new file every 25 chapters" in the download window), or use Settings > "JPEG 98%".' };
    if (/pdf|download|could not be downloaded|pages? (are|is) missing/i.test(m))
      return { title: '⬇ Download problem',
        hint: 'The PDF could not be finished completely. The list below says which chapters or pages failed. You can press Retry (start the download again) for just those chapters. Reading mode is not affected.' };
    if (/browser blocked|security/i.test(m))
      return { title: '\u{1F6E1} Security protection triggered',
        hint: 'MangaFlow only runs its own code. Something tried to load or run code that is not allowed and the browser stopped it. That is the protection working. If you do not use a browser add-on that does this, close the page and send this report to Claude.' };
    return { title: '⚠ Something went wrong',
      hint: 'Copy the report below and send it to Claude. It lists what happened and where.' };
  }

  function showError(msg, extra = {}) {
    msg = String(msg || 'Unknown problem');
    const now = Date.now();
    if (errSeen.get(msg) && now - errSeen.get(msg) < 8000) return;      // same problem again very soon: ignore
    errSeen.set(msg, now);
    if (errSeen.size > 60) errSeen.delete(errSeen.keys().next().value);
    const ex = explain(msg);
    const openJobs = typeof jobs !== 'undefined' ? jobs.map(j => '#' + j.id + ' ' + j.status + ' ' + (j.pct || 0) + '% "' + (j.text || '') + '"').join(' | ') : '';
    const report = [
      'MangaFlow error report (round 8)',
      'Time: ' + new Date().toString(),
      'Problem: ' + msg,
      'App page: ' + location.href,
      'Manga page open: ' + (typeof cur !== 'undefined' && cur ? cur.url : '-'),
      'Reading: ' + (typeof R !== 'undefined' && R.chapters && R.chapters.length ? R.title + ' | chapter ' + (R.cur + 1) + ' of ' + R.chapters.length : 'not reading'),
      'Downloads: ' + (openJobs || 'none'),
      'Proxies: ' + (settings.proxies.length ? settings.proxies.map(proxyName).join(', ') : 'NONE'),
      'Browser: ' + navigator.userAgent,
      extra.details ? '\nDetails:\n' + extra.details : ''
    ].join('\n');
    const box = $('#errbox');
    if (box.open) { $('#errText').value += '\n\n----- another problem -----\n' + report; return; }   // already on screen: add to it
    $('#errTitle').textContent = extra.title || ex.title;
    $('#errSummary').textContent = msg.length > 320 ? msg.slice(0, 320) + '…' : msg;
    $('#errHint').textContent = extra.hint || ex.hint;
    $('#errText').value = report;
    try { box.showModal(); } catch { box.setAttribute('open', ''); }
  }
  let toastTimer;
  function toast(msg, isErr, extra) {
    if (isErr) { showError(msg, extra); return; }
    const t = $('#toast');
    t.textContent = msg; t.className = 'show';
    clearTimeout(toastTimer); toastTimer = setTimeout(() => { t.className = ''; }, 3200);
  }
  function setBusy(msg) {
    const b = $('#busy');
    if (!msg) { b.hidden = true; return; }
    b.hidden = false; b.textContent = msg;
  }
  const setLoading = on => $('#loadbar').classList.toggle('on', on);

  /* A site that says "no" (403 / 429 / bot check) gets ONE pop-up per minute, not one per chapter. */
  const blockedSeen = new Map();
  function reportBlocked(url, msg) {
    const h = hostOf(url), now = Date.now();
    if (now - (blockedSeen.get(h) || 0) < 60000) return;
    blockedSeen.set(h, now);
    showError('The site ' + h + ' did not let MangaFlow in: ' + msg);
  }

  /* Everything we know about a page that gave no chapters/pictures. It goes into the error report so the problem
     can be fixed for that site afterwards. */
  function diagnose(doc, base) {
    const html = (doc.documentElement && doc.documentElement.outerHTML || '');
    const text = ((doc.body && doc.body.textContent) || '').replace(/\s+/g, ' ').trim();
    return [
      'page title: ' + (doc.title || '-'),
      '<img> tags: ' + doc.querySelectorAll('img').length,
      '<script> tags: ' + doc.querySelectorAll('script').length,
      'picture addresses found inside scripts: ' + fromScripts(doc, base).length,
      'looks like a JavaScript app (React / Next / Vue): ' + !!doc.querySelector('#__next, #root, #app, #__nuxt, [data-reactroot]'),
      'visible text length: ' + text.length,
      'Next.js data present (__NEXT_DATA__): ' + !!doc.querySelector('script#__NEXT_DATA__'),
      'ts_reader (MangaStream theme) present: ' + /ts_reader/.test(html),
      'og:image / twitter:image: ' + (metaImageSamples(doc, base).join(' , ') || '-'),
      'first <img> addresses: ' + (Array.from(doc.querySelectorAll('img')).slice(0, 6).map(i => i.getAttribute('src') || i.getAttribute('data-src') || '?').join(' , ') || '-'),
      'script files: ' + (Array.from(doc.querySelectorAll('script[src]')).slice(0, 6).map(x => x.getAttribute('src')).join(' , ') || '-'),
      'page says "loading": ' + /loading chapter|loading\.\.\./i.test(text) + ' | says "not available": ' + /not available|removed|deleted/i.test(text),
      'lock / login words found: ' + LOCK_RE.test(text),
      'prev/next links found: ' + JSON.stringify(findNavLinks(doc, base, base)),
      'api hints inside scripts: ' + (Array.from(new Set((html.match(/\/api\/[a-z0-9_\/-]{3,40}/gi) || []))).slice(0, 5).join(', ') || '-'),
      'bot-check words found: ' + /just a moment|cf-browser-verification|challenge-platform|captcha/i.test(html.slice(0, 40000)),
      'first 300 characters of text: ' + text.slice(0, 300)
    ].join('\n');
  }

  /* ---------------------------------------------------------------
     5b. POLITE REQUESTS (round 8)
     WHY: a site notices a reader that asks for 50 pictures in the same second. Reading like a person (a few requests
          at a time, small pauses) is kinder to the site and much less likely to get you blocked.
     HOW: gate(key, max, gap) hands out a "ticket". Only `max` tickets per key (one key per website) can be open at
          once and two tickets are at least `gap` ms apart (plus a random extra, so it does not look like a clock).
          When a site answers 429 / 503 ("too many requests") coolDown() makes everybody wait first.
     LIMIT: this makes blocks LESS likely, it cannot promise they never happen. We never try to break bot checks.
     IMPROVE: make the numbers settings; slow down automatically after each refusal. */
  const gates = new Map();
  async function gate(key, max, gap, job) {
    let g = gates.get(key);
    if (!g) { g = { active: 0, last: 0, cool: 0 }; gates.set(key, g); }
    for (;;) {
      if (job && job.cancel) throw new Error('cancelled');
      const now = Date.now();
      if (g.active < max && now >= g.cool && now - g.last >= gap) {
        g.active++; g.last = now + Math.random() * gap;              // random extra delay = not a perfect clock
        let done = false;
        return () => { if (!done) { done = true; g.active--; } };
      }
      await new Promise(r => setTimeout(r, 40));
    }
  }
  const coolDown = (key, ms) => { const g = gates.get(key); if (g) g.cool = Math.max(g.cool, Date.now() + ms); };

  /* ---------------------------------------------------------------
     6. HISTORY: RECENT PAGES, CONTINUE READING, BOOKMARKS (start page)
     WHY: lets users return to a manga quickly without retyping the address, and (new) go back to
          the EXACT chapter they were reading.
     HOW: three saved lists.
          recent = pages you opened          { url, title, host, at }
          reads  = manga you were reading    { id, title, host, seriesUrl, chapterUrl, chapterLabel, at }
          books  = your bookmarks            { url, title }
          `at` is a time in milliseconds; timeAgo() turns it into "3 h ago".
     IMPROVE: sync to a cloud database so history follows the user between devices; store the scroll
              position inside the chapter too. */
  let recent = store.get('recent', []);
  let books = store.get('books', []);
  let reads = store.get('reads', []);

  function timeAgo(t) {
    if (!t) return '';
    const s = Math.max(0, (Date.now() - t) / 1000);
    if (s < 60) return 'just now';
    if (s < 3600) return Math.floor(s / 60) + ' min ago';
    if (s < 86400) return Math.floor(s / 3600) + ' h ago';
    return Math.floor(s / 86400) + ' d ago';
  }
  function addRecent(url, title) {
    if (settings.noHistory) return;                   // privacy option (Settings > Security)
    recent = [{ url, title: (title || url).slice(0, 80), host: hostOf(url), at: Date.now() }, ...recent.filter(r => r.url !== url)].slice(0, 20);
    store.set('recent', recent);
  }
  function saveRead(info) {              // newest first, one entry per manga (same id replaces the old one)
    if (settings.noHistory) return;
    reads = [info, ...reads.filter(r => r.id !== info.id)].slice(0, 30);
    store.set('reads', reads);
  }

  // One history row = bold title + small grey line. WHY: more information than just the page name.
  function item(title, sub, onclick, tip) {
    const b = document.createElement('button');
    b.className = 'item'; b.title = tip || '';
    // ROUND 10: a coloured letter tile (colour made from the title, so a manga always has the same colour) + the two text lines.
    const av = document.createElement('span'); av.className = 'av'; av.textContent = (String(title || '?').trim()[0] || '?').toUpperCase();
    let hue = 0; for (const ch of String(title || '')) hue = (hue * 31 + ch.charCodeAt(0)) % 360;
    av.style.background = 'hsl(' + hue + ',55%,45%)';
    const tx = document.createElement('span'); tx.className = 'tx';
    const t = document.createElement('span'); t.className = 't'; t.textContent = title;
    const s = document.createElement('span'); s.className = 's'; s.textContent = sub;
    tx.append(t, s); b.append(av, tx); b.onclick = onclick;
    return b;
  }
  /* STATUS CHIPS on the start page (round 10): one glance tells which proxy route you have and whether the slider add-on is linked.
     WHY: most "cannot load" problems are proxy problems. HOW: reads settings + location only, changes nothing. */
  function renderStatus() {
    const box = $('#statusChips'); if (!box) return;
    box.innerHTML = '';
    const local = /^(localhost|127\.0\.0\.1)$/.test(location.hostname), own = settings.proxies.some(p => !DEFAULT_PROXIES.includes(p));
    const chip = (text, fn) => { const x = document.createElement('button'); x.type = 'button'; x.className = 'chip2'; x.textContent = text; if (fn) x.onclick = fn; box.appendChild(x); };
    chip(local ? '\u{1F7E2} Local launcher (best)' : own ? '\u{1F7E2} Your own proxy' : '\u{1F7E0} Free proxies only (slow, often blocked)', () => openSettings(false));
    chip(window.MangaFlowSlider ? '\u2194 Chapter slider on' : '\u2194 Chapter slider off', null);
    chip('\u2699 Settings', () => openSettings(false));
  }
  function renderStart() {
    renderStatus();
    const fill = (arr, el, empty, make) => {
      el.innerHTML = '';
      if (!arr.length) { el.innerHTML = '<span class="muted small">' + empty + '</span>'; return; }
      arr.forEach(it => el.appendChild(make(it)));
    };
    fill(reads, $('#readList'), 'Nothing yet. Read a manga and it will appear here.',
      r => item(r.title, [r.host, r.chapterLabel, timeAgo(r.at)].filter(Boolean).join(' · '), () => continueReading(r), r.chapterUrl));
    fill(recent, $('#recentList'), 'Nothing yet.',
      r => item(r.title || r.url, [r.host || hostOf(r.url), timeAgo(r.at)].filter(Boolean).join(' · '), () => navigate(r.url), r.url));
    fill(books, $('#bookList'), 'Tap the star in the address bar to bookmark a page.',
      b => item(b.title || b.url, hostOf(b.url), () => navigate(b.url), b.url));
  }
  function toggleBookmark() {
    if (!cur) return;
    const i = books.findIndex(b => b.url === cur.url);
    if (i >= 0) books.splice(i, 1); else books.unshift({ url: cur.url, title: (cur.doc.title || cur.url).slice(0, 80) });
    store.set('books', books); updateNav(); renderStart();
  }
  // Open the saved chapter page, then start reading mode straight away.
  async function continueReading(r) {
    await navigate(r.chapterUrl);
    if (cur && sameUrl(cur.url, r.chapterUrl)) startReading();
  }

  /* ---------------------------------------------------------------
     7. MINI BROWSER (address bar, back/forward, iframe)
     WHY: shows the other website so the user can search/open a manga and choose a chapter.
          We sanitise the HTML (remove scripts, inline handlers) before putting it in the iframe.
     IMPROVE: many modern sites render content with JavaScript and will look empty here. A
              server-side headless browser (Puppeteer) behind your proxy would fix that. */
  const frame = $('#frame');
  let cur = null;                  // { url, base, doc, chapters, listHtml, token } - the page currently shown
  let hist = [], hi = -1;          // our own back/forward stack
  let renderCount = 0;             // gives every render a unique "token" so we can recognise the right document

  function fixLazy(d) {            // lazy-load sites keep the real image in data-* attributes
    const attrs = ['data-src', 'data-lazy-src', 'data-original', 'data-url', 'data-lazy'];
    d.querySelectorAll('img').forEach(img => {
      for (const a of attrs) { const v = img.getAttribute(a); if (v) { img.setAttribute('src', v); break; } }
      const ss = img.getAttribute('data-srcset'); if (ss) img.setAttribute('srcset', ss);
      img.setAttribute('referrerpolicy', 'no-referrer');
    });
  }

  /* LINKS MADE SAFE BEFORE THE PAGE LOADS  (fixes "manhuatop.org refused to connect")
     WHY: the iframe only fires its "load" event after EVERY picture on the page has finished. Before
          that, our click handler did not exist yet, so a quick click on "Read first chapter" made the
          iframe open the real website inside itself. Real sites forbid that, so Chrome showed
          "refused to connect".
     HOW: every link gets its real address stored in a data-mf-href attribute and its href is changed to
          "#mf". A click then can never leave the page, even if our handler is not attached yet.
          Forms get action="about:blank" for the same reason. Calling this twice is harmless.
     IMPROVE: show the real address in a tooltip (title attribute) on desktop. */
  function neutralizeLinks(d, base) {
    d.querySelectorAll('a[href]').forEach(a => {
      if (a.dataset.mfHref) { a.setAttribute('href', '#mf'); a.removeAttribute('target'); return; }   // already done / set by shortcuts
      const href = a.getAttribute('href') || '';
      if (!href || href.startsWith('#')) return;                       // in-page anchor: let it scroll
      if (/^(javascript|mailto|tel):/i.test(href)) { a.setAttribute('href', '#mf'); return; }
      const u = absUrl(href, base); if (!u) return;
      a.dataset.mfHref = unwrap(u);
      a.setAttribute('href', '#mf'); a.removeAttribute('target');
    });
    d.querySelectorAll('form').forEach(f => {
      if ('mfAction' in f.dataset) return;
      f.dataset.mfAction = f.getAttribute('action') || '';
      f.setAttribute('action', 'about:blank'); f.removeAttribute('target');
    });
  }

  /* SERIES PAGE: put the chapter list back
     WHY: on sites built with the WordPress "Madara" theme (manhuatop.org and many more) the chapter list
          is empty in the downloaded HTML. The site's own JavaScript fills it in later, but scripts are
          removed in our iframe, so the list never appeared.
     HOW: enhanceSeriesPage() asks the site for the list (ajaxChapterList) and keeps the answer in
          `page.chapters` (clean list) and `page.listHtml` (the site's own list markup).
          injectChapters() puts that markup into the site's list box so it looks like the real site.
          If the page has no such box, a simple list is added instead.
     IMPROVE: add a "newest first / oldest first" switch to the fallback list. */
  function injectChapters(d, page) {
    const list = page.chapters;
    if (!list || !list.length || !page.listHtml) return;             // nothing to add, or the page already had its own list
    if (d.querySelector('[data-mf-done]')) return;                    // already added (this function can run twice)

    const holder = d.querySelector('#manga-chapters-holder');
    if (holder) {
      const tmp = d.createElement('div');
      tmp.innerHTML = page.listHtml;
      tmp.querySelectorAll('script,iframe,object,embed,style').forEach(n => n.remove());       // never trust other sites' code
      tmp.querySelectorAll('*').forEach(el => Array.from(el.attributes).forEach(a => { if (/^on/i.test(a.name)) el.removeAttribute(a.name); }));
      const target = holder.querySelector('.page-content-listing') || holder;
      target.innerHTML = '';
      while (tmp.firstChild) target.appendChild(tmp.firstChild);
      holder.removeAttribute('hidden'); holder.style.display = '';
      holder.dataset.mfDone = '1';
      return;
    }
    // Fallback panel for pages without a chapter box.
    const box = d.createElement('section');
    box.id = 'mf-chapters'; box.dataset.mfDone = '1';
    const css = d.createElement('style');
    css.textContent = '#mf-chapters{max-width:900px;margin:16px auto;padding:12px 16px;font:15px system-ui,sans-serif;border:1px solid #8884;border-radius:10px}' +
      '#mf-chapters h2{margin:0 0 8px;font-size:1.1rem}#mf-chapters ul{list-style:none;margin:0;padding:0;max-height:60vh;overflow:auto}' +
      '#mf-chapters li{border-top:1px solid #8883}#mf-chapters a{display:block;padding:10px 4px;color:inherit;text-decoration:none}';
    const h = d.createElement('h2'); h.textContent = 'Chapters (' + list.length + ')';
    const ul = d.createElement('ul');
    list.slice().reverse().forEach(c => {                              // newest first, like the real sites
      const li = d.createElement('li'), a = d.createElement('a');
      a.textContent = c.title && c.title.length < 80 ? c.title : 'Chapter ' + fmtNum(c.num);
      a.setAttribute('href', '#mf'); a.dataset.mfHref = c.url;
      li.appendChild(a); ul.appendChild(li);
    });
    box.append(css, h, ul);
    const host = d.querySelector('main, #content, .site-content, .container');
    if (host) host.appendChild(box); else d.body.insertBefore(box, d.body.firstChild);
  }

  /* "Read first chapter" / "Read last chapter" buttons.
     WHY: on the real site these links are filled in by JavaScript, so in our copy they point nowhere.
     HOW: find links by their words or class and point them at the first / last chapter of the list. */
  function fixShortcuts(d, list) {
    if (!list || !list.length) return;
    const first = list[0], last = list[list.length - 1];             // the list is sorted: chapter 1 first
    d.querySelectorAll('a').forEach(a => {
      const txt = (a.textContent || '').replace(/\s+/g, ' ').trim();
      const idc = (a.id || '') + ' ' + (typeof a.className === 'string' ? a.className : '');
      let target = null;
      if (/read\s*first|first\s*chapter|start\s*reading|btn-read-first/i.test(txt + ' ' + idc)) target = first;
      else if (/read\s*last|last\s*chapter|latest\s*chapter|newest\s*chapter|btn-read-last/i.test(txt + ' ' + idc)) target = last;
      if (target) a.dataset.mfHref = target.url;                       // neutralizeLinks() turns href into "#mf"
    });
  }

  function renderFrame(doc, base) {
    const d = doc.cloneNode(true);
    // CLEANING (security): remove everything that could run code, load plug-ins, or redirect the frame.
    d.querySelectorAll('script,iframe,frame,frameset,object,embed,applet,noscript,base,meta[http-equiv],link[rel~="import"],link[rel~="prefetch"],link[rel~="preload"],link[rel~="modulepreload"]').forEach(n => n.remove());
    d.querySelectorAll('*').forEach(el => {
      for (const a of Array.from(el.attributes)) {
        const n = a.name.toLowerCase(), v = a.value.replace(/[\u0000-\u0020]+/g, '').toLowerCase();
        if (n.startsWith('on')) el.removeAttribute(a.name);                                   // onclick="..." etc.
        else if (/^(href|src|action|formaction|xlink:href|data|poster|srcset)$/.test(n) && /^(javascript|vbscript|data:text\/html)/.test(v)) el.removeAttribute(a.name);
      }
    });
    fixLazy(d);
    if (cur && cur.chapters && cur.chapters.length) { injectChapters(d, cur); fixShortcuts(d, cur.chapters); }   // known already (e.g. page reload)
    neutralizeLinks(d, base);
    const head = d.head || d.documentElement.insertBefore(d.createElement('head'), d.body);
    const b = d.createElement('base'); b.href = base;                    // makes relative links/images work
    const sec = d.createElement('meta'); sec.httpEquiv = 'Content-Security-Policy';           // second lock inside the frame: no scripts, plug-ins or form posts
    sec.content = "script-src 'none'; object-src 'none'; form-action 'none'";
    const m = d.createElement('meta'); m.name = 'referrer'; m.content = 'no-referrer';
    const token = String(++renderCount);                                 // marker so hookFrame() knows when THIS document exists
    const tk = d.createElement('meta'); tk.name = 'mf-token'; tk.content = token;
    head.prepend(tk); head.prepend(m); head.prepend(sec); head.prepend(b);
    if (cur) cur.token = token;
    frame.srcdoc = '<!doctype html>' + d.documentElement.outerHTML;
    hookFrame(token);
  }

  /* Connect our click / form handlers to the iframe document AS SOON AS it exists.
     WHY: waiting for the iframe "load" event is too late on slow pages (see neutralizeLinks).
     HOW: check every 50 ms for our token meta tag; stop after about 5 seconds. The "load" event below is a backup. */
  function hookFrame(token) {
    let tries = 0;
    const t = setInterval(() => {
      const d = frame.contentDocument;
      const mark = d && d.head && d.querySelector('meta[name="mf-token"]');
      if (mark && mark.content === token) { clearInterval(t); hookDoc(d); }
      else if (++tries > 100) clearInterval(t);
    }, 50);
  }
  function hookDoc(d) {
    if (!d || d.mfHooked) return;
    d.mfHooked = true;                                                   // never attach twice to the same document
    d.addEventListener('click', onFrameClick, true);
    d.addEventListener('auxclick', e => { if (e.target.closest && e.target.closest('a')) e.preventDefault(); }, true);   // middle click
    d.addEventListener('submit', onFrameSubmit, true);
    d.addEventListener('securitypolicyviolation', onSecurityViolation);   // round 8: a script of the page was stopped -> tell the person
    applyLive(d);
  }
  frame.addEventListener('load', () => hookDoc(frame.contentDocument));  // backup

  // Put the chapter list / shortcuts into the document that is on screen right now.
  function applyLive(d) {
    if (!cur || !cur.chapters || !cur.chapters.length) return;
    const mark = d.querySelector('meta[name="mf-token"]');
    if (!mark || mark.content !== cur.token) return;                     // the frame shows another page: ignore
    injectChapters(d, cur); fixShortcuts(d, cur.chapters); neutralizeLinks(d, cur.base);
  }

  function onFrameClick(e) {
    const a = e.target.closest && e.target.closest('a'); if (!a || !cur) return;
    const mf = a.dataset.mfHref;
    const href = a.getAttribute('href') || '';
    if (!mf && (!href || href.startsWith('#'))) return;                  // in-page anchor: let it scroll
    e.preventDefault();
    if (mf && isChapterLinkOfCurrent(mf)) return readFrom(mf);            // round 8: a chapter link starts reading at once
    if (mf) return navigate(mf);
    if (/^(javascript|mailto|tel|data|vbscript|file|blob):/i.test(href.trim())) return;     // never follow these
    const u = absUrl(href, cur.base); if (u) navigate(unwrap(u));
  }
  function onFrameSubmit(e) {
    e.preventDefault();
    const f = e.target; if (!f || !cur) return;
    if ((f.getAttribute('method') || 'get').toLowerCase() !== 'get') return;     // only simple search forms
    let u; try { u = new URL(f.dataset.mfAction || f.getAttribute('action') || cur.url, cur.base); } catch { return; }
    new FormData(f).forEach((v, k) => { if (typeof v === 'string') u.searchParams.set(k, v); });
    navigate(u.href);
  }

  // Address bar text lives in three places: the wide input, the phone popup input and the phone pill.
  function setAddress(url) {
    $('#addr').value = url; $('#addr2').value = url; $('#rdAddr').value = url;
    $('#pillText').textContent = url ? shortUrl(url) : 'Search or paste a link';
    // ROUND 9b: boxes filled by code send no "input" event, so show/hide their clear (x) buttons here.
    $$('.clearx').forEach(b => { b.hidden = !$('#' + b.dataset.for).value; });
  }

  /* OPENING A PAGE  (round 8: can go straight into reading mode)
     WHY: before, pasting the address of a manga's main page only showed the site's page; you had to press
          "Reading mode" or edit the link to ".../chapter-1". Now a link you PASTE or TYPE (opts.user) is checked
          after it loads: if it is a manga page (chapter pictures, or a chapter list of its own) reading mode
          starts by itself, from the chapter you stopped at last time (history) or from chapter 1.
     HOW: navigate() loads and shows the page, then starts enhanceSeriesPage() (fetches hidden chapter lists).
          tryAutoRead() waits for that, decides "is this a manga?" and calls startReading({ quiet: true }).
          quiet = no error pop-up when it does not work out (the page simply stays open for you to choose).
          The site's front page, search results and pages with no chapters are never auto-read.
          Turn it off in Settings ("Open a manga link straight in reading mode").
     RETURNS: true when the page was loaded (so the reader bar can go back to reading when it was not). */
  async function navigate(input, push = true, opts = {}) {
    const url = safeWebUrl(normalizeInput(input));
    if (!url) { if ((input || '').trim()) toast('Only http:// and https:// addresses can be opened'); return false; }
    setAddress(url); setLoading(true);
    let ok = false;
    try {
      const { doc, base } = await fetchDoc(url);
      cur = { url, base, doc, chapters: null, listHtml: '', token: '' };
      renderFrame(doc, base);
      $('#start').hidden = true; frame.hidden = false;
      if (push) { hist = hist.slice(0, hi + 1); hist.push(url); hi = hist.length - 1; }
      addRecent(url, doc.title); renderStart();
      const page = cur;
      page.enhancing = enhanceSeriesPage(page);        // runs in the background, adds the chapter list when ready
      ok = true;
      if (opts.user) tryAutoRead(page);                // not awaited: the page is already on screen
    } catch (e) {
      showError('Could not load the page: ' + e.message, { details: 'Address: ' + url + '\nProxies: ' + settings.proxies.map(proxyName).join(', ') + '\nPress Retry by opening the link again, or see MANGAFLOW.md section 11.' });
      // WHY: with no proxy at all, failure is certain, so open Settings once per visit to point the user at the fix.
      if (!settings.proxies.length && !navigate.hinted) { navigate.hinted = true; setTimeout(() => $('#btnSettings').click(), 900); }
    }
    finally { setLoading(false); updateNav(); }
    return ok;
  }

  async function tryAutoRead(page) {
    if (!settings.autoRead || !page) return;
    try {
      const u = new URL(page.url);
      if (/duckduckgo\.com$/.test(u.hostname)) return;                    // search results are not a manga
      if (u.pathname.replace(/\/+$/, '') === '') return;                  // the site's front page lists many manga
      setBusy('Looking for chapters…');
      await page.enhancing;                                               // wait for hidden chapter lists
      if (cur !== page) return;                                           // the person went somewhere else
      let ok = extractImages(page.doc, page.base).length >= 3 ||          // a chapter page
        (chapterNumOf(page.url) != null && metaImageSamples(page.doc, page.base).some(u => NUM_IMG.test(u)));   // round 10: pictures added by script, numbered preview picture
      if (!ok) {
        const list = page.chapters || pickSeries(detectChapters(page.doc, page.base), page.url, false);
        ok = list.length >= 2 && belongsToPage(list, page.url);           // a manga page with its own chapter list
      }
      setBusy('');
      if (ok && cur === page) await startReading({ quiet: true });
    } catch { /* staying on the page is always fine */ }
    finally { setBusy(''); }
  }

  /* Click on a chapter link of a manga page -> read from that chapter at once (no extra step).
     WHY: a click used to open only the chapter's website page inside the mini browser.
     HOW: readFrom() opens the chapter page, then starts reading mode from it. */
  async function readFrom(url) {
    const ok = await navigate(url, true, { user: false });
    if (ok && cur && sameUrl(cur.url, url)) startReading({ quiet: false });
  }
  function isChapterLinkOfCurrent(u) {
    if (!cur || !settings.autoRead) return false;
    if (cur.chapters && cur.chapters.some(c => sameUrl(c.url, u))) return true;
    if (extractImages(cur.doc, cur.base).length >= 3) return false;       // already a chapter page: normal navigation
    try {
      return numFrom(decodeURIComponent(new URL(u).pathname)) != null && belongsToPage([{ url: u }], cur.url);
    } catch { return false; }
  }

  function goHist(d) { const n = hi + d; if (n < 0 || n >= hist.length) return; hi = n; navigate(hist[hi], false); }
  function goHome() { frame.hidden = true; $('#start').hidden = false; cur = null; setAddress(''); renderStart(); updateNav(); }
  function updateNav() {
    $('#btnBack').disabled = hi <= 0;
    $('#btnFwd').disabled = hi >= hist.length - 1;
    $('#fabRead').hidden = !cur;
    $('#btnStar').textContent = cur && books.some(b => b.url === cur.url) ? '★' : '☆';
  }

  /* ---------------------------------------------------------------
     8. CHAPTER + IMAGE DETECTION (the "guessing" part)
     WHY: every manga site has different HTML. We use common-sense rules:
          - chapter links contain "chapter 12", "ch.12", "episode 3"... in the text or the URL
          - chapter images are the biggest group of <img> sharing one container
     IMPROVE: this is the part most likely to need tweaks per site. Add a table of site-specific
              rules (CSS selectors per hostname), plus support for "c012" style URLs, and for sites
              that hide image URLs inside JSON/JavaScript (needs a headless-browser proxy). */
  const CH_RE = /(?<![a-z])(?:chapter|chap|ch|episode|ep)(?![a-z])[\s._\-#:/]*(\d+(?:[._-]\d+)?)/i;
  function numFrom(s) {
    const m = CH_RE.exec(s || '');
    if (m) return parseFloat(m[1].replace(/[_-]/, '.'));
    const c = /\/c(\d{1,4}(?:[._]\d+)?)\/?$/i.exec(s || '');          // round 8: addresses ending in /c012
    return c ? parseFloat(c[1].replace('_', '.')) : null;
  }
  const fmtNum = n => (Number.isInteger(n) ? String(n) : String(n));
  // "Chapter 5", "Chapter: 1-eng-li" ... = nothing more than the number, so no extra title line is needed.
  const isPlainTitle = t => /^(?:chapter|chap|ch|episode|ep)(?![a-z])[\s:._#-]*\d+(?:[.-]\d+)?(?:[-_][a-z]{1,4}){0,3}$/i.test((t || '').trim());

  /* Which series does a chapter URL belong to?
     WHY: pages also contain chapter links of OTHER manga (sidebars, "new manga", "you may also like").
          Mixing them in produced a wrong, short chapter list. The key is the part of the address before
          the chapter number: /manhua/nightwatcher/chapter-5/ -> "/manhua/nightwatcher";
          /reader/en/some-title-chapter-5-eng/ -> "/reader/en/some-title".
     IMPROVE: per-site rules (roadmap 1) would be even more exact. */
  function seriesKey(u) {
    let p; try { p = decodeURIComponent(new URL(u).pathname); } catch { return null; }
    p = p.replace(/\/+$/, '');
    const i = p.lastIndexOf('/'), dir = p.slice(0, i + 1), last = p.slice(i + 1);
    if (/^(?:chapter|chap|ch|episode|ep)(?![a-z])[\s._\-#:]*\d/i.test(last)) return dir.replace(/\/$/, '') || '/';
    const m = /[-_.](?:chapter|chap|ch|episode|ep)(?![a-z])[-_.\s#:]*\d/i.exec(last);
    if (m) return dir + last.slice(0, m.index);
    return null;
  }
  /* Keep only the chapters of the manga being read. `url` = the chapter page (asChapter) or the series page. */
  function pickSeries(list, url, asChapter) {
    const groups = new Map();
    list.forEach(c => { const k = seriesKey(c.url) || ''; if (!groups.has(k)) groups.set(k, []); groups.get(k).push(c); });
    if (groups.size <= 1) {
      // Only ONE group of links. If we are reading a chapter and that group belongs to another manga
      // (for example a "latest updates" sidebar), it is not our list.
      if (asChapter) {
        const k = seriesKey(url), g = groups.size ? groups.keys().next().value : '';
        if (k != null && g !== '' && g !== k) return [];
      }
      return list;
    }
    let pick = null;
    if (asChapter) {
      const k = seriesKey(url); if (k != null && groups.has(k)) pick = groups.get(k);
    } else {
      let slug = ''; try { slug = decodeURIComponent(new URL(url).pathname).replace(/\/+$/, '').split('/').pop().toLowerCase(); } catch { /* none */ }
      groups.forEach((g, k) => { if (slug && k.toLowerCase().includes(slug) && (!pick || g.length > pick.length)) pick = g; });
    }
    if (!pick) {                                                         // fall back to the biggest group
      let best = []; groups.forEach(g => { if (g.length > best.length) best = g; });
      if (asChapter || best.length >= 3) pick = best;
    }
    return pick || [];
  }

  /* Does this chapter list really belong to THIS series page?
     WHY: a series page often shows chapter links of OTHER manga (sidebar "latest updates") but none of its own,
          because its own list is filled in by JavaScript. Without this check those foreign links were taken as
          "the list", the real list was never fetched, and "Read first chapter" opened a different manga.
     HOW: the last part of the series address (the "slug", e.g. "a-bad-example-of-a-perfect-curse") must appear
          in at least one chapter address. Sites that use numbers instead of names fail this test; for them we
          simply ask the site for its list and fall back to nothing. */
  function belongsToPage(list, url) {
    if (list.some(c => c.box)) return true;                              // round 8: list found inside a chapter-list box
    let slug = '';
    try { slug = new URL(url).pathname.replace(/\/+$/, '').split('/').pop().toLowerCase(); } catch { return true; }
    if (!slug) return true;
    return list.some(c => c.url.toLowerCase().includes(slug));
  }

  function detectChapters(doc, base) {
    const origin = new URL(base).origin;
    const found = new Map();
    const add = (href, text) => {
      if (!href || href.startsWith('#') || /^(javascript|mailto|tel):/i.test(href)) return;
      const u = absUrl(href, base); if (!u) return;
      let p; try { p = new URL(u); } catch { return; }
      if (p.origin !== origin) return;
      text = (text || '').replace(/\s+/g, ' ').trim();
      let num = numFrom(decodeURIComponent(p.pathname));
      if (num == null) num = numFrom(text);
      if (num == null) return;
      const key = u.split('#')[0];
      const old = found.get(key);
      if (!old) found.set(key, { url: key, title: text.slice(0, 120), num });
      else if (!/\d/.test(old.title) && /\d/.test(text)) old.title = text.slice(0, 120);
    };
    // a.dataset.mfHref = the real address of a link that neutralizeLinks() already changed to "#mf"
    doc.querySelectorAll('a[href]').forEach(a => add(a.dataset.mfHref || a.getAttribute('href'), a.textContent));
    doc.querySelectorAll('select option[value]').forEach(o => add(o.getAttribute('value'), o.textContent));
    const list = Array.from(found.values()).sort((a, b) => a.num - b.num);   // chapter 1 first
    if (list.length < 2) { const loose = detectChaptersLoose(doc, base); if (loose.length >= 3) return loose; }   // round 8
    return list;
  }

  function detectTitle(doc, base) {
    const clean = t => (t || '').replace(/\s+/g, ' ').trim()
      .replace(/\s*[-–—|:]?\s*(?:chapter|chap|ch|episode|ep)(?![a-z])[\s._\-#:]*\d.*$/i, '')
      .split(/\s[|–—-]\s/)[0].trim();
    const cands = [
      clean($('h1', doc) && $('h1', doc).textContent),
      clean($('meta[property="og:title"]', doc) && $('meta[property="og:title"]', doc).content),
      clean(doc.title)
    ];
    return cands.find(Boolean) || new URL(base).hostname;
  }

  /* PICTURE DETECTION (round 8: much wider)
     WHY: the first version only looked at <img src>. Many scanlation sites (for example the "MangaStream" and
          "Next.js" kinds) put the chapter pictures in a JavaScript list inside the page, or in srcset, or in a
          lazy-load attribute we did not know. The reader then showed EMPTY pages for them.
     HOW: three steps, the first that finds 3 or more pictures wins.
          1. <img> tags: src, lazy-load attributes (data-src ...), and the best entry of srcset / <picture>.
             The biggest group of pictures that share one container is "the reader".
          2. Pictures hidden in <script> text (fromScripts): a list such as  "images":["https://.../01.jpg", ...]
             is read straight from the script text. Nothing from the site is ever RUN, we only read the text.
          3. If there is no such list, every picture address in the scripts is grouped by folder and the biggest
             folder with numbered file names (01.jpg, 02.jpg ...) is taken.
     IMPROVE: per-site rules (a table of CSS selectors / script patterns by hostname) for the hardest sites. */
  const BAD_IMG = /logo|banner|avatar|icon|sprite|\bads?[-_/.]|advert|loading|gravatar|emoji|placeholder|button|badge|thumb-?small|[-_]\d{2,3}x\d{2,3}\.(?:jpe?g|png|webp)/i;
  const IMG_EXT = /\.(?:jpe?g|png|webp|avif|gif)(?:[?#]|$)/i;
  // srcset = "a.jpg 400w, b.jpg 800w"  ->  the last (biggest) address.
  const srcsetBest = s => {
    const parts = (s || '').split(',').map(x => x.trim().split(/\s+/)[0]).filter(Boolean);
    return parts.length ? parts[parts.length - 1] : '';
  };

  function fromScripts(doc, base) {
    const texts = [];
    doc.querySelectorAll('script').forEach(s => {
      const t = s.textContent || '';
      if (t.length > 40 && t.length < 4000000 && /\.(?:jpe?g|png|webp|avif|gif)/i.test(t)) texts.push(t);
    });
    if (!texts.length) return [];
    // JSON inside scripts writes "/" as "\/" or "\u002F": turn that back into a normal address.
    const unesc = t => t.replace(/\\u002F/gi, '/').replace(/\\u0026/gi, '&').replace(/\\\//g, '/');
    const okUrl = u => { const a = absUrl(u, base); return a && IMG_EXT.test(a) && !BAD_IMG.test(a) ? a : null; };
    // 1) a list made only of text items, most of them picture addresses
    let best = [];
    for (const raw of texts) {
      const t = unesc(raw);
      const re = /\[\s*(?:"[^"\\]*"|'[^'\\]*')(?:\s*,\s*(?:"[^"\\]*"|'[^'\\]*'))+\s*,?\s*\]/g;
      let m;
      while ((m = re.exec(t))) {
        const items = m[0].match(/"[^"\\]*"|'[^'\\]*'/g).map(x => x.slice(1, -1));
        const good = items.map(okUrl).filter(Boolean);
        if (good.length >= 3 && good.length >= items.length * 0.8 && good.length > best.length) best = good;
      }
    }
    if (best.length >= 3) return Array.from(new Set(best));
    // 2) every picture address in the scripts; keep the biggest folder with numbered file names
    const all = [];
    for (const raw of texts) {
      const t = unesc(raw);
      const re = /(?:https?:)?\/\/[^"'\s<>\\)]+?\.(?:jpe?g|png|webp|avif|gif)(?:\?[^"'\s<>\\)]*)?/gi;
      let m;
      while ((m = re.exec(t))) { const a = okUrl(m[0]); if (a) all.push(a); }
    }
    const groups = new Map();
    Array.from(new Set(all)).forEach(u => {
      const k = u.replace(/[^/]*$/, '');
      if (!groups.has(k)) groups.set(k, []);
      groups.get(k).push(u);
    });
    let top = [];
    groups.forEach(g => {
      const numbered = g.filter(u => /\d/.test(u.split('/').pop()));
      if (numbered.length >= 5 && numbered.length > top.length) top = numbered;
    });
    return top;
  }

  function extractImages(doc, base) {
    const cands = [];
    doc.querySelectorAll('img').forEach(img => {
      let raw = ['data-src', 'data-lazy-src', 'data-original', 'data-url', 'data-lazy', 'src']
        .map(a => img.getAttribute(a)).find(v => v && !v.startsWith('data:'));
      if (!raw) {                                                         // no usable src: try srcset (also inside <picture>)
        const pic = img.parentElement && img.parentElement.tagName === 'PICTURE' ? img.parentElement.querySelector('source[srcset],source[data-srcset]') : null;
        raw = srcsetBest(img.getAttribute('data-srcset') || img.getAttribute('srcset') ||
          (pic && (pic.getAttribute('srcset') || pic.getAttribute('data-srcset'))) || '');
      }
      if (!raw) return;
      const u = absUrl(raw.trim(), base); if (!u || /\.svg(\?|$)/i.test(u) || BAD_IMG.test(u)) return;
      const w = parseInt(img.getAttribute('width') || '0', 10), h = parseInt(img.getAttribute('height') || '0', 10);
      if ((w && w < 150) || (h && h < 150)) return;                      // tiny = decoration
      cands.push({ img, url: u });
    });
    let dom = cands.map(c => c.url);
    if (cands.length >= 2) {
      // Count how many candidates each ancestor contains; the winner is the reader container.
      const counts = new Map();
      cands.forEach(c => {
        let el = c.img.parentElement;
        for (let i = 0; i < 6 && el; i++, el = el.parentElement) counts.set(el, (counts.get(el) || 0) + 1);
      });
      let best = null, bestN = 0;
      counts.forEach((n, el) => { if (n > bestN || (n === bestN && best && best.contains(el))) { best = el; bestN = n; } });
      const picked = best ? cands.filter(c => best.contains(c.img)) : cands;
      dom = Array.from(new Set(picked.map(c => c.url)));                 // remove duplicates, keep order
    }
    if (dom.length >= 3) return dom;
    const sc = fromScripts(doc, base);                                    // empty reader? look inside the scripts
    return sc.length >= 3 && sc.length > dom.length ? sc : dom;
  }

  /* CHAPTER LIST WITHOUT NUMBERS IN THE LINKS (round 8)
     WHY: detectChapters() needs "chapter 12" in the link or its text. Some sites use links like /read/48213 and a
          list whose text is only "12" or a date. Their list is still easy to see: it sits inside a box whose
          class or id says chapter / episode / eplister.
     HOW: take the links inside such boxes, keep the biggest group of links that share one folder (that is the
          manga's own list, a sidebar of "latest updates" has different folders), find a number in the text or the
          address, and sort. When no link has a number at all, the list is numbered from the page order
          (sites list the newest chapter first, so the last one is chapter 1).
     IMPROVE: read "next chapter" links to order lists that have no numbers. */
  function detectChaptersLoose(doc, base) {
    let origin; try { origin = new URL(base).origin; } catch { return []; }
    const SKIP = /\/(?:genres?|tags?|authors?|artists?|categor(?:y|ies)|page|search|bookmarks?|login|register|user|forum|contact|about|privacy|dmca|terms)(?:\/|$|\?)/i;
    const boxes = doc.querySelectorAll('[id*="chapter" i],[class*="chapter" i],[class*="eplister"],[id*="episode" i],[class*="episode" i]');
    const seen = new Map();
    const take = a => {
      const href = a.dataset && a.dataset.mfHref ? a.dataset.mfHref : a.getAttribute('href');
      if (!href || href.startsWith('#') || /^(javascript|mailto|tel):/i.test(href)) return;
      const u = absUrl(href, base); if (!u) return;
      let p; try { p = new URL(u); } catch { return; }
      if (p.origin !== origin || p.pathname.length < 2 || SKIP.test(p.pathname)) return;
      const key = u.split('#')[0];
      if (!seen.has(key)) seen.set(key, { url: key, title: (a.textContent || '').replace(/\s+/g, ' ').trim().slice(0, 120) });
    };
    boxes.forEach(b => {
      if (b === doc.body || b === doc.documentElement) return;
      if (b.tagName === 'A') take(b); else b.querySelectorAll('a[href]').forEach(take);
    });
    const all = Array.from(seen.values());
    if (all.length < 3) return [];
    // biggest group sharing one folder
    const groups = new Map();
    all.forEach(c => { const k = c.url.replace(/[^/]*\/?$/, ''); if (!groups.has(k)) groups.set(k, []); groups.get(k).push(c); });
    let g = []; groups.forEach(x => { if (x.length > g.length) g = x; });
    if (g.length < 3) return [];
    const firstNum = s => { const m = /(\d+(?:\.\d+)?)/.exec(s || ''); return m ? parseFloat(m[1]) : null; };
    g.forEach(c => {
      let num = null;
      try { num = numFrom(decodeURIComponent(new URL(c.url).pathname)); } catch { /* none */ }
      if (num == null) num = numFrom(c.title);
      if (num == null) num = firstNum(c.title);
      if (num == null) num = firstNum(c.url.split('/').filter(Boolean).pop());
      c.num = num; c.box = true;
    });
    const withNum = g.filter(c => c.num != null);
    if (withNum.length >= Math.max(3, g.length * 0.6)) return withNum.sort((a, b) => a.num - b.num);
    g.forEach((c, i) => { c.num = g.length - i; });                      // page order, newest first
    return g.sort((a, b) => a.num - b.num);
  }

  /* ---------------------------------------------------------------
     8b. FINDING THE FULL CHAPTER LIST FROM A CHAPTER PAGE  (round 9)
     WHY: when you paste the address of ONE chapter (for example chapter 5), the page may not contain the other chapters:
          on the "MangaStream / ts_reader" kind of site (Thunder Scans and many more) the chapter dropdown is empty in the
          page and the Prev / Next buttons are placeholders ("#/prev/") that the site's own JavaScript fills in later.
          Before, MangaFlow then knew only chapter 5 (and sometimes the next one), so chapters 1 to 4 were unreachable.
     HOW: analyze() now tries these ways, in this order, and uses the first that gives a real list:
            1. the chapter links that are on the page itself,
            2. findParentLink(): a link whose address is the start of this chapter's address (/manga/name/ for /manga/name/chapter-5/),
            3. findSeriesLink(): a link to the manga's own page found by NAME (the last part of the address equals the manga's
               slug) or by words like "All chapters", also read from the page's JSON-LD breadcrumb,
            4. guessSeriesUrls(): typical addresses such as /comics/NAME/ , /manga/NAME/ , /series/NAME/ ,
            5. synthesizeChapters(): last resort, chapters 1..N are built from the number in the address
               (chapter-5 -> chapter-4 ... chapter-1). A guessed chapter that does not exist is removed again by fillChapter().
          Next and previous chapters are also read from the "prevUrl" / "nextUrl" values that the site writes inside a script
          (findNavLinks), because those are the real addresses behind the empty buttons.
     WHERE: used by analyze(), fillChapter() and goChapter(). Reading UPWARDS (loading earlier chapters above) is loadPrev() in section 9.
     IMPROVE: remember the series address per site so step 3 and 4 are skipped next time; add per-site rules. */
  const unescapeJs = t => t.replace(/\\u002F/gi, '/').replace(/\\u0026/gi, '&').replace(/\\\//g, '/');   // JSON writes "/" as "\/"
  const chapterNumOf = u => { try { return numFrom(decodeURIComponent(new URL(u).pathname)); } catch { return null; } };
  const attrCls = a => (typeof a.className === 'string' ? a.className : '') + ' ' + (a.id || '') + ' ' + (a.getAttribute('rel') || '');

  /* Previous / next chapter addresses of a chapter page. Returns { prev, next } (each an address or null).
     A usable address is on the same site, is not "#...", and is not the page itself. */
  function findNavLinks(doc, base, curUrl) {
    let cu; try { cu = new URL(curUrl); } catch { return { prev: null, next: null }; }
    const out = { prev: null, next: null };
    const usable = raw => {
      raw = String(raw || '').trim();
      if (!raw || raw.startsWith('#') || /^(javascript|mailto|tel|data):/i.test(raw)) return null;   // placeholders like "#/prev/"
      const u = absUrl(raw, base); if (!u) return null;
      let p; try { p = new URL(u); } catch { return null; }
      if (p.origin !== cu.origin) return null;                          // never leave the site
      const clean = u.split('#')[0];
      return sameUrl(clean, curUrl) ? null : clean;                     // a link to the page itself is no use
    };
    const set = (k, raw) => { if (!out[k]) out[k] = usable(raw); };      // the first good one wins
    // 1) the real addresses written inside a script:  "prevUrl":"https://..."  "nextUrl":"https://..."
    doc.querySelectorAll('script').forEach(s => {
      const t = s.textContent || '';
      if (t.length < 20 || t.length > 4000000 || !/prev|next/i.test(t)) return;
      const txt = unescapeJs(t);
      const pm = /["'](?:prevUrl|prev_url|previousUrl|prevChapter|prev_chapter|prevLink|prev)["']\s*:\s*["']([^"']*)["']/i.exec(txt);
      const nm = /["'](?:nextUrl|next_url|nextChapter|next_chapter|nextLink|next)["']\s*:\s*["']([^"']*)["']/i.exec(txt);
      if (pm) set('prev', pm[1]);
      if (nm) set('next', nm[1]);
    });
    // 2) <link rel="prev"> and <link rel="next"> in the head
    doc.querySelectorAll('link[rel~="prev"],link[rel~="previous"]').forEach(l => set('prev', l.getAttribute('href')));
    doc.querySelectorAll('link[rel~="next"]').forEach(l => set('next', l.getAttribute('href')));
    // 3) normal links: by rel / class / id, or by their words ("Prev", "Previous", "Next")
    doc.querySelectorAll('a[href]').forEach(a => {
      const txt = (a.textContent || '').replace(/\s+/g, ' ').trim(), cls = attrCls(a);
      const href = a.dataset && a.dataset.mfHref ? a.dataset.mfHref : a.getAttribute('href');
      if (/(^|[\s_-])(prev|previous)([\s_-]|$)/i.test(cls) || /^\s*(?:[«‹←<]\s*)?(prev|previous)\b/i.test(txt)) set('prev', href);
      if (/(^|[\s_-])next([\s_-]|$)/i.test(cls) || /^\s*next\b/i.test(txt) || /\bnext\s*(?:chapter|ch)?\s*[»›→>]?\s*$/i.test(txt)) set('next', href);
    });
    return out;
  }

  /* The manga's name part of a chapter address ("slug").
     /i-picked-up-a-grimoire-chapter-1/  ->  i-picked-up-a-grimoire        /manga/solo/chapter-5/  ->  solo */
  function slugOf(url) {
    const k = seriesKey(url);
    if (k) return (k.split('/').filter(Boolean).pop() || '').toLowerCase().replace(/[-_.\s]+$/, '');
    try { const p = decodeURIComponent(new URL(url).pathname).split('/').filter(Boolean); return (p.length > 1 ? p[p.length - 2] : p[0] || '').toLowerCase(); }
    catch { return ''; }
  }

  // Words in an address that mean "this is not a manga page" (menus, lists of genres, login ...).
  const NOT_SERIES = /\/(?:genres?|tags?|authors?|artists?|categor(?:y|ies)|page|search|bookmarks?|login|register|user|forum|contact|about|privacy|dmca|terms|wp-[a-z]+|feed|comments?)(?:\/|$|-|\?)/i;

  /* A link to the manga's own page, found by its NAME or by words. Returns an address or null.
     SCORE: the last part of the address equals the slug = 10, contains it = 6, link text like "All chapters" = 3,
     a class like "allc" / "breadcrumb" = 2. A score under 5 is too weak, so a menu link such as "Series" is not taken. */
  function findSeriesLink(doc, base, url) {
    let cu; try { cu = new URL(url); } catch { return null; }
    const slug = slugOf(url);
    let best = null, bestScore = 0;
    const consider = (raw, text, cls) => {
      const u = absUrl(raw, base); if (!u) return;
      let p; try { p = new URL(u); } catch { return; }
      if (p.origin !== cu.origin) return;
      let path; try { path = decodeURIComponent(p.pathname).replace(/\/+$/, ''); } catch { return; }
      if (path.length < 2 || sameUrl(u, url) || NOT_SERIES.test(path + '/') || numFrom(path) != null) return;   // chapter-like addresses are not the series
      const last = path.split('/').pop().toLowerCase();
      let score = 0;
      if (slug && last === slug) score += 10;
      else if (slug && last.length >= 4 && (last.includes(slug) || slug.includes(last))) score += 6;
      if (/all\s*chapters?|chapter\s*list|manga\s*(?:info|page|detail)|series\s*page|back to (?:series|manga|info)/i.test(text)) score += 3;
      if (/\b(?:allc|breadcrumb|series|manga-info|info|back)\b/i.test(cls)) score += 2;
      if (score > bestScore) { best = u.split('#')[0]; bestScore = score; }
    };
    doc.querySelectorAll('a[href]').forEach(a => {
      const raw = a.dataset && a.dataset.mfHref ? a.dataset.mfHref : a.getAttribute('href');
      if (!raw || raw.startsWith('#')) return;
      consider(raw, (a.textContent || '').replace(/\s+/g, ' ').trim(), attrCls(a) + ' ' + (a.parentElement ? attrCls(a.parentElement) : ''));
    });
    doc.querySelectorAll('script[type="application/ld+json"]').forEach(s => {          // breadcrumb data lists the series address too
      (unescapeJs(s.textContent || '').match(/https?:\/\/[^"'\s,\\]+/g) || []).forEach(raw => consider(raw, '', ''));
    });
    return bestScore >= 5 ? best : null;
  }

  // Typical addresses of a manga page, built from the name part of the chapter address.
  function guessSeriesUrls(url) {
    let u; try { u = new URL(url); } catch { return []; }
    const slug = slugOf(url); if (!slug || slug.length < 3) return [];
    const dirs = ['/comics/', '/manga/', '/series/', '/comic/', '/manhwa/', '/manhua/', '/webtoon/', '/title/', '/'];
    return Array.from(new Set(dirs.map(d => u.origin + d + slug + '/'))).filter(g => !sameUrl(g, url));
  }

  /* Try to get the full chapter list of the manga that a chapter page belongs to. Returns
     { chapters, parent, title } or null. Each attempt fetches one page and accepts it only when it holds 2+ chapters
     of THIS manga. At most 6 guessed addresses and about 25 seconds are spent on guessing. */
  async function loadSeriesList(doc, base, url) {
    const tried = new Set([url]);
    const attempt = async cand => {
      if (!cand || tried.has(cand)) return null;
      tried.add(cand);
      try {
        const p = await fetchDoc(cand);
        let c = pickSeries(detectChapters(p.doc, p.base), url, true);
        if (c.length && !belongsToPage(c, cand)) c = [];                // only links of other manga there
        if (c.length < 2) c = (await ajaxChapterList(p.doc, p.base, cand, url, true)).chapters;
        if (c.length >= 2) return { chapters: c, parent: cand, title: detectTitle(p.doc, p.base) };
      } catch { /* try the next way */ }
      return null;
    };
    let r = await attempt(findParentLink(doc, base, url));              // way 2: a shorter address that starts the same way
    if (!r) { setBusy('Looking for the manga page…'); r = await attempt(findSeriesLink(doc, base, url)); }   // way 3: by name / words
    if (!r) {                                                           // way 4: typical addresses
      const t0 = Date.now();
      for (const g of guessSeriesUrls(url).slice(0, 6)) {
        if (Date.now() - t0 > 25000) break;
        setBusy('Looking for the chapter list…');
        r = await attempt(g); if (r) break;
      }
    }
    return r;
  }

  /* LAST RESORT: build chapters 1..N from the number in this chapter's address (round 9).
     chapter-5 -> chapter-4, chapter-3 ... chapter-1. These are guesses (flag guess: true). If one does not exist the site
     answers "not found" and fillChapter() quietly removes that box again. The real previous address from the page (nav.prev)
     replaces the guess for chapter N-1 when the page has one. Returns a list or null. */
  function synthesizeChapters(url, nav) {
    let u; try { u = new URL(url); } catch { return null; }
    const m = CH_RE.exec(u.pathname); if (!m) return null;
    const curNum = parseFloat(m[1].replace(/[_-]/, '.'));
    if (!Number.isInteger(curNum) || curNum < 2 || curNum > 2000) return null;
    const at = m.index + m[0].length - m[1].length, width = m[1].length;
    const make = n => u.origin + u.pathname.slice(0, at) + (m[1].startsWith('0') ? String(n).padStart(width, '0') : String(n)) + u.pathname.slice(at + width) + u.search;
    const list = [];
    for (let n = 1; n <= curNum; n++) list.push({ url: n === curNum ? url.split('#')[0] : make(n), title: '', num: n, guess: n !== curNum });
    if (nav && nav.prev && list.length >= 2) list[list.length - 2] = { url: nav.prev, title: '', num: curNum - 1, guess: false };
    return list;
  }

  /* PICTURES THAT THE PAGE DOES NOT LIST (round 10, roliascan.com and similar)
     WHY: some readers fill the pictures in with JavaScript after the page loads, so the downloaded page has none. But the page's
          preview picture (og:image) is usually page 1 of the chapter, e.g. ".../storage/chapters/<code>/001.webp". The other pages
          sit next to it with the next numbers (002, 003 ...).
     HOW: take such a sample address, ask for 001, 002, 003 ... in small groups and stop at the first number that does not exist.
          Each test loads the picture in an <img> (no referer); if the host refuses that, your own proxy is tried with the chapter
          address as referer. Only used when the normal detection found NOTHING, and only up to 300 pages.
     LIMITS: only works when the pages really are numbered next to the preview picture. If it finds nothing the error report says so.
     IMPROVE: remember the pattern per site, and read the page count from the page text ("1 / 24") to stop sooner. */
  const NUM_IMG = /^(.*\/)(\d{1,4})(\.(?:jpe?g|png|webp|avif|gif))(\?.*)?$/i;
  function metaImageSamples(doc, base) {
    const out = [];
    doc.querySelectorAll('meta[property="og:image"],meta[name="twitter:image"],meta[property="og:image:secure_url"],link[rel="image_src"]').forEach(m => {
      const u = absUrl(m.getAttribute('content') || m.getAttribute('href') || '', base); if (u && !out.includes(u)) out.push(u);
    });
    return out;
  }
  function imgExists(src, ref) {                                       // does this picture address answer with a real picture?
    const viaTag = () => new Promise(res => {
      const im = new Image(); let done = false;
      const end = ok => { if (!done) { done = true; res(ok); } };
      im.referrerPolicy = 'no-referrer'; im.onload = () => end(im.naturalWidth > 20); im.onerror = () => end(false);
      setTimeout(() => end(false), 9000); im.src = src;
    });
    const viaProxy = async () => {
      const own = proxyList(false).find(p => !DEFAULT_PROXIES.includes(p)); if (!own) return false;
      try {
        const r = await fetch(own.replace('{url}', encodeURIComponent(src)) + (ref ? '&ref=' + encodeURIComponent(ref) : ''), { referrerPolicy: 'no-referrer', credentials: 'omit' });
        if (!r.ok) return false;
        return (await r.blob()).size > 1500;
      } catch { return false; }
    };
    return viaTag().then(ok => ok || viaProxy());
  }
  async function probeNumbered(doc, base, ref) {
    for (const sample of metaImageSamples(doc, base)) {
      const m = NUM_IMG.exec(sample); if (!m) continue;
      const pre = m[1], digits = m[2], ext = m[3], q = m[4] || '', width = digits.length;
      const make = n => pre + String(n).padStart(width, '0') + ext + q;
      if (!(await imgExists(make(1), ref)) && !(await imgExists(sample, ref))) continue;   // the pattern does not hold
      const list = [];
      for (let n = 1; n <= 300; n += 6) {
        const group = []; for (let k = n; k < n + 6; k++) group.push(k);
        const res = await Promise.all(group.map(k => imgExists(make(k), ref)));
        let stop = false;
        for (let i = 0; i < group.length; i++) { if (res[i]) list.push(make(group[i])); else { stop = true; break; } }
        if (stop) break;
      }
      if (list.length >= 2) return list;
    }
    return [];
  }

  /* "No pictures on this chapter page": say WHY as exactly as we can. A page that talks about a login / coins / premium is
     probably LOCKED (MangaFlow cannot log in). The error carries a report of what the page contained (err.details). */
  const LOCK_RE = /(?:please\s+)?log\s*in\s+to\s+(?:read|unlock|view|continue)|unlock\s+(?:this\s+)?chapter|(?:chapter|content)\s+is\s+locked|premium\s+(?:only|chapter|members?)|members?\s+only|(?:coins?|points?)\s+(?:required|needed)|sign\s*in\s+to\s+read|not\s+available\s+anymore|has\s+been\s+removed/i;
  function noImagesError(doc, base) {
    const text = ((doc.body && doc.body.textContent) || '').replace(/\s+/g, ' ');
    const err = new Error(LOCK_RE.test(text)
      ? 'This chapter may be LOCKED or REMOVED (the page asks for a login / coins / premium, or says it is not available any more). MangaFlow cannot log in for you.'
      : 'no images found on this chapter page');
    err.details = diagnose(doc, base);
    return err;
  }


  /* If we are on a chapter page without a chapter list, look for the series page (a shorter URL
     path) and read the list from there. */
  function findParentLink(doc, base, url) {
    const cu = new URL(url); const cp = cu.pathname.replace(/\/$/, '');
    let best = null, bestLen = 0;
    doc.querySelectorAll('a[href]').forEach(a => {
      const u = absUrl(a.dataset.mfHref || a.getAttribute('href'), base); if (!u) return;
      let p; try { p = new URL(u); } catch { return; }
      if (p.origin !== cu.origin) return;
      const pp = p.pathname.replace(/\/$/, '');
      if (pp.length > 1 && pp.length < cp.length && cp.startsWith(pp + '/') && !CH_RE.test(pp) && pp.length > bestLen) { best = u; bestLen = pp.length; }
    });
    return best;
  }

  /* Many sites (WordPress "Madara" theme, e.g. manhuatop.org) leave the chapter list EMPTY in the page
     and fill it with JavaScript afterwards. We ask for that list directly (through your proxy, which makes
     the POST request). Returns { chapters: [], html: '' } when the site does not work that way.
     `html` is the site's own list markup, so the series page can show it exactly like the real site.
     HOW: first try SERIES-URL/ajax/chapters/ (POST, then plain GET as a fallback), then WordPress admin-ajax.php.
     IMPROVE: other themes use other endpoints; add them here or as per-site rules. */
  async function ajaxChapterList(doc, base, pageUrl, keyUrl, asChapter) {
    const u = new URL(pageUrl), series = u.origin + u.pathname.replace(/\/?$/, '/');
    const tries = [{ url: series + 'ajax/chapters/', body: '' }];
    const holder = doc.querySelector('#manga-chapters-holder[data-id]');
    const short = doc.querySelector('link[rel="shortlink"]');
    const id = (holder && holder.getAttribute('data-id')) || (short && (/[?&]p=(\d+)/.exec(short.getAttribute('href') || '') || [])[1]);
    if (id) tries.push({ url: u.origin + '/wp-admin/admin-ajax.php', body: 'action=manga_get_chapters&manga=' + id });
    for (const t of tries) {
      for (const post of (t.body === '' ? [true, false] : [true])) {
        try {
          const html = await fetchHTML(t.url, post ? { post: true, body: t.body } : {});
          const c = pickSeries(detectChapters(new DOMParser().parseFromString(html, 'text/html'), series), keyUrl, asChapter);
          if (c.length >= 2) return { chapters: c, html };
        } catch { /* try the next way */ }
      }
    }
    return { chapters: [], html: '' };
  }

  /* Runs in the background after a page is shown. If it is a series page, find its chapter list and
     show it inside the page. WHY: so the person sees the chapters like on the real site. */
  async function enhanceSeriesPage(page) {
    try {
      if (extractImages(page.doc, page.base).length >= 3) return;       // a chapter page, not a series page
      const own = pickSeries(detectChapters(page.doc, page.base), page.url, false);
      let list = own, html = '';
      if (own.length < 2 || !belongsToPage(own, page.url)) {            // no list, or only links of other manga
        const r = await ajaxChapterList(page.doc, page.base, page.url, page.url, false);
        if (r.chapters.length >= 2) { list = r.chapters; html = r.html; }
        else if (!belongsToPage(own, page.url)) list = [];              // never use another manga's chapters
      }
      if (cur !== page) return;                                         // the person already went somewhere else
      if (list.length < 2) {
        if (page.doc.querySelector('#manga-chapters-holder'))
          toast('This site fills its chapter list with JavaScript. Run start-manga.bat or add your own proxy in Settings so MangaFlow can load it.');
        return;
      }
      page.chapters = list; page.listHtml = html;
      applyLive(frame.contentDocument);
    } catch { /* the page still works without the extra list */ }
  }

  /* Follow the page's own "Next" link. WHY: if the full chapter list could not be found, reading mode
     still continues chapter after chapter (each chapter page links to the next one). */
  /* NEXT / PREVIOUS CHAPTER ADDRESS (round 9: one function for both directions)
     WHY: the old code only looked for "next". Many themes (Thunder Scans) keep real addresses inside a script and
          put "#" in the visible buttons, so the first choice is now findNavLinks(). The old loop over <a> stays as a fallback.
     HOW: dir = +1 (next) or -1 (previous). The number in the address must go the right way and the address must belong
          to the same manga (seriesKey), otherwise a "next" button that points to another series is ignored.
     IMPROVE: use the chapter list order instead of numbers for sites that number chapters strangely. */
  function findStep(doc, base, curUrl, dir) {
    let cu, curNum;
    try { cu = new URL(curUrl); curNum = numFrom(decodeURIComponent(cu.pathname)); } catch { return null; }
    if (curNum == null) return null;
    const key = seriesKey(curUrl);
    const ok = u => { const n = chapterNumOf(u); return n != null && (dir > 0 ? n > curNum : n < curNum) && (key == null || seriesKey(u) === key) ? { url: u.split('#')[0], title: '', num: n } : null; };
    const nav = findNavLinks(doc, base, curUrl), good = ok(dir > 0 ? nav.next || '' : nav.prev || '');
    if (good) return good;
    const re = dir > 0 ? /^\s*next\b/i : /^\s*(?:[«‹←<]\s*)?(prev|previous)\b/i, word = dir > 0 ? /next/i : /prev/i, rel = dir > 0 ? '[rel~="next"]' : '[rel~="prev"]';
    const cands = $$('a[href]', doc).filter(a => a.matches(rel) || re.test(a.textContent) || word.test(a.className));
    for (const a of cands) {
      const u = absUrl(a.getAttribute('href') || '', base); if (!u) continue;
      let p; try { p = new URL(u); } catch { continue; }
      if (p.origin !== cu.origin) continue;
      const r = ok(u); if (r) return r;
    }
    return null;
  }
  const findNextLink = (doc, base, curUrl) => findStep(doc, base, curUrl, 1);
  const findPrevLink = (doc, base, curUrl) => findStep(doc, base, curUrl, -1);

  async function analyze(page) {
    const { url, doc, base } = page;
    const imgs = extractImages(doc, base);
    // ROUND 10: a page with no listed pictures is still a CHAPTER when its address has a chapter number and its preview picture is numbered (001.webp).
    const numberedPreview = chapterNumOf(url) != null && metaImageSamples(doc, base).some(u => NUM_IMG.test(u));
    const isChapter = imgs.length >= 3 || numberedPreview;
    let chapters = pickSeries(detectChapters(doc, base), url, isChapter);
    if (!isChapter && chapters.length && !belongsToPage(chapters, url)) chapters = [];         // links of other manga: ignore
    if (!isChapter && chapters.length < 2 && page.chapters && page.chapters.length >= 2) chapters = page.chapters;   // already fetched for the series page
    let title = detectTitle(doc, base);
    let seriesUrl = isChapter ? null : url;                              // remembered in history
    // ROUND 9: a chapter page whose list is missing OR has no earlier chapters (so you could only read forwards).
    // Ways to find the list, in order: shorter address -> link by name/words -> typical addresses (/comics/name/ ...)
    // -> last resort: build chapters 1..N from the number in the address (guessed, removed again if they do not exist).
    const nav = isChapter ? findNavLinks(doc, base, url) : null;
    const curNum0 = isChapter ? chapterNumOf(url) : null;
    const earlier = c => curNum0 == null ? 0 : c.filter(x => x.num != null && x.num < curNum0).length;
    const incomplete = isChapter && curNum0 != null && curNum0 >= 3 && earlier(chapters) < Math.min(curNum0 - 1, 3);
    if (isChapter && (chapters.length < 2 || incomplete)) {
      const r = await loadSeriesList(doc, base, url).catch(() => null);
      if (r && (r.chapters.length > chapters.length || earlier(r.chapters) > earlier(chapters))) {
        chapters = r.chapters; title = r.title || title; seriesUrl = r.parent;
      }
      setBusy('Detecting chapters…');
    }
    if (isChapter && chapters.length < 2) { const syn = synthesizeChapters(url, nav); if (syn) chapters = syn; }
    if (isChapter) {
      let i = chapters.findIndex(c => sameUrl(c.url, url));
      if (i < 0) {                                                       // current page missing from list: add it
        const n = numFrom(decodeURIComponent(new URL(url).pathname)) ?? numFrom(doc.title);
        chapters.push({ url, title: doc.title.slice(0, 120), num: n == null ? chapters.length + 1 : n });
        chapters.sort((a, b) => a.num - b.num);
        i = chapters.findIndex(c => c.url === url);
      }
      return { title, chapters, start: i, seriesUrl };
    }
    if (chapters.length < 2) chapters = (await ajaxChapterList(doc, base, url, url, false)).chapters;
    if (!chapters.length) {
      const err = new Error('No chapters or chapter images found on this page. Open a manga series page or a chapter page.');
      err.details = diagnose(doc, base);                                  // round 8: what the page contained (goes into the report)
      throw err;
    }
    // Resume where you stopped: the history remembers the chapter ADDRESS (not a position number), so it still
    // works when new chapters are added to the list later.
    const hit = reads.find(r => r.id === new URL(base).origin + '|' + title);
    const j = hit ? chapters.findIndex(c => sameUrl(c.url, hit.chapterUrl)) : -1;
    const start = j > 0 ? j : 0;
    if (start > 0) toast('Resuming from chapter ' + fmtNum(chapters[start].num));
    return { title, chapters, start, seriesUrl };
  }

  /* ---------------------------------------------------------------
     9. READING MODE - state + infinite chapter streaming
     WHY: R holds everything about the current reading session. `gen` is a counter that lets us
          ignore results of a chapter that finished loading after the user already jumped elsewhere.
          An IntersectionObserver watches an invisible marker at the bottom: when it nears the
          screen we load the next chapter, so scrolling never ends until all chapters are done.
     ROUND 6: chapters now load in BATCHES of BATCH (10) at the same time. When reading starts, chapter 1..10
          are all asked for together (the 10 boxes appear at once and each fills as soon as its page arrives).
          When you get close to the last chapter of the batch (updateCurrent) the next 10 start loading, so you
          never wait. The pictures themselves stay lazy (they load when you scroll near them) to save data.
     IMPROVE: also load PREVIOUS chapters when scrolling up (needs scroll-position correction),
              make BATCH a setting, remove far-away chapters from the page to save memory on phones. */
  // WHERE: used by loadNext() (first batch + next batches) and reloadSections() below.
  const BATCH = 10;                  // how many chapters are requested at the same time
  const reader = $('#reader'), stream = $('#stream'), sentinel = $('#sentinel');
  let R = { gen: 0, title: '', chapters: [], first: 0, next: 0, cur: 0, loading: false, paused: false, seriesUrl: null, batchP: null };

  const io = new IntersectionObserver(es => { if (es[0].isIntersecting) loadNext(); }, { rootMargin: '1500px' });

  const labelFor = i => {
    const c = R.chapters[i];
    return 'Chapter ' + (c && c.num != null ? fmtNum(c.num) : i + 1);
  };
  const secFor = i => stream.querySelector('.chapter[data-index="' + i + '"]');

  /* START READING MODE (round 8: returns true/false, quiet mode, "reading" class)
     WHY: the dock, the keys and the CSS need to know that we are in reading mode: body.reading is added here and
          removed in leaveReader(). `quiet` is used by the automatic start (no pop-up if it cannot start).
     HOW: analyze() works out the chapters, then the first batch of chapters is loaded (loadNext). */
  async function startReading(opts = {}) {
    if (!cur) { toast('Open a manga page first'); return false; }
    if (!$('#busy').hidden && !opts.quiet) return false;                  // already starting
    setBusy('Detecting chapters…');
    let info;
    try { info = await analyze(cur); }
    catch (e) {
      setBusy('');
      if (opts.quiet) toast('Could not start reading automatically. Pick a chapter, or press "Reading mode".');
      else showError(e.message, { hint: e.hint, details: e.details });
      return false;
    }
    setBusy('');
    R = { gen: R.gen + 1, title: info.title, chapters: info.chapters, first: info.start, next: info.start, cur: info.start, loading: false, paused: false, seriesUrl: info.seriesUrl };
    buildChapterMenu();
    stream.innerHTML = ''; $('#theEnd').hidden = true; updateDlBar();
    $('#browser').hidden = true; reader.hidden = false; document.body.classList.add('reading'); syncDock();
    $('#rTitle').textContent = R.title; $('#rSub').textContent = labelFor(R.cur);
    $('#rdAddr').value = cur.url;
    window.scrollTo(0, 0); lastY = 0; showUi();
    rememberChapter(R.cur);                                              // history knows this chapter right away
    updatePrevBar();                                                     // round 9: show the "earlier chapters" area
    io.disconnect(); io.observe(sentinel);
    await loadNext();
    return true;
  }

  /* Load the next batch of chapters (up to BATCH) at the same time.
     HOW: 1) make the empty chapter boxes in order (so the order on the page is always right),
          2) fill all of them in parallel, 3) when every box is done, check the sentinel again.
     Returns a promise, so callers (for example the "next chapter" key) can wait for the batch. */
  function loadNext() {
    if (reader.hidden || R.paused) return Promise.resolve();
    if (R.loading) return R.batchP;                                  // a batch is already running: share it
    if (R.next >= R.chapters.length) { $('#theEnd').hidden = false; return Promise.resolve(); }
    const gen = R.gen, from = R.next, to = Math.min(R.chapters.length, from + BATCH);
    R.next = to; R.loading = true;
    R.batchP = (async () => {
      try {
        const secs = [];
        for (let i = from; i < to; i++) secs.push(makeSection(i));
        await Promise.all(secs.map(sec => fillChapter(sec, +sec.dataset.index, gen)));
      } finally {
        if (gen === R.gen) {
          R.loading = false;
          io.disconnect(); io.observe(sentinel);          // re-check: sentinel may still be near the screen
        }
      }
    })();
    return R.batchP;
  }

  /* Build the empty box of one chapter: header (manga name, number, title). The pages come later (fillChapter). */
  function makeSection(i, detached) {                // detached = do not add to the page yet (loadPrev inserts it above)
    const ch = R.chapters[i];
    const sec = document.createElement('section');
    sec.className = 'chapter'; sec.dataset.index = i; sec.dataset.url = ch.url;

    const head = document.createElement('div'); head.className = 'ch-head';
    const m = document.createElement('div'); m.className = 'ch-manga'; m.textContent = R.title;
    const n = document.createElement('div'); n.className = 'ch-num'; n.textContent = labelFor(i);
    head.append(m, n);
    const label = labelFor(i).toLowerCase();
    if (ch.title && ch.title.toLowerCase().replace(/\s+/g, ' ') !== label && !isPlainTitle(ch.title)) {
      const t = document.createElement('div'); t.className = 'ch-title'; t.textContent = ch.title; head.appendChild(t);
    }
    sec.appendChild(head);
    if (!detached) stream.appendChild(sec);
    return sec;
  }

  async function fillChapter(sec, i, gen) {
    const ch = R.chapters[i];
    $$('.ch-msg,.ch-end,img.page,.page-fail', sec).forEach(n => { if (n._blob) URL.revokeObjectURL(n._blob); n.remove(); });
    const wait = document.createElement('div'); wait.className = 'ch-msg';
    wait.innerHTML = '<div class="spinner"></div>Loading ' + labelFor(i) + '…';
    sec.appendChild(wait);
    try {
      const { doc, base } = await fetchDoc(ch.url);
      if (gen !== R.gen) return;                      // user jumped elsewhere meanwhile
      let imgs = extractImages(doc, base);
      if (!imgs.length) imgs = await probeNumbered(doc, base, ch.url);   // round 10: numbered pictures next to the preview picture
      if (!imgs.length) throw noImagesError(doc, base);                  // says WHY (locked / removed / script-built) and carries a report
      sec._imgs = imgs;                               // remembered for the PDF download (original picture addresses)
      // List incomplete? The page's "Next" link adds the following chapter (only ever to the end of the list).
      const nx = findNextLink(doc, base, ch.url), last = R.chapters[R.chapters.length - 1];
      if (nx && last && nx.num > last.num && !R.chapters.some(c => sameUrl(c.url, nx.url))) {
        R.chapters.push(nx); buildChapterMenu(); $('#theEnd').hidden = true;
      }
      wait.remove();
      const frag = document.createDocumentFragment();
      imgs.forEach((src, k) => frag.appendChild(makeImg(src, k, ch.url)));
      sec.appendChild(frag);
      const end = document.createElement('div'); end.className = 'ch-end';
      end.textContent = 'End of ' + labelFor(i) + (i + 1 < R.chapters.length ? ' · next chapter follows' : '');
      sec.appendChild(end);
      updateDlBar();
    } catch (e) {
      if (gen !== R.gen) return;
      wait.className = 'ch-msg';
      wait.innerHTML = '';
      wait.append('Could not load ' + labelFor(i) + ': ' + e.message);
      if (/bot check|HTTP 40[13]|HTTP 429|HTTP 503/i.test(e.message)) reportBlocked(ch.url, e.message);   // round 8: one big pop-up per site
      // ROUND 9: a chapter we only GUESSED (chapter-3 from chapter-5) that does not exist is not an error: drop it quietly.
      if (ch.guess && /HTTP 404|HTTP 410|no images found|not found/i.test(e.message)) {
        ch.dead = true; removeSection(sec); buildChapterMenu(); updateDlBar();
        if (!R.deadToast) { R.deadToast = true; toast('Some earlier chapters do not exist on this site and were skipped'); }
        return;
      }
      // ROUND 9: the first "no pictures" problem of a site gets the big pop-up (with the report), the rest stay small.
      // ROUND 10: EVERY kind of chapter failure gets the big pop-up with a report (once per site and kind, so a bad site cannot flood you).
      if (!/bot check|HTTP 40[13]|HTTP 429|HTTP 503/i.test(e.message) && !noImgSeen.has(hostOf(ch.url) + '|' + e.message.slice(0, 40))) {
        noImgSeen.add(hostOf(ch.url) + '|' + e.message.slice(0, 40));
        showError('Could not load ' + labelFor(i) + ': ' + e.message, { details: (e.details || '') + '\nChapter address: ' + ch.url + '\nChapters in the list: ' + R.chapters.length });
      }
      const row = document.createElement('div'); row.className = 'row';
      const retry = document.createElement('button'); retry.textContent = 'Retry';
      const skip = document.createElement('button'); skip.textContent = 'Skip';
      // Other chapters of the batch keep loading, so a failure no longer stops everything (round 6).
      retry.onclick = () => { cache.delete(ch.url); fillChapter(sec, i, R.gen); };
      skip.onclick = () => { sec.remove(); updateDlBar(); };
      row.append(retry, skip);
      if (e.details) { const dt = document.createElement('button'); dt.textContent = 'Details'; dt.onclick = () => showError(e.message, { details: e.details }); row.append(dt); }
      wait.appendChild(row);
    }
  }

  /* Image element (round 8: more ways to load, and a visible Retry).
     WHY: lazy loading saves data; no-referrer avoids hotlink blocks. Some picture hosts only answer when the
          request looks like it comes from the manga site (they check the "Referer"). The browser cannot send that
          itself, but YOUR proxy (start-manga.bat or worker.js) can: it gets &ref=<chapter address>.
     HOW: when the picture fails to load, these are tried in order, each only after the one before failed:
            1. your own / local proxy, with the chapter address as referer (the answer becomes a blob: address),
            2. the public image proxy images.weserv.nl.
          If all fail, the picture is replaced by a clear box: "Page N could not be loaded" with Retry and
          "Open picture" (the plain link) - never an empty grey space.
     IMPROVE: show which step worked, and remember hosts that always need the proxy so the first try is skipped. */
  function makeImg(src, k, ref) {
    const img = document.createElement('img');
    img.className = 'page'; img.alt = 'Page ' + (k + 1);
    img.loading = 'lazy'; img.decoding = 'async'; img.referrerPolicy = 'no-referrer';
    const own = proxyList(false).find(p => !DEFAULT_PROXIES.includes(p));
    const attempts = [];
    if (own) attempts.push(async () => {
      const full = own.replace('{url}', encodeURIComponent(src)) + (ref ? '&ref=' + encodeURIComponent(ref) : '');
      const res = await fetch(full, { referrerPolicy: 'no-referrer', credentials: 'omit' });
      if (!res.ok) throw new Error('HTTP ' + res.status);
      const blob = await res.blob();
      if (blob.size < 200) throw new Error('not a picture');
      if (img._blob) URL.revokeObjectURL(img._blob);
      img._blob = URL.createObjectURL(blob); img.src = img._blob;
    });
    attempts.push(async () => { img.src = 'https://images.weserv.nl/?url=' + encodeURIComponent(src.replace(/^https?:\/\//, '')); });
    let n = 0;
    const fail = () => {
      const box = document.createElement('div'); box.className = 'page-fail';
      box.append('Page ' + (k + 1) + ' could not be loaded.');
      const row = document.createElement('div'); row.className = 'row';
      const retry = document.createElement('button'); retry.type = 'button'; retry.textContent = 'Retry';
      retry.onclick = () => { box.remove(); n = 0; img.hidden = false; img.src = src + (src.includes('?') ? '&' : '?') + 'r=' + Date.now(); };
      const a = document.createElement('a'); a.href = src; a.target = '_blank'; a.rel = 'noopener noreferrer'; a.textContent = 'Open picture';
      const dt = document.createElement('button'); dt.type = 'button'; dt.textContent = 'Details';
      dt.onclick = () => showError('Page ' + (k + 1) + ' could not be loaded', { details: 'Picture address: ' + src + '\nChapter address: ' + (ref || '-') + '\nTried: the picture directly, your own proxy with the chapter as referer (if you have one), images.weserv.nl.' });
      row.append(retry, a, dt); box.appendChild(row);
      img.hidden = true; img.after(box);
    };
    img.onload = () => {
      const h0 = img.offsetHeight;                                           // height with the grey placeholder
      img.classList.add('loaded');
      if (!ANCHOR_OK && img.getBoundingClientRect().bottom <= 0) window.scrollBy(0, img.offsetHeight - h0);   // keep the view still
    };
    img.onerror = async () => {
      if (n >= attempts.length) return fail();
      const step = attempts[n++];
      try { await step(); } catch { img.onerror(); }
    };
    img.src = src;
    return img;
  }

  /* ---------------------------------------------------------------
     10. CHAPTER NAVIGATION (dropdown list, prev/next, home/end)
     WHY: goChapter scrolls to a chapter that is already loaded, loads it if it is the next one,
          or restarts the stream from it (jumpTo) when it is far away.
     HOW: markInput() tells the scroll code "this scrolling was on purpose" (see section 11).
     IMPROVE: when jumping far, keep earlier chapters collapsed above so scrolling up still works. */
  function buildChapterMenu() {
    const ul = $('#chapterList'); ul.innerHTML = '';
    R.chapters.forEach((c, i) => {
      if (c.dead) return;                                                // a guessed chapter that does not exist
      const li = document.createElement('li'), b = document.createElement('button');
      b.textContent = labelFor(i) + (c.title && c.title.length < 60 && !isPlainTitle(c.title) ? ' — ' + c.title : '');
      b.dataset.index = i;
      b.onclick = () => { closeMenu(); jumpOrGo(i); };
      li.appendChild(b); ul.appendChild(li);
    });
  }
  function toggleMenu() {
    const m = $('#chapterMenu'); m.hidden = !m.hidden;
    if (!m.hidden) { markCurrent(); const c = $('#chapterList button.current'); if (c) c.scrollIntoView({ block: 'center' }); }
  }
  const closeMenu = () => { $('#chapterMenu').hidden = true; };
  function markCurrent() { $$('#chapterList button').forEach(b => b.classList.toggle('current', +b.dataset.index === R.cur)); }

  // WHY lastInput = 0: a jump with the chapter keys is a big scroll that is NOT the person "reading downwards",
  // so it must not hide the keys / title bar (otherwise you could not press the key a second time).
  async function jumpTo(i) {                         // restart the stream at chapter i
    holdUiFor(2500);
    R.gen++; R.first = i; R.next = i; R.cur = i; R.loading = false; R.paused = false;
    stream.innerHTML = ''; $('#theEnd').hidden = true; updateDlBar(); updatePrevBar();
    window.scrollTo(0, 0); lastY = 0;
    await loadNext();
  }
  async function goChapter(i) {
    if (i < 0) return toast('This is the first chapter');
    if (i >= R.chapters.length) return toast('No more chapters');
    holdUiFor(2500);
    let s = secFor(i);
    if (!s && i < R.first && R.first - i <= 2 * BATCH_PREV) { loadPrev(R.first - i); s = secFor(i); }   // round 9: an earlier chapter, added above
    if (!s && i >= R.next) { await loadNext(); s = secFor(i); }     // wait for the running batch, then scroll
    if (!s) return jumpTo(i);
    s.scrollIntoView({ block: 'start' });
  }
  const jumpOrGo = i => (secFor(i) || i === R.next || (i < R.first && R.first - i <= 2 * BATCH_PREV)) ? goChapter(i) : jumpTo(i);

  /* END (round 8): jump to the very bottom of everything that is loaded.
     WHY: with hundreds of chapters, dragging the scrollbar is slow. Pressing the round "end" key, or the real End key
          on the keyboard, goes straight to the bottom (the download bar). The bottom is near the loader, so the next
          10 chapters begin loading by themselves and the page grows below you.
     HOW: scroll to the full page height. lastInput = 0 (for the on-screen key AND the real End key), so the keys do
          not hide themselves and you can press again, or press Download, at once. */
  function goEnd() {
    holdUiFor(2500);                        // a jump is not "reading downwards": keep the keys visible (also for the real End key)
    window.scrollTo({ top: document.documentElement.scrollHeight });
  }

  /* ---------------------------------------------------------------
     9b. READING UPWARDS: EARLIER CHAPTERS  (round 9)
     WHY: when you open the link of chapter 5, reading starts at chapter 5. Before, chapters 1 to 4 could not be reached by
          scrolling up (the page only ever grew downwards), so you could only go forward.
     HOW: R.first is the number of the first chapter that is on the page. loadPrev() builds the boxes of the chapters
          before it (5 at a time), puts them ABOVE the first one (stream.insertBefore) and then scrolls by exactly the
          height that was added, so the picture you are looking at does not move. They start loading at once.
          It is triggered by: scrolling up near the top, the mouse wheel / a finger drag / the Up, PageUp and Home keys at
          the very top (the page cannot scroll there, so no scroll event comes), the "Load earlier chapters" button, and
          the up round key / Left arrow when the chapter before the first one is wanted (goChapter).
     LIMITS: a browser without "scroll anchoring" (old Safari) is helped by keepView() and makeImg(), which scroll by hand when a
             box ABOVE the screen changes height.
     IMPROVE: also remove far-away chapters at the bottom when many earlier ones are loaded (see Free memory). */
  const BATCH_PREV = 5;                                               // how many earlier chapters one load adds
  const ANCHOR_OK = (() => { try { return CSS.supports('overflow-anchor', 'auto'); } catch { return false; } })();   // browser keeps the view still itself?
  const noImgSeen = new Set();                                        // sites that already got the "no pictures found" pop-up

  // Text above the stream: is there anything earlier, and which chapter would come next.
  function updatePrevBar() {
    const has = R.first > 0;
    $('#btnPrevLoad').disabled = !has;                                // CSS hides a disabled button, the text stays
    $('#prevInfo').textContent = has ? labelFor(R.first - 1) + ' and earlier are above · scroll up or tap the button'
      : (R.chapters.length ? '— This is the first chapter —' : '');
  }

  // Remove one chapter box (a guessed chapter that does not exist) without moving the page when it is above the screen.
  function removeSection(sec) {
    const above = !ANCHOR_OK && sec.getBoundingClientRect().bottom <= 0, h = sec.offsetHeight;
    sec.remove();
    if (above) window.scrollBy(0, -h);
  }

  /* Load up to `count` earlier chapters ABOVE the first one. The boxes are created at once (so callers can scroll to them
     right away); the returned promise finishes when their pages have been fetched. */
  function loadPrev(count = BATCH_PREV) {
    if (reader.hidden || R.first <= 0) return Promise.resolve();
    const gen = R.gen, to = R.first, from = Math.max(0, to - Math.max(1, count));
    R.first = from;                                                   // set at once: a second trigger cannot load the same chapters twice
    const anchor = stream.querySelector('.chapter');                  // the chapter that is at the top right now
    const before = anchor ? anchor.getBoundingClientRect().top : 0;
    const frag = document.createDocumentFragment(), secs = [];
    for (let i = from; i < to; i++) { const s = makeSection(i, true); frag.appendChild(s); secs.push(s); }
    stream.insertBefore(frag, anchor);                                // earlier chapters go ABOVE the first one
    // Keep the page where it was. (Measured after the insert: if the browser already corrected the scroll itself this is ~0.)
    if (anchor) window.scrollBy(0, anchor.getBoundingClientRect().top - before);
    updatePrevBar();
    return Promise.all(secs.map(s => fillChapter(s, +s.dataset.index, gen)));
  }

  // Next / previous chapter that really exists (guessed chapters that turned out missing are skipped).
  const alive = i => R.chapters[i] && !R.chapters[i].dead;
  function stepChapter(dir) {
    let i = R.cur + dir;
    while (i >= 0 && i < R.chapters.length && !alive(i)) i += dir;
    return goChapter(i);
  }

  /* RELOAD BUTTONS (round 6)
     WHY: a chapter can load half-broken (slow proxy, missing pictures). Instead of leaving reading mode,
          "reload" fetches the chapter again; "reload all" does the same for every open chapter.
     HOW: the chapter's saved page is dropped from the cache, the pictures are removed and fillChapter()
          builds them again. The box keeps its old height meanwhile (min-height), so the page does not jump.
     IMPROVE: reload only the pictures that failed, and show a count of how many were repaired. */
  async function reloadSections(secs, btn) {
    if (!secs.length) return;
    if (btn) btn.classList.add('spin');
    const gen = R.gen;
    secs.forEach(sec => { if (sec._cleared) { sec._cleared = false; $$('.ch-cleared', sec).forEach(n => { clearIO.unobserve(n); n.remove(); }); } sec.style.minHeight = sec.offsetHeight + 'px'; cache.delete(sec.dataset.url); });
    try {
      for (let k = 0; k < secs.length; k += BATCH)                      // up to BATCH chapters at the same time
        await Promise.all(secs.slice(k, k + BATCH).map(sec => fillChapter(sec, +sec.dataset.index, gen)));
    } finally {
      secs.forEach(sec => { sec.style.minHeight = ''; });
      if (btn) btn.classList.remove('spin');
      updateDlBar();
    }
  }
  const reloadCurrent = () => { const sec = secFor(R.cur); if (sec) { toast('Reloading ' + labelFor(R.cur) + '…'); reloadSections([sec], $('#btnReload1')); } };
  /* ---------------------------------------------------------------
     10b. FREE MEMORY / CLEAR CHAPTER CACHE  (round 7)
     WHY: with 30-50 chapters open, thousands of big pictures sit in memory and the page gets slow and jumpy.
          Clearing a range of chapters throws their pictures away but keeps the empty box (same height), so
          your scroll position does not jump.
     HOW: freeSection() removes the pictures and puts a small notice in the box. The picture ADDRESSES stay in
          sec._imgs, so (1) when the box comes near the screen again restoreSection() rebuilds the pictures by
          itself (observer clearIO), and (2) a PDF download still knows the chapter.
          The chapter you are reading is never cleared. Optional automatic mode: settings.autoFree.
     WHERE: buttons live in the Settings dialog (index.html #memBox) and are wired in section 15;
            the reader bar has a gear button and the chapter menu a "Free memory" entry that open that dialog.
     IMPROVE: also drop far-away chapters that were never visited, show how many MB were freed. */
  const clearIO = new IntersectionObserver(es => {
    es.forEach(e => { if (e.isIntersecting) restoreSection(e.target.closest('.chapter')); });
  }, { rootMargin: '1200px' });

  function freeSection(sec) {
    if (!sec || sec._cleared || !sec._imgs || +sec.dataset.index === R.cur) return false;
    sec.style.minHeight = sec.offsetHeight + 'px';                    // keep the height: no scroll jump
    $$('img.page,.ch-end,.ch-msg,.page-fail', sec).forEach(n => { if (n.tagName === 'IMG') { n.removeAttribute('src'); if (n._blob) URL.revokeObjectURL(n._blob); } n.remove(); });
    cache.delete(sec.dataset.url);
    const ph = document.createElement('div'); ph.className = 'ch-cleared';
    ph.append(labelFor(+sec.dataset.index) + ' was cleared to save memory. It comes back when you scroll here. ');
    const b = document.createElement('button'); b.textContent = 'Load now'; b.onclick = () => restoreSection(sec);
    ph.appendChild(b); sec.appendChild(ph);
    sec._cleared = true; clearIO.observe(ph);
    return true;
  }
  function restoreSection(sec) {
    if (!sec || !sec._cleared) return;
    sec._cleared = false;
    $$('.ch-cleared', sec).forEach(n => { clearIO.unobserve(n); n.remove(); });
    const i = +sec.dataset.index, frag = document.createDocumentFragment();
    sec._imgs.forEach((src, k) => frag.appendChild(makeImg(src, k, sec.dataset.url)));
    sec.appendChild(frag);
    const end = document.createElement('div'); end.className = 'ch-end';
    end.textContent = 'End of ' + labelFor(i) + (i + 1 < R.chapters.length ? ' · next chapter follows' : '');
    sec.appendChild(end);                                              // min-height stays, so nothing jumps
  }
  function clearRange(a, b) {
    let n = 0;
    $$('.chapter', stream).forEach(sec => { const i = +sec.dataset.index; if (i >= a && i <= b && freeSection(sec)) n++; });
    return n;
  }
  function memInfo() {
    const secs = $$('.chapter', stream), open = secs.filter(x => x._imgs && !x._cleared).length;
    $('#memInfo').textContent = reader.hidden
      ? 'Open reading mode first. This clears chapters you have opened there.'
      : open + ' chapter' + (open === 1 ? '' : 's') + ' in memory · ' + secs.filter(x => x._cleared).length + ' cleared';
    $$('#memBox button, #memBox select').forEach(el => { if (el.id !== 'memAuto') el.disabled = reader.hidden; });
  }
  function fillMemSelects() {
    [$('#memFrom'), $('#memTo')].forEach(sel => {
      sel.innerHTML = '';
      R.chapters.forEach((c, i) => { const o = document.createElement('option'); o.value = i; o.textContent = labelFor(i); sel.appendChild(o); });
    });
    const open = $$('.chapter', stream).map(x => +x.dataset.index);
    if (open.length) { $('#memFrom').value = Math.min(...open); $('#memTo').value = Math.max(R.cur - 1, Math.min(...open)); }
  }
  function autoFree() {                                                // called while scrolling (updateCurrent)
    if (!settings.autoFree) return;
    $$('.chapter', stream).forEach(sec => { if (+sec.dataset.index < R.cur - settings.autoFree) freeSection(sec); });
  }

  const reloadEvery = () => { const secs = $$('.chapter', stream); toast('Reloading ' + secs.length + ' chapter' + (secs.length === 1 ? '' : 's') + '…'); reloadSections(secs, $('#btnReloadAll')); };

  /* ---------------------------------------------------------------
     11. SCROLL TRACKING + AUTO-HIDING UI  (changed in round 2)
     WHY: the title bar and the arrow keys cover the art, so they hide while you read downwards.
          NEW RULE: they come back ONLY when you scroll UP (mouse wheel up, finger drag down, Up / PageUp / Home key,
          scrollbar drag up) or when you reach the very top. They no longer come back by themselves after a pause.
     HOW: on every scroll event we compare the new position with the last one.
          Down more than 14 px in a row  -> hide.   Up more than 14 px in a row -> show.
          The 14 px "dead zone" stops tiny finger wobbles from flickering the buttons.
          lastInput remembers when the PERSON last used wheel / touch / keyboard / scrollbar. Scroll events that
          happen long after that (pictures loading and moving the page) are ignored, so they cannot hide or show
          the buttons by accident.
     WHERE: onScroll() runs on every scroll event; showUi/hideUi toggle body.scrolling, which style.css uses to fade .ui-hide items
            (title bar buttons and the #side key block). goChapter/jumpTo set lastInput = 0 so key jumps do not hide the keys.
     IMPROVE: make the 14 px and 1.5 s numbers settings; add a small "show buttons" handle at the screen edge. */
  let lastY = 0, upAcc = 0, downAcc = 0, lastInput = 0, holdUi = 0, saveTimer, ticking = false;
  // ROUND 8 fix: holdUi = "a deliberate jump (chapter key, End) happened a moment ago, do not hide the keys".
  // WHY: with the REAL keyboard keys our handler runs first and the generic "person is scrolling" marker (markInput)
  // runs second, so lastInput = 0 was overwritten and the jump hid the keys. holdUi is not touched by markInput.
  const holdUiFor = ms => { lastInput = 0; holdUi = Date.now() + ms; };
  const markInput = () => { lastInput = Date.now(); };
  function showUi() { document.body.classList.remove('scrolling'); upAcc = downAcc = 0; }
  function hideUi() { document.body.classList.add('scrolling'); upAcc = downAcc = 0; }

  function onScroll() {
    if (reader.hidden) return;
    const y = window.scrollY, dy = y - lastY; lastY = y;
    if (dy < 0 && y < 700 && R.first > 0 && Date.now() - lastInput < 1500) loadPrev();   // round 9: scrolled up near the top -> earlier chapters
    if (Date.now() - lastInput < 1500 && Date.now() > holdUi) {   // only react to scrolling the person did on purpose (and not to our own jumps)
      if (y < 40) showUi();                              // at the very top the bar is always visible
      else if (dy < 0) { upAcc -= dy; downAcc = 0; if (upAcc > 14) showUi(); }
      else if (dy > 0) { downAcc += dy; upAcc = 0; if (downAcc > 14) hideUi(); }
    }
    if (!ticking) { ticking = true; requestAnimationFrame(() => { updateCurrent(); ticking = false; }); }
  }
  function updateCurrent() {
    const secs = $$('.chapter', stream); if (!secs.length) return;
    const mid = window.innerHeight * 0.4;
    let s = secs[0];
    for (const x of secs) { if (x.getBoundingClientRect().top <= mid) s = x; else break; }
    const idx = +s.dataset.index;
    if (idx !== R.cur) { R.cur = idx; $('#rSub').textContent = labelFor(idx); markCurrent(); }
    // Close to the end of what is loaded (2 chapters left)? Start the next batch now, so you never wait.
    if (!R.loading && R.next < R.chapters.length && idx >= R.next - 2) loadNext();
    autoFree();
    const r = s.getBoundingClientRect();
    const pct = Math.max(0, Math.min(1, (mid - r.top) / Math.max(1, r.height)));
    $('#progress i').style.width = (pct * 100).toFixed(1) + '%';
    clearTimeout(saveTimer);
    saveTimer = setTimeout(() => rememberChapter(idx), 600);       // wait until scrolling calms down, then save
  }
  // Save "this manga, this chapter, now" in the history (used by Continue reading).
  function rememberChapter(idx) {
    const ch = R.chapters[idx]; if (!ch) return;
    // ROUND 9b: write the chapter into the address of THIS page (#r=<chapter link>). WHY: a refresh used to drop you on the
    // start page. Now start-up reads it back (see resumeFromHash). The same address, opened on another device, also resumes
    // at this chapter (the reading list itself cannot travel between devices: it lives only in each browser).
    if (!settings.noHistory) { try { history.replaceState(null, '', location.pathname + location.search + '#r=' + encodeURIComponent(ch.url)); } catch { /* address bar not writable: fine */ } }
    saveRead({
      id: new URL(R.chapters[0].url).origin + '|' + R.title,
      title: R.title, host: hostOf(ch.url), seriesUrl: R.seriesUrl,
      chapterUrl: ch.url, chapterLabel: labelFor(idx), at: Date.now()
    });
  }

  /* Leave reading mode (without opening any page). Used by exitReading() and the reader's search bar. */
  function leaveReader() {
    io.disconnect(); closeMenu();
    try { history.replaceState(null, '', location.pathname + location.search); } catch { /* ignore */ }   // forget #r=: a refresh now shows the start page
    reader.hidden = true; $('#browser').hidden = false;
    document.body.classList.remove('reading'); syncDock();
    showUi();
    window.scrollTo(0, 0);
    renderStart();
  }
  /* Exit reading mode and open the website page of the chapter you were on. */
  function exitReading() {
    const ch = R.chapters[R.cur];
    leaveReader();
    if (ch && (!cur || !sameUrl(cur.url, ch.url))) navigate(ch.url);
  }

  /* SEARCH / LINK BAR INSIDE READING MODE (round 8)
     WHY: you can paste another manga link (or type a name) without leaving reading mode first.
     HOW: reading mode is closed, the link is opened with navigate(..., { user: true }) so a manga link starts reading
          by itself (see tryAutoRead). Words are searched. If the new page cannot be loaded, you are put back exactly
          where you were reading. */
  async function readerGo(v) {
    v = (v || '').trim(); if (!v) return;
    const y = window.scrollY, hadReader = R.chapters.length > 0;
    leaveReader();
    const ok = await navigate(v, true, { user: true });
    if (!ok && hadReader) {
      $('#browser').hidden = true; reader.hidden = false; document.body.classList.add('reading'); syncDock();
      io.observe(sentinel); window.scrollTo(0, y); showUi();
    }
  }

  /* Tap the chapter to scroll.
     WHY: lets you read with one thumb: tap the page = scroll down about one screen; tap the top
          fifth of the screen = scroll back up. Skips buttons, links, failed-image retry taps and
          text selection so those still work. Can be switched off in Settings.
     IMPROVE: add a left/right tap-zone layout, or make the scroll distance a setting. */
  function tapScroll(e) {
    const t = e.target;
    if (t.closest('button, a')) return;
    if (t.matches && t.matches('img.page') && !t.classList.contains('loaded')) return;   // failed image: tap retries it
    if (window.getSelection && String(window.getSelection())) return;                   // user is selecting text
    const up = e.clientY < window.innerHeight * 0.2;
    markInput();
    window.scrollBy({ top: (up ? -1 : 1) * window.innerHeight * 0.85, behavior: 'smooth' });
  }

  /* ---------------------------------------------------------------
     12. PDF DOWNLOAD (the "Download all chapters" button)
     WHY: read offline. One PDF with every chapter that is loaded in reading mode, in reading order.
          ROUND 6: each chapter is ONE long page (a "long strip"), exactly like the reading mode:
          a title block at the top (manga name, chapter number, chapter title), all pictures stacked, and an
          "End of Chapter N" block at the bottom, in the same white/black theme. The file is named after the manga.
     HOW:
       1. Each page picture is downloaded as BYTES (fetchBytes). Browsers only allow that when the picture
          host sends a CORS permission, so we try: direct -> your proxies -> images.weserv.nl (last resort).
          The route that worked is remembered per website to make the next pages faster.
       2. addPageImage() puts the bytes in the PDF. JPEG and simple PNG are copied untouched (best quality,
          smallest size). WebP/GIF/other formats are decoded by the browser and stored losslessly
          (or as JPEG 98% if you chose "smaller files" in Settings).
       3. addTextPage() draws the title block and the "End of Chapter N" block with a canvas, so every language works.
       4. A picture that cannot be downloaded is NEVER skipped silently: a placeholder block says which page
          is missing, and the final message lists them.
       5. pdfmaker.js stacks everything of one chapter on one tall page. The picture data is never changed, so
          quality is the same as the source files (see pdfmaker.js for the page-size rules).
     WHERE: started by #btnDl (end of reading mode) and #btnDlMenu (chapter menu) -> range dialog (12b) -> download manager (12c);
            markup in index.html (#dlBar, #rangeDlg, #dock), styles in style.css, PDF writer = pdfmaker.js.
     IMPROVE: write to disk while downloading (File System Access API), resume after a failure, and let
              the person pick a chapter range. Very large PDFs (hundreds of MB) can run out of memory on phones. */
  const PDF_Q = 0.92;               // round 10: JPEG quality for converted pictures (92% looks the same, files are far smaller)
  const SLICE = 2000;               // pictures that need the browser decoder are cut into strips of this height

  function sniff(b) {               // what kind of picture is this? (look at the first bytes, not the file name)
    if (b.length > 3 && b[0] === 0xFF && b[1] === 0xD8 && b[2] === 0xFF) return 'jpeg';
    if (b.length > 7 && b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4E && b[3] === 0x47) return 'png';
    if (b.length > 11 && b[0] === 0x52 && b[1] === 0x49 && b[2] === 0x46 && b[3] === 0x46 && b[8] === 0x57 && b[9] === 0x45 && b[10] === 0x42 && b[11] === 0x50) return 'webp';
    if (b.length > 5 && b[0] === 0x47 && b[1] === 0x49 && b[2] === 0x46) return 'gif';
    if (b.length > 11 && b[4] === 0x66 && b[5] === 0x74 && b[6] === 0x79 && b[7] === 0x70) return 'avif';
    return null;
  }

  const routeMemory = new Map();    // website -> name of the route that worked last time
  /* The ways to get a picture's bytes. Your own proxy gets &ref=<chapter address> so picture hosts that check the
     "Referer" accept the request (round 8). Free public proxies do not get it (they would ignore or mishandle it). */
  function byteRoutes(ref) {
    const routes = [{ name: 'direct', make: u => u }];
    proxyList(false).forEach(tpl => routes.push({
      name: proxyName(tpl),
      make: u => tpl.replace('{url}', encodeURIComponent(u)) + (ref && !DEFAULT_PROXIES.includes(tpl) ? '&ref=' + encodeURIComponent(ref) : '')
    }));
    routes.push({ name: 'images.weserv.nl', make: u => 'https://images.weserv.nl/?q=100&url=' + encodeURIComponent(u) });
    return routes;
  }
  /* Download one picture as bytes. `job` = the download job (its .cancel flag stops us), `ref` = chapter address.
     POLITE (round 8): a ticket from gate() is needed for every try, so at most 4 pictures per website are asked for at
     once with small random pauses. A "429 / 503" answer makes everybody wait first (coolDown). */
  async function fetchBytes(url, job, ref) {
    const host = hostOf(url);
    let routes = byteRoutes(ref);
    const good = routeMemory.get(host);
    if (good) routes = [...routes.filter(r => r.name === good), ...routes.filter(r => r.name !== good)];
    const errors = [];
    for (let round = 0; round < 2; round++) {              // go through every route twice before giving up
      for (const r of routes) {
        if (job && job.cancel) throw new Error('cancelled');
        const release = await gate('i:' + host, 4, 70, job);
        const ctrl = new AbortController(), timer = setTimeout(() => ctrl.abort(), 30000);
        try {
          const res = await fetch(r.make(url), { signal: ctrl.signal, referrerPolicy: 'no-referrer', credentials: 'omit' });
          if (res.status === 429 || res.status === 503) {
            coolDown('i:' + host, (+res.headers.get('retry-after') || 5) * 1000);
            throw new Error('HTTP ' + res.status + ' (slowing down)');
          }
          if (!res.ok) throw new Error('HTTP ' + res.status);
          const bytes = new Uint8Array(await res.arrayBuffer());
          if (bytes.length < 200 || !sniff(bytes)) throw new Error('not a picture');   // error pages are not pictures
          routeMemory.set(host, r.name);
          return bytes;
        } catch (e) { errors.push(r.name + ': ' + (e.name === 'AbortError' ? 'timeout' : e.message)); }
        finally { clearTimeout(timer); release(); }
      }
    }
    throw new Error(errors.slice(-4).join(' | '));
  }

  const toRgb = rgba => {           // canvas gives 4 bytes per pixel (R,G,B,A); the PDF wants 3 (R,G,B)
    const out = new Uint8Array((rgba.length / 4) * 3);
    for (let i = 0, j = 0; i < rgba.length; i += 4, j += 3) { out[j] = rgba[i]; out[j + 1] = rgba[i + 1]; out[j + 2] = rgba[i + 2]; }
    return out;
  };

  async function addPageImage(pdf, bytes, mode) {          // mode: 'small' or 'lossless' (default = the setting)
    const kind = sniff(bytes);
    try {                                                  // best case: copy the original bytes
      if (kind === 'jpeg') return await pdf.addJpeg(bytes);
      if (kind === 'png') return await pdf.addPng(bytes);
    } catch { /* unusual file: let the browser decode it below */ }
    const bmp = await createImageBitmap(new Blob([bytes]));
    try {
      const w = bmp.width, h = bmp.height;
      const c = document.createElement('canvas');
      let pages = 0;
      for (let y = 0; y < h; y += SLICE) {                 // strips keep canvases small enough for phones
        const sh = Math.min(SLICE, h - y);
        c.width = w; c.height = sh;
        const g = c.getContext('2d', { willReadFrequently: true });
        g.fillStyle = '#fff'; g.fillRect(0, 0, w, sh);     // transparent areas become white
        g.drawImage(bmp, 0, y, w, sh, 0, 0, w, sh);
        if ((mode || settings.pdfMode) === 'small') {
          const blob = await new Promise(res => c.toBlob(res, 'image/jpeg', PDF_Q));
          pages += (await pdf.addJpeg(new Uint8Array(await blob.arrayBuffer()))).pages;
        } else {
          pages += (await pdf.addRaw(w, sh, toRgb(g.getImageData(0, 0, w, sh).data))).pages;
        }
        await sleep0();                                    // round 8: give the page a breath so reading stays smooth
      }
      return { pages, width: w, height: h };
    } finally { if (bmp.close) bmp.close(); }
  }

  // A block with text only, drawn on a canvas, then added to the strip.
  // `lines` = [{ text, size (fraction of width), y (fraction of height), bold, muted }]
  // `edge` = 'top' or 'bottom': which side gets the thin divider line (like the borders in reading mode).
  // `front` = true puts the block at the very top of the strip (used for the chapter title block).
  async function addTextPage(pdf, w, h, lines, edge, front, dark) {   // dark = theme chosen when the download started
    const c = document.createElement('canvas'); c.width = w; c.height = h;
    const g = c.getContext('2d', { willReadFrequently: true });
    g.fillStyle = dark ? '#000' : '#fff'; g.fillRect(0, 0, w, h);
    g.textAlign = 'center'; g.textBaseline = 'middle';
    lines.forEach(L => {
      let size = Math.round(w * L.size);
      const font = () => { g.font = (L.bold ? '700 ' : '400 ') + size + 'px system-ui, "Segoe UI", Roboto, Arial, sans-serif'; };
      font();
      while (g.measureText(L.text).width > w * 0.92 && size > 12) { size -= 2; font(); }   // shrink long titles to fit
      g.fillStyle = L.muted ? (dark ? '#9a9a9a' : '#666') : (dark ? '#eee' : '#111');
      g.fillText(L.text, w / 2, Math.round(h * L.y));
    });
    g.fillStyle = dark ? '#333' : '#ddd';
    if (edge) g.fillRect(0, edge === 'top' ? 0 : h - 2, w, 2);
    return pdf.addRaw(w, h, toRgb(g.getImageData(0, 0, w, h).data), !!front);
  }

  const fileSafe = t => (t || 'manga').replace(/[\\/:*?"<>|\u0000-\u001f]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 120) || 'manga';

  function updateDlBar() {
    const secs = $$('.chapter', stream).filter(s => s._imgs);
    const pages = secs.reduce((n, s) => n + s._imgs.length, 0);
    $('#dlBar').hidden = !secs.length;
    $('#dlInfo').textContent = secs.length + ' chapter' + (secs.length === 1 ? '' : 's') + ' · ' + pages + ' pages loaded · ' + R.chapters.length + ' in the list';
  }

  /* ---------------------------------------------------------------
     12b. DOWNLOAD RANGE DIALOG  (round 7)
     WHY: a manga can have 100s of chapters. The person picks WHICH ones (1-50, 51-100, the rest...) and may split
          the result into several smaller files. Chapters that are not open in reading mode are fetched by the
          download itself, so any chapter of the list can be chosen.
     HOW: two drop-downs (from / to), quick buttons made from the chapter count, and a "split" choice.
          "Make PDF" builds a job description (a plain snapshot) and hands it to queueDownload().
     WHERE: dialog markup = index.html #rangeDlg; styles = style.css "RANGE DIALOG"; opened by #btnDl and #btnDlMenu.
     IMPROVE: show an estimated file size, remember the last range, add "only chapters I have not downloaded". */
  const rgFrom = $('#rgFrom'), rgTo = $('#rgTo'), rgSplit = $('#rgSplit');
  const chapNo = i => (R.chapters[i] && R.chapters[i].num != null) ? fmtNum(R.chapters[i].num) : String(i + 1);
  function setRange(a, b) { rgFrom.value = a; rgTo.value = b; const o = $('#rgAuto'); if (o) o.remove(); rgSplit.value = '0'; rangeInfo(); scheduleEstimate(); }
  function rangeValues() {
    let a = +rgFrom.value, b = +rgTo.value;
    if (a > b) [a, b] = [b, a];
    return [a, b];
  }
  function rangeInfo() {
    const [a, b] = rangeValues(), n = b - a + 1, per = +rgSplit.value;
    const files = per > 0 ? Math.ceil(n / per) : 1;
    const loaded = $$('.chapter', stream).filter(s => s._imgs && +s.dataset.index >= a && +s.dataset.index <= b).length;
    $('#rgInfo').textContent = labelFor(a) + ' to ' + labelFor(b) + ' · ' + n + ' chapter' + (n === 1 ? '' : 's') +
      ' · ' + files + ' file' + (files === 1 ? '' : 's') + ' · ' + loaded + ' already open in reading mode';
  }
  function openRangeDialog() {
    if (!window.MangaPDFLib) return toast('pdfmaker.js did not load. Keep it in the same folder as app.js.', true);
    const n = R.chapters.length;
    if (!n) return toast('No chapter list yet');
    [rgFrom, rgTo].forEach(sel => {
      sel.innerHTML = '';
      R.chapters.forEach((c, i) => { const o = document.createElement('option'); o.value = i; o.textContent = labelFor(i); sel.appendChild(o); });
    });
    // Quick buttons: blocks of 50 chapters, then the special ones.
    const box = $('#rgChips'); box.innerHTML = '';
    const chip = (text, a, b) => {
      const x = document.createElement('button'); x.type = 'button'; x.className = 'chip'; x.textContent = text;
      x.onclick = () => setRange(a, b); box.appendChild(x);
    };
    const loaded = $$('.chapter', stream).filter(s => s._imgs).map(s => +s.dataset.index);
    chip('All ' + n, 0, n - 1);
    if (loaded.length) chip('Open now (' + loaded.length + ')', Math.min(...loaded), Math.max(...loaded));
    chip('Current → end', Math.min(R.cur, n - 1), n - 1);
    for (let a = 0; a < n; a += 50) { const b = Math.min(n - 1, a + 49); chip(chapNo(a) + '–' + chapNo(b), a, b); }
    if (loaded.length) setRange(Math.min(...loaded), Math.max(...loaded)); else setRange(0, Math.min(n - 1, 49));
    $('#rgMode').value = settings.pdfMode;
    $('#rangeDlg').showModal();
    scheduleEstimate();
  }
  /* ESTIMATED FILE SIZE BEFORE YOU PRESS "Make PDF" (round 10)
     WHY: 15 chapters once became 1 GB. You should see the size first and be warned when it is too big for the device.
     HOW: a few sample pages (first / one third / two thirds / last) of an open chapter are downloaded and put into a throw-away PDF in the
          CHOSEN quality; the size per page x the number of pages in the range = the estimate. Pages of chapters that are not open yet are
          counted with the average of the open ones. The number is an ESTIMATE (usually within +-25%).
          Above 400 MB the dialog suggests (and selects) several smaller files, because one huge file can run out of memory.
     IMPROVE: read the real size with HEAD requests, cache samples per site, show the time it will take. */
  const estCache = {};
  let estTimer = 0, estToken = 0;
  async function measure(mode) {
    if (estCache[mode]) return estCache[mode];
    const fake = { cancel: false };
    const secs = $$('.chapter', stream).filter(s => s._imgs && s._imgs.length);
    let urls, ref, pages;
    if (secs.length) { urls = secs[0]._imgs; ref = secs[0].dataset.url; pages = secs.reduce((n, s) => n + s._imgs.length, 0) / secs.length; }
    else { const it = { url: R.chapters[rangeValues()[0]].url }; urls = await chapterImages(it, fake); ref = it.url; pages = urls.length; }
    const n = urls.length, picks = []; [0, Math.floor(n / 3), Math.floor((2 * n) / 3), n - 1].forEach(k => { if (k >= 0 && !picks.includes(k)) picks.push(k); });
    let bytes = 0, got = 0;
    for (const k of picks) {
      try {
        const b = await fetchBytes(urls[k], fake, ref);
        const pdf = new MangaPDFLib.MangaPDF({ title: 'sample' }), strip = pdf.strip({ bg: [255, 255, 255] }), base0 = pdf.size;
        await addPageImage(strip, b, mode); strip.end();
        bytes += pdf.size - base0; got++;
      } catch { /* a sample that fails is skipped */ }
    }
    if (!got) throw new Error('no sample picture could be downloaded');
    return (estCache[mode] = { perPage: bytes / got, pages });
  }
  async function estimate() {
    const tok = ++estToken, box = $('#rgSize'), [a, b] = rangeValues(), n = b - a + 1, mode = $('#rgMode').value;
    box.dataset.level = ''; box.textContent = 'Estimating the file size…';
    try {
      const m = await measure(mode);
      if (tok !== estToken) return;                                   // the person changed the range meanwhile
      let pages = 0; for (let i = a; i <= b; i++) { const s = secFor(i); pages += s && s._imgs ? s._imgs.length : m.pages; }
      const total = m.perPage * pages * 1.02, MB = 1048576;
      box.textContent = 'Estimated size: about ' + fmtSize(total);
      const sm = document.createElement('small');
      sm.textContent = n + ' chapters · about ' + Math.round(pages) + ' pages · from ' + (mode === 'small' ? 'JPEG 92%' : 'perfect-copy') + ' sample pages. The real size can differ by about a quarter.';
      box.appendChild(sm);
      box.dataset.level = total > 700 * MB ? 'huge' : total > 300 * MB ? 'big' : '';
      if (total > 400 * MB && +rgSplit.value === 0 && n > 1) {         // suggest smaller files
        const per = Math.max(1, Math.floor(n / Math.ceil(total / (300 * MB))));
        let o = $('#rgAuto'); if (!o) { o = document.createElement('option'); o.id = 'rgAuto'; rgSplit.appendChild(o); }
        o.value = per; o.textContent = 'a new file every ' + per + ' chapters (recommended, about ' + fmtSize(total * per / n) + ' each)';
        rgSplit.value = String(per); rangeInfo();
        sm.textContent += ' Big: split into several files so the device does not run out of memory.';
      }
    } catch (e) { if (tok === estToken) { box.textContent = 'Could not estimate the size (' + e.message + '). The download itself still works.'; } }
  }
  const scheduleEstimate = () => { clearTimeout(estTimer); estTimer = setTimeout(estimate, 350); };

  rgFrom.onchange = rgTo.onchange = () => { const o = $('#rgAuto'); if (o) o.remove(); if ($('#rgSplit').value && !$('#rgSplit').querySelector('option[value="' + rgSplit.value + '"]')) rgSplit.value = '0'; rangeInfo(); scheduleEstimate(); };
  rgSplit.onchange = rangeInfo;
  $('#rgMode').onchange = e => { settings.pdfMode = e.target.value; applySettings(); scheduleEstimate(); };
  $('#rgGo').onclick = () => {
    const [a, b] = rangeValues(), per = +rgSplit.value;
    const idx = []; for (let i = a; i <= b; i++) idx.push(i);
    const items = idx.map(i => {
      const sec = secFor(i), c = R.chapters[i];
      return { idx: i, label: labelFor(i), no: chapNo(i), url: c.url, ctitle: c.title, hasNext: i + 1 < R.chapters.length, imgs: sec && sec._imgs ? sec._imgs.slice() : null };
    });
    const parts = []; for (let k = 0; k < items.length; k += (per > 0 ? per : items.length)) parts.push(items.slice(k, k + (per > 0 ? per : items.length)));
    const whole = a === 0 && b === R.chapters.length - 1 && parts.length === 1;
    $('#rangeDlg').close();
    queueDownload({ title: R.title, parts, whole, dark: settings.theme === 'dark' });
  };
  $('#rgCancel').onclick = () => $('#rangeDlg').close();

  /* ---------------------------------------------------------------
     12c. DOWNLOAD MANAGER + FLOATING DOCK  (round 7)
     WHY: downloading 50+ chapters takes minutes. It must NOT block reading, so:
          - a job works only from a SNAPSHOT (chapter addresses, labels, theme) and never reads the reading-mode
            state again, so you can scroll, jump, change chapters, even leave reading mode meanwhile;
          - it yields to the browser between pictures (sleep0) so scrolling stays smooth;
          - the progress is shown in a floating "dock" in the bottom corner that can be minimised to a small pill.
     HOW: jobs[] is the list. queueDownload() adds one, runQueue() runs them one after another (one at a time keeps
          memory and proxy use low). runJob() builds one PDF per "part" (a part = the chapters of one file).
          buildPart() fetches missing chapter pages, then every picture, in reading order, into one long strip per chapter.
          The dock shows: title, status line, progress bar and the size of the PDF as it grows.
     WHERE: dock markup = index.html #dock; styles = style.css "DOWNLOAD DOCK".
     IMPROVE: pause / resume, a max-size limit per file, and save straight to disk (File System Access API). */
  const jobs = [];
  let jobSeq = 0, queueRunning = false;
  /* DOWNLOAD DIARY + REPORT (round 10)
     WHY: a download once stopped after 2 of 10 chapters with no message. Now every step is written to a short diary (job.log), a watchdog
          notices when nothing has happened for 90 seconds, and ANY failure opens the big pop-up with this report to send to Claude.
     HOW: jlog() adds a line with the seconds since the start; jobReport() = the job's facts + the last 45 diary lines + memory use. */
  const jlog = (job, msg) => { job.log.push('+' + Math.round((Date.now() - job.t0) / 1000) + 's ' + msg); if (job.log.length > 200) job.log.shift(); };
  function jobReport(job) {
    const mem = performance && performance.memory ? Math.round(performance.memory.usedJSHeapSize / 1048576) + ' MB used of ' + Math.round(performance.memory.jsHeapSizeLimit / 1048576) + ' MB' : 'not reported by this browser';
    return ['Download job #' + job.id + ' · status: ' + job.status + (job.stalled ? ' (STALLED)' : ''),
      'Manga: ' + job.spec.title + ' · chapters done: ' + job.doneCh + ' of ' + job.total,
      'Now: ' + job.text, 'PDF size so far: ' + fmtSize(job.bytes) + ' · picture mode: ' + settings.pdfMode,
      'Failed pages/chapters: ' + job.failed.length, 'Browser memory (JS heap): ' + mem, '--- diary (latest last) ---']
      .concat(job.log.slice(-45), job.failed.length ? ['--- failed ---'].concat(job.failed.slice(0, 40)) : []).join('\n');
  }
  const sleep0 = () => new Promise(r => setTimeout(r, 0));
  const fmtSize = b => b >= 1073741824 ? (b / 1073741824).toFixed(2) + ' GB' : b >= 1048576 ? (b / 1048576).toFixed(1) + ' MB' : Math.max(1, Math.round(b / 1024)) + ' KB';
  const dock = $('#dock');

  function queueDownload(spec) {
    const total = spec.parts.reduce((n, p) => n + p.length, 0);
    const job = { id: ++jobSeq, spec, status: 'queued', cancel: false, total, doneCh: 0, frac: 0, bytes: 0, text: 'Waiting in the queue…', files: [], failed: [], el: null, log: [], t0: Date.now(), tick: Date.now(), stalled: false };
    jobs.push(job);
    // ROUND 8: while you READ the dock starts minimised (a small round button above the keys) so nothing covers the
    // page. Outside reading mode it opens so you can see the progress.
    if (reader.hidden) dock.classList.remove('min'); else { dock.classList.add('min'); toast('Download started. Keep reading: the round button above the keys shows the progress.'); }
    renderDock();
    runQueue();
    return job;
  }
  async function runQueue() {
    if (queueRunning) return;
    queueRunning = true;
    try { for (let j; (j = jobs.find(x => x.status === 'queued'));) await runJob(j); }
    finally { queueRunning = false; }
  }
  async function runJob(job) {
    job.status = 'running'; job.text = 'Starting…'; paintJob(job); jlog(job, 'job started');
    // WATCHDOG: no progress for 90 s -> one pop-up with the report (the download keeps trying; you can Cancel it).
    const dog = setInterval(() => {
      const idle = Date.now() - job.tick;
      if (job.status === 'running' && idle > 90000 && !job.stalled) {
        job.stalled = true; jlog(job, 'STALL: nothing happened for 90 s');
        showError('The download looks stuck', { title: '\u23F3 Download not moving', hint: 'Nothing has progressed for 90 seconds. The site or proxy may be slow or have blocked you, or the device is short of memory. It keeps trying; press Cancel in the download list to stop it. Copy the report and send it to Claude.', details: jobReport(job) });
      } else if (idle < 90000) job.stalled = false;
    }, 5000);
    try {
      for (let p = 0; p < job.spec.parts.length; p++) {
        const f = await buildPart(job, job.spec.parts[p], p);
        job.files.push(f); saveFile(f);
      }
      job.status = 'done'; job.frac = 1; job.doneCh = job.total;
      const size = job.files.reduce((n, f) => n + f.size, 0);
      job.text = (job.failed.length ? '⚠ Saved, but ' + job.failed.length + ' page(s)/chapter(s) are missing (marked inside the PDF). ' : '✓ Saved. ') +
        job.files.length + ' file' + (job.files.length === 1 ? '' : 's') + ' · ' + fmtSize(size);
      job.bytes = size;
      if (dock.classList.contains('min')) toast('PDF ready: ' + job.files.map(f => f.name).join(', '));
      jlog(job, 'job finished, ' + job.failed.length + ' failed');
      if (job.failed.length) showError(job.failed.length + ' page(s)/chapter(s) could not be downloaded and are marked inside the PDF', { title: '\u26A0 PDF saved with missing pages', hint: 'Everything else is in the PDF. Missing pages usually mean the picture host refuses outside readers (hotlink protection) or the site slowed you down. Use start-manga.bat or your own proxy (it sends the right referer), wait a few minutes, then download those chapters again.', details: jobReport(job) });
    } catch (e) {
      job.status = e.message === 'cancelled' ? 'cancelled' : 'error';
      job.text = e.message === 'cancelled' ? 'Cancelled' : 'Failed: ' + e.message;
      jlog(job, 'STOPPED: ' + e.message);
      if (job.status === 'error') showError('PDF download failed: ' + e.message, { details: jobReport(job) + '\n--- error ---\n' + (e.stack || e.message) });
    } finally { clearInterval(dog); }
    job.pdf = null;
    renderDock();
  }

  async function chapterImages(it, job) {              // picture addresses of a chapter (from reading mode, or fetched now)
    if (it.imgs && it.imgs.length) return it.imgs;
    let last;
    for (let t = 0; t < 2; t++) {
      if (job.cancel) throw new Error('cancelled');
      try {
        const { doc, base } = await fetchDoc(it.url);
        let imgs = extractImages(doc, base);
        if (!imgs.length) imgs = await probeNumbered(doc, base, it.url);
        if (imgs.length) return imgs;
        last = new Error('no pictures found');
      } catch (e) { last = e; }
    }
    throw last;
  }

  async function buildPart(job, items, partNo) {
    const spec = job.spec, dark = spec.dark;
    const pdf = new MangaPDFLib.MangaPDF({ title: spec.title });
    job.pdf = pdf;
    const bg = dark ? [0, 0, 0] : [255, 255, 255];
    const AHEAD = 3;                                         // pictures downloaded ahead (always added in order)
    let crashes = 0;
    // ROUND 10: one chapter that crashes unexpectedly no longer ends the whole download: it is marked missing and the next one goes on.
    // Three crashes in a row stop the job (something is badly wrong, e.g. memory) and the report pop-up appears.
    const doChapter = async n => {
      const it = items[n], label = it.label;
      if (job.cancel) throw new Error('cancelled');
      jlog(job, 'start ' + label);
      job.text = label + ' · getting the chapter page…'; job.bytes = pdf.size; paintJob(job);
      pdf.bookmark(label);
      const strip = pdf.strip({ bg });
      let urls = null;
      try { urls = await chapterImages(it, job); }
      catch (e) {
        if (e.message === 'cancelled') throw e;
        job.failed.push(label + ': ' + e.message);
        await addTextPage(strip, 800, 320, [{ text: label, size: 0.05, y: 0.4, bold: true }, { text: 'This chapter could not be loaded', size: 0.03, y: 0.62, muted: true }], null, false, dark);
        jlog(job, label + ' chapter page failed: ' + e.message);
        strip.end(); job.doneCh++; return;
      }
      const pics = new Map();
      const start = k => { if (k < urls.length && !pics.has(k)) pics.set(k, fetchBytes(urls[k], job, it.url).then(b => ({ b }), e => ({ e }))); };
      for (let k = 0; k < Math.min(AHEAD, urls.length); k++) start(k);
      for (let k = 0; k < urls.length; k++) {
        if (job.cancel) throw new Error('cancelled');
        job.frac = k / urls.length;
        job.text = label + ' · page ' + (k + 1) + ' of ' + urls.length + ' · chapter ' + (job.doneCh + 1) + ' of ' + job.total;
        job.bytes = pdf.size; paintJob(job);
        const r = await Promise.race([pics.get(k), new Promise(res => setTimeout(() => res({ e: new Error('the picture took longer than 150 s') }), 150000))]);   // round 10: never wait forever
        pics.delete(k); start(k + AHEAD);
        let err = r.e && r.e.message;
        if (r.b) {
          try { await addPageImage(strip, r.b); }
          catch (e) { err = 'could not decode the picture (' + e.message + ')'; }
        }
        if (err) {                                           // never skip silently
          if (err === 'cancelled') throw new Error('cancelled');
          job.failed.push(label + ', page ' + (k + 1) + ': ' + err); jlog(job, label + ' p' + (k + 1) + ' failed: ' + err);
          await addTextPage(strip, Math.max(400, Math.min(strip.maxWidth || 800, 4000)), 320, [
            { text: label + ' · page ' + (k + 1), size: 0.045, y: 0.40, bold: true },
            { text: 'This page could not be downloaded', size: 0.03, y: 0.62, muted: true }], null, false, dark);
        }
        await sleep0();                                      // let the browser scroll / draw: reading stays smooth
      }
      // Title block (top) and "End of" block (bottom), like in reading mode.
      const w = Math.max(400, Math.min(strip.maxWidth || 800, 4000));
      const head = [
        { text: spec.title.toUpperCase(), size: 0.022, y: 0.24, muted: true },
        { text: label, size: 0.058, y: 0.52, bold: true }];
      if (it.ctitle && it.ctitle.toLowerCase().replace(/\s+/g, ' ') !== label.toLowerCase() && !isPlainTitle(it.ctitle) && it.ctitle.length < 90)
        head.push({ text: it.ctitle, size: 0.03, y: 0.80, muted: true });
      await addTextPage(strip, w, Math.round(w * 0.27), head, 'bottom', true, dark);
      await addTextPage(strip, w, Math.round(w * 0.15), [
        { text: 'End of ' + label + (it.hasNext ? ' · next chapter follows' : ''), size: 0.028, y: 0.5, muted: true }], 'top', false, dark);
      strip.end();
      job.doneCh++; job.frac = 0;
      jlog(job, 'finished ' + label + ' · pdf ' + fmtSize(pdf.size));
    };
    for (let n = 0; n < items.length; n++) {
      try { await doChapter(n); crashes = 0; }
      catch (e) {
        if (e.message === 'cancelled') throw e;
        crashes++; job.failed.push(items[n].label + ': unexpected error: ' + e.message);
        jlog(job, 'CRASH in ' + items[n].label + ': ' + e.message + (e.stack ? ' @ ' + String(e.stack).split('\n')[1] : ''));
        if (crashes >= 3) throw new Error('3 chapters in a row failed unexpectedly (last: ' + e.message + ')');
        job.doneCh++; job.frac = 0;
      }
    }
    job.text = 'Saving the file…'; job.bytes = pdf.size; paintJob(job);
    const blob = pdf.finish();
    const range = items.length === 1 ? items[0].label : 'Chapters ' + items[0].no + '-' + items[items.length - 1].no;
    const name = fileSafe(spec.title) + (spec.whole ? '' : ' - ' + range) + '.pdf';
    return { name, blob, size: blob.size, url: URL.createObjectURL(blob) };
  }
  function saveFile(f) {
    const a = document.createElement('a'); a.href = f.url; a.download = f.name;
    document.body.appendChild(a); a.click(); a.remove();
  }

  /* ---- the dock (floating list) ---- */
  function jobEl(job) {
    const li = document.createElement('li'); li.className = 'dl-job';
    li.innerHTML = '<div class="dj-top"><b class="dj-title"></b><span class="dj-size"></span></div>' +
      '<div class="dl-bar"><i></i></div><div class="dj-text small muted"></div><div class="dj-btns"></div>';
    $('.dj-title', li).textContent = job.spec.title + (job.spec.whole ? '' : ' (' + job.spec.parts[0][0].no + ' – ' + job.spec.parts[job.spec.parts.length - 1].slice(-1)[0].no + ')');
    job.el = li; return li;
  }
  function paintJob(job) {
    job.tick = Date.now();                              // round 10: the watchdog reads this ("something happened just now")
    if (!job.el) return;
    const pct = job.status === 'done' ? 100 : Math.min(99, Math.round((job.doneCh + job.frac) / Math.max(1, job.total) * 100));
    job.pct = pct;
    $('.dl-bar i', job.el).style.width = pct + '%';
    $('.dj-text', job.el).textContent = job.text;
    $('.dj-size', job.el).textContent = job.status === 'queued' ? 'queued' : fmtSize(job.bytes) + (job.status === 'running' ? ' so far' : '');
    job.el.dataset.status = job.status;
    paintPill();
  }
  function paintPill() {
    const active = jobs.filter(j => j.status === 'running' || j.status === 'queued');
    const run = jobs.find(j => j.status === 'running');
    const pill = $('#dockIcon');
    pill.style.setProperty('--p', run ? run.pct : (jobs.length && !active.length ? 100 : 0));
    $('#dockLabel').textContent = run ? run.pct + '% · ' + fmtSize(run.bytes) : active.length ? 'queued' : jobs.some(j => j.status === 'done') ? 'PDF ready' : 'Downloads';
    $('#dockCount').textContent = active.length ? active.length : '';
    pill.classList.toggle('busy', !!active.length);
    pill.classList.toggle('done', !active.length && jobs.some(j => j.status === 'done'));      // round 8: green when a PDF is ready
    pill.classList.toggle('err', !active.length && !jobs.some(j => j.status === 'done') && jobs.some(j => j.status === 'error'));
  }
  const syncDock = () => { dock.hidden = !jobs.length && reader.hidden; };   // round 10: visible whenever you are reading (idle = a small round button)
  function renderDock() {
    syncDock();
    const ul = $('#dockList');
    jobs.forEach(j => { if (!j.el) ul.prepend(jobEl(j)); });
    jobs.forEach(j => {
      const btns = $('.dj-btns', j.el); btns.innerHTML = '';
      const add = (text, fn) => { const b = document.createElement('button'); b.type = 'button'; b.textContent = text; b.onclick = fn; btns.appendChild(b); };
      if (j.status === 'running' || j.status === 'queued') add('Cancel', () => { j.cancel = true; if (j.status === 'queued') { j.status = 'cancelled'; j.text = 'Cancelled'; } renderDock(); });
      if (j.status === 'done') j.files.forEach(f => add('Save ' + (j.files.length > 1 ? f.name.replace(/^.* - /, '') : 'again'), () => saveFile(f)));
      if (j.status !== 'running' && j.status !== 'queued') add('✕', () => { j.files.forEach(f => URL.revokeObjectURL(f.url)); j.el.remove(); jobs.splice(jobs.indexOf(j), 1); renderDock(); });
      paintJob(j);
    });
    syncDock();
    paintPill();
  }
  $('#dockIcon').onclick = () => { if (!jobs.length) { openRangeDialog(); return; } dock.classList.toggle('min'); };   // idle button = open the download window
  $('#dockMin').onclick = () => dock.classList.add('min');
  // Closing the tab while a PDF is being made would lose it: ask first.
  window.addEventListener('beforeunload', e => { if (jobs.some(j => j.status === 'running' || j.status === 'queued')) { e.preventDefault(); e.returnValue = ''; } });

  /* ---------------------------------------------------------------
     13. SEARCH BAR FOR SMALL SCREENS (floating bar)
     WHY: on a phone the long address bar was squeezed next to six buttons and showed almost nothing.
          On narrow screens (CSS media query, 760px) the wide input is hidden and a "pill" takes the full row.
          Tapping the pill opens a floating bar with a big input, a Paste button and a Go button.
     HOW: both inputs call the same navigate(). The popup closes on Go, on Esc, or when you tap outside.
     IMPROVE: show suggestions (history) under the input; add a "search engine" switch. */
  function openSearch() {
    $('#searchPop').hidden = false; $('#popShade').hidden = false;
    const i = $('#addr2'); i.value = cur ? cur.url : ''; i.focus(); i.select();
  }
  function closeSearch() { $('#searchPop').hidden = true; $('#popShade').hidden = true; }

  /* ---------------------------------------------------------------
     14. EVENT WIRING
     WHY: one place that connects every button/key to the functions above.
     IMPROVE: add touch gestures (swipe from edge = prev/next chapter) and a keyboard help
              overlay (press "?"). */
  $('#addrForm').addEventListener('submit', e => { e.preventDefault(); navigate($('#addr').value, true, { user: true }); $('#addr').blur(); });
  $('#rdForm').addEventListener('submit', e => { e.preventDefault(); readerGo($('#rdAddr').value); $('#rdAddr').blur(); });
  $('#addrPill').onclick = openSearch;
  $('#popShade').onclick = closeSearch;
  $('#popForm').addEventListener('submit', e => { e.preventDefault(); const v = $('#addr2').value; closeSearch(); navigate(v, true, { user: true }); });
  $('#btnPaste').onclick = async () => {
    try { const t = await navigator.clipboard.readText(); $('#addr2').value = t.trim(); $('#addr2').focus(); }
    catch { toast('Press and hold in the box, then choose Paste'); $('#addr2').focus(); }
  };
  $('#btnBack').onclick = () => goHist(-1);
  $('#btnFwd').onclick = () => goHist(1);
  $('#btnReload').onclick = () => { if (cur) { cache.delete(cur.url); navigate(cur.url, false); } };
  $('#btnHome').onclick = goHome;
  $('#btnStar').onclick = toggleBookmark;
  $('#btnThemeB').onclick = toggleTheme;
  $('#btnTheme').onclick = toggleTheme;
  $('#fabRead').onclick = () => startReading();
  $('#btnExit').onclick = exitReading;
  $('#btnChapters').onclick = e => { e.stopPropagation(); toggleMenu(); };
  $('#btnPrev').onclick = () => stepChapter(-1);
  $('#btnNext').onclick = () => stepChapter(1);
  $('#btnReload1').onclick = reloadCurrent;
  $('#btnReloadAll').onclick = reloadEvery;
  $('#btnEnd').onclick = () => goEnd();
  $('#btnTopEnd').onclick = () => { markInput(); window.scrollTo({ top: 0 }); };
  $('#btnDl').onclick = openRangeDialog;
  $('#btnDlMenu').onclick = () => { closeMenu(); openRangeDialog(); };

  // Any sign that the PERSON is scrolling (not the page moving by itself) - see section 11.
  ['wheel', 'touchstart', 'touchmove', 'mousedown', 'pointerdown', 'keydown'].forEach(ev =>
    window.addEventListener(ev, markInput, { passive: true }));
  window.addEventListener('scroll', onScroll, { passive: true });

  document.addEventListener('click', e => {
    if (reader.hidden) return;
    const menuWasOpen = !$('#chapterMenu').hidden;
    if (!e.target.closest('#chapterMenu')) closeMenu();
    // Tap the page = scroll (option in Settings). The buttons are NOT shown again by a tap any more:
    // they return only when you scroll up (section 11).
    if (e.target.closest('#stream') && settings.tapScroll && !menuWasOpen) tapScroll(e);
  });

  /* KEYBOARD (round 8: End and Home keys added)
     WHY: the on-screen round keys have real-keyboard twins. When you press the real key the round key
          "presses down" too, so you can see it worked.
          Left / Right arrow = previous / next chapter, End = end of everything that is loaded, Home = top.
     HOW: keys are ignored while a dialog is open or while you type in a box (so the search bar in the reader works). */
  /* ROUND 9: asking for earlier chapters when the page cannot scroll any further up (a scroll event never comes then):
     wheel up, or a finger drag downwards, while at the very top; plus the "Load earlier chapters" button. */
  window.addEventListener('wheel', e => { if (!reader.hidden && e.deltaY < 0 && window.scrollY < 40) loadPrev(); }, { passive: true });
  let touchY0 = null;
  window.addEventListener('touchstart', e => { touchY0 = e.touches[0].clientY; }, { passive: true });
  window.addEventListener('touchmove', e => { if (!reader.hidden && touchY0 != null && window.scrollY < 40 && e.touches[0].clientY - touchY0 > 30) { touchY0 = null; loadPrev(); } }, { passive: true });
  $('#btnPrevLoad').onclick = () => { holdUiFor(1500); loadPrev(); };
  // ROUND 10: the round "top" key (and the Home key) scroll smoothly to the top of everything that is loaded. holdUiFor keeps the keys visible.
  $('#btnTop').onclick = () => { holdUiFor(2500); window.scrollTo({ top: 0, behavior: 'smooth' }); };
  // ROUND 10: the OPTIONAL chapter-slider.js add-on sends this event (dir = +1 next, -1 previous). Without the file nothing ever sends it.
  window.addEventListener('mf-chapter-step', e => {
    if (reader.hidden || document.querySelector('dialog[open]')) return;
    holdUiFor(2500); stepChapter(e.detail && e.detail.dir > 0 ? 1 : -1);
  });
  const keyCaps = { arrowleft: '#btnPrev', arrowright: '#btnNext', end: '#btnEnd', home: '#btnTop' };
  const pressCap = sel => { const cap = $(sel); if (cap) { cap.classList.add('pressed'); setTimeout(() => cap.classList.remove('pressed'), 160); } };
  document.addEventListener('keydown', e => {
    if (e.key === 'Escape' && !$('#searchPop').hidden) { closeSearch(); return; }
    // Keys do nothing while a dialog (settings, download range, error) is open or while you type in a box.
    if (reader.hidden || document.querySelector('dialog[open]') || /input|select|textarea/i.test(e.target.tagName)) return;
    const k = e.key.toLowerCase();
    const plain = !e.altKey && !e.ctrlKey && !e.metaKey && !e.shiftKey;
    if (k === 'escape') { if (!$('#chapterMenu').hidden) closeMenu(); else exitReading(); }
    else if (k === 'n') stepChapter(1);
    else if (k === 'p') stepChapter(-1);
    else if (k === 't') toggleTheme();
    else if (k === 'c') toggleMenu();
    else if (k === 'end' && plain) { e.preventDefault(); pressCap('#btnEnd'); goEnd(); }          // End = bottom of the loaded chapters
    else if (k === 'home' && plain) { e.preventDefault(); pressCap('#btnTop'); window.scrollTo({ top: 0 }); if (R.first > 0) loadPrev(); }
    else if ((k === 'arrowup' || k === 'pageup') && plain && window.scrollY < 40) loadPrev();      // round 9: the page cannot scroll up, so no scroll event comes
    else if (settings.arrowKeys && (k === 'arrowright' || k === 'arrowleft') && plain) {
      e.preventDefault();                                                            // right arrow = next chapter, left arrow = previous
      pressCap(keyCaps[k]);
      stepChapter(k === 'arrowright' ? 1 : -1);
    }
  });

  // The big error pop-up: Close, and Copy report (so the full text can be pasted to Claude).
  $('#errClose').onclick = () => $('#errbox').close();
  $('#errCopy').onclick = async () => {
    const t = $('#errText');
    try { await navigator.clipboard.writeText(t.value); }
    catch { t.focus(); t.select(); try { document.execCommand('copy'); } catch { /* user can copy by hand */ } }
    toast('Report copied');
  };

  /* ---------------------------------------------------------------
     15. SETTINGS DIALOG + PROXY LIST
     WHY: the person can see which proxies are used, remove any (also the free ones), add their own
          (for example a Cloudflare Worker), test them, or go back to the free defaults.
     HOW: settings.proxies is the saved list. renderProxyList() draws it; every button edits the list,
          calls applySettings() (saves) and draws again.
     IMPROVE: drag to re-order, a "test on every start" option, and per-site proxy choice. */
  const dlg = $('#settings');
  function renderProxyList() {
    const ul = $('#proxyList'); ul.innerHTML = '';
    if (!settings.proxies.length) { ul.innerHTML = '<li class="muted small">No proxy. Add one below or press "Reset to defaults".</li>'; return; }
    settings.proxies.forEach((p, i) => {
      const li = document.createElement('li');
      const name = document.createElement('span'); name.className = 'pname'; name.textContent = proxyName(p); name.title = p;
      const state = document.createElement('span'); state.className = 'pstate small muted';
      state.textContent = DEFAULT_PROXIES.includes(p) ? 'free · pages only' : 'yours';
      const rm = document.createElement('button'); rm.type = 'button'; rm.textContent = '✕'; rm.title = 'Remove this proxy';
      rm.setAttribute('aria-label', 'Remove ' + proxyName(p));
      rm.onclick = () => { settings.proxies.splice(i, 1); applySettings(); renderProxyList(); };
      li.append(name, state, rm); ul.appendChild(li);
    });
  }
  function addProxy() {
    const p = fixProxy($('#proxyNew').value);
    if (!p) return;
    if (!/^https?:\/\//i.test(p)) return toast('The address must start with https://');
    // SECURITY: a proxy sees every address you read, so only encrypted (https) proxies are accepted,
    // plus http://localhost for the local launcher. It must also contain {url} (fixProxy adds it when missing).
    if (!/^https:\/\//i.test(p) && !/^http:\/\/(localhost|127\.0\.0\.1)(:|\/)/i.test(p)) return toast('For your safety only https:// proxies are accepted (or http://localhost).');
    if (!p.includes('{url}')) return toast('The proxy address must contain {url}');
    if (isExample(p)) return toast('That is only example text. Paste the real address of YOUR proxy.');
    if (settings.proxies.includes(p)) return toast('That proxy is already in the list');
    settings.proxies.unshift(p);                       // the person's own proxy goes first
    $('#proxyNew').value = ''; applySettings(); renderProxyList();
  }
  async function testProxies() {
    const rows = $$('#proxyList li');
    await Promise.all(settings.proxies.map(async (p, i) => {
      const badge = rows[i] && rows[i].querySelector('.pstate'); if (badge) badge.textContent = 'testing…';
      const t0 = performance.now();
      try { await askProxy(p, 'https://example.com/'); if (badge) badge.textContent = '✓ ' + Math.round(performance.now() - t0) + ' ms'; }
      catch (e) { if (badge) badge.textContent = '✗ ' + e.message.replace(/^[^:]*: /, ''); }
    }));
  }
  function openSettings(toMemory) {
    $('#setWidth').value = settings.width; $('#setWidthVal').textContent = settings.width;
    $('#setSide').value = settings.side; $('#setPdf').value = settings.pdfMode;
    $('#setArrows').checked = settings.arrowKeys; $('#setTap').checked = settings.tapScroll; $('#setAutoRead').checked = settings.autoRead;
    $('#memAuto').value = String(settings.autoFree); $('#setNoHist').checked = settings.noHistory; $('#setWipe').checked = settings.wipeOnClose;
    $('#secList').innerHTML = '';
    renderProxyList();
    if (!reader.hidden) fillMemSelects();
    memInfo();
    dlg.showModal();
    fitSettings();
    if (toMemory) showTab('memory');
  }
  /* SETTINGS THAT FIT THE SCREEN (round 9)
     WHY: you should never scroll inside Settings. On a big screen all four cards sit side by side in a grid. When the
          window is too small for that (a phone, a short window) the cards become TABS: one card at a time, same options.
     HOW: remove the "tabs" class, measure: if the dialog is taller than the window, add "tabs" back. Runs when the dialog
          opens and when the window size or phone orientation changes.
     IMPROVE: remember the last tab you used, and use a ResizeObserver instead of the window events. */
  let setTab = 'proxy';
  function showTab(name) {
    setTab = name;
    $$('#setTabs button').forEach(b => b.classList.toggle('active', b.dataset.tab === name));
    $$('.set-card').forEach(c => c.classList.toggle('active', c.dataset.tab === name));
    if (dlg.open && !dlg.classList.contains('tabs')) fitSettings();
  }
  function fitSettings() {
    if (!dlg.open) return;
    dlg.classList.remove('tabs');                                       // try the grid first
    if (dlg.scrollHeight > dlg.clientHeight + 2) dlg.classList.add('tabs');
    $$('#setTabs button').forEach(b => b.classList.toggle('active', b.dataset.tab === setTab));
    $$('.set-card').forEach(c => c.classList.toggle('active', c.dataset.tab === setTab));
  }
  $$('#setTabs button').forEach(b => { b.type = 'button'; b.onclick = () => showTab(b.dataset.tab); });
  window.addEventListener('resize', fitSettings);
  window.addEventListener('orientationchange', () => setTimeout(fitSettings, 200));
  $('#btnSettings').onclick = () => openSettings(false);
  $('#btnSettingsR').onclick = () => openSettings(false);
  $('#btnFreeMenu').onclick = () => { closeMenu(); openSettings(true); };
  $('#memRange').onclick = () => {
    let a = +$('#memFrom').value, b = +$('#memTo').value; if (a > b) [a, b] = [b, a];
    const n = clearRange(a, b); toast(n ? n + ' chapter' + (n === 1 ? '' : 's') + ' cleared' : 'Nothing to clear in that range'); memInfo();
  };
  $('#memBefore').onclick = () => { const n = clearRange(0, R.cur - 1); toast(n ? n + ' chapter' + (n === 1 ? '' : 's') + ' cleared' : 'Nothing to clear before this chapter'); memInfo(); };
  $('#memAuto').onchange = e => { settings.autoFree = +e.target.value; applySettings(); autoFree(); memInfo(); };
  $('#setNoHist').onchange = e => { settings.noHistory = e.target.checked; applySettings(); };
  $('#setWipe').onchange = e => { settings.wipeOnClose = e.target.checked; applySettings(); };
  $('#proxyAdd').onclick = addProxy;
  $('#proxyNew').addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); addProxy(); } });
  $('#proxyTest').onclick = testProxies;
  $('#proxyReset').onclick = () => {
    if (!confirm('Replace the list with the free default proxies? Proxies you added will be removed.')) return;
    settings.proxies = DEFAULT_PROXIES.slice(); applySettings(); renderProxyList();
  };
  $('#setWidth').oninput = e => { settings.width = +e.target.value; $('#setWidthVal').textContent = settings.width; applySettings(); };
  $('#setSide').onchange = e => { settings.side = e.target.value; applySettings(); };
  $('#setPdf').onchange = e => { settings.pdfMode = e.target.value; applySettings(); };
  $('#setArrows').onchange = e => { settings.arrowKeys = e.target.checked; applySettings(); };
  $('#setTap').onchange = e => { settings.tapScroll = e.target.checked; applySettings(); };
  $('#setAutoRead').onchange = e => { settings.autoRead = e.target.checked; applySettings(); };
  // SECURITY / PRIVACY: optional erase when the tab is closed.
  window.addEventListener('pagehide', () => {
    if (!settings.wipeOnClose) return;
    ['recent', 'books', 'reads', 'progress'].forEach(k => store.set(k, k === 'progress' ? {} : []));
  });
  /* "Check my setup": a quick, honest list of what is safe and what is not.
     WHY: so the owner can see the protections at a glance. It only reads settings, it changes nothing. */
  $('#secCheck').onclick = () => {
    const ul = $('#secList'); ul.innerHTML = '';
    const row = (ok, text) => { const li = document.createElement('li'); li.textContent = (ok === true ? '✅ ' : ok === false ? '⚠️ ' : 'ℹ️ ') + text; ul.appendChild(li); };
    const local = /^(localhost|127\.0\.0\.1)$/.test(location.hostname);
    row(location.protocol === 'https:' || local, location.protocol === 'https:' ? 'This site uses https (encrypted).' : local ? 'Running on your own computer (localhost).' : 'This site is not using https. Use an https address.');
    const csp = document.querySelector('meta[http-equiv="Content-Security-Policy"]');
    row(!!csp, csp ? 'Content-Security-Policy is active: only this site\'s own scripts can run.' : 'No Content-Security-Policy found in index.html.');
    row(true, 'Scripts of manga sites never run: pages are cleaned and shown in a script-free frame.');
    const free = settings.proxies.filter(p => DEFAULT_PROXIES.includes(p)).length, own = settings.proxies.length - free;
    row(free === 0, free ? free + ' free public prox' + (free === 1 ? 'y' : 'ies') + ' in the list: their owners can see every address you open. Prefer your own proxy.' : 'No free public proxy is used.');
    row(own > 0 || local, own ? own + ' own prox' + (own === 1 ? 'y' : 'ies') + ' set.' : local ? 'The local launcher is your proxy.' : 'You have no own proxy yet (see MANGAFLOW.md, Cloudflare Worker with ALLOWED set to your site).');
    row(!settings.noHistory, settings.noHistory ? 'History saving is OFF.' : 'History is saved in this browser only (nothing is sent anywhere).');
  };
  $('#btnClear').onclick = () => {
    recent = []; books = []; reads = []; cache.clear();
    store.set('recent', []); store.set('books', []); store.set('reads', []); store.set('progress', {});
    renderStart(); toast('Cleared');
  };

  /* ---------------------------------------------------------------
     16. START-UP + SAFETY NETS (round 8)
     WHY: nothing should fail silently. These handlers send every unexpected crash and every blocked attack to the
          big error pop-up (section 5), so a problem is never just a line in a hidden console.
     HOW: 1. "error" and "unhandledrejection" catch crashes and forgotten failures of async code.
          2. "securitypolicyviolation" fires when the browser's Content-Security-Policy STOPS something (for example a
             script that is not ours). That is the protection working, and you are told about it. Only script, plug-in,
             frame and form blocks are reported (style / picture blocks would only be noise). Browser add-ons are
             ignored, and at most 3 such pop-ups are shown per visit.
     IMPROVE: add a small "problems log" page that lists everything caught, and a "send report" button. */
  const quietError = m => /ResizeObserver|Script error|cancelled|AbortError|The user aborted/i.test(m || '');
  window.addEventListener('error', e => {
    if (quietError(e.message)) return;
    showError('Unexpected error: ' + (e.message || 'unknown'), { details: (e.error && e.error.stack) || (e.filename + ':' + e.lineno) });
  });
  window.addEventListener('unhandledrejection', e => {
    const r = e.reason, m = (r && r.message) || String(r);
    if (quietError(m)) return;
    showError('Unexpected error: ' + m, { details: (r && r.stack) || '' });
  });
  let secShown = 0;
  function onSecurityViolation(e) {
    if (!/^(script|object|worker|child|frame|form-action|base)/i.test(e.effectiveDirective || '')) return;
    const blocked = e.blockedURI || '', src = e.sourceFile || '';
    if (/^(chrome|moz|safari|edge)-extension/i.test(blocked + ' ' + src)) return;       // browser add-ons are not our business
    if (++secShown > 3) return;
    showError('The browser blocked something: ' + e.effectiveDirective + ' → ' + (blocked || 'inline code'),
      { details: 'Rule that stopped it: ' + e.violatedDirective + '\nBlocked address: ' + (blocked || 'inline') + '\nFrom: ' + (src || 'this page') + ' line ' + (e.lineNumber || '?') });
  }
  document.addEventListener('securitypolicyviolation', onSecurityViolation);

  applySettings();
  renderStart();
  updateNav();
  const qs = new URLSearchParams(location.search).get('url');
  if (qs) navigate(qs, true, { user: true });
  /* RESUME AFTER A REFRESH (round 9b): the address ends in #r=<chapter link> while you read. Open that chapter in reading mode again.
     If it cannot be loaded (offline, proxy down) the start page stays and the broken #r= is removed, so you are never stuck. */
  async function resumeFromHash() {
    const m = /^#r=(.+)$/.exec(location.hash); if (!m || qs) return;
    let url; try { url = decodeURIComponent(m[1]); } catch { return; }
    toast('Resuming your chapter…');
    const ok = await navigate(url, true, { user: false });
    if (ok && cur && sameUrl(cur.url, url)) { if (!(await startReading({ quiet: true }))) toast('Could not resume reading. Press "Reading mode".'); }
    else { try { history.replaceState(null, '', location.pathname + location.search); } catch { /* ignore */ } }
  }
  resumeFromHash();
  // START PAGE SEARCH CARD (round 10): same behaviour as the address bar (a link opens in reading mode, words search).
  $('#heroForm').addEventListener('submit', e => { e.preventDefault(); const v = $('#addrHero').value.trim(); if (v) navigate(v, true, { user: true }); });
  $('#heroPaste').onclick = async () => {
    try { const t = await navigator.clipboard.readText(); $('#addrHero').value = t.trim(); $('#addrHero').dispatchEvent(new Event('input')); $('#addrHero').focus(); }
    catch { toast('Paste with Ctrl+V (the browser did not allow reading the clipboard)'); $('#addrHero').focus(); }
  };
  syncDock();
  // The (x) buttons inside the search boxes: show only when there is text; clear + focus on tap.
  $$('.clearx').forEach(b => {
    const inp = $('#' + b.dataset.for), sync = () => { b.hidden = !inp.value; };
    inp.addEventListener('input', sync); inp.addEventListener('focus', sync);
    b.onclick = () => { inp.value = ''; sync(); inp.focus(); };
    sync();
  });
  $('#btnHomeR').onclick = () => { leaveReader(); goHome(); };
})();
