/* =====================================================================
   MangaFlow - chapter-slider.js   (OPTIONAL add-on file, round 10)
   ---------------------------------------------------------------------
   WHY it exists:
     A small horizontal slider that floats at the middle of the RIGHT edge while you read. Drag the round knob to the
     right = NEXT chapter, drag it to the left = PREVIOUS chapter (one chapter per drag). It is made as a SEPARATE file
     on purpose: if this file is linked in index.html the slider appears; if the file is missing (or the <script> line is
     deleted) the reader works exactly as before and no slider is shown. Nothing else depends on it.
   HOW it works (three steps):
     1. It builds its own HTML (a track, two small arrows and a knob) and its own CSS, and adds them to the page.
        It only shows itself while the body has the class "reading" (app.js sets that class in reading mode).
     2. The knob moves on the X axis ONLY (like the cross slider this was designed from): a drag is clamped to +-MAX px
        and springs back to the centre when you let go (a CSS transition does the spring).
     3. When you let go and the knob was pulled far enough (>= TRIGGER px) it sends ONE browser event:
            window.dispatchEvent(new CustomEvent('mf-chapter-step', { detail: { dir: +1 or -1 } }))
        app.js listens for that event and moves one chapter. This file knows nothing else about app.js.
   HOW to use it elsewhere: any page can listen for 'mf-chapter-step' - the slider is just a controller.
   HOW to IMPROVE it:
     - make MAX / TRIGGER settings, add a "click the arrow = one step" option, add a vibration on phones
       (navigator.vibrate), let the slider be dragged to a different height, or add a Y-axis twin for "top / end".
   ===================================================================== */
