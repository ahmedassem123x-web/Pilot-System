// Contract PDF generator — Node built-ins only, no PDF dependency.
// Arabic RTL is rendered properly (not as disconnected letters):
//  1. Arabic letters are shaped to presentation forms (isolated/final/
//     initial/medial, plus lam-alef ligatures) by the reshaper below.
//  2. Each line is converted to visual order (Arabic runs reversed,
//     Latin/digit runs kept LTR) before drawing.
//  3. Glyphs come from an embedded DejaVu Sans TTF shipped in
//     backend/assets/ (so the PDF renders on Render too, where no
//     system fonts exist, and Latin codes/phones/fingerprints render
//     alongside Arabic — Noto Naskh Arabic has no Latin glyphs at all).
//     The font is parsed here (cmap/hmtx/head) — no external font
//     library is used.
// If the font file is missing, generation throws a clear error instead
// of producing a broken PDF.
const fs = require('fs');
const path = require('path');

const FONT_PATH = path.join(__dirname, '..', 'assets', 'DejaVuSans.ttf');
const FONT_B64_PATH = path.join(__dirname, '..', 'assets', 'DejaVuSans.ttf.b64');
// The GitHub snapshot push only accepts UTF-8 files, so the binary TTF
// cannot be pushed that way; the repo ships the same font as base64
// text instead, and loadFont decodes it in memory at runtime.

// ---- TTF parsing (cmap format 4 / 12, hmtx, head) ----
function u16(buf, o) { return buf.readUInt16BE(o); }
function i16(buf, o) { return buf.readInt16BE(o); }
function u32(buf, o) { return buf.readUInt32BE(o); }
function loadFont() {
  let buf;
  if (fs.existsSync(FONT_PATH)) buf = fs.readFileSync(FONT_PATH);
  else if (fs.existsSync(FONT_B64_PATH)) buf = Buffer.from(fs.readFileSync(FONT_B64_PATH, 'utf8').replace(/\s/g, ''), 'base64');
  else throw new Error('Arabic font file missing: backend/assets/DejaVuSans.ttf(.b64)');
  const numTables = u16(buf, 4);
  const tables = {};
  for (let i = 0; i < numTables; i++) {
    const o = 12 + i * 16;
    tables[buf.toString('ascii', o, o + 4)] = { offset: u32(buf, o + 8), length: u32(buf, o + 12) };
  }
  const need = ['cmap', 'head', 'hhea', 'maxp', 'hmtx'];
  for (const t of need) if (!tables[t]) throw new Error('font table missing: ' + t);
  const unitsPerEm = u16(buf, tables.head.offset + 18);
  const numGlyphs = u16(buf, tables.maxp.offset + 4);
  const numHMetrics = u16(buf, tables.hhea.offset + 34);
  const hmtx = tables.hmtx.offset;
  const advance = (gid) => {
    const g = gid < numHMetrics ? gid : numHMetrics - 1;
    return u16(buf, hmtx + g * 4);
  };
  // cmap: prefer a format-4 subtable, else format-12.
  const cmapBase = tables.cmap.offset;
  const nSub = u16(buf, cmapBase + 2);
  let fmt4 = null, fmt12 = null;
  for (let i = 0; i < nSub; i++) {
    const o = cmapBase + 4 + i * 8;
    const sub = cmapBase + u32(buf, o + 4);
    const fmt = u16(buf, sub);
    if (fmt === 4 && !fmt4) fmt4 = sub;
    if (fmt === 12 && !fmt12) fmt12 = sub;
  }
  let gidFor;
  if (fmt4) {
    const segCount = u16(buf, fmt4 + 6) / 2;
    const endO = fmt4 + 14, startO = endO + segCount * 2 + 2, deltaO = startO + segCount * 2, rangeO = deltaO + segCount * 2;
    gidFor = (cp) => {
      for (let i = 0; i < segCount; i++) {
        const start = u16(buf, startO + i * 2), end = u16(buf, endO + i * 2);
        if (cp < start || cp > end) continue;
        const ro = u16(buf, rangeO + i * 2);
        if (ro === 0) return (cp + i16(buf, deltaO + i * 2)) & 0xffff;
        // Address = &idRangeOffset[i] + ro + 2*(cp-start), in bytes.
        const g = u16(buf, rangeO + i * 2 + ro + 2 * (cp - start));
        return g === 0 ? 0 : (g + i16(buf, deltaO + i * 2)) & 0xffff;
      }
      return 0;
    };
  } else if (fmt12) {
    const n = u32(buf, fmt12 + 12);
    const groups = [];
    for (let i = 0; i < n; i++) {
      const o = fmt12 + 16 + i * 12;
      groups.push([u32(buf, o), u32(buf, o + 4), u32(buf, o + 8)]);
    }
    gidFor = (cp) => {
      for (const [s, e, g] of groups) if (cp >= s && cp <= e) return g + (cp - s);
      return 0;
    };
  } else throw new Error('font cmap has no format 4 or 12 subtable');
  return { buf, unitsPerEm, numGlyphs, advance, gidFor };
}

