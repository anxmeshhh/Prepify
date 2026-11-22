/* Prepify: PDF export, built in the browser with jsPDF (nothing is uploaded).

   Every PDF Prepify makes (the full report, one source, the job description, the company brief) uses the same
   design, defined once here:
     * a cover: company, what the PDF is, when it was made, a row of key numbers and the contents;
     * each part on its own page, opened by the same section heading (accent bar, title, one-line summary);
     * one type scale, one colour palette and one spacing rhythm, used only through the helpers below;
     * a running header (company, current part) and footer (page x of y) on every page after the cover.
   The parts call the helpers (section, sub, label, para, list, checks, kv, qa, callout, rule, link) and never
   set fonts, colours or positions themselves. Uses helpers from search.js, jd.js and prep.js at call time. */

const JSPDF_URL = 'https://cdnjs.cloudflare.com/ajax/libs/jspdf/2.5.1/jspdf.umd.min.js';
function loadJsPdf() {
  if (window.jspdf) return Promise.resolve(window.jspdf.jsPDF);
  return new Promise((resolve, reject) => {
    const s = document.createElement('script');
    s.src = JSPDF_URL;
    s.onload = () => resolve(window.jspdf.jsPDF);
    s.onerror = () => reject(new Error('Could not load the PDF library (are you offline?)'));
    document.head.appendChild(s);
  });
}

// jsPDF's built-in fonts cover Latin-1 only: swap smart punctuation, drop the rest.
const pdfText = (t) => String(t ?? '')
  .replace(/[‘’]/g, "'").replace(/[“”]/g, '"').replace(/[–—]/g, '-')
  .replace(/…/g, '...').replace(/[•▪●]/g, '-').replace(/[→↗]/g, '->')
  .replace(/[^\x09\x0A\x0D\x20-\x7E\xA0-\xFF]/g, '');

// ---------- the design: palette, type scale, spacing ----------
const PDF_COLOR = {
  ink: [24, 24, 27],          // headings, questions
  body: [55, 55, 63],         // running text
  muted: [112, 112, 122],     // meta lines, labels of facts
  faint: [160, 160, 170],     // header, footer, "no answer"
  accent: [188, 92, 38],      // Prepify orange, darkened for paper
  tint: [252, 243, 236],      // callout background
  line: [226, 226, 232],      // rules, answer bars, box borders
  panel: [247, 247, 249],     // number boxes, code
  cover: [22, 22, 25],        // cover band
  coverText: [250, 250, 250],
  coverSub: [184, 184, 192],
};
const PDF_TYPE = {            // [size, style, colour]
  section: [19, 'bold', 'ink'],
  sub: [13, 'bold', 'ink'],
  item: [10.5, 'bold', 'ink'],
  label: [9.5, 'bold', 'accent'],
  body: [10, 'normal', 'body'],
  small: [9, 'normal', 'body'],
  meta: [8.5, 'normal', 'muted'],
  tiny: [8, 'normal', 'faint'],
};
const PDF_LEAD = 1.45;        // line height, as a multiple of the font size