(() => {                                                   // WHY: an IIFE keeps every variable private (no clashes with app.js)
  'use strict';                                            // WHY: strict mode turns silent mistakes into real errors
  if (window.MangaFlowSlider) return;                      // WHY: if the file is loaded twice, build only one slider

  const MAX = 38;                                          // WHY: furthest the knob may move from the centre (px). HOW: used in clamp()
  const TRIGGER = 26;                                      // WHY: how far you must pull before letting go counts as a step (avoids accidents)
  const LOCK = 4;                                          // WHY: tiny finger wobbles below this many px are ignored

  /* ---- 1. the CSS (kept inside this file so the slider is truly one file) ---- */
  const css = `
  #mfSlider{position:fixed;right:6px;top:50%;transform:translateY(-50%);z-index:29;display:none;
    width:150px;height:56px;touch-action:none;user-select:none;-webkit-user-select:none;
    transition:opacity .25s;}                              /* fixed in the middle of the right edge; touch-action:none lets a finger drag it */
  body.reading #mfSlider{display:block;}                   /* only visible in reading mode */
  body.scrolling #mfSlider{opacity:0;pointer-events:none;} /* hides while you scroll down, like the arrow keys, and returns on scroll up */
  #mfSlider .mf-track{position:absolute;inset:6px 0;border-radius:999px;border:2px solid #777d9e;
    background:linear-gradient(145deg,#151722,#080a11 65%,#171927);
    box-shadow:inset 0 4px 10px rgba(0,0,0,.9),inset 0 -1px 2px rgba(255,255,255,.13),0 6px 14px rgba(0,0,0,.28);} /* the dark groove */
  #mfSlider .mf-arrow{position:absolute;top:50%;transform:translateY(-50%);color:#f7f5ff;font-size:22px;line-height:1;
    text-shadow:0 0 10px rgba(188,166,255,.9);pointer-events:none;} /* the little ‹ › marks */
  #mfSlider .mf-arrow.l{left:12px;} #mfSlider .mf-arrow.r{right:12px;}
  #mfSlider .mf-knob{position:absolute;top:50%;left:50%;width:44px;height:44px;margin:-22px 0 0 -22px;padding:0;border-radius:50%;
    border:2px solid #a9a2ff;cursor:grab;z-index:2;
    background:radial-gradient(circle at 32% 25%,rgba(255,255,255,.45),transparent 18%),
      radial-gradient(circle at 72% 72%,#6200ff 0%,#3b20ff 38%,transparent 72%),
      linear-gradient(135deg,#25a8ff 0%,#5741ff 42%,#bb20ff 100%);
    box-shadow:inset 0 0 10px rgba(255,255,255,.2),0 0 0 3px rgba(96,61,255,.16),0 0 18px rgba(112,41,255,.7),0 6px 16px rgba(0,0,0,.6);
    transform:translateX(0);transition:transform 340ms cubic-bezier(.16,1.4,.32,1),box-shadow 160ms;} /* the spring comes from this transition */
  #mfSlider .mf-knob.drag{transition:none;cursor:grabbing;}  /* while dragging the knob must follow the finger at once */
  #mfSlider .mf-knob:focus-visible{outline:3px solid #fff;outline-offset:2px;} /* visible focus for keyboard users */
  #mfSlider .mf-tip{position:absolute;bottom:100%;left:50%;transform:translateX(-50%);margin-bottom:4px;padding:3px 10px;border-radius:999px;
    background:#111;color:#fff;font:600 12px system-ui,sans-serif;white-space:nowrap;opacity:0;transition:opacity .15s;pointer-events:none;} /* "Next chapter" bubble */
  #mfSlider.armed .mf-tip{opacity:1;}                      /* shown once the knob is pulled far enough */
  @media (max-width:520px){#mfSlider{width:128px;right:2px;}} /* WHY: a little smaller on phones so it covers less of the art */
  @media (prefers-reduced-motion:reduce){#mfSlider .mf-knob{transition-duration:1ms;}} /* respect "reduce motion" */
  `;
  const style = document.createElement('style');           // HOW: a <style> tag added to <head>. (The page's CSP allows inline styles.)
  style.id = 'mfSliderCss'; style.textContent = css; document.head.appendChild(style);

  /* ---- 2. the HTML ---- */
  const box = document.createElement('div');               // the whole widget
  box.id = 'mfSlider'; box.setAttribute('role', 'group'); box.setAttribute('aria-label', 'Chapter slider: drag right for next chapter, left for previous');
  box.innerHTML = '<div class="mf-track" aria-hidden="true"></div>' +
    '<span class="mf-arrow l" aria-hidden="true">‹</span><span class="mf-arrow r" aria-hidden="true">›</span>' +
    '<span class="mf-tip" aria-live="polite"></span>' +
    '<button class="mf-knob" type="button" aria-label="Chapter slider knob. Drag right for the next chapter, left for the previous one. Arrow keys also work."></button>';
  document.body.appendChild(box);
  const knob = box.querySelector('.mf-knob'), tip = box.querySelector('.mf-tip');   // the two parts we move / change

  /* ---- 3. the behaviour ---- */
  let dragging = false, pid = null, x0 = 0, off = 0;      // dragging = is a finger/mouse holding the knob; x0 = where it started; off = current offset
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v)); // keep a number between a and b
  const place = px => { knob.style.transform = 'translateX(' + px + 'px)'; };   // move the knob sideways by px

  function step(dir) {                                     // WHY: one single place that tells the app "go one chapter"
    window.dispatchEvent(new CustomEvent('mf-chapter-step', { detail: { dir } }));   // HOW: a normal DOM event any script can hear
  }
  function label(dir) { return dir > 0 ? 'Next chapter ›' : '‹ Previous chapter'; }   // text of the bubble

  knob.addEventListener('pointerdown', e => {              // finger or mouse pressed on the knob
    if (e.button !== undefined && e.button !== 0) return;  // only the main mouse button
    e.preventDefault();
    dragging = true; pid = e.pointerId; x0 = e.clientX; off = 0;
    knob.classList.add('drag');                            // no spring while dragging
    knob.setPointerCapture(pid);                           // HOW: keep getting move events even if the finger leaves the knob
  });
  knob.addEventListener('pointermove', e => {              // the finger moved
    if (!dragging || e.pointerId !== pid) return;
    const dx = e.clientX - x0;
    off = Math.abs(dx) < LOCK ? 0 : clamp(dx, -MAX, MAX);  // X axis only: Y movement is simply never used
    place(off);
    const armed = Math.abs(off) >= TRIGGER;                // pulled far enough to count?
    box.classList.toggle('armed', armed);
    if (armed) tip.textContent = label(off);               // show what will happen
  });
  function release() {                                     // finger lifted (or the browser cancelled the drag)
    if (!dragging) return;
    dragging = false; pid = null;
    knob.classList.remove('drag');
    const dir = Math.abs(off) >= TRIGGER ? (off > 0 ? 1 : -1) : 0;   // which way, or 0 = not far enough
    off = 0; place(0);                                     // the CSS transition springs the knob back to the middle
    box.classList.remove('armed');
    if (dir) step(dir);                                    // exactly ONE chapter per drag
  }
  knob.addEventListener('pointerup', release);
  knob.addEventListener('pointercancel', release);
  knob.addEventListener('lostpointercapture', release);

  knob.addEventListener('keydown', e => {                  // keyboard users: focus the knob, then Left / Right arrow
    if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return;
    e.preventDefault(); e.stopPropagation();               // stop app.js from ALSO reacting to the same key (it would move two chapters)
    const dir = e.key === 'ArrowRight' ? 1 : -1;
    place(dir * MAX * 0.7);                                // small visible nudge ...
    setTimeout(() => place(0), 140);                       // ... then back to the middle
    step(dir);
  });

  window.MangaFlowSlider = { version: 1, el: box };        // WHY: lets other code (and MANGAFLOW.md) check that the add-on is present
})();