// ---- Arabic reshaping ----
const DUAL = new Set([...'بتثجحخسشصضطظعغفقكلمنهيئ']);
const RIGHT_ONLY = new Set([...'اأإآدذرزوةؤىء']);
const FORMS = {
  0x0621: [0xfe80, 0xfe80, 0xfe80, 0xfe80], 0x0622: [0xfe81, 0xfe82, 0xfe81, 0xfe81],
  0x0623: [0xfe83, 0xfe84, 0xfe83, 0xfe83], 0x0624: [0xfe85, 0xfe86, 0xfe85, 0xfe85],
  0x0625: [0xfe87, 0xfe88, 0xfe87, 0xfe87], 0x0626: [0xfe89, 0xfe8a, 0xfe8b, 0xfe8c],
  0x0627: [0xfe8d, 0xfe8e, 0xfe8d, 0xfe8d], 0x0628: [0xfe8f, 0xfe90, 0xfe91, 0xfe92],
  0x0629: [0xfe93, 0xfe94, 0xfe93, 0xfe93], 0x062a: [0xfe95, 0xfe96, 0xfe97, 0xfe98],
  0x062b: [0xfe99, 0xfe9a, 0xfe9b, 0xfe9c], 0x062c: [0xfe9d, 0xfe9e, 0xfe9f, 0xfea0],
  0x062d: [0xfea1, 0xfea2, 0xfea3, 0xfea4], 0x062e: [0xfea5, 0xfea6, 0xfea7, 0xfea8],
  0x062f: [0xfea9, 0xfeaa, 0xfea9, 0xfea9], 0x0630: [0xfeab, 0xfeac, 0xfeab, 0xfeab],
  0x0631: [0xfead, 0xfeae, 0xfead, 0xfead], 0x0632: [0xfeaf, 0xfeb0, 0xfeaf, 0xfeaf],
  0x0633: [0xfeb1, 0xfeb2, 0xfeb3, 0xfeb4], 0x0634: [0xfeb5, 0xfeb6, 0xfeb7, 0xfeb8],
  0x0635: [0xfeb9, 0xfeba, 0xfebb, 0xfebc], 0x0636: [0xfebd, 0xfebe, 0xfebf, 0xfec0],
  0x0637: [0xfec1, 0xfec2, 0xfec3, 0xfec4], 0x0638: [0xfec5, 0xfec6, 0xfec7, 0xfec8],
  0x0639: [0xfec9, 0xfeca, 0xfecb, 0xfecc], 0x063a: [0xfecd, 0xfece, 0xfecf, 0xfed0],
  0x0641: [0xfed1, 0xfed2, 0xfed3, 0xfed4], 0x0642: [0xfed5, 0xfed6, 0xfed7, 0xfed8],
  0x0643: [0xfed9, 0xfeda, 0xfedb, 0xfedc], 0x0644: [0xfedd, 0xfede, 0xfedf, 0xfee0],
  0x0645: [0xfee1, 0xfee2, 0xfee3, 0xfee4], 0x0646: [0xfee5, 0xfee6, 0xfee7, 0xfee8],
  0x0647: [0xfee9, 0xfeea, 0xfeeb, 0xfeec], 0x0648: [0xfeed, 0xfeee, 0xfeed, 0xfeed],
  0x0649: [0xfeef, 0xfef0, 0xfeef, 0xfeef], 0x064a: [0xfef1, 0xfef2, 0xfef3, 0xfef4],
};
const LAM_ALEF = { 0x0627: [0xfefb, 0xfefc], 0x0623: [0xfef7, 0xfef8], 0x0625: [0xfef9, 0xfefa], 0x0622: [0xfef5, 0xfef6] };
function isArabicLetter(cp) { return (cp >= 0x0600 && cp <= 0x06ff) || (cp >= 0x0750 && cp <= 0x077f) || (cp >= 0xfb50 && cp <= 0xfdff) || (cp >= 0xfe70 && cp <= 0xfeff); }
function shapeRun(chars) {
  // chars: array of codepoints (Arabic run, no spaces). Returns shaped
  // codepoints in LOGICAL order; the caller reverses for visual order.
  const out = [];
  for (let i = 0; i < chars.length; i++) {
    const cp = chars[i];
    if (cp === 0x0644 && LAM_ALEF[chars[i + 1]]) {
      const prevDual = i > 0 && DUAL.has(String.fromCodePoint(chars[i - 1]));
      out.push(LAM_ALEF[chars[i + 1]][prevDual ? 1 : 0]);
      i++;
      continue;
    }
    const forms = FORMS[cp];
    if (!forms) { out.push(cp); continue; }
    const prev = chars[i - 1];
    const next = chars[i + 1];
    const connectsPrev = prev !== undefined && DUAL.has(String.fromCodePoint(prev));
    const connectsNext = DUAL.has(String.fromCodePoint(cp)) && next !== undefined && isArabicLetter(next);
    out.push(forms[connectsPrev && connectsNext ? 3 : connectsPrev ? 1 : connectsNext ? 2 : 0]);
  }
  return out;
}
// Convert a logical line to visual glyph codepoints (drawn LTR).
// Word-level bidi: split the line into words (spaces kept as tokens),
// reverse the WORD order, shape each Arabic word and reverse its letters.
// This preserves word spacing exactly — the earlier run-based version
// merged Arabic words ("رقم العقد" became "رقمالعقد") and misplaced
// colons. A word containing any Arabic letter is shaped as Arabic;
// purely Latin/digit words (codes, phones, amounts) stay LTR.
function visualCodepoints(line) {
  const clean = [...line].filter((ch) => {
    const cp = ch.codePointAt(0);
    return !(cp >= 0x064b && cp <= 0x0652) && cp !== 0x0670 && cp !== 0x0640;
  }).join('');
  const words = clean.split(/\s+/).filter(Boolean);
  // Group consecutive words by script: a Latin phrase ("Pilot System",
  // "100 SAR") keeps its internal LTR order as one unit; Arabic words
  // reverse individually. Then the UNITS reverse — never Latin words.
  const units = [];
  for (const w of words) {
    const kind = [...w].some((ch) => isArabicLetter(ch.codePointAt(0))) ? 'ar' : 'lat';
    const last = units[units.length - 1];
    if (last && last.kind === kind) last.words.push(w);
    else units.push({ kind, words: [w] });
  }
  const visual = [];
  units.reverse().forEach((unit, ui) => {
    if (ui > 0) visual.push(0x20);
    if (unit.kind === 'ar') {
      const ws = [...unit.words].reverse();
      ws.forEach((w, wi) => {
        if (wi > 0) visual.push(0x20);
        const shaped = shapeRun([...w].map((ch) => ch.codePointAt(0)));
        for (let i = shaped.length - 1; i >= 0; i--) visual.push(shaped[i]);
      });
    } else {
      const text = unit.words.join(' ');
      for (const ch of text) visual.push(ch.codePointAt(0));
    }
  });
  return visual;
}