function pdfBuilder(doc) {
  const W = doc.internal.pageSize.getWidth();
  const H = doc.internal.pageSize.getHeight();
  const M = 56;                 // side margins
  const TOP = 74;               // first line on a page (the running header sits above)
  const BOTTOM = 66;            // space kept for the footer
  const p = { doc, W, H, M, y: TOP, width: W - 2 * M, current: '', pageSection: {}, toc: [] };

  const font = (size, style, color) => {
    doc.setFont('helvetica', style || 'normal');
    doc.setFontSize(size);
    doc.setTextColor(...(PDF_COLOR[color] || color || PDF_COLOR.body));
  };
  const type = (name) => PDF_TYPE[name] || PDF_TYPE.body;

  p.newPage = () => {
    doc.addPage();
    p.y = TOP;
    p.pageSection[doc.getNumberOfPages()] = p.current;
  };
  p.ensure = (h) => { if (p.y + h > H - BOTTOM) p.newPage(); };
  p.space = (h) => { p.y += h; };

  // Wrapped text in one of the type styles. o: indent, after, color, style, size, bar (a thin line left of
  // every line: answers and quotes), mono (code, on a shaded panel).
  p.text = (str, o = {}) => {
    const [tSize, tStyle, tColor] = type(o.type);
    const size = o.size || tSize;
    const style = o.style || tStyle;
    const color = o.color || tColor;
    const indent = o.indent || 0;
    const lead = size * PDF_LEAD;
    const setFont = () => { font(size, style, color); if (o.mono) doc.setFont('courier', 'normal'); };
    setFont();
    const lines = doc.splitTextToSize(pdfText(str), p.width - indent - (o.mono ? 16 : 0));
    lines.forEach((line) => {
      p.ensure(lead);
      if (o.bar) { doc.setFillColor(...PDF_COLOR.line); doc.rect(M + (o.barAt ?? indent) - 10, p.y + 1, 2, lead, 'F'); }
      if (o.mono) { doc.setFillColor(...PDF_COLOR.panel); doc.rect(M + indent, p.y, p.width - indent, lead, 'F'); }
      setFont();
      doc.text(line, M + indent + (o.mono ? 8 : 0), p.y + size);
      p.y += lead;
    });
    p.y += o.after ?? 4;
    return lines.length;
  };

  // A part of the PDF: always starts a new page (or the cover, for a one-part PDF), listed in the contents.
  p.section = (title, summary, o = {}) => {
    p.current = title;
    if (o.onCover) p.y += 8;
    else p.newPage();
    p.toc.push({ title, summary, page: doc.getNumberOfPages(), y: p.y });
    doc.setFillColor(...PDF_COLOR.accent);
    doc.rect(M, p.y, 4, 24, 'F');
    const [size, style, color] = type('section');
    font(size, style, color);
    doc.text(pdfText(title), M + 14, p.y + 18);
    p.y += 34;
    if (summary) p.text(summary, { type: 'meta', after: 8 });
    p.rule(4);
  };

  // A heading inside a part; kept together with what follows it.
  p.sub = (title, o = {}) => {
    const before = o.before ?? 12;
    if (p.y + before + 100 > H - BOTTOM) p.newPage();
    else p.y += before;
    p.text(title, { type: 'sub', after: 8 });
  };

  // A small accent label over a block (How they applied, Tips, Answer).
  p.label = (t, o = {}) => {
    p.ensure(o.keep || 36);
    p.text(t, { type: 'label', indent: o.indent, color: o.color, after: 3 });
  };

  // A number in the accent colour, in the gutter at `indent`; returns where the text after it starts.
  const number = (n, indent, size) => {
    font(size, 'bold', 'accent');
    doc.text(`${n}.`, M + indent, p.y + size);
    return indent + (n >= 10 ? 20 : 16);
  };

  // A titled item (an experience, a round, a step, a skill): bold title, optional number and meta line.
  // Returns the indent its body should use, so details line up under the title.
  p.item = (title, meta, o = {}) => {
    const [size] = type(o.type || 'item');
    p.ensure(o.keep || 48);
    const indent = o.num ? number(o.num, o.indent || 0, o.size || size) : (o.indent || 0);
    p.text(title, { type: o.type || 'item', size: o.size, indent, after: meta ? 2 : 4 });
    if (meta) p.text(meta, { type: 'meta', indent, after: 6 });
    return indent;
  };

  p.para = (t, o = {}) => p.text(t, { after: 6, ...o });
  p.meta = (t, o = {}) => p.text(t, { type: 'meta', after: 4, ...o });

  // Bulleted or numbered list with hanging indents.
  p.list = (items, o = {}) => {
    const indent = o.indent || 0;
    const [size] = type(o.type || 'body');
    items.filter(Boolean).forEach((item, i) => {
      p.ensure(size * PDF_LEAD);
      let at = indent + 16;
      if (o.numbered) at = number(i + 1, indent, size);
      else {
        doc.setFillColor(...PDF_COLOR.accent);
        doc.circle(M + indent + 3, p.y + size * 0.62, 1.6, 'F');
      }
      p.text(item, { type: o.type, color: o.color, indent: at, after: o.gap ?? 3, bar: o.bar, barAt: o.barAt });
    });
    p.y += 3;
  };

  // A checklist: [{ text, done }]
  p.checks = (items, o = {}) => {
    const indent = o.indent || 0;
    const [size] = type('small');
    items.forEach((it) => {
      p.ensure(size * PDF_LEAD);
      doc.setDrawColor(...(it.done ? PDF_COLOR.accent : PDF_COLOR.faint));
      doc.setLineWidth(0.8);
      doc.rect(M + indent, p.y + 2.5, 7.5, 7.5, 'S');
      if (it.done) {
        doc.line(M + indent + 1.6, p.y + 6.6, M + indent + 3.3, p.y + 8.4);
        doc.line(M + indent + 3.3, p.y + 8.4, M + indent + 6.2, p.y + 4);
      }
      p.text(it.text, { type: 'small', indent: indent + 16, color: it.done ? 'muted' : 'body', after: 2 });
    });
    p.y += 3;
  };

  // Key and value rows (job facts, resume match).
  p.kv = (rows, o = {}) => {
    const keyW = o.keyWidth || 120;
    rows.filter(([, v]) => v !== undefined && v !== null && v !== '').forEach(([k, v]) => {
      font(...type('small'));
      const lines = doc.splitTextToSize(pdfText(v), p.width - keyW);
      const lead = 9 * PDF_LEAD;
      p.ensure(lines.length * lead + 4);
      font(...type('meta'));
      doc.text(pdfText(k), M, p.y + 9);
      font(...type('small'));
      lines.forEach((line, i) => doc.text(line, M + keyW, p.y + 9 + i * lead));
      p.y += lines.length * lead + 4;
      doc.setDrawColor(...PDF_COLOR.line);
      doc.setLineWidth(0.5);
      doc.line(M, p.y - 2, W - M, p.y - 2);
      p.y += 3;
    });
    p.y += 6;
  };

  // Text in a tinted box (the brief's overview, caveats).
  p.callout = (t, o = {}) => {
    const size = o.size || 10;
    font(size, o.style || 'normal', o.color || 'body');
    const lines = doc.splitTextToSize(pdfText(t), p.width - 28);
    const lead = size * PDF_LEAD;
    const h = lines.length * lead + 20;
    p.ensure(Math.min(h, 200));
    doc.setFillColor(...PDF_COLOR.tint);
    doc.rect(M, p.y, p.width, Math.min(h, H - BOTTOM - p.y), 'F');
    doc.setFillColor(...PDF_COLOR.accent);
    doc.rect(M, p.y, 3, Math.min(h, H - BOTTOM - p.y), 'F');
    p.y += 10;
    lines.forEach((line) => {
      if (p.y + lead > H - BOTTOM) p.newPage();
      font(size, o.style || 'normal', o.color || 'body');
      doc.text(line, M + 16, p.y + size);
      p.y += lead;
    });
    p.y += 18;
  };

  // A question and its answers: the number in the margin, answers indented behind a thin bar.
  p.qa = (num, question, answers, o = {}) => {
    p.ensure(52);
    font(10, 'bold', 'accent');
    doc.text(`Q${num}`, M, p.y + 10);
    p.text(question, { type: 'item', size: 10, indent: 34, after: 4 });
    if (!answers.length) p.text(o.none || 'No answer shown.', { type: 'tiny', style: 'italic', indent: 34, after: 4 });
    answers.forEach((a) => {
      p.text(a.label, { type: 'label', size: 8.5, color: a.ai ? 'muted' : 'accent', indent: 44, after: 2 });
      p.rich(null, a.text, { indent: 44, type: 'small', bar: true });
      if (a.code) p.text(a.code, { type: 'small', size: 8, mono: true, indent: 44, after: 6 });
    });
    p.y += 8;
  };

  // Cleaned text (paragraphs and lists, from textBlocks in search.js) under an optional label.
  p.rich = (label, raw, o = {}) => {
    const blocks = textBlocks(raw);
    if (!blocks.length) return;
    const indent = o.indent || 0;
    if (label) p.label(label, { indent });
    const bar = o.bar ? { bar: true, barAt: indent } : {};
    blocks.forEach((b) => {
      if (b.type === 'p') p.text(b.text, { type: o.type, color: o.color, indent, after: 4, ...bar });
      else p.list(b.items, { numbered: b.type === 'ol', type: o.type, color: o.color, indent, ...bar });
    });
    p.y += 3;
  };

  p.rule = (before = 6) => {
    p.ensure(14);
    p.y += before;
    doc.setDrawColor(...PDF_COLOR.line);
    doc.setLineWidth(0.6);
    doc.line(M, p.y, W - M, p.y);
    p.y += 12;
  };

  // A web address, clickable, on one line.
  p.link = (url, o = {}) => {
    const [size] = type('meta');
    p.ensure(size * PDF_LEAD);
    font(size, 'normal', 'accent');
    let shown = pdfText(url);
    while (doc.getTextWidth(shown) > p.width - (o.indent || 0) && shown.length > 20) shown = shown.slice(0, -4) + '...';
    doc.textWithLink(shown, M + (o.indent || 0), p.y + size, { url });
    p.y += size * PDF_LEAD + (o.after ?? 2);
  };

  // ---------- the cover ----------
  p.cover = ({ title, kind, line, stats }) => {
    doc.setFillColor(...PDF_COLOR.cover);
    doc.rect(0, 0, W, 196, 'F');
    doc.setFillColor(...PDF_COLOR.accent);
    doc.rect(0, 196, W, 4, 'F');
    font(9, 'bold', 'accent');
    doc.text('Prepify', M, 58);
    font(9, 'normal', 'coverSub');
    doc.text(pdfText('·  interview preparation'), M + doc.getTextWidth('Prepify ') + 2, 58);
    font(26, 'bold', 'coverText');
    const titleLines = doc.splitTextToSize(pdfText(title), p.width).slice(0, 2);
    titleLines.forEach((l, i) => doc.text(l, M, 98 + i * 32));
    let y = 98 + (titleLines.length - 1) * 32 + 28;
    font(13, 'normal', 'coverSub');
    doc.text(pdfText(kind), M, y);
    y += 22;
    font(9, 'normal', 'coverSub');
    doc.splitTextToSize(pdfText(line), p.width).slice(0, 2).forEach((l, i) => doc.text(l, M, y + i * 13));
    p.y = 228;

    const shown = (stats || []).filter(([, n]) => n !== undefined && n !== null);
    if (shown.length) {
      const gap = 12;
      const bw = (p.width - gap * (shown.length - 1)) / shown.length;
      shown.forEach(([label, n], i) => {
        const x = M + i * (bw + gap);
        doc.setFillColor(...PDF_COLOR.panel);
        doc.setDrawColor(...PDF_COLOR.line);
        doc.setLineWidth(0.6);
        doc.roundedRect(x, p.y, bw, 60, 4, 4, 'FD');
        font(20, 'bold', 'ink');
        doc.text(pdfText(n), x + 14, p.y + 30);
        font(8.5, 'normal', 'muted');
        doc.text(pdfText(label), x + 14, p.y + 47);
      });
      p.y += 60 + 28;
    }
  };

  // The contents on the cover, filled in once every part knows its page. Each entry links to its page.
  p.contents = (y) => {
    if (p.toc.length < 2) return;
    doc.setPage(1);
    let cy = y;
    font(...type('sub'));
    doc.text('Contents', M, cy + 13);
    cy += 28;
    p.toc.forEach((t, i) => {
      font(10, 'bold', 'accent');
      doc.text(String(i + 1).padStart(2, '0'), M, cy + 11);
      font(11, 'bold', 'ink');
      doc.text(pdfText(t.title), M + 28, cy + 11);
      font(10, 'normal', 'muted');
      doc.text(`Page ${t.page}`, W - M, cy + 11, { align: 'right' });
      if (t.summary) {
        font(8.5, 'normal', 'muted');
        doc.text(doc.splitTextToSize(pdfText(t.summary), p.width - 100)[0], M + 28, cy + 25);
      }
      doc.link(M, cy, p.width, 32, { pageNumber: t.page });
      doc.setDrawColor(...PDF_COLOR.line);
      doc.setLineWidth(0.5);
      doc.line(M, cy + 34, W - M, cy + 34);
      cy += 42;
    });
  };

  // Running header and footer on every page.
  p.finish = (name, kind) => {
    const pages = doc.getNumberOfPages();
    for (let i = 1; i <= pages; i++) {
      doc.setPage(i);
      if (i > 1) {
        font(8, 'bold', 'accent');
        doc.text('Prepify', M, 38);
        font(8, 'normal', 'faint');
        doc.text(pdfText(`·  ${name}  ·  ${kind}`), M + doc.getTextWidth('Prepify') + 6, 38);
        if (p.pageSection[i]) doc.text(pdfText(p.pageSection[i]), W - M, 38, { align: 'right' });
        doc.setDrawColor(...PDF_COLOR.line);
        doc.setLineWidth(0.5);
        doc.line(M, 48, W - M, 48);
      }
      doc.setDrawColor(...PDF_COLOR.line);
      doc.line(M, H - 44, W - M, H - 44);
      font(8, 'normal', 'faint');
      doc.text('Made with Prepify. Everything here was pulled into your own browser; check important details at the source.', M, H - 30);
      doc.text(`Page ${i} of ${pages}`, W - M, H - 30, { align: 'right' });
    }
  };
  return p;
}

