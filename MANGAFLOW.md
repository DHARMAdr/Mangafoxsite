# MangaFlow Reader — the complete project blueprint (history + full specification, up to round 10)

**How to use this file.** Give it to Claude together with the code files and say what you want ("improve X", "fix site Y", or
"build me a new site from this blueprint"). Sections 1–3 are the story and the rules, sections 4–9 are the full specification
(enough to rebuild every file from nothing), sections 10–14 are how to run, test, secure and extend it.
This is the ONE combined project file: when something changes, add a new "round" to section 2 and update the spec in place.

---

## 1. What the project is

A manga reading website made with only **HTML, CSS and JavaScript** (no framework, no build step, no database).
You paste a manga site address; it opens inside a small built-in browser; the **Reading mode** turns every chapter into one
endless scroll. It also downloads chapters as one PDF. It runs

* on a PC through a tiny local launcher (`start-manga.bat` → `proxy-local.js`, http://localhost:8787), or
* on GitHub Pages / any static host, together with a CORS proxy (your own Cloudflare Worker `worker.js`, or free public proxies).

**Why a proxy at all?** A browser page may not read other websites directly (the CORS rule). The proxy fetches the page for
the app and adds the permission header. The local launcher is best (your own home connection is trusted by sites);
your own Worker is second; free public proxies are slow and often blocked.

**Who it is for.** A beginner developer (GitHub user `DHARMAdr`, repo `Manga-web-3`) who wants a personal reader that works on
PC **and** phone, and who wants every code file explained in basic English (why / how / how to improve).

---

## 2. History — every round, in order

| Round | What happened |
|---|---|
| 1 | First reader like manhuatop.org: white/black toggle, upload chapters, auto sort by name, smooth scroll, tap to scroll, chapter dropdown, left/right arrow keys. Storage: Supabase + IndexedDB. |
| 2 | Any file type: JPG/PNG/WebP, CBZ, ZIP (auto unzip), PDF. Hosted on GitHub Pages. |
| 3 | Oracle Cloud database (ORDS handlers `posts/`, `delete/`, BLOB table `POST_FILES`, delete protected with `?key=`). Fixed 500 errors. (Section 14.) |
| 4 | **MangaFlow**: mini browser + reading mode, CORS proxy, chapter + image detection. Files: index.html, style.css, app.js, worker.js, proxy-local.js, start-manga.bat. |
| 5 | Series pages with script-built chapter lists (Madara `ajax/chapters/`), bars hide on scroll down / return on scroll up, free default proxies, mechanical keycaps, richer "Continue reading" history, PDF download (JPEG/PNG bytes copied untouched), mobile search pill, friendlier UI, comments, this guide. |
| 6 | Two chapter keys (up = previous, down = next), reload buttons, **10 chapters loaded at once** (`BATCH`), one long PDF page per chapter. |
| 7 | Choose which chapters to download (range dialog), floating download dock with live size, reading while downloading, clear-chapter-cache ("Free memory"), security hardening (CSP, sandboxed frame, proxy rules, `_headers`). |
| 8 | One row of round 3D keys + End key, title/search bar inside reading mode, manga links open straight in reading mode (`tryAutoRead`), download dock above keys, pictures hidden in scripts, hotlink-protected pictures (proxy sends `&ref=`), polite request gating, BIG error / security pop-ups with a copyable report. 41 browser checks. |
| **9** | **(this round)** See 2.1. |
| 9b | Reload keys left / arrows right, ✕ clear button, refresh keeps reading (`#r=`), Home button. See 2.2. |
| **10** | **(latest)** roliascan-type sites, download size estimate + stall protection + reports, top key, optional chapter slider file, always-visible download button, redesigned start page. See 2.3. |

### 2.1 Round 9 — what was asked and what was done

| # | Request | Done | Where |
|---|---|---|---|
| 1 | Keys horizontal, right corner | One horizontal row, bottom-right (see 9b for the final split with the reload keys). Setting "Reader buttons on the" = right (default) / left. Old saved settings are migrated once (`settings.ver < 9`). | `style.css` `#side`; `app.js` settings defaults |
| 2a | Errors on en-thunderscans.com (and arenascans.com) | Root cause found for the MangaStream / Thunder Scans family: the series link (`/comics/name/`) is **not** a path prefix of the chapter address, the chapter dropdown is empty, and the Prev/Next buttons are `#` placeholders — the real addresses are only inside the script (`ts_reader.run({... "prevUrl", "nextUrl", "sources":[{"images":[...]}]})`). New code reads those (`findNavLinks`), looks for the series page by link, by name and by typical addresses (`loadSeriesList`, `findSeriesLink`, `guessSeriesUrls`), and, as a last resort, builds chapters 1..N from the number in the address (`synthesizeChapters`). Chapters that turn out not to exist vanish quietly. A page that asks for a login / coins is reported as **LOCKED** instead of "broken" (`noImagesError`, `LOCK_RE`). The error report now also says: Next.js data present, ts_reader present, lock words, prev/next found, `/api/` hints (`diagnose`). | `app.js` section 8b, `analyze`, `fillChapter`, `explain`, `diagnose` |
| 2b | Chapter-5 link: cannot reach chapters 1–4 | Reading used to only grow downwards. New **earlier chapters** engine (`loadPrev`, `R.first`): scroll up near the top, wheel-up / finger-drag / Up / PageUp / Home at the very top, the "▲ Load earlier chapters" button, the up round key and Left arrow at the first loaded chapter. Chapters are inserted ABOVE and the scroll position is corrected so the picture on screen does not jump (browser scroll anchoring + a manual fallback for old Safari). | `app.js` section 9b, `goChapter`, `stepChapter`; `index.html` `#prevBar` |
| 3 | Progress line stays mid-page when the title bar hides | `#progress` was inside the bar. The whole bar now **slides up out of the screen** while you scroll down, and the 3 px progress line is pinned to the very top edge (it is outside the transformed bar). | `index.html`, `style.css` `#readerBar`, `#progress` |
| 4 | Beginner comments everywhere | Block comments (WHY / HOW / WHERE / IMPROVE) on every section and function in all files; see section 13 for the honest coverage. | all files |
| 5 | Settings must fit the screen, no scrolling, keep every option | Settings is now a **grid of four cards** (Proxies / Reading / Memory / Security). If the window is too small for all four, `fitSettings()` switches to **tabs** (one card at a time). Same options, same ids. | `index.html` `#settings`; `style.css`; `app.js` `fitSettings`, `showTab` |
| 6 | All files fresh + a full blueprint | All nine files are delivered again (including a new `start-manga.bat`) plus this file and a zip. | — |

### 2.2 Round 9b — second set of requests in the same delivery

| # | Request | Done | Where |
|---|---|---|---|
| 1 | Only the arrow keys and End are a horizontal row in the right corner; **reload keys stay in the bottom-left corner** | `#side` is a click-through strip: `.kg-l` (↻, ↻ all) left, `.kg-r` (↑, ↓, End) right. Setting "left" swaps the groups. | `index.html` `#side`; `style.css` `#side .kg` |
| 2 | Error report from another site: `proxy 403, allorigins/codetabs timed out` | This is the **site refusing the cloud proxy** (usually bot protection on the site, which blocks Cloudflare-Worker and public-proxy addresses). It is shown as "The site is blocking MangaFlow". MangaFlow does not try to bypass protection; run `start-manga.bat` (your home connection) or open the chapter in your normal browser. See 11.3. | `explain()` |
| 3 | Progress line | as 2.1 #3 | — |
| 4 | **Clear (✕) button inside the search boxes** (paste a new link without deleting the old one by hand) | Three boxes (start page, phone search pop-up, reader bar) have a ✕ that appears only when there is text. | `index.html` `.inwrap/.clearx`; `app.js` bottom (wiring), `setAddress` |
| 5 | **Refresh in reading mode must not go home**; update history on every new chapter; see the last chapter on another device | While you read, the address of the page holds `#r=<chapter link>` (`rememberChapter`). On start-up `resumeFromHash()` reopens that chapter in reading mode. A new **⌂ Home** button in the reader bar and "✕ End reading" clear it (so only those go to the start page). Every chapter you scroll into is saved in "Continue reading" (`reads`). **Other device:** the history lives in each browser's `localStorage` and cannot sync by itself (there is no server). What does work: copy the page address while reading (it contains `#r=`) and open it on the other device — it resumes at that chapter. A real sync would need a small backend (idea in section 12). | `app.js` `rememberChapter`, `leaveReader`, `resumeFromHash` |
| 6 | Phone bar: manga title was squeezed | On screens ≤ 520 px the words "End reading" are hidden (only ✕ stays). | `style.css` `#btnExit .lbl` |

### 2.3 Round 10 — what was asked and what was done

| # | Request | Done | Where |
|---|---|---|---|
| 1 | **roliascan.com**: "no images found on this chapter page" (report: 3 `<img>` tags, 20 scripts, nothing in scripts, no API hints, text only menu/login) | The pictures are added by JavaScript after the page loads, so the downloaded page has none. The page's preview picture (`og:image`) is page 1 of the chapter (`.../storage/chapters/<code>/001.webp`) and the other pages sit next to it with the next numbers. New fallback `probeNumbered()` asks for 001, 002, 003 … (6 at a time) and stops at the first missing number (max 300); each test tries an `<img>` first, then your own proxy with the chapter as referer. It is used only when normal detection finds nothing, in reading mode, in downloads and in `analyze` / `tryAutoRead` (a page with a chapter number in the address + numbered preview picture counts as a chapter page). The report now also lists og:image, the first `<img>` addresses, script files and whether the page says "loading" or "not available". `LOCK_RE` also matches "not available anymore / has been removed" → message "may be LOCKED or REMOVED". **Honest note:** a live fetch of that page showed only a "Loading chapter…" placeholder and "This content is not available anymore", so some chapters may simply be removed or hidden by the site; the fix covers sites whose pictures are numbered next to the preview picture. | `app.js` `probeNumbered`, `metaImageSamples`, `imgExists`, `analyze`, `tryAutoRead`, `diagnose`, `noImagesError` |
| 2a | **Download size** (15 chapters = 1 GB) — show the size BEFORE downloading | The download window now has a **picture-mode** choice and an **"Estimated size"** box. It downloads 4 sample pages, builds a throw-away PDF in the chosen mode and multiplies (pages of open chapters are known, the rest use the average). Above 400 MB it suggests and selects "a new file every N chapters (≈ 300 MB each)". Colours: orange > 300 MB, red > 700 MB. **Cause of the 1 GB:** WebP pages were stored as raw pixels ("lossless"). The default is now **JPEG 92 %** (about 5–10× smaller, looks the same; JPEG/PNG pages are still copied untouched); old settings are moved once (`settings.ver < 10`). | `app.js` `measure`, `estimate`, `scheduleEstimate`, `PDF_Q`, `addPageImage(..., mode)`; `index.html` `#rgMode`, `#rgSize` |
| 2b | Download **stopped after 2 of 10 chapters** with no message | The exact cause was not visible (most likely memory: a huge PDF in the browser, or a site slowing down). Now: every picture has a 150 s limit; a chapter that crashes unexpectedly is marked missing and the next one continues (3 crashes in a row stop the job); a **watchdog** shows a pop-up if nothing moves for 90 s; every step goes into a **diary** (`job.log`); ANY failure / stall / "saved with missing pages" shows the big pop-up with `jobReport()` = job facts + last 45 diary lines + JS memory use + failed list. | `app.js` `jlog`, `jobReport`, `runJob`, `buildPart` (`doChapter`) |
| 3 | An error report for EVERYTHING | Page-load failures (`navigate`), any chapter failure (once per site and kind), failed pictures (**Details** button on the "Page N could not be loaded" box), downloads (above), crashes and security blocks (round 8) all open the big pop-up with a copyable report. Bot/403/429/503 keep their own pop-up. | `showError` callers |
| 4 | Go-to-top key beside the reload keys | `#btnTop` (⇧ top), same round 3D style, left group; the Home key does the same and the key "presses" visibly. | `index.html`, `app.js` |
| 5 | **Separate horizontal slider file** (like the attached cross-slider, X axis only) at the middle of the right edge to change chapter one at a time; visible only when the file is linked | New file **`chapter-slider.js`**, linked by ONE `<script>` line in `index.html`. It builds its own HTML + CSS, shows only in reading mode (`body.reading`), fades while scrolling (`body.scrolling`), moves the knob on X only (±38 px, spring back), and when released past 26 px sends the browser event `mf-chapter-step` with `detail.dir` = +1 (next) / −1 (previous): **one chapter per drag**. `app.js` listens (`stepChapter`). Delete the file or the script line → no slider, nothing else changes. Keyboard: focus the knob, ←/→. Sets `window.MangaFlowSlider`. | `chapter-slider.js`; `app.js` `mf-chapter-step` |
| 6 | Download button always visible like the arrow keys, hides on scroll, minimised, highlight only while downloading | `#dock` is shown whenever you read (even with no job), minimised, class `ui-hide` (fades while scrolling down). Idle = a small round ⬇ (tap = open the download window). While a job runs: filling ring, bobbing arrow, pulsing glow and a count; green = PDF ready, red = failed. | `index.html #dock`; `style.css`; `app.js` `syncDock` |
| 7 | Clear (✕) button smaller and fixed | 22 × 22 px, pinned by `.inwrap .clearx` (a more specific rule than the search-bar button rules). | `style.css` |
| 8 | Comments on all lines | All new code (the slider file, estimate, watchdog, probing, start page) has WHY / HOW / IMPROVE on every block and on most lines; see section 13 for the honest overall coverage. | all files |
| 9 | Digital, friendlier home page | Hero card (animated gradient) with a search form (Paste + Read + ✕), status chips (local launcher / own proxy / free proxies only; slider add-on on/off; Settings), a 3-step "how it works" row, and history / bookmarks as cards with coloured letter tiles. Plain HTML / CSS / JS. | `index.html #start`; `style.css`; `app.js` `renderStart`, `renderStatus`, `item` |
| 10 | All files fresh + this blueprint | All ten files + the zip are delivered again. | — |

---

## 3. Rules of this project

1. **Pure HTML/CSS/JS.** No build step, no npm packages in the website. (Tests use Playwright; they are not part of the site.)
2. **Every code file is commented in basic English for beginners**: WHY it exists, HOW it works, how to IMPROVE it. New code gets the same.
3. **One combined project file** (this one). Add a round, never start a second guide.
4. **Never bypass protection.** No captcha / Cloudflare / login bypass. When a site blocks, tell the user plainly (pop-up) and give honest options.
5. **Safe by default**: scripts of other sites never run; only http(s) addresses open; outside text is written with `textContent`.
6. **Nothing fails silently**: every problem ends in the big error pop-up with a copyable report.
7. **Works on PC and phone**: touch targets ≥ 40 px, safe-area padding, 16 px inputs (no iOS zoom), reduced-motion support, keyboard shortcuts on PC.
8. **Be honest** about what was tested (mock sites) and what was not (live sites).

---

## 4. Files (what each one is for)

| File | Purpose |
|---|---|
| `index.html` | Page structure and ids (start page, mini browser, reader, reader bar + search, earlier-chapters bar, keys, download dock, range dialog, error pop-up, phone search pop-up, settings dialog). Content-Security-Policy `<meta>`. |
| `style.css` | Themes (CSS variables, white/black), layout, 3D keys, progress line, dock, settings grid/tabs, phone rules. |
| `app.js` | All behaviour (sections 0–16, see 6). |
| `chapter-slider.js` | **Optional** add-on (round 10): horizontal chapter slider at the middle of the right edge. Own HTML + CSS + JS; sends `mf-chapter-step`. Remove it and the site works as before. |
| `pdfmaker.js` | Own tiny PDF writer `MangaPDFLib` (loaded before `app.js`): copies JPEG bytes untouched, PNG when simple, else decodes; `strip()` = one tall page per chapter. |
| `worker.js` | Cloudflare Worker proxy (own, free). Set `ALLOWED` to your site. Accepts `&ref=` (sent as Referer). |
| `proxy-local.js` | Local launcher: serves the site and `/proxy?url=` at http://localhost:8787 (Node.js, no packages). |
| `start-manga.bat` | Windows double-click starter (checks Node.js, opens the browser, runs `proxy-local.js`). |
| `_headers` | Real HTTP security headers for Netlify / Cloudflare Pages (GitHub Pages ignores it). |
| `MANGAFLOW.md` | This file. |
| `test/mock-sites.js`, `test/e2e-test.js`, `test/img/` | Test helpers: fake manga sites + Playwright end-to-end suite (67 checks). **Not part of the website.** |

Load order in `index.html`: `pdfmaker.js` first, then `app.js` (both `defer` or at the end of `<body>`; same folder, exact file names).

---

## 5. Data and storage

`localStorage` keys (all start with `mf_`): `mf_settings`, `mf_recent` (pages), `mf_books` (bookmarks), `mf_reads` (manga + site +
chapter URL/label + time → "Continue reading"), `mf_progress`. The address bar also carries `#r=<chapter link>` while reading.

`settings` (defaults): `proxies` (list; first run = the free defaults + your old single proxy), `width: 820` (px), `side: 'right'`
(arrow keys), `theme: 'light'`, `arrowKeys: true`, `tapScroll: true`, `autoRead: true`, `ver: 10` (migration counter: <8 → side left,
<9 → side right, <10 → pdfMode small), `pdfMode: 'small'` (default, JPEG 92 %) or `'lossless'`, `autoFree: 0` (clear chapters N behind you), `noHistory: false`, `wipeOnClose: false`.

Reader state `R`: `{ gen, title, chapters[], first, next, cur, loading, paused, seriesUrl, batchP }`.
`first` = lowest chapter index on the page (earlier chapters go above it), `next` = next index to load below, `cur` = chapter in view,
`gen` = counter that invalidates results of loads started before a jump. A chapter object: `{ url, title, num, guess?, dead? }`
(`guess` = invented from the address number, `dead` = a guessed chapter that does not exist).

---

## 6. `app.js` — section map and the algorithms

| § | Name | Contents |
|---|---|---|
| 0 | Security basics | `escapeHtml`, safe URL checks, CSP notes. |
| 1 | Small helpers | `$`, `$$`, `sleep`, `store` (localStorage with try/catch), `toast`. |
| 2 | Settings + theme | defaults, migrations, `applySettings` (theme, width, `body[data-side]`). |
| 3 | Fetching through a CORS proxy | `proxyList`, `askProxy`, `fetchHTML` (direct → all proxies at once, `Promise.any`), `fetchDoc` (+ cache). |
| 4 | URL helpers | `absUrl`, `sameUrl`, `normalizeInput` (text → URL or search), `safeWebUrl`, `hostOf`. |
| 5 | Errors | `showError` (modal `<dialog id="errbox">`), `explain` (title + hint from key words), `diagnose` (facts about a page), `reportBlocked`, toast, busy bar. |
| 5b | Polite requests | `gate(key,max,gap)` tickets per host, `coolDown` after 429/503. |
| 6 | History | `recent`, `reads`, `books`, "Continue reading" on the start page. |
| 7 | Mini browser | `navigate(url, push, {user})`, `renderFrame` (sandboxed iframe, scripts removed, links neutralised with `data-mf-href`), `tryAutoRead`, `readFrom`, `goHome`, `setAddress`. |
| 8 | Chapter + image detection | `CH_RE`, `numFrom`, `detectChapters`, `detectChaptersLoose`, `pickSeries`, `seriesKey`, `belongsToPage`, `extractImages` (img src/lazy attrs/srcset/`<picture>` → biggest container; else `fromScripts`), `ajaxChapterList` (Madara). |
| 8b | Full chapter list from a chapter page (r9) | `findNavLinks` (JSON prevUrl/nextUrl, `<link rel>`, rel/class/text links, ignores `#`), `findSeriesLink` (scored), `guessSeriesUrls`, `loadSeriesList`, `synthesizeChapters`, `noImagesError`, `LOCK_RE`; then `findParentLink`, `findStep` / `findNextLink` / `findPrevLink`, `analyze`. |
| 9 | Reading mode | `R`, `startReading`, `loadNext` (batches of 10, `IntersectionObserver` on `#sentinel`), `makeSection(i, detached)`, `fillChapter`, `makeImg` (src → own proxy with `&ref=` → images.weserv.nl → visible "Page N could not be loaded" box with Retry). |
| 10 | Navigation | `buildChapterMenu` (skips dead), `jumpTo`, `goChapter` (adds earlier chapters when needed), `jumpOrGo`, `goEnd`, reload buttons (`reloadSections`). |
| 9b | Earlier chapters (r9) | `BATCH_PREV = 5`, `loadPrev`, `updatePrevBar`, `removeSection`, `stepChapter`, `ANCHOR_OK`. |
| 10b | Free memory | `freeSection`, `restoreSection`, `clearRange`, `autoFree`. |
| 11 | Scroll tracking | `onScroll` (hide UI on down >14 px, show on up; ignores scrolling not caused by a person via `markInput`/`holdUiFor`), `updateCurrent` (current chapter, progress width, load-ahead), `rememberChapter` (history + `#r=`), `leaveReader`, `exitReading`, `readerGo`, `tapScroll`. |
| 12–12c | PDF + downloads | `fetchBytes`/`byteRoutes`, `addPageImage(pdf, bytes, mode)`, range dialog + **size estimate** (`measure`, `estimate`), `queueDownload`, `runJob` (watchdog), `jlog`/`jobReport`, `buildPart` (`doChapter`), `renderDock`, `syncDock`, `paintPill`. |
| 13 | Phone search pop-up | `#searchPop`, Paste, Go. |
| 14 | Event wiring | buttons, keyboard (←/→ = previous/next chapter, End, Home, N/P/T/C/Esc, ArrowUp/PageUp at top loads earlier), wheel/touch triggers for earlier chapters. |
| 15 | Settings dialog | `openSettings`, `fitSettings`, `showTab`, proxy list editor, security check. |
| 8c | Numbered pictures (r10) | `metaImageSamples`, `imgExists`, `probeNumbered`, `NUM_IMG` (inside the 8b block). |
| 16 | Start-up + safety nets | global `error`, `unhandledrejection`, `securitypolicyviolation` → pop-up; `applySettings`, `renderStart`, `?url=` parameter, `resumeFromHash`, start-page form, clear (✕) wiring, Home button, `mf-chapter-step` listener (in 14). |

### 6.1 How reading starts (the important flow)

1. `navigate(url, true, {user:true})` fetches the page through the proxy, shows it in the sandboxed iframe, starts `enhanceSeriesPage`.
2. `tryAutoRead` waits for it, decides "manga?" (≥3 pictures = chapter page; or ≥2 chapter links of this manga) and calls `startReading({quiet:true})`.
3. `startReading` → `analyze(page)`: chapter page? (≥3 pictures). Chapter list from the page; if empty **or has no earlier chapters** (chapter number ≥ 3 with < 3 earlier ones) → `loadSeriesList` (shorter address → series link by name/words → typical addresses, ≤ 6 guesses / 25 s, a page is accepted only with ≥ 2 chapters of this manga) → else `synthesizeChapters`.
4. `R` is built with `first = next = cur = start`; the first batch of 10 chapter boxes is created at once and filled in parallel; pictures are lazy.
5. Scrolling down: when `cur >= next - 2` the next batch loads. Scrolling up near the top (or the button / keys / wheel / drag): `loadPrev` inserts 5 earlier chapters above and compensates the scroll.
6. Every chapter you reach is saved (`rememberChapter`): history row + `#r=` in the address.

### 6.2 Chapter-list discovery order (and why)

own links on the page → hidden list via Madara AJAX → chapter dropdown/loose boxes → **(r9)** series page via shorter address → series link by slug/words/JSON-LD → `/comics/slug/`, `/manga/slug/`, `/series/slug/`… → numbered guess. Each step validates (`belongsToPage`, ≥ 2 chapters of this manga) so a sidebar of other manga is never mistaken for the list.

### 6.3 Picture detection order

`<img>` (src, `data-src`, `data-lazy-src`, `srcset`, `<picture>`) → the container with the most pictures → pictures only inside scripts (`"images":[...]`, ts_reader, Next.js JSON) → biggest numbered folder pattern. Hotlink protection: pictures retried through your proxy with the chapter as Referer.

---

## 7. `index.html` — the ids the code depends on

Start page: `#start`, `#browser`, `#frame`, `#addr`/`#addrForm`, `#addrPill`, `#btnBack/#btnFwd/#btnReload/#btnHome/#btnStar/#btnThemeB/#btnSettings`, `#fabRead`.
Reader: `#reader`, `#progress` (outside the bar!), `#readerBar` (`#btnHomeR`, `#btnExit`, `.rb-title` `#rTitle` `#rSub`, `#btnChapters`, `#btnTheme`, `#btnSettingsR`, search `#rdForm` `#rdAddr`), `#chapterMenu` (`#btnDlMenu`, `#btnFreeMenu`, `#chapterList`), `#prevBar` (`#btnPrevLoad`, `#prevInfo`), `#stream`, `#sentinel`, `#theEnd`, `#dlBar` (`#dlInfo`, `#btnDl`, `#btnTopEnd`).
Keys: `#side` → `.kg-l` (`#btnReload1`, `#btnReloadAll`, `#btnTop`), `.kg-r` (`#btnPrev`, `#btnNext`, `#btnEnd`).
Start page: `.hero`, `#heroForm`, `#addrHero`, `#heroPaste`, `#statusChips`, `.steps`, `#readList` / `#recentList` / `#bookList`. Slider (injected by `chapter-slider.js`): `#mfSlider`, `.mf-knob`. Dock: `#dock` (class `ui-hide min`), `#dockIcon`, `#dockLabel`, `#dockCount`, `#dockBox`, `#dockMin`. Range dialog `#rangeDlg` (`#rgFrom`, `#rgTo`, `#rgSplit`, `#rgMode`, `#rgSize`, `#rgInfo`, `#rgGo`, `#rgCancel`). Error pop-up `#errbox` (`#errText`, `#errClose`, `#errCopy`).
Phone search: `#searchPop`, `#popShade`, `#popForm`, `#addr2`, `#btnPaste`.
Settings: `<dialog id="settings">` → `#setForm` → `.set-head` (`#setTabs` buttons `data-tab` proxy/reading/memory/security) + `.set-grid` with four `fieldset.set-card`: `#proxyBox` (`#proxyList`, `#proxyNew`, `#proxyAdd`, `#proxyTest`, `#proxyReset`), `#readBox` (`#setWidth`, `#setWidthVal`, `#setSide`, `#setPdf`, `#setArrows`, `#setAutoRead`, `#setTap`), `#memBox` (`#memInfo`, `#memFrom`, `#memTo`, `#memRange`, `#memBefore`, `#memAuto`), `#secBox` (`#setNoHist`, `#setWipe`, `#secCheck`, `#secList`); footer `#btnClear` + Done.
Clear buttons: `<span class="inwrap"><input …><button class="clearx" data-for="<input id>">`.

---

## 8. `style.css` — the design rules

* **Themes**: CSS variables on `:root` / `[data-theme=dark]` (`--bg --fg --line --accent --keytop --keyhi --keyedge --safe-t --safe-b`).
* **Reader bar**: `#readerBar` slides up with `transform: translateY(-110%)` when `body.scrolling` (not just fades) and stops catching clicks; `.ui-hide` fades the individual items.
* **Progress line**: `#progress { position: fixed; top: var(--safe-t); height: 3px; }` — never inside a transformed parent (a transform would trap a fixed child; that was the bug).
* **Keys**: `#side` click-through strip (`pointer-events: none`), `.kg { pointer-events: auto }`; each `.key` is a circle (`border-radius: 50%`) with radial-gradient top, solid under-shadow = thickness, pressed state moves down 4 px. Sizes 50 / 44 (≤ 520 px) / 40 px (≤ 370 px). `body[data-side=left]` → `row-reverse`.
* **Dock**: bottom corner, above the keys while reading (`bottom: calc(14px+5px+50px+14px+safe)`), `column-reverse` so the open list is above the round pill.
* **Settings**: `#settings { width: min(98vw,1180px); max-height: 96dvh }`; `.set-grid` = `repeat(auto-fit, minmax(255px,1fr))`; `#settings.tabs` shows `#setTabs` and hides the non-active cards; compact paddings; short windows hide the small grey help lines.
* **Earlier chapters bar**: `#prevBar` keeps a fixed height so showing/hiding its button does not move the page; a disabled button is hidden.
* **Phone**: media queries at 520 px and 370 px; `#btnExit .lbl` hidden ≤ 520 px.
* `img.page { width: 100%; height: auto }`, placeholder `min-height: 260px` until loaded; `overflow-anchor` left at the default (auto) so the browser keeps the view still when content is inserted above.

---

## 9. Other files in detail

**`pdfmaker.js`** — builds PDF bytes by hand: objects, cross-reference table, page tree; `addImage` copies JPEG (DCTDecode) bytes as they are; simple PNG copied; other formats decoded on a canvas and stored lossless (or JPEG 98 %). `strip(title block, pictures, end block)` makes ONE tall page per chapter; chapters taller than 14400 units set `/UserUnit`. Tested with `qpdf --check`.

**`worker.js`** — Cloudflare Worker: GET only; target must be http(s); refuses private/local hosts and its own address; optional `ALLOWED` origin list (set it), optional `TOKEN` (`?k=`); passes only web/JSON/text/picture answers; size cap; per-visitor rate limit; no cookies; accepts `ref` and sends it as `Referer` (so picture hosts with hotlink protection answer); adds CORS headers.

**`proxy-local.js`** — Node http server: serves only the whitelisted site files, `/proxy?url=` and nothing else; checks `Host` (DNS rebinding), `Origin` / `sec-fetch-site`, refuses private targets (checked on the resolved IP, also after redirects), GET only, size cap, 900 requests/min, no cookies, `ref` support. `MF_ALLOW_PRIVATE=1` is for tests only.

**`_headers`** — `Content-Security-Policy` (own scripts only, `style-src 'self' 'unsafe-inline' https:`, images any https, frames none), `X-Content-Type-Options`, `Referrer-Policy`, `frame-ancestors 'none'`.

**`start-manga.bat`** — `where node` check with a friendly message → `cd /d "%~dp0"` → open the browser after 2 s → `node proxy-local.js` → `pause` so errors stay readable.

---

## 10. How to run and publish

**A. PC (best).** Install Node.js (LTS). Keep all site files in one folder. Double-click `start-manga.bat`. Use http://localhost:8787.

**B. GitHub Pages.** Upload `index.html`, `style.css`, `app.js`, `pdfmaker.js` (and optionally `_headers`) to the repo root; Settings → Pages → deploy from branch. After updating press Ctrl+F5 (phone: reload twice). Saved data lives in the browser and survives updates.

**C. Your own proxy (needed on GitHub Pages / phones).** Cloudflare dashboard → Workers & Pages → Create Worker → paste `worker.js` → set `ALLOWED = ['https://YOURNAME.github.io']` → Deploy. Test `https://NAME.YOURNAME.workers.dev/?url=https://example.com`. In MangaFlow: ⚙ Settings → CORS proxies → add `https://NAME.YOURNAME.workers.dev/?url={url}` (keep `{url}`).

**D. New device.** Copy the folder (or open the GitHub Pages address). History does not travel; the reading address with `#r=` does (2.2 #5).

---

## 11. Honest limits and how problems are solved

1. **Live sites were not reachable from the build environment** (network allowlist). Round-9 fixes for Thunder Scans were built from the known ts_reader / MangaStream structure and tested on a mock that copies it (series at `/comics/slug/`, chapters at the root, `#/prev/` placeholders, JSON `prevUrl`/`nextUrl`). A real site can still differ → the pop-up report (section 11.4) is how it gets fixed.
2. **arenascans.com** structure is unknown here; the generic fixes (script images, hotlink referer, series lookup) apply, and the report will show what the page contains if it still fails.
3. **Blocked by the site (HTTP 403 / "Just a moment" / captcha / rate limit).** Free proxies and Cloudflare Workers run from data-centre addresses that many sites block. MangaFlow shows "The site is blocking MangaFlow" and does **not** bypass protection. Options: `start-manga.bat` (home connection), wait and Retry, add your own proxy, read in the normal browser.
4. **Locked chapters** (login / coins / premium) cannot be read; the pop-up says LOCKED.
5. **Pictures that come from a JavaScript API call** after page load (nothing in the page source) cannot be found without a real browser engine; the report says so (idea: headless-browser proxy).
6. Free public proxies are slow, can be down, cannot POST, and can read every address you open.
7. Safari without scroll anchoring uses a manual scroll correction (less smooth).
8. **Download of a huge range**: the whole PDF is built in browser memory. The estimate warns above 400 MB and suggests smaller files; a phone can still run out of memory. History is per browser (no sync). Huge PDFs use browser memory (use "a new file every 25/50 chapters" or "JPEG 98 %").
9. Only read content you have the right to access.

**How to report a problem.** The big pop-up has **Copy report**. Paste it to Claude with the site address and what you expected. For "no chapters/pictures found" the report lists: page title, `<img>` count, `<script>` count, picture addresses inside scripts, React/Next app?, `__NEXT_DATA__`?, ts_reader?, lock words?, prev/next links found, `/api/` hints, bot-check words, first 300 characters of text.

---

## 12. Ideas for the next improvements

1. **Sync history between devices** (small backend: Cloudflare Worker + KV, or Supabase, keyed by a secret code; the reads list is tiny).
2. Site rules table (per hostname: list selector, picture selector, script pattern) built from reports.
3. Headless-browser proxy for sites that load pictures through an API.
4. Make `BATCH` / `BATCH_PREV` settings; remove far-away chapters at the bottom when many earlier ones are loaded.
5. Page-by-page (swipe) mode, offline cache / installable PWA, cover thumbnails in history, draggable dock, pause/resume downloads.
6. Use a `ResizeObserver` for the settings fit and remember the last tab.
7. A Mac/Linux launcher `start-manga.sh`, automatic free port.

---

## 13. Comments in the code (the beginner rule) — honest status

Every file starts with a header explaining WHY it exists, HOW it works and how to IMPROVE it. `app.js` is split into numbered sections, each with a WHY / HOW / WHERE / IMPROVE block, and every function has its own block or line comment. CSS has a block per section; HTML has a comment per major element group. Tricky lines carry inline notes. **Not literally every single line has its own comment** (about a third of the code lines are individually explained, the rest are covered by the block above them). To raise coverage, ask Claude: "add a WHY/HOW/IMPROVE comment above every uncommented line of <file>, in basic English" — one file at a time works best.

---

## 14. Tests

`test/e2e-test.js` (Playwright, headless Chromium) against `test/mock-sites.js` (three fake sites on ports 9100/9101 + Thunder-style site D + a no-series site + a locked chapter) and `proxy-local.js` started with `MF_ALLOW_PRIVATE=1`. Run: start `node test/mock-sites.js`, start `MF_ALLOW_PRIVATE=1 node proxy-local.js`, then `node test/e2e-test.js` (edit the Chromium path at the top for your PC). **Round 10 result: 78 checks, 0 failed** (67 earlier + roliascan-type site, slider, top key, dock, clear button size, size estimate, start page).

Covered: paste a home link → reading starts by itself; 10 chapters at once; reload keys left, arrow/End keys one row right, circular 3D; title + search bar + keys hide on scroll down and return on scroll up; progress line at the top edge while the bar is hidden; End key; download of 5 chapters while reading (PDF = 5 long pages, `qpdf --check` clean, pill turns green); dock above the keys; reader search bar switching to a script-image + hotlink site; number-only chapter list; 403 and bot-check pop-ups; crash pop-up; click a chapter link → reading at that chapter; **chapter-5 link → chapters 1–4 reachable by wheel-up, button and Left arrow, in order, without a jump**; Thunder-style site (series by link, JSON prev/next, script pictures); site with no series page (guessed chapters, missing ones vanish); locked chapter; settings grid on a big screen / tabs on a phone with no scrolling; refresh keeps reading and the same chapter; ✕ clear button; ⌂ Home goes to the start page and a refresh then stays there; no CSP violations.
Not tested: live sites, real phones, Safari, a real 1 GB download (the stall / memory protections are code-reviewed and the estimate is tested, but a multi-GB run was not).

Asking Claude for changes: attach this file plus the files to change and say what you see (plus the **Copy report** text).