// ---- PDF assembly ----
function buildPdf(lines) {
  // lines: [{ text, size, align: 'right'|'center'|'left' }]
  const font = loadFont();
  const PAGE_W = 595, PAGE_H = 842, MARGIN = 48;
  const maxWidth = PAGE_W - MARGIN * 2;
  const rendered = []; // { cps, size, align, width }
  const used = new Map(); // gid -> unicode
  for (const ln of lines) {
    const words = String(ln.text).split(/\s+/).filter(Boolean);
    let cur = [];
    const flush = () => {
      if (!cur.length) return;
      const text = cur.join(' ');
      const cps = visualCodepoints(text);
      const gids = cps.map((cp) => { const g = font.gidFor(cp) || font.gidFor(0x3f) || 0; if (!used.has(g)) used.set(g, cp); return g; });
      const width = gids.reduce((s, g) => s + font.advance(g), 0) / font.unitsPerEm * ln.size;
      rendered.push({ gids, size: ln.size, align: ln.align || 'right', width });
      cur = [];
    };
    for (const w of words) {
      cur.push(w);
      const trial = visualCodepoints(cur.join(' '));
      const w2 = trial.reduce((s, cp) => s + font.advance(font.gidFor(cp) || 0), 0) / font.unitsPerEm * ln.size;
      if (w2 > maxWidth && cur.length > 1) { cur.pop(); flush(); cur.push(w); }
    }
    flush();
    if (ln.blankAfter) rendered.push({ gids: [], size: ln.size, align: 'right', width: 0, blank: true });
  }
  // Paginate.
  const pages = [];
  let page = [];
  for (const ln of rendered) {
    const h = ln.size * 1.6;
    if (page.reduce((s, x) => s + x.size * 1.6, 0) + h > PAGE_H - MARGIN * 2 && page.length) { pages.push(page); page = []; }
    page.push(ln);
  }
  if (page.length) pages.push(page);
  if (!pages.length) pages.push([]);

  const objects = [];
  const add = (body) => { objects.push(body); return objects.length; };
  // Reserve ids: 1 catalog, 2 pages, then per-page page+content, then font objects.
  const pageIds = pages.map(() => ({ page: 0, content: 0 }));
  let nextId = 3;
  for (const p of pageIds) { p.page = nextId++; p.content = nextId++; }
  const fontId = nextId++, cidFontId = nextId++, descId = nextId++, fileId = nextId++, toUniId = nextId++;
  const kids = pageIds.map((p) => `${p.page} 0 R`).join(' ');
  objects[0] = `<< /Type /Catalog /Pages 2 0 R >>`;
  objects[1] = `<< /Type /Pages /Kids [${kids}] /Count ${pages.length} >>`;
  pages.forEach((plines, pi) => {
    const { page: pid, content: cid } = pageIds[pi];
    objects[pid - 1] = `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${PAGE_W} ${PAGE_H}] /Resources << /Font << /F1 ${fontId} 0 R >> >> /Contents ${cid} 0 R >>`;
    let y = PAGE_H - MARGIN;
    const ops = [];
    for (const ln of plines) {
      y -= ln.size * 1.6;
      if (!ln.gids.length) continue;
      const x = ln.align === 'center' ? (PAGE_W - ln.width) / 2 : ln.align === 'left' ? MARGIN : PAGE_W - MARGIN - ln.width;
      const hex = ln.gids.map((g) => g.toString(16).padStart(4, '0')).join('');
      ops.push(`BT /F1 ${ln.size} Tf 1 0 0 1 ${x.toFixed(2)} ${y.toFixed(2)} Tm <${hex}> Tj ET`);
    }
    const stream = Buffer.from(ops.join('\n'), 'ascii');
    objects[cid - 1] = Buffer.concat([Buffer.from(`<< /Length ${stream.length} >>\nstream\n`, 'ascii'), stream, Buffer.from('\nendstream', 'ascii')]);
  });
  objects[fontId - 1] = `<< /Type /Font /Subtype /Type0 /BaseFont /DejaVuSans /Encoding /Identity-H /DescendantFonts [${cidFontId} 0 R] /ToUnicode ${toUniId} 0 R >>`;
  // /W is essential: without it the viewer uses /DW for every glyph and
  // Arabic letters render far apart (disconnected) and lines overflow.
  const wEntries = [...used.keys()].sort((a, b) => a - b).map((g) => `${g} [${Math.round(font.advance(g) / font.unitsPerEm * 1000)}]`).join(' ');
  objects[cidFontId - 1] = `<< /Type /Font /Subtype /CIDFontType2 /BaseFont /DejaVuSans /CIDSystemInfo << /Registry (Adobe) /Ordering (Identity) /Supplement 0 >> /FontDescriptor ${descId} 0 R /DW 1000 /W [${wEntries}] >>`;
  objects[descId - 1] = `<< /Type /FontDescriptor /FontName /DejaVuSans /Flags 4 /FontBBox [-1000 -1000 3000 3000] /ItalicAngle 0 /Ascent 1000 /Descent -400 /CapHeight 700 /StemV 80 /FontFile2 ${fileId} 0 R >>`;
  objects[fileId - 1] = Buffer.concat([Buffer.from(`<< /Length ${font.buf.length} /Length1 ${font.buf.length} >>\nstream\n`, 'ascii'), font.buf, Buffer.from('\nendstream', 'ascii')]);
  let bf = '';
  const entries = [...used.entries()].sort((a, b) => a[0] - b[0]);
  for (let i = 0; i < entries.length; i += 100) {
    const chunk = entries.slice(i, i + 100);
    bf += `${chunk.length} beginbfchar\n` + chunk.map(([g, cp]) => `<${g.toString(16).padStart(4, '0')}> <${cp.toString(16).padStart(4, '0')}>`).join('\n') + '\nendbfchar\n';
  }
  const cmapStream = Buffer.from(`/CIDInit /ProcSet findresource begin\n12 dict begin\nbegincmap\n/CIDSystemInfo << /Registry (Adobe) /Ordering (UCS) /Supplement 0 >> def\n/CMapName /Adobe-Identity-UCS def\n/CMapType 2 def\n1 begincodespacerange\n<0000> <FFFF>\nendcodespacerange\n${bf}endcmap\nCMapName currentdict /CMap defineresource pop\nend\nend`, 'ascii');
  objects[toUniId - 1] = Buffer.concat([Buffer.from(`<< /Length ${cmapStream.length} >>\nstream\n`, 'ascii'), cmapStream, Buffer.from('\nendstream', 'ascii')]);

  const chunks = [Buffer.from('%PDF-1.4\n', 'ascii')];
  const offsets = [0];
  for (let i = 0; i < objects.length; i++) {
    offsets.push(Buffer.concat(chunks).length);
    chunks.push(Buffer.from(`${i + 1} 0 obj\n`, 'ascii'), Buffer.isBuffer(objects[i]) ? objects[i] : Buffer.from(objects[i], 'ascii'), Buffer.from('\nendobj\n', 'ascii'));
  }
  const xrefPos = Buffer.concat(chunks).length;
  let xref = `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  for (let i = 1; i <= objects.length; i++) xref += `${String(offsets[i]).padStart(10, '0')} 00000 n \n`;
  xref += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xrefPos}\n%%EOF`;
  chunks.push(Buffer.from(xref, 'ascii'));
  return Buffer.concat(chunks);
}

module.exports = { buildPdf, visualCodepoints };