// ---------- the parts ----------
function pdfSourceSummary(g) {
  if (g.name === 'Official') return `${plural(g.official.length, 'official page')}, read from the company's own site`;
  return [plural(g.experiences.length, 'experience'), plural(g.questions.length, 'question'), plural(g.answers || 0, 'answer'),
          g.reviews.length ? plural(g.reviews.length, 'review') : '', g.newest ? 'pulled ' + fmtDate(g.newest) : '']
    .filter(Boolean).join(' · ');
}

function pdfSource(p, g, o = {}) {
  p.section(g.name === 'Official' ? 'Official information' : g.name, pdfSourceSummary(g), o);

  g.official.forEach((pg, i) => {
    p.sub(pg.title, { before: i ? 16 : 4 });
    p.link(pg.url, { after: 8 });
    (pg.sections || []).forEach(sec => p.rich(sec.heading, sec.text));
  });

  if (g.experiences.length) {
    p.sub(`Interview experiences (${g.experiences.length})`, { before: 4 });
    [...g.experiences].sort(byDateDesc).forEach((x, i) => {
      if (i) p.rule(2);
      const facts = [x.date, x.location, x.outcome, x.experience, x.difficulty].filter(Boolean).map(sentence).join('  ·  ');
      p.item(cleanRole(x.role) || 'Interview experience', facts, { num: i + 1, size: 11.5 });
      if (x.application) p.rich('How they applied', x.application);
      if (x.process) p.rich('Interview process', x.process);
      if ((x.rounds || []).length) {
        p.label('Rounds');
        x.rounds.forEach((r, ri) => {
          const at = p.item(r.name, '', { num: ri + 1, size: 10, keep: 30 });
          if (r.detail) p.rich(null, r.detail, { indent: at });
        });
      }
      if ((x.questions || []).length) {
        p.label('Questions asked');
        x.questions.forEach((q, qi) => {
          const at = p.item(q.text, '', { num: qi + 1, type: 'body', keep: 30 });
          (q.answers || []).forEach(a => p.rich(null, a, { indent: at + 10, type: 'small', bar: true }));
        });
        p.space(2);
      }
      if (x.tips) p.rich('Tips', x.tips);
      if ((x.discussion || []).length) {
        p.label('Discussion (top comments)');
        x.discussion.slice(0, 3).forEach(c => p.text(tidyText(c.text).slice(0, 600).replace(/\n/g, ' '),
          { type: 'small', color: 'muted', indent: 8, bar: true, after: 5 }));
      }
    });
  }

  if (g.questions.length) {
    p.sub(`Interview questions and answers (${g.questions.length})`, { before: g.experiences.length ? 22 : 4 });
    const bySubject = {};
    g.questions.forEach(q => { const s = subjectOf(q); (bySubject[s] = bySubject[s] || []).push(q); });
    let num = 0;
    Object.entries(bySubject).sort((a, b) => b[1].length - a[1].length).forEach(([subject, list], si) => {
      p.ensure(70);
      if (si) p.space(6);
      p.text(`${subject}  ·  ${list.length}`, { type: 'label', size: 10.5, after: 8 });
      list.forEach(q => {
        num += 1;
        const own = (q.answers || []).map((a, ai, all) => ({ label: all.length > 1 ? `Answer ${ai + 1}` : 'Answer', text: a }));
        const aiA = !own.length && aiAnswerFor(q);
        const answers = own.length ? own
          : aiA ? [{ label: `AI-written model answer, not from ${g.name}`, text: aiA.answer, code: aiA.code, ai: true }] : [];
        p.qa(num, q.text, answers, { none: `No answer shown on ${g.name}.` });
      });
    });
  }

  if (g.reviews.length) {
    p.sub(`Reviews (${g.reviews.length})`, { before: 22 });
    g.reviews.forEach((r, i) => {
      if (i) p.rule(0);
      p.item(r.title || r.job_title || 'Review', r.rating ? `Rated ${r.rating} out of 5` : '');
      if (r.pros) p.rich('Pros', r.pros);
      if (r.cons) p.rich('Cons', r.cons);
    });
  }

  const pages = [...g.pages.keys()].filter(u => /^https?:/.test(u));
  if (pages.length && g.name !== 'Official') {
    p.sub('Pulled from', { before: 22 });
    pages.slice(0, 25).forEach(u => p.link(u));
    if (pages.length > 25) p.meta(`and ${pages.length - 25} more pages`);
  }
}

