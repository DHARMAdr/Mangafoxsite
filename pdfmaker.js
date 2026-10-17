/* =====================================================================
   MangaFlow Reader - pdfmaker.js   (a tiny PDF writer, no libraries needed)
   ---------------------------------------------------------------------
   WHY THIS FILE EXISTS
   The "Download all chapters" button must make ONE PDF with every page at full quality.
   Most PDF libraries decode each picture and compress it again, which costs quality, time and memory.
   This file does the opposite: it puts the ORIGINAL picture bytes into the PDF untouched.
     - JPEG pictures   -> copied as they are (the PDF format understands JPEG directly)
     - simple PNG      -> the compressed data is copied as it is (the PDF format understands it too)
     - anything else   -> app.js lets the browser decode it, and we store the raw pixels (lossless)
   TWO WAYS TO MAKE PAGES
     1. Normal pages: every picture becomes a page exactly as big as the picture (1 pixel = 1 PDF point).
        A very tall picture is cut into several pages WITHOUT re-encoding it.
     2. LONG-STRIP pages (new in round 6, used by the download button): ALL pictures of one chapter are
        stacked on ONE very tall page, exactly like the reading mode. The pictures are still the original
        bytes, so quality is untouched. Only the PAGE SIZE is written smaller when the chapter is taller than
        14400 units (the limit of Adobe Acrobat): the page then carries a /UserUnit number that tells viewers
        how much bigger to show it. Viewers that ignore /UserUnit simply show the same strip a little smaller;
        nothing is cropped or re-compressed either way.

   HOW IT IS USED (from app.js)
       const pdf = new MangaPDF({ title: 'My Manga' });
       pdf.bookmark('Chapter 1');            // the next page you add gets this bookmark
       await pdf.addJpeg(bytes);             // bytes = Uint8Array of a .jpg file
       await pdf.addPng(bytes);              // throws if the PNG is not a simple one
       await pdf.addRaw(w, h, rgbBytes);     // w*h*3 bytes of red, green, blue
       const blob = pdf.finish();            // a Blob you can download

       // Long-strip way (one page per chapter):
       const strip = pdf.strip({ bg: [255, 255, 255] });   // start a tall page
       await strip.addRaw(w, h, rgb, true);  // true = put it at the very top (used for the title block)
       await strip.addJpeg(bytes);           // pictures are stacked top to bottom in the order you add them
       strip.maxWidth;                       // widest picture so far (use it to size the title/end blocks)
       strip.end();                          // writes the page

   HOW A PDF FILE IS BUILT (for beginners)
   A PDF is a list of numbered "objects" (1 0 obj ... endobj), then a table (xref) that says at which
   byte each object starts, then a "trailer" that says where the table is. We write the objects one
   after another, remember their byte positions, and write the table last.

   WHERE IT IS USED: loaded by index.html before app.js; only app.js section 12 (downloadAll) calls it.

   IMPROVE LATER
     - Add an "image mode" that turns WebP into JPEG 98% to make the file 3x smaller.
     - Add page labels or a cover page.
     - Write straight to disk with the File System Access API so very large PDFs never sit in memory.
   ===================================================================== */