function pdfBrief(p, b, o = {}) {
  const a = b.data;
  const used = new Set((JSON.stringify(a).match(/"[XQ]\d+"/g) || []).map(s => s.slice(1, -1)));
  const srcs = (ids) => (ids || []).length ? 'Sources: ' + ids.join(', ') : '';
  p.section('Company brief', `Written by ${a.model_name || 'AI'} on ${fmtDate(b.at)} from ${plural(a.based_on.experiences, 'experience')} and ` +
            `${plural(a.based_on.questions, 'question')}`, o);
  if (a.overview) p.callout(a.overview, { size: 10.5 });

  if (a.process.length) {
    p.sub('How the process usually goes', { before: 6 });
    a.process.forEach((s, i) => {
      const at = p.item(s.step, '', { num: i + 1 });
      p.para(s.detail, { indent: at, after: 2 });
      if ((s.sources || []).length) p.meta(srcs(s.sources), { indent: at, after: 8 });
    });
  }
  if (a.focus.length) {
    p.sub('What they ask most');
    a.focus.forEach(f => {
      p.item(f.topic, '');
      p.para(f.detail, { indent: 16, after: 2 });
      if ((f.sources || []).length) p.meta(srcs(f.sources), { indent: 16, after: 8 });
    });
  }
  if (a.tips.length) {
    p.sub('Tips from candidates');
    p.list(a.tips.map(t => t.tip + ((t.sources || []).length ? `  (${t.sources.join(', ')})` : '')), { gap: 5 });
  }
  if (a.caveat) { p.space(6); p.callout(a.caveat, { size: 9, color: 'muted', style: 'italic' }); }

  const refs = Object.entries(b.refs).filter(([id]) => used.has(id));
  if (refs.length) {
    p.sub('Sources', { before: 16 });
    p.meta('The codes after each point (X for an experience, Q for a question) refer to these.', { after: 8 });
    refs.forEach(([id, r]) => {
      p.ensure(14);
      p.doc.setFont('helvetica', 'bold');
      p.doc.setFontSize(8.5);
      p.doc.setTextColor(...PDF_COLOR.accent);
      p.doc.text(id, p.M, p.y + 8.5);
      p.text(r.label, { type: 'meta', indent: 32, after: 3 });
    });
  }
}

function pdfSchedule(p, d) {
  const sch = buildSchedule(d);
  if (!sch || !sch.days.length) return;
  const jd = jdNow();
  p.sub('Schedule up to the interview');
  p.meta(`Interview on ${jd.schedule.date}, ${sch.hours} hours a day. Ticked items are ones you marked done in Prepify.`, { after: 8 });
  sch.days.forEach(day => {
    p.ensure(40);
    p.text(day.date.toLocaleDateString(undefined, { weekday: 'long', day: 'numeric', month: 'long' }), { type: 'label', after: 4 });
    if (!day.tasks.length) p.meta('Rest or revise', { indent: 16, after: 6 });
    else p.checks(day.tasks.map(t => ({ text: t.text, done: !!jd.done[t.key] })), { indent: 4 });
  });
}

function pdfJd(p, d, o = {}) {
  const jd = jdNow();
  if (!jd) return;
  const a = jd.analysis;
  const f = a.facts || {};
  p.section('Job description analysis', `${jd.role || a.title || 'Role'}${jd.company ? ' at ' + jd.company : ''}`, o);
  p.kv([['Seniority', a.seniority], ['Experience', a.experience && a.experience.label], ['Work mode', f.work_mode],
    ['Employment', f.employment], ['Location', (f.locations || []).join(', ')], ['Salary in the JD', f.salary],
    ['Education', (f.education || []).join(' ')], ['Academic cut-off', f.academic_cutoff], ['Bond', f.bond], ['Shifts', f.shifts]]);

  if ((a.watch_outs || []).length) {
    p.sub('Worth checking', { before: 4 });
    p.list(a.watch_outs);
  }

  p.sub('Skills');
  ['required', 'expected', 'preferred'].forEach(l => {
    const names = a.skills.filter(s => s.level === l).map(s => s.name);
    if (names.length) { p.label(JD_LEVEL[l]); p.para(names.join(', ')); }
  });

  if (a.rounds.length) {
    p.sub('Likely interview rounds');
    p.meta('Predicted from the job description.', { after: 8 });
    a.rounds.forEach((r, i) => {
      const at = p.item(r.name, r.why, { num: i + 1 });
      p.list(r.focus, { indent: at, type: 'small' });
    });
  }

  pdfSchedule(p, d);

  const { tiers } = jdPlan(d);
  if (tiers.length) {
    p.sub('Prep plan');
    tiers.forEach(([tier, items]) => {
      p.ensure(60);
      p.text(tier, { type: 'label', size: 10.5, after: 8 });
      items.forEach(s => {
        p.item(s.name, `${JD_LEVEL[s.level]}${s.reported.length ? ` · asked in ${plural(s.reported.length, 'pulled question')}` : ''}`, { indent: 8 });
        p.checks(s.topics.map(t => ({ text: t, done: !!jd.done[`${s.name}|${t}`] })), { indent: 16 });
        if (s.reported.length) { p.label('Asked in pulled questions', { indent: 16 }); p.list(s.reported.slice(0, 3).map(q => q.text), { indent: 16, type: 'small' }); }
        if (s.questions.length) { p.label('Practise', { indent: 16 }); p.list(s.questions, { indent: 16, type: 'small', color: 'muted' }); }
        p.space(4);
      });
    });
  }

  if (a.resume) {
    p.sub('Resume match');
    p.kv([['Required skills on it', `${a.resume.score ?? 0}%`], ['On your resume', a.resume.matched.join(', ')],
      ['Required but missing', a.resume.missing_required.join(', ')], ['Nice to have, missing', a.resume.missing_preferred.join(', ')]]);
  }

  if ((a.ask || []).length) {
    p.sub('Questions to ask the interviewer');
    p.list(a.ask, { numbered: true, gap: 5 });
  }
}