(function (root) {
  'use strict';

  const enc = new TextEncoder();            // turns text into bytes
  const MAX_PAGE = 14000;                   // most PDF viewers handle pages up to about 14400 units
  const STRIP_MAX = 14400;                  // Adobe Acrobat's largest page side; longer strips use /UserUnit
  const OVERLAP = 0.5;                      // each picture goes 0.5 px under the next one so no thin line can show between them
  const FLUSH_AT = 32 * 1024 * 1024;        // move big data into a Blob every 32 MB so memory stays low

  /* ---------- reading the top of a JPEG to learn its size and colour type ----------
     WHY: the PDF needs width, height and colour type, but we do not want to decode the picture.
     HOW: a JPEG is a list of "markers". The marker named SOF holds height, width and colour count. */
  function parseJpeg(b) {
    if (b[0] !== 0xFF || b[1] !== 0xD8) throw new Error('not a JPEG');
    let i = 2, adobe = false;
    while (i + 4 <= b.length) {
      if (b[i] !== 0xFF) { i++; continue; }          // skip stray bytes
      const m = b[i + 1];
      if (m === 0xFF) { i++; continue; }             // padding
      if (m === 0xD8 || m === 0x01 || (m >= 0xD0 && m <= 0xD7)) { i += 2; continue; }   // markers without data
      const len = (b[i + 2] << 8) | b[i + 3];
      // APP14 "Adobe" marker: CMYK JPEGs made by Photoshop are stored upside down (inverted).
      if (m === 0xEE && len >= 14 && b[i + 4] === 0x41 && b[i + 5] === 0x64 && b[i + 6] === 0x6F) adobe = true;
      // SOF markers (C0..CF except C4, C8, CC) describe the picture.
      if (m >= 0xC0 && m <= 0xCF && m !== 0xC4 && m !== 0xC8 && m !== 0xCC) {
        if (m > 0xC2) throw new Error('unsupported JPEG type');     // lossless / arithmetic coding: let the browser decode
        const bits = b[i + 4], h = (b[i + 5] << 8) | b[i + 6], w = (b[i + 7] << 8) | b[i + 8], comps = b[i + 9];
        if (bits !== 8 || !w || !h || ![1, 3, 4].includes(comps)) throw new Error('unsupported JPEG');
        return { w, h, comps, adobe };
      }
      i += 2 + len;                                  // jump to the next marker
    }
    throw new Error('JPEG header not found');
  }

  /* ---------- reading a PNG so its compressed data can be copied without decoding ----------
     WHY: PDF's FlateDecode with "Predictor 15" understands PNG's own compression, so for simple PNGs
          we can copy the data untouched (lossless AND the same size as the PNG file).
     LIMIT: only 8-bit (or low-bit grey/palette) pictures without transparency and without interlacing.
            Others throw, and app.js falls back to the browser decoder. */
  function parsePng(b) {
    const sig = [0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A];
    if (b.length < 33 || sig.some((v, k) => b[k] !== v)) throw new Error('not a PNG');
    const dv = new DataView(b.buffer, b.byteOffset, b.byteLength);
    let i = 8, hdr = null, palette = null; const idat = [];
    while (i + 12 <= b.length) {
      const len = dv.getUint32(i);
      const type = String.fromCharCode(b[i + 4], b[i + 5], b[i + 6], b[i + 7]);
      const data = b.subarray(i + 8, i + 8 + len);
      if (type === 'IHDR') {
        hdr = { w: dv.getUint32(i + 8), h: dv.getUint32(i + 12), depth: b[i + 16], colorType: b[i + 17], interlace: b[i + 20] };
      } else if (type === 'PLTE') palette = data;
      else if (type === 'tRNS') throw new Error('PNG has transparency');
      else if (type === 'IDAT') idat.push(data);
      else if (type === 'IEND') break;
      i += 12 + len;                                  // 4 length + 4 type + data + 4 checksum
    }
    if (!hdr || !idat.length) throw new Error('broken PNG');
    const okType = hdr.colorType === 0 || hdr.colorType === 2 || hdr.colorType === 3;
    const okDepth = hdr.colorType === 2 ? hdr.depth === 8 : [1, 2, 4, 8].includes(hdr.depth);
    if (!okType || !okDepth || hdr.interlace !== 0) throw new Error('PNG type needs the browser decoder');
    if (hdr.colorType === 3 && !palette) throw new Error('PNG palette missing');
    let total = 0; idat.forEach(p => { total += p.length; });
    const all = new Uint8Array(total); let o = 0;
    idat.forEach(p => { all.set(p, o); o += p.length; });
    return { w: hdr.w, h: hdr.h, depth: hdr.depth, colorType: hdr.colorType, palette, idat: all };
  }

  /* ---------- zlib compression using the browser's built-in CompressionStream ----------
     Returns null when the browser cannot do it (very old browsers); then we store raw pixels. */
  async function deflate(bytes) {
    if (typeof CompressionStream === 'undefined') return null;
    const stream = new Blob([bytes]).stream().pipeThrough(new CompressionStream('deflate'));
    return new Uint8Array(await new Response(stream).arrayBuffer());
  }

  // PDF text strings: "FEFF" + each character as 4 hex digits works for every language (Chinese, Korean...).
  function pdfText(s) {
    let h = 'FEFF';
    for (let i = 0; i < s.length; i++) h += s.charCodeAt(i).toString(16).padStart(4, '0');
    return '<' + h + '>';
  }

  class MangaPDF {
    constructor(opts = {}) {
      this.title = opts.title || 'Manga';
      this.parts = [];            // pieces of the file, in order
      this.size = 0;              // bytes written so far (needed for the xref table)
      this.pending = 0;           // bytes in `parts` that are not yet moved into a Blob
      this.offsets = [0, 0, 0];   // object number -> byte position. 1 = catalog and 2 = page list (written last)
      this.nextId = 3;            // next free object number
      this.kids = [];             // object numbers of all pages, in order
      this.marks = [];            // bookmarks: { title, page, top }
      this.pendingMark = null;    // bookmark waiting for the next page
      this.pageCount = 0;
      // File header. The 4 high bytes on line 2 tell programs "this file is binary".
      this._push(new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x2D, 0x31, 0x2E, 0x37, 0x0A, 0x25, 0xE2, 0xE3, 0xCF, 0xD3, 0x0A]));
    }

    _push(u8) {
      this.parts.push(u8); this.size += u8.length; this.pending += u8.length;
      if (this.pending > FLUSH_AT) { this.parts = [new Blob(this.parts)]; this.pending = 0; }   // lets the browser keep it outside JS memory
    }
    _id() { return this.nextId++; }

    // Write one object. With `data` it is a "stream" object (picture data, page content).
    _obj(id, dict, data) {
      this.offsets[id] = this.size;
      if (data) {
        this._push(enc.encode(id + ' 0 obj\n<<' + dict + ' /Length ' + data.length + '>>\nstream\n'));
        this._push(data);
        this._push(enc.encode('\nendstream\nendobj\n'));
      } else {
        this._push(enc.encode(id + ' 0 obj\n' + dict + '\nendobj\n'));
      }
    }

    _takeFront() { const f = this._front; this._front = false; return f; }   // see strip(): "put this one at the top"

    // The next page you add gets a bookmark with this title (shown in the PDF viewer's side panel).
    bookmark(title) { this.pendingMark = title; }

    // Write the picture once, then one or more pages that show it.
    // While a long strip is open (see strip()), the picture goes onto the strip instead of getting its own pages.
    _image(w, h, dict, data, atFront) {
      const imgId = this._id();
      this._obj(imgId, '/Type /XObject /Subtype /Image /Width ' + w + ' /Height ' + h + ' ' + dict, data);
      if (this._strip) return this._strip._place(imgId, w, h, atFront);
      return this._pages(imgId, w, h);
    }

    /* LONG STRIP: one tall page that holds many pictures (one chapter).
       WHY: the person asked for "one chapter = one page", like the reading mode.
       HOW: strip() returns a helper with the same add... methods. Pictures are written to the file at once
            (so memory stays low) and only a tiny note {id, width, height} is kept. strip.end() writes the page. */
    strip(opts = {}) {
      if (this._strip) throw new Error('finish the open strip first');
      const self = this, st = {
        items: [], maxWidth: 0, bg: opts.bg || null,
        _place(id, w, h, front) {
          st.maxWidth = Math.max(st.maxWidth, w);
          const it = { id, w, h };
          if (front) st.items.unshift(it); else st.items.push(it);
          return { pages: 1, width: w, height: h };
        },
        addJpeg: (b, front) => { self._front = !!front; return self.addJpeg(b); },
        addPng: (b, front) => { self._front = !!front; return self.addPng(b); },
        addRaw: (w, h, rgb, front) => { self._front = !!front; return self.addRaw(w, h, rgb); },
        end() { return self._endStrip(st); }
      };
      this._strip = st;
      return st;
    }

    _endStrip(st) {
      this._strip = null;
      if (!st.items.length) return null;
      const W = Math.max(1, st.maxWidth);
      // Every picture is shown as wide as the widest one. Narrower pictures are only stretched by the viewer
      // (their data is not touched), so nothing is ever shrunk.
      let H = 0;
      const rows = st.items.map(it => { const hd = it.h * W / it.w; const r = { id: it.id, hd, top: H }; H += hd; return r; });
      const u = Math.max(1, Math.ceil(H / STRIP_MAX));          // 1 = normal size; bigger = /UserUnit is needed
      const f = n => (Math.round(n * 10000) / 10000).toString();
      let c = 'q ' + f(1 / u) + ' 0 0 ' + f(1 / u) + ' 0 0 cm\n';      // from here on: 1 unit = 1 picture pixel
      if (st.bg) c += (st.bg[0] / 255).toFixed(3) + ' ' + (st.bg[1] / 255).toFixed(3) + ' ' + (st.bg[2] / 255).toFixed(3) + ' rg 0 0 ' + f(W) + ' ' + f(H) + ' re f\n';
      const xo = [];
      rows.forEach((r, k) => {
        const hh = r.hd + (k < rows.length - 1 ? OVERLAP : 0);              // overlap: see OVERLAP above
        c += 'q ' + f(W) + ' 0 0 ' + f(hh) + ' 0 ' + f(H - r.top - hh) + ' cm /I' + k + ' Do Q\n';
        xo.push('/I' + k + ' ' + r.id + ' 0 R');
      });
      c += 'Q';
      const cid = this._id(), pid = this._id();
      this._obj(cid, '', enc.encode(c));
      this._obj(pid, '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ' + f(W / u) + ' ' + f(H / u) + ']' + (u > 1 ? ' /UserUnit ' + u : '') +
        ' /Resources << /XObject << ' + xo.join(' ') + ' >> >> /Contents ' + cid + ' 0 R >>');
      this.kids.push(pid); this.pageCount++;
      if (this.pendingMark) { this.marks.push({ title: this.pendingMark, page: pid, top: f(H / u) }); this.pendingMark = null; }
      return { width: W, height: H, unit: u, images: rows.length };
    }

    /* A page is as big as the picture. If the picture is taller than MAX_PAGE it gets several pages;
       each page shows the SAME picture object, moved up so a different part is visible. Nothing is re-encoded. */
    _pages(imgId, w, h) {
      const n = Math.ceil(h / MAX_PAGE);
      for (let k = 0; k < n; k++) {
        const top = k * MAX_PAGE, sh = Math.min(MAX_PAGE, h - top);
        // "cm" places and scales the picture: width w, height h, bottom edge so that row `top` is at the page's top edge.
        const content = enc.encode('q ' + w + ' 0 0 ' + h + ' 0 ' + (sh + top - h) + ' cm /Im0 Do Q');
        const cid = this._id(), pid = this._id();
        this._obj(cid, '', content);
        this._obj(pid, '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ' + w + ' ' + sh + '] /Resources << /XObject << /Im0 ' + imgId + ' 0 R >> >> /Contents ' + cid + ' 0 R >>');
        this.kids.push(pid); this.pageCount++;
        if (this.pendingMark) { this.marks.push({ title: this.pendingMark, page: pid, top: sh }); this.pendingMark = null; }
      }
      return { pages: n, width: w, height: h };
    }

    // JPEG: copy the file bytes into the PDF as they are (no quality loss, no re-compression).
    async addJpeg(bytes) {
      const j = parseJpeg(bytes);
      const cs = j.comps === 1 ? '/DeviceGray' : j.comps === 3 ? '/DeviceRGB' : '/DeviceCMYK';
      const decode = (j.comps === 4 && j.adobe) ? ' /Decode [1 0 1 0 1 0 1 0]' : '';
      return this._image(j.w, j.h, '/ColorSpace ' + cs + ' /BitsPerComponent 8 /Filter /DCTDecode' + decode, bytes, this._takeFront());
    }

    // PNG: copy the compressed pixel data as it is (lossless).
    async addPng(bytes) {
      const p = parsePng(bytes);
      let cs;
      if (p.colorType === 0) cs = '/DeviceGray';
      else if (p.colorType === 2) cs = '/DeviceRGB';
      else {                                           // palette picture: the colour table goes into the PDF as hex text
        let hex = ''; for (let i = 0; i < p.palette.length; i++) hex += p.palette[i].toString(16).padStart(2, '0');
        cs = '[/Indexed /DeviceRGB ' + (Math.floor(p.palette.length / 3) - 1) + ' <' + hex + '>]';
      }
      const colors = p.colorType === 2 ? 3 : 1;
      return this._image(p.w, p.h,
        '/ColorSpace ' + cs + ' /BitsPerComponent ' + p.depth + ' /Filter /FlateDecode /DecodeParms << /Predictor 15 /Colors ' + colors + ' /BitsPerComponent ' + p.depth + ' /Columns ' + p.w + ' >>',
        p.idat, this._takeFront());
    }

    // Raw pixels (3 bytes per pixel: R, G, B). Compressed with zlib, still lossless.
    async addRaw(w, h, rgb) {
      const z = await deflate(rgb);
      return this._image(w, h, '/ColorSpace /DeviceRGB /BitsPerComponent 8' + (z ? ' /Filter /FlateDecode' : ''), z || rgb, this._takeFront());
    }

    // Write the page list, bookmarks, catalog, info and the xref table. Returns the finished PDF as a Blob.
    finish() {
      this._obj(2, '<< /Type /Pages /Count ' + this.kids.length + ' /Kids [' + this.kids.map(k => k + ' 0 R').join(' ') + '] >>');
      let outline = '';
      if (this.marks.length) {
        const root = this._id(), ids = this.marks.map(() => this._id());
        this.marks.forEach((m, i) => {
          this._obj(ids[i], '<< /Title ' + pdfText(m.title) + ' /Parent ' + root + ' 0 R' +
            (i > 0 ? ' /Prev ' + ids[i - 1] + ' 0 R' : '') + (i < ids.length - 1 ? ' /Next ' + ids[i + 1] + ' 0 R' : '') +
            ' /Dest [' + m.page + ' 0 R /XYZ 0 ' + m.top + ' null] >>');
        });
        this._obj(root, '<< /Type /Outlines /First ' + ids[0] + ' 0 R /Last ' + ids[ids.length - 1] + ' 0 R /Count ' + ids.length + ' >>');
        outline = ' /Outlines ' + root + ' 0 R /PageMode /UseOutlines';
      }
      // /PageLayout /OneColumn = pages one under the other with continuous scrolling, like the reading mode.
      this._obj(1, '<< /Type /Catalog /Pages 2 0 R /PageLayout /OneColumn' + outline + ' >>');
      const d = new Date(), p2 = n => String(n).padStart(2, '0');
      const date = 'D:' + d.getUTCFullYear() + p2(d.getUTCMonth() + 1) + p2(d.getUTCDate()) + p2(d.getUTCHours()) + p2(d.getUTCMinutes()) + p2(d.getUTCSeconds()) + 'Z';
      const info = this._id();
      this._obj(info, '<< /Title ' + pdfText(this.title) + ' /Producer ' + pdfText('MangaFlow Reader') + ' /CreationDate (' + date + ') >>');

      const xrefAt = this.size;
      let x = 'xref\n0 ' + this.nextId + '\n0000000000 65535 f \n';
      for (let i = 1; i < this.nextId; i++) x += String(this.offsets[i]).padStart(10, '0') + ' 00000 n \n';   // each line is exactly 20 bytes
      x += 'trailer\n<< /Size ' + this.nextId + ' /Root 1 0 R /Info ' + info + ' 0 R >>\nstartxref\n' + xrefAt + '\n%%EOF\n';
      this._push(enc.encode(x));
      return new Blob(this.parts, { type: 'application/pdf' });
    }
  }

  const api = { MangaPDF, parseJpeg, parsePng };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;   // lets Node.js tests load it
  else root.MangaPDFLib = api;                                                   // in the browser: window.MangaPDFLib
})(typeof window !== 'undefined' ? window : globalThis);