// ---------- making a PDF ----------
// only: null (everything), a source name, 'JD' (the job description) or 'BRIEF' (the company brief)
async function downloadPdf(d, only = null) {
  const JsPDF = await loadJsPdf();
  const c = aiEntry();
  const brief = c && c.ai && c.ai.brief;
  if (only === 'BRIEF' && !brief) throw new Error('Write the company brief first.');
  const jd = jdNow();
  const name = (d && d.parsed && companyName(d)) || (jd && jd.company) || 'Interview';

  const withJd = !!jd && (!only || only === 'JD');
  const withBrief = !!brief && (!only || only === 'BRIEF');
  const groups = (only === 'JD' || only === 'BRIEF' || !d) ? []
    : groupBySource(d).filter(hasData).filter(g => !only || g.name === only)
      .sort((a, b) => (b.name === 'Official') - (a.name === 'Official'));
  const parts = (withJd ? 1 : 0) + (withBrief ? 1 : 0) + groups.length;
  if (!parts) throw new Error('There is nothing to put in the PDF yet.');

  const kind = only === 'BRIEF' ? 'Company brief' : only === 'JD' ? 'Job description analysis'
    : only ? `${only === 'Official' ? 'Official information' : only}` : 'Interview preparation report';
  const sum = (k) => groups.reduce((n, g) => n + (k === 'answers' ? (g.answers || 0) : g[k].length), 0);
  const stats = only === 'BRIEF' ? [['Experiences read', brief.data.based_on.experiences], ['Questions read', brief.data.based_on.questions],
                                   ['Process steps', brief.data.process.length], ['Tips', brief.data.tips.length]]
    : only === 'JD' ? [['Skills', jd.analysis.skills.length], ['Likely rounds', jd.analysis.rounds.length],
                       ['Questions to ask', (jd.analysis.ask || []).length]]
    : [['Experiences', sum('experiences')], ['Questions', sum('questions')], ['Answers', sum('answers')],
       ['Sources', groups.length]].filter(([, n], i) => n || i === 1);

  const doc = new JsPDF({ unit: 'pt', format: 'a4' });
  doc.setProperties({ title: `${name}: ${kind}`, subject: 'Interview preparation', creator: 'Prepify' });
  const p = pdfBuilder(doc);
  const made = new Date().toLocaleDateString(undefined, { day: 'numeric', month: 'long', year: 'numeric' });
  p.cover({ title: name, kind, line: `Prepared on ${made}${d && d.query ? ` for "${d.query}"` : ''}`, stats });
  const contentsY = p.y;
  const onCover = parts === 1;                  // a one-part PDF starts right under the cover

  if (withJd) pdfJd(p, d, { onCover });
  if (withBrief) pdfBrief(p, brief, { onCover });
  groups.forEach(g => pdfSource(p, g, { onCover }));

  p.contents(contentsY);
  p.finish(name, kind);
  const slug = (s) => String(s).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
  const suffix = only === 'BRIEF' ? 'company-brief' : only === 'JD' ? 'job-description'
    : only ? `${slug(only)}-interview-preparation` : 'interview-preparation';
  doc.save(`${slug(name) || 'company'}-${suffix}.pdf`);
}

function wirePdf() {
  $$('[data-pdf]').forEach(b => b.onclick = async () => {
    const label = b.innerHTML;
    b.disabled = true;
    b.textContent = 'Preparing PDF…';
    try { await downloadPdf(lastData, b.dataset.pdf || null); }
    catch (e) { pdfError(e.message); }
    finally { b.disabled = false; b.innerHTML = label; }
  });
}

function pdfError(msg) {
  const old = $('#pdf-error');
  if (old) old.remove();
  const host = $('#report') || document.body;
  host.insertAdjacentHTML('afterbegin', `<div class="notice" id="pdf-error"><b>PDF not created.</b> ${esc(msg)}</div>`);
}
