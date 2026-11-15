/*
 * SeatStory — wedding seating chart.
 *
 * One classic script (no modules, no build step) so the app also works when
 * index.html is opened straight from disk. Nothing is fetched after load and
 * nothing is sent anywhere: guests, tables and settings live in localStorage
 * under the key "seatstory_v1", purchase entitlement included.
 */
(function () {
  'use strict';

  /* ------------------------------------------------------------- settings */

  var CFG = window.SEATSTORY_CONFIG || {};
  var PAYMENT_URL = String(CFG.PAYMENT_URL || '').trim();
  var PRICE_LABEL = String(CFG.PRICE_LABEL || '$29 one-time').trim();
  var UNLOCK_CODE = String(CFG.UNLOCK_CODE || '').trim();
  var STORAGE_KEY = 'seatstory_v1';
  var STYLE_IDS = ['minimal', 'botanical', 'midnight'];

  /* -------------------------------------------------------------- helpers */

  function byId(id) { return document.getElementById(id); }

  function el(tag, cls, txt) {
    var node = document.createElement(tag);
    if (cls) { node.className = cls; }
    if (txt != null) { node.textContent = String(txt); }
    return node;
  }

  function clear(node) {
    while (node && node.firstChild) { node.removeChild(node.firstChild); }
  }

  function txt(value, max) {
    return String(value == null ? '' : value).slice(0, max || 240);
  }

  function uid(prefix) {
    return prefix + '-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 9);
  }

  function debounce(fn, wait) {
    var timer = null;
    return function () {
      var args = arguments, self = this;
      clearTimeout(timer);
      timer = setTimeout(function () { fn.apply(self, args); }, wait);
    };
  }

  function positiveInt(value, fallback) {
    var n = parseInt(value, 10);
    if (!isFinite(n) || n < 1) { return fallback; }
    return Math.min(n, 999);
  }

  var toastTimer = null;
  function toast(message, isError) {
    var node = byId('toast');
    if (!node) { return; }
    node.textContent = message;
    node.classList.toggle('toast--error', !!isError);
    node.hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { node.hidden = true; }, isError ? 6500 : 3200);
  }

  function confirmDialog(opts) {
    var modal = byId('modal');
    if (!modal) { return Promise.resolve(window.confirm(opts.text || opts.title)); }
    byId('modal-title').textContent = opts.title || 'Confirm';
    byId('modal-text').textContent = opts.text || '';
    var actions = byId('modal-actions');
    clear(actions);

    return new Promise(function (resolve) {
      function close(result) {
        modal.hidden = true;
        document.removeEventListener('keydown', onKey);
        resolve(result);
      }
      function onKey(event) {
        if (event.key === 'Escape') { event.preventDefault(); close(false); }
      }
      var cancel = el('button', 'btn', opts.cancel || 'Cancel');
      cancel.type = 'button';
      cancel.addEventListener('click', function () { close(false); });

      var ok = el('button', 'btn ' + (opts.danger ? 'btn--danger' : 'btn--primary'), opts.confirm || 'Confirm');
      ok.type = 'button';
      ok.addEventListener('click', function () { close(true); });

      actions.appendChild(cancel);
      actions.appendChild(ok);

      var backdrop = modal.querySelector('[data-close]');
      backdrop.onclick = function () { close(false); };

      modal.hidden = false;
      document.addEventListener('keydown', onKey);
      ok.focus();
    });
  }

  function downloadBlob(blob, filename) {
    var url = URL.createObjectURL(blob);
    var a = document.createElement('a');
    a.href = url;
    a.download = filename;
    a.rel = 'noopener';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    setTimeout(function () { URL.revokeObjectURL(url); }, 4000);
  }

  /* ---------------------------------------------------------------- store */

  var DEFAULT_SETTINGS = {
    style: 'minimal',
    title: 'Our Wedding',
    names: '',
    date: '',
    venue: '',
    shareBase: ''
  };

  var state = null;
  var storageBroken = false;

  function defaultState() {
    return {
      version: 1,
      guests: [],
      tables: [],
      settings: Object.assign({}, DEFAULT_SETTINGS),
      license: { unlocked: false }
    };
  }

  function normalizeState(raw) {
    var out = defaultState();
    if (!raw || typeof raw !== 'object') { return out; }

    var settings = raw.settings && typeof raw.settings === 'object' ? raw.settings : {};
    out.settings = {
      style: STYLE_IDS.indexOf(settings.style) >= 0 ? settings.style : DEFAULT_SETTINGS.style,
      title: settings.title === undefined ? DEFAULT_SETTINGS.title : txt(settings.title, 80),
      names: txt(settings.names, 80),
      date: txt(settings.date, 80),
      venue: txt(settings.venue, 80),
      shareBase: txt(settings.shareBase, 500)
    };

    if (raw.license && raw.license.unlocked === true) { out.license.unlocked = true; }

    if (Array.isArray(raw.tables)) {
      raw.tables.forEach(function (t) {
        if (!t || typeof t !== 'object') { return; }
        out.tables.push({
          id: txt(t.id, 60) || uid('t'),
          label: txt(t.label, 60) || ('Table ' + (out.tables.length + 1)),
          capacity: positiveInt(t.capacity, 8),
          shape: t.shape === 'long' ? 'long' : 'round'
        });
      });
    }

    var known = {};
    out.tables.forEach(function (t) { known[t.id] = true; });

    if (Array.isArray(raw.guests)) {
      raw.guests.forEach(function (g) {
        if (!g || typeof g !== 'object') { return; }
        var name = txt(g.name, 120).trim();
        if (!name) { return; }
        out.guests.push({
          id: txt(g.id, 60) || uid('g'),
          name: name,
          tableId: known[g.tableId] ? String(g.tableId) : null,
          tags: Array.isArray(g.tags) ? g.tags.map(function (t) { return txt(t, 60).trim(); }).filter(Boolean).slice(0, 12) : [],
          note: txt(g.note, 200)
        });
      });
    }

    return out;
  }

  function loadState() {
    var raw = null;
    try {
      raw = window.localStorage.getItem(STORAGE_KEY);
    } catch (err) {
      storageBroken = true;
      return defaultState();
    }
    if (!raw) { return defaultState(); }
    try {
      return normalizeState(JSON.parse(raw));
    } catch (err) {
      return defaultState();
    }
  }

  function save() {
    if (storageBroken) { return false; }
    try {
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
      return true;
    } catch (err) {
      storageBroken = true;
      toast('This browser blocked local storage, so changes are not being saved.', true);
      return false;
    }
  }

  /*
   * Purchase entitlement.
   *
   * Be clear about what this is: a courtesy lock, not fraud protection. The
   * flag lives in this browser's localStorage and the unlock code sits in
   * assets/config.js, so anyone who opens the page source can turn it off.
   * There is deliberately no server, no account and no receipt check — the
   * point is that the preview is honest before payment and that a buyer can
   * restore their purchase on another device. Do not rely on it to protect
   * anything that actually matters.
   */
  function isUnlocked() { return !!(state && state.license && state.license.unlocked); }

  function setUnlocked(flag) {
    state.license.unlocked = !!flag;
    save();
  }

  /* Two tables with the same name make the CSV round-trip and the share
     fragment ambiguous, so a rename gets a suffix instead of a duplicate. */
  function uniqueLabel(label, excludeId) {
    var base = String(label || '').trim();
    if (!base) { return ''; }
    /* Leave room for a " (2)" suffix: the result is capped at 60 chars later,
       and a 60-char base would otherwise lose the suffix and collide again. */
    var MAX = 60;
    if (base.length > MAX - 4) { base = base.slice(0, MAX - 4).trim(); }
    var taken = {};
    state.tables.forEach(function (t) {
      if (t.id !== excludeId) { taken[String(t.label || '').trim().toLowerCase()] = true; }
    });
    if (!taken[base.toLowerCase()]) { return base; }
    for (var n = 2; n < 999; n++) {
      var suffix = ' (' + n + ')';
      var head = base.length + suffix.length > MAX ? base.slice(0, MAX - suffix.length).trim() : base;
      var cand = head + suffix;
      if (!taken[cand.toLowerCase()]) { return cand; }
    }
    return base;
  }

  function tableById(id) {
    if (!id || !state) { return null; }
    for (var i = 0; i < state.tables.length; i++) {
      if (state.tables[i].id === id) { return state.tables[i]; }
    }
    return null;
  }

  function guestById(id) {
    if (!id || !state) { return null; }
    for (var i = 0; i < state.guests.length; i++) {
      if (state.guests[i].id === id) { return state.guests[i]; }
    }
    return null;
  }

  function tableLabel(id) {
    var t = tableById(id);
    return t ? t.label : '';
  }

  function guestsAt(tableId) {
    return state.guests.filter(function (g) { return g.tableId === tableId; });
  }

  function findTableByLabel(label) {
    var needle = String(label || '').trim().toLowerCase();
    if (!needle) { return null; }
    for (var i = 0; i < state.tables.length; i++) {
      var t = state.tables[i];
      if (t.label.trim().toLowerCase() === needle) { return t.id; }
    }
    return null;
  }

  function stats() {
    var capacity = 0, seated = 0;
    state.tables.forEach(function (t) { capacity += t.capacity; });
    state.guests.forEach(function (g) {
      if (g.tableId && tableById(g.tableId)) { seated++; }
    });
    return {
      guests: state.guests.length,
      tables: state.tables.length,
      capacity: capacity,
      seated: seated,
      unseated: state.guests.length - seated,
      free: capacity - seated
    };
  }

  function splitTags(value) {
    return String(value || '')
      .split(/[;,]/)
      .map(function (t) { return t.trim(); })
      .filter(Boolean)
      .slice(0, 12);
  }

  /* ------------------------------------------------------------------ CSV */

  function parseCsv(raw) {
    var src = String(raw || '').replace(/^\uFEFF/, '');
    var rows = [];
    var errors = [];
    var row = [];
    var field = '';
    var state = 'start';        /* start | plain | quoted | afterquote */
    var line = 1;
    var rowLine = 1;
    var i = 0;
    var rowBad = false;
    var quoteBreak = -1;        /* index just after the first line break inside an open quote */
    var quoteBreakLine = 0;

    function endField() {
      row.push(field);
      field = '';
      state = 'start';
    }

    function endRow() {
      endField();
      if (rowBad) {
        errors.push({ line: rowLine, message: 'Malformed quoting — fix the quotation marks on this row.' });
      } else {
        rows.push({ line: rowLine, cells: row });
      }
      row = [];
      rowBad = false;
      quoteBreak = -1;
      line++;
      rowLine = line;
    }

    function readAll() {
      while (i < src.length) {
        var ch = src.charAt(i);

        if (state === 'quoted') {
          if (ch === '"') {
            if (src.charAt(i + 1) === '"') { field += '"'; i += 2; continue; }
            state = 'afterquote'; i++; continue;
          }
          if (ch === '\n') {
            /* Names, tables, tags and notes are single-line here, so a line break
               inside an open quote always means the quotes on this row are broken.
               Report the row and resume at the next line — otherwise the open
               quote swallows the valid rows that follow it. */
            errors.push({ line: rowLine, message: 'Unclosed quote — this row was skipped.' });
            row = [];
            field = '';
            state = 'start';
            rowBad = false;
            quoteBreak = -1;
            line++;
            rowLine = line;
            i++;
            continue;
          }
          field += ch;
          i++;
          continue;
        }

        if (state === 'afterquote') {
          if (ch === ',') { endField(); i++; continue; }
          if (ch === '\r') { i++; continue; }
          if (ch === '\n') { endRow(); i++; continue; }
          if (!ch.trim()) { i++; continue; }   /* spaces between the quote and the comma */
          rowBad = true;
          field += ch;
          state = 'plain';
          i++;
          continue;
        }

        if (ch === '"') {
          if (state === 'start') { state = 'quoted'; i++; continue; }
          rowBad = true;                        /* a quote inside an unquoted field */
          field += ch;
          i++;
          continue;
        }
        if (ch === ',') { endField(); i++; continue; }
        if (ch === '\r') { i++; continue; }
        if (ch === '\n') { endRow(); i++; continue; }
        field += ch;
        state = 'plain';
        i++;
      }
    }

    readAll();

    /* A quote that never closes would otherwise swallow every following row.
       Once at least one line break was passed inside it, the file is read again
       from that break: the broken row is reported and the rows after it import
       normally instead of disappearing. */
    while (state === 'quoted' && quoteBreak >= 0) {
      errors.push({ line: rowLine, message: 'Unclosed quote — this row was skipped.' });
      var resumeAt = quoteBreak;
      var resumeLine = quoteBreakLine;
      row = [];
      field = '';
      state = 'start';
      rowBad = false;
      quoteBreak = -1;
      i = resumeAt;
      line = resumeLine;
      rowLine = resumeLine;
      readAll();
    }

    if (state === 'quoted') {
      errors.push({ line: rowLine, message: 'Unclosed quote — this row could not be read.' });
      return { rows: rows, errors: errors };
    }
    if (state !== 'start' || field !== '' || row.length) { endRow(); }
    return { rows: rows, errors: errors };
  }

  function csvCell(value) {
    var s = String(value == null ? '' : value);
    if (/[",\r\n]/.test(s)) { return '"' + s.replace(/"/g, '""') + '"'; }
    return s;
  }

  function buildCsv() {
    var lines = ['name,table,tags'];
    state.guests.forEach(function (g) {
      lines.push([csvCell(g.name), csvCell(tableLabel(g.tableId)), csvCell(g.tags.join(';'))].join(','));
    });
    return lines.join('\n') + '\n';
  }

  function importCsv(raw) {
    var parsed = parseCsv(raw);
    var report = { added: 0, errors: parsed.errors.slice(), misses: [] };

    var rows = parsed.rows.filter(function (r) {
      return !(r.cells.length === 1 && String(r.cells[0]).trim() === '');
    });

    if (!rows.length) {
      report.errors.push({ line: 1, message: 'Nothing to import — paste some CSV rows first.' });
      return report;
    }

    var headerCells = rows[0].cells.map(function (c) { return String(c).trim().toLowerCase(); });
    var hasHeader = headerCells.indexOf('name') !== -1;
    var idx = { name: 0, table: 1, tags: 2 };
    var width = 3;
    var start = 0;

    if (hasHeader) {
      idx.name = headerCells.indexOf('name');
      idx.table = headerCells.indexOf('table');
      idx.tags = headerCells.indexOf('tags');
      width = rows[0].cells.length;
      start = 1;
    }

    var incoming = [];
    for (var r = start; r < rows.length; r++) {
      var row = rows[r];
      var cells = row.cells;
      if (cells.length !== width) {
        report.errors.push({
          line: row.line,
          message: 'Expected ' + width + ' columns, found ' + cells.length + '.'
        });
        continue;
      }
      var name = String(cells[idx.name] == null ? '' : cells[idx.name]).trim();
      if (!name) {
        report.errors.push({ line: row.line, message: 'Name is required.' });
        continue;
      }
      var rawTable = idx.table >= 0 ? String(cells[idx.table] == null ? '' : cells[idx.table]).trim() : '';
      var rawTags = idx.tags >= 0 ? String(cells[idx.tags] == null ? '' : cells[idx.tags]) : '';
      var tableId = findTableByLabel(rawTable);
      if (rawTable && !tableId) {
        report.misses.push({ line: row.line, table: rawTable });
      }
      incoming.push({
        id: uid('g'),
        name: txt(name, 120),
        tableId: tableId,
        tags: rawTags.split(';').map(function (t) { return t.trim(); }).filter(Boolean).slice(0, 12),
        note: ''
      });
    }

    if (incoming.length) {
      state.guests = state.guests.concat(incoming);
      report.added = incoming.length;
      save();
    }
    return report;
  }


  /* -------------------------------------------------------- poster engine */
  /*
   * One layout pass produces a list of pages made of small drawing primitives
   * in millimetres. The same primitives feed three renderers — the on-screen
   * preview (canvas), the PNG export (canvas at 2x) and the PDF (vector text
   * and shapes). That is why the preview matches what gets downloaded.
   */

  var MM2PT = 72 / 25.4;
  var PAGE = { w: 420, h: 594 };          /* A2 portrait, millimetres */
  var PREVIEW_PX = 700;                   /* intrinsic preview width in px */
  var LINE_HEIGHT = 1.28;

  var STYLES = {
    minimal: {
      id: 'minimal', label: 'Minimal',
      family: 'times',
      cssFont: '"Times New Roman", Times, serif',
      bg: '#ffffff', fg: '#1c1b17', muted: '#807a6c', rule: '#ddd8c9', accent: '#1c1b17',
      margin: { l: 34, r: 34, t: 40, b: 30 },
      columns: 2, gap: 26, align: 'center', footerSize: 4,
      header: { kickerSize: 5, namesSize: 24, metaSize: 7, spaceAfterKicker: 11, spaceAfterNames: 8, rule: true, ruleWidth: 70, ruleSpace: 22 },
      block: { gap: 17, labelSize: 8, metaSize: 4.4, nameSize: 6.4, lineH: 9.6, align: 'center', padX: 0, padY: 0, panel: false, ruleUnderHeader: true },
      sheet: { nameSize: 5.6, lineH: 9.2, letterSize: 13, groupGap: 9, gap: 22 }
    },
    botanical: {
      id: 'botanical', label: 'Botanical',
      family: 'times',
      cssFont: '"Times New Roman", Times, serif',
      bg: '#f7f1e2', fg: '#2c3a2b', muted: '#6c7659', rule: '#cdc5ad', accent: '#5f7a45',
      margin: { l: 28, r: 28, t: 32, b: 26 },
      columns: 2, gap: 18, align: 'left', footerSize: 4,
      header: { kickerSize: 4.6, namesSize: 21, metaSize: 6.4, spaceAfterKicker: 9, spaceAfterNames: 7, rule: true, ruleWidth: 80, ruleSpace: 12 },
      block: { gap: 14, labelSize: 7.6, metaSize: 4.2, nameSize: 6, lineH: 8.8, align: 'left', padX: 0, padY: 0, panel: false, ruleUnderHeader: false, sprig: true },
      sheet: { nameSize: 5.4, lineH: 8.8, letterSize: 12, groupGap: 8, gap: 18 }
    },
    midnight: {
      id: 'midnight', label: 'Midnight',
      family: 'helv',
      cssFont: 'Arial, Helvetica, sans-serif',
      bg: '#101319', fg: '#f4ecd9', muted: '#a49b8a', rule: '#3a4152', accent: '#c9a95d',
      panelFill: '#191e29', panelStroke: '#8f7738',
      margin: { l: 20, r: 20, t: 26, b: 22 },
      columns: 3, gap: 9, align: 'left', footerSize: 3.8,
      header: { kickerSize: 4.2, namesSize: 20, metaSize: 5.8, spaceAfterKicker: 9, spaceAfterNames: 6, rule: true, ruleWidth: 90, ruleSpace: 12 },
      block: { gap: 10, labelSize: 7.2, metaSize: 4.4, nameSize: 6, lineH: 9, align: 'left', padX: 7, padY: 7, panel: true, panelWidth: 0.5, ruleUnderHeader: false },
      sheet: { nameSize: 5.2, lineH: 8.4, letterSize: 11, groupGap: 7, gap: 12 }
    }
  };

  function tint(S, key) {
    if (!key) { return S.fg; }
    if (key.charAt(0) === '#') { return key; }
    return S[key] || S.fg;
  }

  var metricCache = null;

  function getMetricFonts() {
    if (!window.PDFLib) { return Promise.reject(new Error('The PDF library did not load.')); }
    if (!metricCache) {
      var lib = window.PDFLib;
      var SF = lib.StandardFonts;
      metricCache = lib.PDFDocument.create().then(function (doc) {
        return Promise.all([
          doc.embedFont(SF.TimesRoman),
          doc.embedFont(SF.TimesRomanBold),
          doc.embedFont(SF.TimesRomanItalic),
          doc.embedFont(SF.Helvetica),
          doc.embedFont(SF.HelveticaBold),
          doc.embedFont(SF.HelveticaOblique)
        ]);
      }).then(function (f) {
        return {
          times: { body: f[0], bold: f[1], italic: f[2] },
          helv: { body: f[3], bold: f[4], italic: f[5] }
        };
      });
      metricCache.catch(function () { metricCache = null; });
    }
    return metricCache;
  }

  function fontsFor(styleId) {
    return getMetricFonts().then(function (set) {
      return (STYLES[styleId] || STYLES.minimal).family === 'helv' ? set.helv : set.times;
    });
  }

  /*
   * Measures text in millimetres with the very font the PDF will use, so line
   * breaks are identical in the preview, the PNG and the PDF. Characters the
   * standard PDF fonts cannot encode are measured as "?" and reported, so the
   * app can stop a broken export instead of printing garbage.
   */
  function makeMetrics(fonts) {
    var cache = Object.create(null);
    var unsupported = [];
    var seen = Object.create(null);

    function safeText(value, kind) {
      var text = String(value == null ? '' : value);
      var key = kind + '|' + text;
      if (cache[key] !== undefined) { return cache[key]; }
      var font = fonts[kind] || fonts.body;
      var out = '';
      for (var i = 0; i < text.length; i++) {
        var ch = text.charAt(i);
        var ok = true;
        try {
          font.widthOfTextAtSize(ch, 10);
        } catch (err) {
          ok = false;
        }
        if (ok) {
          out += ch;
        } else {
          out += '?';
          if (!seen[ch]) { seen[ch] = true; unsupported.push(ch); }
        }
      }
      cache[key] = out;
      return out;
    }

    return {
      fonts: fonts,
      unsupported: unsupported,
      safe: function (value, kind) { return safeText(value, kind || 'body'); },
      width: function (value, kind, size) {
        var font = fonts[kind] || fonts.body;
        var text = safeText(value, kind || 'body');
        if (!text) { return 0; }
        return font.widthOfTextAtSize(text, size * MM2PT) / MM2PT;
      }
    };
  }

  /* Width of the widest word in a string, in millimetres. Used to tell a
     wrap that will break a word mid-way from one that will not. */
  function longestWord(text, kind, size, mm) {
    var widest = 0;
    String(text == null ? '' : text).split(/\s+/).forEach(function (word) {
      if (!word) { return; }
      var w = mm.width(word, kind, size);
      if (w > widest) { widest = w; }
    });
    return widest;
  }

  function wrap(text, kind, size, maxWidth, mm) {
    var src = String(text == null ? '' : text).replace(/\s+/g, ' ').trim();
    if (!src || maxWidth <= 0) { return []; }
    var words = src.split(' ');
    var lines = [];
    var current = '';

    function measure(value) { return mm.width(value, kind, size); }

    words.forEach(function (word) {
      var candidate = current ? current + ' ' + word : word;
      if (measure(candidate) <= maxWidth) { current = candidate; return; }
      if (current) { lines.push(current); current = ''; }
      if (measure(word) <= maxWidth) { current = word; return; }
      var rest = word;
      while (rest.length > 1 && measure(rest) > maxWidth) {
        var cut = rest.length - 1;
        while (cut > 1 && measure(rest.slice(0, cut)) > maxWidth) { cut -= 1; }
        lines.push(rest.slice(0, cut));
        rest = rest.slice(cut);
      }
      current = rest;
    });

    if (current) { lines.push(current); }
    return lines;
  }

  function stackHeight(stack) {
    var h = 0;
    stack.forEach(function (item) {
      if (item.rule || item.branch) { h += (item.spaceBefore || 0) + (item.spaceAfter || 0); return; }
      if (item.sprig) { h += (item.spaceAfter || 0) + 8; return; }
      h += (item.spaceBefore || 0) + item.size * LINE_HEIGHT + (item.spaceAfter || 0);
    });
    return h;
  }

  function drawStack(page, stack, x, width, top, S, mm) {
    var y = top;
    stack.forEach(function (item) {
      if (item.rule) {
        y += item.spaceBefore || 0;
        var ruleWidth = Math.min(width, item.width || 30);
        var rx = (item.align || S.align) === 'center' ? x + (width - ruleWidth) / 2 : x;
        page.shapes.push({
          t: 'line', x1: rx, y1: y, x2: rx + ruleWidth, y2: y,
          color: tint(S, item.color || 'rule'), w: item.thickness || 0.25
        });
        y += item.spaceAfter || 0;
        return;
      }
      if (item.sprig) {
        leafMark(page, S, x + 3, y + 1);
        y += 9.5 + (item.spaceAfter || 0);
        return;
      }
      if (item.branch) {
        y += item.spaceBefore || 0;
        branchRule(page, S, x, y, Math.min(width, item.width || 90));
        y += item.spaceAfter || 0;
        return;
      }
      y += item.spaceBefore || 0;
      var size = item.size;
      var kind = item.kind || 'body';
      var w = mm.width(item.text, kind, size);
      var align = item.align || S.align;
      var tx = align === 'center' ? x + Math.max(0, (width - w) / 2)
        : align === 'right' ? x + Math.max(0, width - w) : x;
      page.texts.push({
        t: 'text', text: item.text, x: tx, y: y + size * 0.8,
        size: size, kind: kind, color: tint(S, item.color || 'fg'),
        opacity: item.opacity == null ? 1 : item.opacity
      });
      y += size * LINE_HEIGHT + (item.spaceAfter || 0);
    });
    return y;
  }

  function leaf(page, S, cx, cy, len, rotate, alpha) {
    page.shapes.push({
      t: 'ellipse', cx: cx, cy: cy, rx: len, ry: len * 0.34,
      rotate: rotate, fill: tint(S, 'accent'), opacity: alpha == null ? 0.4 : alpha
    });
  }

  /* A small twig above a table name (Botanical). */
  function leafMark(page, S, x, y) {
    page.shapes.push({
      t: 'line', x1: x, y1: y + 5.6, x2: x + 11, y2: y + 1.4,
      color: tint(S, 'accent'), w: 0.22, opacity: 0.45
    });
    leaf(page, S, x + 3.6, y + 3.4, 3.4, -42, 0.32);
    leaf(page, S, x + 7.6, y + 1.9, 2.9, -16, 0.24);
  }

  /* A branch used as the header divider (Botanical). */
  function branchRule(page, S, x, y, width) {
    page.shapes.push({
      t: 'line', x1: x, y1: y, x2: x + width, y2: y,
      color: tint(S, 'accent'), w: 0.22, opacity: 0.45
    });
    var mid = x + width / 2;
    page.shapes.push({
      t: 'rect', x: mid - 1.4, y: y - 1.4, w: 2.8, h: 2.8,
      fill: tint(S, 'bg'), stroke: null
    });
    leaf(page, S, mid - 2.6, y - 1.2, 3.4, -32, 0.34);
    leaf(page, S, mid + 2.6, y + 1.2, 3.4, 148, 0.26);
  }

  function headerStack(model, S, mm, contentWidth, kickerOverride) {
    var st = model.settings;
    var title = String(st.title || '').trim();
    var names = String(st.names || '').trim();
    var kicker = title ? title.toUpperCase() : 'SEATING PLAN';
    if (!names) { names = title || 'Seating Plan'; }
    else if (title && title.toUpperCase() === names.toUpperCase()) { kicker = 'SEATING PLAN'; }
    /* The find-your-seat sheet calls itself something else than the poster. */
    if (kickerOverride) { kicker = String(kickerOverride); }

    var metaParts = [st.date, st.venue].map(function (v) { return String(v || '').trim(); })
      .filter(Boolean);

    var stack = [];

    /* The kicker is the (possibly 80-character) title, so it is wrapped just
       like the names. Everything the header draws is measured in millimetres
       against the printable width, so no line can reach the page edge. */
    var kickerLines = wrap(kicker, 'bold', S.header.kickerSize, contentWidth, mm);
    if (!kickerLines.length) { kickerLines = ['SEATING PLAN']; }
    kickerLines.forEach(function (line, i) {
      stack.push({
        text: line, size: S.header.kickerSize, kind: 'bold', color: 'accent',
        spaceAfter: i === kickerLines.length - 1
          ? S.header.spaceAfterKicker
          : S.header.kickerSize * 0.5
      });
    });

    wrap(names, 'bold', S.header.namesSize, contentWidth, mm).forEach(function (line) {
      stack.push({ text: line, size: S.header.namesSize, kind: 'bold', color: 'fg', spaceAfter: S.header.spaceAfterNames });
    });

    if (metaParts.length) {
      var metaSize = S.header.metaSize;
      var joined = metaParts.join('  ·  ');
      var metaLines = mm.width(joined, 'italic', metaSize) <= contentWidth
        ? [joined]
        : metaParts.reduce(function (all, part) {
          return all.concat(wrap(part, 'italic', metaSize, contentWidth, mm));
        }, []);
      metaLines.forEach(function (line, i) {
        stack.push({
          text: line, size: metaSize, kind: 'italic', color: 'muted',
          spaceAfter: i === metaLines.length - 1 ? 0 : metaSize * 0.55
        });
      });
    }
    if (S.header.rule) {
      stack.push(S.id === 'botanical'
        ? { branch: true, width: S.header.ruleWidth, spaceBefore: S.header.ruleSpace, spaceAfter: 0 }
        : { rule: true, width: S.header.ruleWidth, spaceBefore: S.header.ruleSpace, spaceAfter: 0 });
    }
    return stack;
  }

  function seatingMeta(count, capacity) {
    return (count === 1 ? '1 guest' : count + ' guests') + '  ·  ' +
      (capacity === 1 ? '1 seat' : capacity + ' seats');
  }

  /* ------------------------------------------------------------- paginate */

  function flow(blocks, cfg) {
    var pages = [];
    var page = null;
    var col = 0;
    var y = 0;
    var colHas = false;
    var colW = (cfg.contentW - cfg.gap * (cfg.columns - 1)) / cfg.columns;
    var bottom = cfg.bottom;

    function colX(index) { return cfg.margin.l + index * (colW + cfg.gap); }

    function newPage() {
      var index = pages.length;
      page = {
        index: index + 1,
        bg: cfg.bg,
        fontCss: cfg.S.cssFont,
        shapes: [],
        texts: []
      };
      pages.push(page);
      col = 0;
      y = cfg.topFor(index);
      page.top = y;
      colHas = false;
      if (cfg.onNewPage) { cfg.onNewPage(page, index, colW, colX(0), cfg.contentW); }
    }

    function nextColumn() {
      if (col + 1 < cfg.columns) {
        col += 1;
        y = page.top;
        colHas = false;
      } else {
        newPage();
      }
    }

    /* When everything fits on one page, split the blocks into equally tall
       columns (linear partition). It keeps a poster from ending up with four
       tables in the first column and three empty columns beside it. */
    var breakBefore = {};
    if (cfg.columns > 1) {
      var heights = [];
      var totalHeight = 0;
      blocks.forEach(function (block) {
        var headH = stackHeight(block.header);
        var pad = block.panel ? (block.padY || 0) * 2 : 0;
        var h = headH + block.lines.length * block.lineH + pad + (block.gapBefore || 0);
        heights.push(h);
        totalHeight += h;
      });
      var columnHeight = bottom - cfg.topFor(0);
      if (blocks.length > cfg.columns && totalHeight <= columnHeight * cfg.columns) {
        var prefix = [0];
        heights.forEach(function (h, i) { prefix.push(prefix[i] + h); });
        var n = heights.length;
        var best = [];
        var from = [];
        for (var c = 0; c <= cfg.columns; c++) {
          best.push(new Array(n + 1).fill(Infinity));
          from.push(new Array(n + 1).fill(0));
        }
        best[0][0] = 0;
        for (var cc = 1; cc <= cfg.columns; cc++) {
          for (var i = 1; i <= n; i++) {
            for (var j = cc - 1; j < i; j++) {
              var value = Math.max(best[cc - 1][j], prefix[i] - prefix[j]);
              if (value < best[cc][i]) { best[cc][i] = value; from[cc][i] = j; }
            }
          }
        }
        var cursor = n;
        for (var c2 = cfg.columns; c2 > 1; c2--) {
          cursor = from[c2][cursor];
          if (cursor > 0) { breakBefore[cursor] = true; }
        }
      }
    }

    newPage();

    blocks.forEach(function (block, blockIndex) {
      var idx = 0;
      var first = true;
      var guard = 0;
      var forced = 0;

      while (guard < 6000) {
        guard += 1;
        var head = first ? block.header : (block.contHeader || block.header);
        var headH = stackHeight(head);
        var tail = idx < block.lines.length ? Math.min(2, block.lines.length - idx) * block.lineH : 0;
        var need = headH + tail;
        var gap = (colHas && block.gapBefore) ? block.gapBefore : 0;

        if (first && breakBefore[blockIndex] && colHas && (y - page.top) > 0) {
          nextColumn();
          continue;
        }

        /* Keep a whole table on one column when it can fit there at all. */
        if (first && block.lines.length) {
          var fullH = headH + block.lines.length * block.lineH + (block.panel ? (block.padY || 0) * 2 : 0);
          if (fullH <= bottom - page.top - (block.gapBefore || 0) && bottom - y < gap + fullH) {
            nextColumn();
            continue;
          }
        }

        if (colHas && bottom - y < gap + need) { nextColumn(); continue; }

        if (!colHas && bottom - y < need) {
          if (forced < 2) { forced += 1; newPage(); continue; }
        }

        y += gap;
        var boxTop = y;
        var padX = block.padX || 0;
        var padY = block.panel ? (block.padY || 0) : 0;
        if (padY) { y += padY; }

        var bodyX = colX(col) + padX;
        var bodyW = colW - padX * 2;

        y = drawStack(page, head, bodyX, bodyW, y, cfg.S, cfg.mm);

        if (block.ruleUnderHeader) {
          var rw = Math.min(bodyW, block.ruleWidth || 22);
          var rx = (block.align || cfg.S.align) === 'center' ? bodyX + (bodyW - rw) / 2 : bodyX;
          page.shapes.push({ t: 'line', x1: rx, y1: y + 1.4, x2: rx + rw, y2: y + 1.4, color: tint(cfg.S, 'rule'), w: 0.22 });
          y += 3.2;
        }

        while (idx < block.lines.length && bottom - y >= block.lineH) {
          drawBodyLine(page, block.lines[idx], bodyX, bodyW, y, cfg, block);
          y += block.lineH;
          idx += 1;
        }

        if (block.panel) {
          page.shapes.push({
            t: 'rect', x: colX(col), y: boxTop, w: colW, h: (y + padY) - boxTop,
            fill: block.panelFill || null, stroke: block.panelStroke || null,
            lineWidth: block.panelWidth || 0.3
          });
        }

        first = false;
        colHas = true;

        if (idx >= block.lines.length) { break; }
        nextColumn();
      }
    });

    pages.forEach(function (p) {
      var label = 'Page ' + p.index + ' of ' + pages.length;
      var size = cfg.S.footerSize || 2.2;
      var w = cfg.mm.width(label, 'body', size);
      var x = cfg.S.align === 'center' ? cfg.margin.l + (cfg.contentW - w) / 2 : PAGE.w - cfg.margin.r - w;
      p.texts.push({
        t: 'text', text: label, x: x, y: PAGE.h - cfg.margin.b + 5,
        size: size, kind: 'body', color: tint(cfg.S, 'muted'), opacity: 0.9
      });
    });

    return pages;
  }

  function drawBodyLine(page, line, x, width, top, cfg, block) {
    var size = line.size || block.nameSize;
    var kind = line.kind || 'body';
    var color = tint(cfg.S, line.color || 'fg');
    var align = line.align || block.align || cfg.S.align;
    var rightWidth = 0;
    var rightSize = line.rightSize || size;
    var rightKind = line.rightKind || 'bold';

    if (line.right) {
      rightWidth = cfg.mm.width(line.right, rightKind, rightSize);
      /* A long table label may take at most a little over half the column;
         beyond that it is set smaller, so it can never run into the name or
         out of its column. A caller that reserved less room for the label
         (the QR sheet does, when the name needs the space) passes its own
         cap, so the name and the label can never be drawn over each other. */
      var maxRight = line.rightMax != null ? Math.min(line.rightMax, width) : width * 0.55;
      if (rightWidth > maxRight) {
        rightSize = rightSize * (maxRight / rightWidth);
        rightWidth = cfg.mm.width(line.right, rightKind, rightSize);
      }
      page.texts.push({
        t: 'text', text: line.right,
        x: x + width - rightWidth,
        y: top + rightSize * 0.8,
        size: rightSize, kind: rightKind,
        color: tint(cfg.S, line.rightColor || 'accent')
      });
    }

    var available = width - (line.right ? rightWidth + 4 : 0);
    var text = line.text;
    var w = cfg.mm.width(text, kind, size);

    /* Never drop text: if a line still overflows (a very long word beside a
       wide table label), shrink that one line to the space it has. */
    if (available > 0 && w > available) {
      size = size * (available / w);
      w = cfg.mm.width(text, kind, size);
    }
    var tx = align === 'center' ? x + Math.max(0, (available - w) / 2) : x + (line.indent || 0);
    page.texts.push({
      t: 'text', text: text, x: Math.max(x, tx), y: top + size * 0.8,
      size: size, kind: kind, color: color
    });
  }

  /* --------------------------------------------------------------- layout */

  function posterBlocks(model, S, mm, colW) {
    var padX = S.block.padX || 0;
    var bodyW = colW - padX * 2;
    var blocks = [];

    if (!model.tables.length) {
      blocks.push({
        header: [{ text: 'No tables yet', size: S.block.labelSize, kind: 'bold', color: 'muted', align: S.align, spaceAfter: 2 }],
        lines: [],
        gapBefore: 0,
        lineH: S.block.lineH,
        align: S.align
      });
      return blocks;
    }

    model.tables.forEach(function (t) {
      var guests = model.guests.filter(function (g) { return g.tableId === t.id; });
      var lines = [];

      guests.forEach(function (g) {
        wrap(g.name, 'body', S.block.nameSize, bodyW, mm).forEach(function (part, i) {
          lines.push({
            text: part, size: S.block.nameSize, kind: 'body', color: 'fg',
            align: S.block.align, indent: i ? 1.8 : 0
          });
        });
      });

      var header = [];
      if (S.block.sprig) { header.push({ sprig: true, spaceAfter: 1 }); }

      var labelLines = wrap(String(t.label || 'Table').toUpperCase(), 'bold', S.block.labelSize, bodyW, mm);
      if (!labelLines.length) { labelLines = ['TABLE']; }
      labelLines.forEach(function (line, i) {
        header.push({
          text: line, size: S.block.labelSize, kind: 'bold',
          color: S.block.panel ? 'accent' : 'fg', align: S.block.align,
          spaceAfter: i === labelLines.length - 1 ? 1.4 : 0.2
        });
      });

      header.push({
        text: seatingMeta(guests.length, t.capacity), size: S.block.metaSize, kind: 'italic',
        color: 'muted', align: S.block.align, spaceAfter: S.block.panel ? 3.2 : 2.6
      });

      blocks.push({
        header: header,
        contHeader: wrap(String(t.label || 'Table').toUpperCase() + ' · CONT.', 'bold',
          S.block.labelSize * 0.66, bodyW, mm).map(function (line, i, all) {
          return {
            text: line, size: S.block.labelSize * 0.66, kind: 'bold',
            color: S.block.panel ? 'accent' : 'muted',
            align: S.block.align, spaceAfter: i === all.length - 1 ? 2.6 : 0.2
          };
        }),
        lines: lines,
        gapBefore: S.block.gap,
        lineH: S.block.lineH,
        align: S.block.align,
        nameSize: S.block.nameSize,
        padX: padX,
        padY: S.block.padY,
        panel: !!S.block.panel,
        panelFill: S.panelFill,
        panelStroke: S.panelStroke,
        panelWidth: S.block.panelWidth,
        ruleUnderHeader: !!S.block.ruleUnderHeader,
        ruleWidth: Math.min(bodyW, 24)
      });
    });

    return blocks;
  }

  function continuationStack(text, S, mm, contentWidth, align) {
    var lines = wrap(String(text || ''), 'italic', 4.2, contentWidth, mm);
    if (!lines.length) { return []; }
    return lines.map(function (line, i, all) {
      return {
        text: line, size: 4.2, kind: 'italic', color: 'muted',
        align: align || S.align, spaceAfter: i === all.length - 1 ? 0 : 1.6
      };
    });
  }

  function layoutPoster(model, styleId, mm) {
    var S = STYLES[styleId] || STYLES.minimal;
    var contentW = PAGE.w - S.margin.l - S.margin.r;
    var colW = (contentW - S.gap * (S.columns - 1)) / S.columns;
    var headStack = headerStack(model, S, mm, contentW);
    var headerH = stackHeight(headStack) + (S.id === 'minimal' ? 20 : 16);
    var contStack = continuationStack(
      String(model.settings.names || model.settings.title || 'Seating plan') + ' · continued',
      S, mm, contentW);
    var contH = Math.max(26, stackHeight(contStack) + 16);
    var bottom = PAGE.h - S.margin.b - 14;

    var pages = flow(posterBlocks(model, S, mm, colW), {
      S: S,
      mm: mm,
      margin: S.margin,
      columns: S.columns,
      gap: S.gap,
      contentW: contentW,
      bottom: bottom,
      bg: S.bg,
      topFor: function (index) { return index === 0 ? S.margin.t + headerH : S.margin.t + contH; },
      onNewPage: function (page, index) {
        if (index === 0) {
          drawStack(page, headStack, S.margin.l, contentW, S.margin.t, S, mm);
        } else {
          drawStack(page, contStack, S.margin.l, contentW, S.margin.t + 2, S, mm);
        }

        if (S.id === 'midnight') {
          page.shapes.push({
            t: 'rect', x: S.margin.l - 7, y: S.margin.t - 9,
            w: PAGE.w - S.margin.l - S.margin.r + 14,
            h: PAGE.h - S.margin.t - S.margin.b + 9,
            fill: null, stroke: tint(S, 'rule'), lineWidth: 0.25
          });
        }
      }
    });

    return { pages: pages, unsupported: mm.unsupported, style: S, kind: 'poster' };
  }

  function qrSheet(model, styleId, mm, shareUrl) {
    var S = STYLES[styleId] || STYLES.minimal;
    var contentW = PAGE.w - S.margin.l - S.margin.r;
    var gap = S.sheet.gap;
    var columns = 2;
    var colW = (contentW - gap * (columns - 1)) / columns;
    var bottom = PAGE.h - S.margin.b - 14;

    var titleStack = headerStack(model, S, mm, contentW, 'FIND YOUR SEAT');
    if (titleStack.length && titleStack[0].text) {
      titleStack[0].align = 'center';
      titleStack[0].spaceAfter = 10;
    }
    var titleH = stackHeight(titleStack);
    var qrSize = 128;
    var qrTop = S.margin.t + titleH + 18;
    var captionY = qrTop + qrSize + 18;
    var page1Top = captionY + 30;
    var matrix = qrMatrix(shareUrl);

    var groups = [];
    var byLetter = {};
    model.guests.slice().sort(function (a, b) {
      return a.name.localeCompare(b.name, 'en', { sensitivity: 'base' });
    }).forEach(function (g) {
      var letter = (g.name.trim().charAt(0) || '#').toUpperCase();
      if (!/[A-Z]/.test(letter)) { letter = '#'; }
      if (!byLetter[letter]) { byLetter[letter] = { letter: letter, guests: [] }; groups.push(byLetter[letter]); }
      byLetter[letter].guests.push(g);
    });

    var blocks = groups.map(function (group) {
      var lines = [];
      group.guests.forEach(function (g) {
        var label = tableLabel(g.tableId) || 'Not seated';
        /* Reserve room for the table label on the first line only, so long
           names wrap instead of colliding with it. */
        var labelW = mm.width(label, 'bold', S.sheet.nameSize);
        var labelWidth = Math.min(labelW, colW * 0.55);
        var nameWidth = Math.max(18, colW - labelWidth - 6);
        /* A very long table name squeezes the name column until a surname has
           to break mid-word. If the name has a word that does not fit, take
           room back from the label (down to 42% of the column); the cap is
           handed to drawBodyLine, so the two can still never touch. */
        if (labelW > colW * 0.42 && longestWord(g.name, 'body', S.sheet.nameSize, mm) > nameWidth) {
          labelWidth = Math.min(labelW, colW * 0.42);
          nameWidth = Math.max(18, colW - labelWidth - 6);
        }
        wrap(g.name, 'body', S.sheet.nameSize, nameWidth, mm).forEach(function (part, i) {
          lines.push({
            text: part, size: S.sheet.nameSize, kind: 'body', color: 'fg', align: 'left',
            right: i === 0 ? label : '', rightKind: 'bold', rightColor: g.tableId ? 'accent' : 'muted',
            rightMax: i === 0 ? labelWidth : null
          });
        });
      });
      return {
        header: [{ text: group.letter, size: S.sheet.letterSize, kind: 'bold', color: 'accent', align: 'left', spaceAfter: 2 }],
        contHeader: [{ text: group.letter + ' · CONT.', size: 2.6, kind: 'bold', color: 'muted', align: 'left', spaceAfter: 2 }],
        lines: lines,
        gapBefore: S.sheet.groupGap,
        lineH: S.sheet.lineH,
        align: 'left'
      };
    });

    if (!blocks.length) {
      blocks.push({
        header: [{ text: 'No guests yet', size: 3.2, kind: 'bold', color: 'muted', align: 'left', spaceAfter: 2 }],
        lines: [], gapBefore: 0, lineH: S.sheet.lineH, align: 'left'
      });
    }

    var sheetContStack = continuationStack(
      String(model.settings.names || 'Guests') + ' · names A–Z continued',
      S, mm, contentW, 'left');
    var sheetContTop = S.margin.t + Math.max(18, stackHeight(sheetContStack) + 8);

    var pages = flow(blocks, {
      S: S,
      mm: mm,
      margin: S.margin,
      columns: columns,
      gap: gap,
      contentW: contentW,
      bottom: bottom,
      bg: S.bg,
      topFor: function (index) { return index === 0 ? page1Top : sheetContTop; },
      onNewPage: function (page, index) {
        if (index === 0) {
          drawStack(page, titleStack, S.margin.l, contentW, S.margin.t, S, mm);
          var qx = S.margin.l + (contentW - qrSize) / 2;
          page.shapes.push({ t: 'rect', x: qx - 6, y: qrTop - 6, w: qrSize + 12, h: qrSize + 12, fill: '#ffffff', stroke: null });
          page.shapes.push({ t: 'qr', x: qx, y: qrTop, size: qrSize, matrix: matrix, dark: '#101319' });
          page.texts.push({
            t: 'text', text: 'Scan the code, type your name, find your table.',
            x: S.margin.l + (contentW - mm.width('Scan the code, type your name, find your table.', 'italic', 5)) / 2,
            y: captionY, size: 5, kind: 'italic', color: tint(S, 'muted')
          });
          page.shapes.push({
            t: 'line', x1: S.margin.l, y1: captionY + 14, x2: PAGE.w - S.margin.r, y2: captionY + 14,
            color: tint(S, 'rule'), w: 0.25
          });
        } else {
          drawStack(page, sheetContStack, S.margin.l, contentW, S.margin.t + 2, S, mm);
        }
        if (S.id === 'midnight') {
          page.shapes.push({
            t: 'rect', x: S.margin.l - 7, y: S.margin.t - 9,
            w: PAGE.w - S.margin.l - S.margin.r + 14,
            h: PAGE.h - S.margin.t - S.margin.b + 9,
            fill: null, stroke: tint(S, 'rule'), lineWidth: 0.25
          });
        }
      }
    });

    return { pages: pages, unsupported: mm.unsupported, style: S, kind: 'sheet' };
  }

  /* ------------------------------------------------------------ share link */

  /* The QR fragment carries nothing but names and table labels. It is packed
     compactly (table names once, then name/index pairs) and base64url encoded,
     because raw percent-encoding roughly triples the payload size. */
  function sharePayload(model) {
    var labels = [];
    var index = Object.create(null);
    model.tables.forEach(function (t) {
      var label = String(t.label || '');
      if (!Object.prototype.hasOwnProperty.call(index, label)) {
        index[label] = labels.length;
        labels.push(label);
      }
    });
    return {
      v: 1,
      t: labels,
      g: model.guests.map(function (guest) {
        var label = tableLabel(guest.tableId);
        return [guest.name, label ? index[label] : -1];
      })
    };
  }

  function utf8Bytes(value) {
    var text = String(value);
    if (window.TextEncoder) { return new TextEncoder().encode(text); }
    var escaped = unescape(encodeURIComponent(text));
    var bytes = new Uint8Array(escaped.length);
    for (var i = 0; i < escaped.length; i++) { bytes[i] = escaped.charCodeAt(i); }
    return bytes;
  }

  function utf8String(bytes) {
    if (window.TextDecoder) { return new TextDecoder().decode(bytes); }
    var bin = '';
    for (var i = 0; i < bytes.length; i++) { bin += String.fromCharCode(bytes[i]); }
    return decodeURIComponent(escape(bin));
  }

  function base64UrlEncode(value) {
    var bytes = utf8Bytes(value);
    var bin = '';
    for (var i = 0; i < bytes.length; i++) { bin += String.fromCharCode(bytes[i]); }
    return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  }

  function base64UrlDecode(value) {
    var text = String(value).replace(/-/g, '+').replace(/_/g, '/');
    while (text.length % 4) { text += '='; }
    var bin = atob(text);
    var bytes = new Uint8Array(bin.length);
    for (var i = 0; i < bin.length; i++) { bytes[i] = bin.charCodeAt(i); }
    return utf8String(bytes);
  }

  function shareFragment(model) {
    return base64UrlEncode(JSON.stringify(sharePayload(model)));
  }

  function guestsFromPayload(data) {
    if (!data || typeof data !== 'object' || !Array.isArray(data.g) || !Array.isArray(data.t)) {
      return null;
    }
    if (data.v !== 1) { return null; }
    for (var t = 0; t < data.t.length; t++) {
      if (typeof data.t[t] !== 'string') { return null; }
    }
    var guests = [];
    for (var i = 0; i < data.g.length; i++) {
      var row = data.g[i];
      if (!Array.isArray(row) || row.length < 2 || typeof row[0] !== 'string' || typeof row[1] !== 'number') {
        return null;
      }
      if (!isFinite(row[1]) || Math.floor(row[1]) !== row[1] || row[1] < -1 || row[1] >= data.t.length) {
        return null;
      }
      var label = data.t[row[1]];
      guests.push({
        name: row[0].slice(0, 120),
        table: typeof label === 'string' ? label.slice(0, 80) : ''
      });
    }
    return guests;
  }

  function parseShareHash(hash) {
    var raw = String(hash || '').replace(/^#/, '');
    if (!raw) { return { ok: false, code: 'EMPTY' }; }
    if (raw.length > 12000) { return { ok: false, code: 'BAD' }; }

    var data = null;
    try {
      data = JSON.parse(base64UrlDecode(raw));
    } catch (err) {
      data = null;
    }

    var guests = guestsFromPayload(data);
    if (guests) {
      if (!guests.length) { return { ok: false, code: 'EMPTY' }; }
      return { ok: true, guests: guests };
    }

    /* Older links used percent-encoded [name, table] pairs; keep reading them. */
    try {
      var legacy = JSON.parse(decodeURIComponent(raw));
      if (Array.isArray(legacy)) {
        var list = [];
        for (var i = 0; i < legacy.length; i++) {
          var row = legacy[i];
          if (!Array.isArray(row) || row.length !== 2 || typeof row[0] !== 'string' || typeof row[1] !== 'string') {
            return { ok: false, code: 'BAD' };
          }
          list.push({ name: row[0].slice(0, 120), table: row[1].slice(0, 80) });
        }
        if (!list.length) { return { ok: false, code: 'EMPTY' }; }
        return { ok: true, guests: list };
      }
    } catch (err) {
      /* fall through to the error below */
    }

    return { ok: false, code: 'BAD' };
  }

  function qrMatrix(text) {
    if (typeof qrcode !== 'function') {
      throw new Error('The QR code library did not load.');
    }
    var qr;
    try {
      qr = qrcode(0, 'L');
      qr.addData(text, 'Byte');
      qr.make();
    } catch (err) {
      var tooLong = new Error('QR data is too long');
      tooLong.code = 'QR_TOO_LONG';
      throw tooLong;
    }
    var count = qr.getModuleCount();
    var runs = [];
    for (var r = 0; r < count; r++) {
      var c = 0;
      while (c < count) {
        if (qr.isDark(r, c)) {
          var start = c;
          while (c < count && qr.isDark(r, c)) { c += 1; }
          runs.push([r, start, c - start]);
        } else {
          c += 1;
        }
      }
    }
    return { count: count, runs: runs };
  }

  /* ------------------------------------------------------------- renderers */

  function hexToRgb(hex) {
    var value = String(hex || '#000000').replace('#', '');
    if (value.length === 3) {
      value = value.charAt(0) + value.charAt(0) + value.charAt(1) + value.charAt(1) + value.charAt(2) + value.charAt(2);
    }
    var num = parseInt(value, 16);
    if (!isFinite(num)) { return { r: 0, g: 0, b: 0 }; }
    return {
      r: ((num >> 16) & 255) / 255,
      g: ((num >> 8) & 255) / 255,
      b: (num & 255) / 255
    };
  }

  function drawShapeCanvas(ctx, shape, k) {
    if (shape.t === 'rect') {
      if (shape.fill) {
        ctx.globalAlpha = shape.opacity == null ? 1 : shape.opacity;
        ctx.fillStyle = shape.fill;
        ctx.fillRect(shape.x * k, shape.y * k, shape.w * k, shape.h * k);
      }
      if (shape.stroke) {
        ctx.globalAlpha = 1;
        ctx.strokeStyle = shape.stroke;
        ctx.lineWidth = Math.max(0.6, (shape.lineWidth || 0.3) * k);
        ctx.strokeRect(shape.x * k, shape.y * k, shape.w * k, shape.h * k);
      }
      ctx.globalAlpha = 1;
      return;
    }
    if (shape.t === 'line') {
      ctx.globalAlpha = shape.opacity == null ? 1 : shape.opacity;
      ctx.strokeStyle = shape.color;
      ctx.lineWidth = Math.max(0.6, (shape.w || 0.25) * k);
      ctx.beginPath();
      ctx.moveTo(shape.x1 * k, shape.y1 * k);
      ctx.lineTo(shape.x2 * k, shape.y2 * k);
      ctx.stroke();
      ctx.globalAlpha = 1;
      return;
    }
    if (shape.t === 'ellipse') {
      ctx.globalAlpha = shape.opacity == null ? 1 : shape.opacity;
      ctx.fillStyle = shape.fill;
      ctx.beginPath();
      ctx.ellipse(shape.cx * k, shape.cy * k, Math.max(0.2, shape.rx * k), Math.max(0.2, shape.ry * k),
        (shape.rotate || 0) * Math.PI / 180, 0, Math.PI * 2);
      ctx.fill();
      ctx.globalAlpha = 1;
      return;
    }
    if (shape.t === 'qr') {
      var n = shape.matrix.count + 8;
      var m = shape.size / n;
      ctx.fillStyle = shape.dark || '#111111';
      shape.matrix.runs.forEach(function (run) {
        ctx.fillRect(
          (shape.x + (run[1] + 4) * m) * k,
          (shape.y + (run[0] + 4) * m) * k,
          run[2] * m * k + 0.4,
          m * k + 0.4
        );
      });
    }
  }

  function drawTextCanvas(ctx, item, k, cssFont) {
    var style = item.kind === 'italic' ? 'italic ' : '';
    var weight = item.kind === 'bold' ? '700 ' : '';
    ctx.font = style + weight + Math.max(1, item.size * k).toFixed(2) + 'px ' + cssFont;
    ctx.fillStyle = item.color;
    ctx.globalAlpha = item.opacity == null ? 1 : item.opacity;
    ctx.textBaseline = 'alphabetic';
    ctx.fillText(item.text, item.x * k, item.y * k);
    ctx.globalAlpha = 1;
  }

  function drawWatermark(ctx, canvas, k) {
    ctx.save();
    ctx.translate(canvas.width / 2, canvas.height / 2);
    ctx.rotate(-Math.PI / 6);
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillStyle = 'rgba(35, 33, 28, 0.08)';
    ctx.font = '700 ' + (26 * k).toFixed(1) + 'px Arial, Helvetica, sans-serif';
    for (var row = -3; row <= 3; row++) {
      for (var col = -2; col <= 2; col++) {
        ctx.fillText('SEATSTORY PREVIEW', col * 270 * k + (row % 2 ? 135 * k : 0), row * 190 * k);
      }
    }
    ctx.restore();

    ctx.fillStyle = 'rgba(35, 33, 28, 0.78)';
    ctx.fillRect(0, canvas.height - 16 * k, canvas.width, 16 * k);
    ctx.fillStyle = '#ffffff';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.font = '600 ' + (5.4 * k).toFixed(1) + 'px Arial, Helvetica, sans-serif';
    ctx.fillText('Preview only — unlock SeatStory to download this poster',
      canvas.width / 2, canvas.height - 8 * k);
  }

  function renderPage(page, pxWidth, options) {
    var opts = options || {};
    var k = pxWidth / PAGE.w;
    var canvas = document.createElement('canvas');
    canvas.width = Math.round(pxWidth);
    canvas.height = Math.round(PAGE.h * k);
    var ctx = canvas.getContext('2d');

    ctx.fillStyle = page.bg;
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    page.shapes.forEach(function (shape) { drawShapeCanvas(ctx, shape, k); });
    page.texts.forEach(function (item) { drawTextCanvas(ctx, item, k, page.fontCss); });

    if (opts.watermark) { drawWatermark(ctx, canvas, k); }
    return canvas;
  }

  function pdfSafeText(text, font) {
    var src = String(text == null ? '' : text);
    var out = '';
    for (var i = 0; i < src.length; i++) {
      var ch = src.charAt(i);
      try {
        font.widthOfTextAtSize(ch, 10);
        out += ch;
      } catch (err) {
        out += '?';
      }
    }
    return out;
  }

  function drawPagePdf(pdfPage, fonts, page, lib) {
    var W = PAGE.w * MM2PT;
    var H = PAGE.h * MM2PT;
    var bg = hexToRgb(page.bg);

    pdfPage.drawRectangle({ x: 0, y: 0, width: W, height: H, color: lib.rgb(bg.r, bg.g, bg.b) });

    page.shapes.forEach(function (shape) {
      if (shape.t === 'rect') {
        var c = shape.fill ? hexToRgb(shape.fill) : null;
        var s = shape.stroke ? hexToRgb(shape.stroke) : null;
        pdfPage.drawRectangle({
          x: shape.x * MM2PT,
          y: (PAGE.h - shape.y - shape.h) * MM2PT,
          width: shape.w * MM2PT,
          height: shape.h * MM2PT,
          color: c ? lib.rgb(c.r, c.g, c.b) : undefined,
          borderColor: s ? lib.rgb(s.r, s.g, s.b) : undefined,
          borderWidth: shape.stroke ? (shape.lineWidth || 0.3) * MM2PT : undefined,
          opacity: shape.opacity == null ? 1 : shape.opacity
        });
        return;
      }
      if (shape.t === 'line') {
        var lc = hexToRgb(shape.color);
        pdfPage.drawLine({
          start: { x: shape.x1 * MM2PT, y: (PAGE.h - shape.y1) * MM2PT },
          end: { x: shape.x2 * MM2PT, y: (PAGE.h - shape.y2) * MM2PT },
          thickness: (shape.w || 0.25) * MM2PT,
          color: lib.rgb(lc.r, lc.g, lc.b),
          opacity: shape.opacity == null ? 1 : shape.opacity
        });
        return;
      }
      if (shape.t === 'ellipse') {
        var ec = hexToRgb(shape.fill);
        pdfPage.drawEllipse({
          x: shape.cx * MM2PT,
          y: (PAGE.h - shape.cy) * MM2PT,
          xScale: shape.rx * MM2PT,
          yScale: shape.ry * MM2PT,
          rotate: lib.degrees(shape.rotate || 0),
          color: lib.rgb(ec.r, ec.g, ec.b),
          opacity: shape.opacity == null ? 1 : shape.opacity
        });
        return;
      }
      if (shape.t === 'qr') {
        var n = shape.matrix.count + 8;
        var m = shape.size / n;
        var qc = hexToRgb(shape.dark || '#111111');
        shape.matrix.runs.forEach(function (run) {
          pdfPage.drawRectangle({
            x: (shape.x + (run[1] + 4) * m) * MM2PT,
            y: (PAGE.h - (shape.y + (run[0] + 4) * m) - m) * MM2PT,
            width: run[2] * m * MM2PT,
            height: m * MM2PT,
            color: lib.rgb(qc.r, qc.g, qc.b)
          });
        });
      }
    });

    page.texts.forEach(function (item) {
      var font = fonts[item.kind] || fonts.body;
      var c = hexToRgb(item.color);
      pdfPage.drawText(pdfSafeText(item.text, font), {
        x: item.x * MM2PT,
        y: (PAGE.h - item.y) * MM2PT,
        size: item.size * MM2PT,
        font: font,
        color: lib.rgb(c.r, c.g, c.b),
        opacity: item.opacity == null ? 1 : item.opacity
      });
    });
  }

  async function buildPdf(model, styleId, kind, shareUrl) {
    var lib = window.PDFLib;
    if (!lib) { throw new Error('The PDF library did not load, so no download can be built.'); }
    var S = STYLES[styleId] || STYLES.minimal;
    var SF = lib.StandardFonts;
    var family = S.family === 'helv'
      ? [SF.Helvetica, SF.HelveticaBold, SF.HelveticaOblique]
      : [SF.TimesRoman, SF.TimesRomanBold, SF.TimesRomanItalic];

    var doc = await lib.PDFDocument.create();
    var fonts = {
      body: await doc.embedFont(family[0]),
      bold: await doc.embedFont(family[1]),
      italic: await doc.embedFont(family[2])
    };

    var mm = makeMetrics(fonts);
    var layout = kind === 'sheet' ? qrSheet(model, styleId, mm, shareUrl) : layoutPoster(model, styleId, mm);

    if (mm.unsupported.length) {
      throw new Error('The PDF font cannot draw these characters: ' +
        mm.unsupported.join(' ') + '. Replace them with plain letters, or download the PNG instead — it supports any script.');
    }

    layout.pages.forEach(function (page) {
      var pdfPage = doc.addPage([PAGE.w * MM2PT, PAGE.h * MM2PT]);
      drawPagePdf(pdfPage, fonts, page, lib);
    });

    doc.setTitle(model.settings.names ? model.settings.names + ' — seating plan' : 'Seating plan');
    doc.setSubject('A2 wedding seating plan');
    doc.setCreator('SeatStory');
    doc.setProducer('SeatStory');
    return await doc.save();
  }


  /* ------------------------------------------------------------- app views */

  var currentView = 'guests';
  var guestQuery = '';
  var planQuery = '';
  var selectedGuestId = null;
  var dragGuestId = null;
  var suppressClickUntil = 0;
  var exportState = { busy: false, seq: 0, timer: null };

  var VIEWS = ['guests', 'tables', 'plan', 'export'];

  function switchView(name) {
    if (VIEWS.indexOf(name) === -1) { name = 'guests'; }
    currentView = name;

    VIEWS.forEach(function (view) {
      var section = byId('view-' + view);
      if (section) { section.hidden = view !== name; }
    });

    Array.prototype.forEach.call(document.querySelectorAll('.tab'), function (tab) {
      var active = tab.getAttribute('data-view') === name;
      tab.classList.toggle('is-active', active);
      if (active) { tab.setAttribute('aria-current', 'page'); }
      else { tab.removeAttribute('aria-current'); }
    });

    if (name === 'guests') { renderGuests(); }
    if (name === 'tables') { renderTables(); }
    if (name === 'plan') { renderPlan(); }
    if (name === 'export') { renderExport(); schedulePreview(); }

    window.scrollTo(0, 0);
  }

  function summaryText() {
    var s = stats();
    if (!s.guests) { return 'No guests yet.'; }
    return s.guests + (s.guests === 1 ? ' guest' : ' guests') + ' · ' +
      s.seated + ' seated · ' + s.unseated + ' unseated';
  }

  function matchesQuery(guest, query) {
    if (!query) { return true; }
    var haystack = (guest.name + ' ' + guest.tags.join(' ') + ' ' + guest.note + ' ' + tableLabel(guest.tableId)).toLowerCase();
    return haystack.indexOf(query) !== -1;
  }

  function refreshCounts() {
    var s = stats();
    if (byId('guests-sub')) { byId('guests-sub').textContent = summaryText(); }
    if (byId('tables-sub')) {
      byId('tables-sub').textContent = s.tables
        ? (s.tables + (s.tables === 1 ? ' table' : ' tables') + ' · ' + s.capacity + ' seats · ' + s.unseated + ' unseated')
        : 'No tables yet.';
    }
    refreshAddGuestSelect();
  }

  function refreshAddGuestSelect() {
    var select = byId('guest-table');
    if (!select) { return; }
    var current = select.value;
    fillTableSelect(select, current);
  }

  function fillTableSelect(select, tableId) {
    clear(select);
    var none = el('option', null, 'Unseated');
    none.value = '';
    select.appendChild(none);
    state.tables.forEach(function (t) {
      var option = el('option', null, t.label);
      option.value = t.id;
      select.appendChild(option);
    });
    select.value = tableId || '';
  }

  /* ---------------------------------------------------------------- guests */

  function guestRow(guest) {
    var li = el('li', 'guest');
    li.dataset.id = guest.id;

    var main = el('div', 'guest__main');
    var name = document.createElement('input');
    name.type = 'text';
    name.className = 'input guest__name';
    name.value = guest.name;
    name.dataset.field = 'name';
    name.setAttribute('aria-label', 'Guest name');
    if (guest.tableId) { name.setAttribute('aria-description', 'Seated at ' + tableLabel(guest.tableId)); }
    main.appendChild(name);

    var del = el('button', 'icon-btn', '✕');
    del.type = 'button';
    del.dataset.act = 'delete';
    del.setAttribute('aria-label', 'Delete ' + guest.name);
    main.appendChild(del);
    li.appendChild(main);

    var meta = el('div', 'guest__meta');
    var select = document.createElement('select');
    select.className = 'input guest__table';
    select.dataset.field = 'table';
    select.setAttribute('aria-label', 'Table for ' + guest.name);
    fillTableSelect(select, guest.tableId);
    meta.appendChild(select);

    var tags = document.createElement('input');
    tags.type = 'text';
    tags.className = 'input guest__tags';
    tags.value = guest.tags.join('; ');
    tags.placeholder = 'tags: vegan; no-alcohol';
    tags.maxLength = 400;
    tags.dataset.field = 'tags';
    tags.setAttribute('aria-label', 'Tags for ' + guest.name);
    meta.appendChild(tags);
    li.appendChild(meta);

    var note = document.createElement('input');
    note.type = 'text';
    note.className = 'input guest__note';
    note.value = guest.note || '';
    note.placeholder = 'Note (allergies, plus-one, …)';
    note.maxLength = 200;
    note.dataset.field = 'note';
    note.setAttribute('aria-label', 'Note for ' + guest.name);
    li.appendChild(note);

    return li;
  }

  function renderGuests() {
    var list = byId('guest-list');
    if (!list) { return; }
    clear(list);

    var query = guestQuery.trim().toLowerCase();
    var shown = 0;
    state.guests.forEach(function (guest) {
      if (!matchesQuery(guest, query)) { return; }
      list.appendChild(guestRow(guest));
      shown += 1;
    });

    var empty = byId('guests-empty');
    if (state.guests.length === 0) {
      empty.hidden = false;
      empty.textContent = 'No guests yet. Add your first guest above, or import a CSV.';
    } else if (shown === 0) {
      empty.hidden = false;
      empty.textContent = 'No guests match “' + guestQuery.trim() + '”.';
    } else {
      empty.hidden = true;
    }

    refreshCounts();
  }

  function renderReport(report) {
    var box = byId('import-report');
    if (!box) { return; }
    clear(box);
    box.hidden = false;

    box.appendChild(el('p', 'report__line report__line--ok',
      'Imported ' + report.added + (report.added === 1 ? ' guest.' : ' guests.')));

    report.misses.forEach(function (miss) {
      box.appendChild(el('p', 'report__line',
        'Row ' + miss.line + ': table “' + miss.table + '” does not exist — that guest was left unseated.'));
    });

    report.errors.forEach(function (err) {
      box.appendChild(el('p', 'report__line report__line--error',
        (err.line ? 'Row ' + err.line + ': ' : '') + err.message));
    });

    if (!report.errors.length && !report.misses.length) {
      toast('Imported ' + report.added + (report.added === 1 ? ' guest.' : ' guests.'));
    }
  }

  function runImport(source) {
    var report = importCsv(source);
    renderReport(report);
    renderGuests();
    renderPlan();
    schedulePreview();
    if (report.added) { toast('Imported ' + report.added + (report.added === 1 ? ' guest.' : ' guests.')); }
  }

  function bindGuestView() {
    byId('form-guest').addEventListener('submit', function (event) {
      event.preventDefault();
      var nameInput = byId('guest-name');
      var name = nameInput.value.trim();
      if (!name) {
        toast('Enter a name before adding a guest.', true);
        nameInput.focus();
        return;
      }
      state.guests.push({
        id: uid('g'),
        name: txt(name, 120),
        tableId: byId('guest-table').value || null,
        tags: splitTags(byId('guest-tags').value),
        note: ''
      });
      save();
      nameInput.value = '';
      byId('guest-tags').value = '';
      byId('guest-table').value = '';
      renderGuests();
      renderPlan();
      schedulePreview();
      nameInput.focus();
    });

    byId('guest-search').addEventListener('input', function (event) {
      guestQuery = event.target.value;
      renderGuests();
    });

    var list = byId('guest-list');

    /* Save while the user types, not only on blur, so a refresh never loses
       the field that still has focus. The list is not re-rendered here, which
       keeps the caret where it is. */
    list.addEventListener('input', function (event) {
      var node = event.target;
      if (!node.dataset || !node.dataset.field) { return; }
      var row = node.closest('.guest');
      var guest = guestById(row ? row.dataset.id : '');
      if (!guest) { return; }

      if (node.dataset.field === 'name') {
        if (!node.value.trim()) { return; }      /* keep the old name until it is fixed */
        guest.name = txt(node.value.trim(), 120);
      } else if (node.dataset.field === 'tags') {
        guest.tags = splitTags(node.value);
      } else if (node.dataset.field === 'note') {
        guest.note = txt(node.value, 200);
      } else {
        return;
      }
      save();
      schedulePreview();
    });

    list.addEventListener('change', function (event) {
      var node = event.target;
      if (!node.dataset || !node.dataset.field) { return; }
      var row = node.closest('.guest');
      if (!row) { return; }
      var guest = guestById(row.dataset.id);
      if (!guest) { return; }

      if (node.dataset.field === 'name') {
        var name = node.value.trim();
        if (!name) {
          node.value = guest.name;
          toast('A guest needs a name.', true);
          return;
        }
        guest.name = txt(name, 120);
      } else if (node.dataset.field === 'tags') {
        guest.tags = splitTags(node.value);
        node.value = guest.tags.join('; ');
      } else if (node.dataset.field === 'note') {
        guest.note = txt(node.value, 200);
      } else if (node.dataset.field === 'table') {
        guest.tableId = node.value || null;
      }
      save();
      refreshCounts();
      renderPlan();
      schedulePreview();
    });

    list.addEventListener('click', function (event) {
      var button = event.target.closest('[data-act="delete"]');
      if (!button) { return; }
      var row = button.closest('.guest');
      var guest = guestById(row ? row.dataset.id : '');
      if (!guest) { return; }
      confirmDialog({
        title: 'Delete ' + guest.name + '?',
        text: 'This removes the guest from the list and from the seating plan.',
        confirm: 'Delete guest',
        danger: true
      }).then(function (ok) {
        if (!ok) { return; }
        state.guests = state.guests.filter(function (g) { return g.id !== guest.id; });
        save();
        renderGuests();
        renderPlan();
        schedulePreview();
      });
    });

    byId('btn-import').addEventListener('click', function () {
      runImport(byId('csv-text').value);
    });

    byId('csv-file').addEventListener('change', function (event) {
      var file = event.target.files && event.target.files[0];
      if (!file) { return; }
      var reader = new FileReader();
      reader.onload = function () {
        var value = String(reader.result || '');
        byId('csv-text').value = value;
        runImport(value);
        event.target.value = '';
      };
      reader.onerror = function () { toast('That file could not be read.', true); };
      reader.readAsText(file);
    });

    byId('btn-export-csv').addEventListener('click', function () {
      /* The plan asks for every download to be blocked while the preview is
         locked, so the CSV export follows the same rule as the poster files.
         Nothing is deleted — the plan stays in this browser. */
      if (!isUnlocked()) {
        toast('Downloads are locked — unlock SeatStory to export the guest list. Your plan stays saved here.', true);
        return;
      }
      var csv = buildCsv();
      downloadBlob(new Blob([csv], { type: 'text/csv;charset=utf-8' }), 'seatstory-guests.csv');
      toast('CSV exported.');
    });
  }

  /* ---------------------------------------------------------------- tables */

  function tableCard(table) {
    var guests = guestsAt(table.id);
    var over = guests.length > table.capacity;

    var li = el('li', 'table-card' + (over ? ' is-over' : ''));
    li.dataset.id = table.id;

    var head = el('div', 'table-card__head');
    var label = document.createElement('input');
    label.type = 'text';
    label.className = 'input table-card__label';
    label.value = table.label;
    label.dataset.field = 'label';
    label.setAttribute('aria-label', 'Table name');
    head.appendChild(label);

    var del = el('button', 'icon-btn', '✕');
    del.type = 'button';
    del.dataset.act = 'delete';
    del.setAttribute('aria-label', 'Delete ' + table.label);
    head.appendChild(del);
    li.appendChild(head);

    var row = el('div', 'table-card__row');

    var capField = el('label', 'field');
    capField.appendChild(el('span', 'field__label', 'Seats'));
    var capacity = document.createElement('input');
    capacity.type = 'number';
    capacity.min = '1';
    capacity.step = '1';
    capacity.className = 'input';
    capacity.value = String(table.capacity);
    capacity.dataset.field = 'capacity';
    capacity.setAttribute('inputmode', 'numeric');
    capacity.setAttribute('aria-label', 'Seats at ' + table.label);
    capField.appendChild(capacity);
    row.appendChild(capField);

    var shapeField = el('label', 'field');
    shapeField.appendChild(el('span', 'field__label', 'Shape'));
    var shape = document.createElement('select');
    shape.className = 'input';
    shape.dataset.field = 'shape';
    shape.setAttribute('aria-label', 'Shape of ' + table.label);
    [['round', 'Round'], ['long', 'Long']].forEach(function (pair) {
      var option = el('option', null, pair[1]);
      option.value = pair[0];
      shape.appendChild(option);
    });
    shape.value = table.shape;
    shapeField.appendChild(shape);
    row.appendChild(shapeField);

    li.appendChild(row);

    var meta = el('p', 'table-card__meta', over
      ? 'Over capacity by ' + (guests.length - table.capacity) + ' · ' + guests.length + ' seated'
      : guests.length + ' seated · ' + (table.capacity - guests.length) + ' free');
    li.appendChild(meta);

    return li;
  }

  function renderTables() {
    var list = byId('table-list');
    if (!list) { return; }
    clear(list);
    state.tables.forEach(function (table) {
      list.appendChild(tableCard(table));
    });
    if (byId('tables-empty')) { byId('tables-empty').hidden = state.tables.length > 0; }
    refreshCounts();
  }

  function bindTableView() {
    byId('form-table').addEventListener('submit', function (event) {
      event.preventDefault();
      var labelInput = byId('table-label');
      var label = labelInput.value.trim();
      if (!label) {
        toast('Give the table a name.', true);
        return;
      }
      var clash = state.tables.some(function (t) { return t.label.trim().toLowerCase() === label.toLowerCase(); });
      if (clash) {
        toast('A table called “' + label + '” already exists.', true);
        return;
      }
      var rawSeats = String(byId('table-capacity').value).trim();
      var seats = parseInt(rawSeats, 10);
      if (!/^\d+$/.test(rawSeats) || seats < 1) {
        toast('Seats must be a whole number of 1 or more.', true);
        byId('table-capacity').focus();
        return;
      }
      state.tables.push({
        id: uid('t'),
        label: txt(label, 60),
        capacity: Math.min(seats, 999),
        shape: byId('table-shape').value === 'long' ? 'long' : 'round'
      });
      save();
      labelInput.value = '';
      byId('table-capacity').value = '8';
      renderTables();
      renderGuests();
      renderPlan();
      schedulePreview();
    });

    var list = byId('table-list');

    /* Same as the guest list: persist on input, normalise on change. */
    list.addEventListener('input', function (event) {
      var node = event.target;
      if (!node.dataset || !node.dataset.field) { return; }
      var row = node.closest('.table-card');
      var table = tableById(row ? row.dataset.id : '');
      if (!table) { return; }

      if (node.dataset.field === 'label') {
        if (!node.value.trim()) { return; }
        table.label = txt(uniqueLabel(node.value, table.id), 60);
      } else if (node.dataset.field === 'capacity') {
        var live = String(node.value).trim();
        if (!/^\d+$/.test(live) || parseInt(live, 10) < 1) { return; }
        table.capacity = Math.min(parseInt(live, 10), 999);
      } else {
        return;
      }
      save();
      renderPlan();
      schedulePreview();
    });

    list.addEventListener('change', function (event) {
      var node = event.target;
      if (!node.dataset || !node.dataset.field) { return; }
      var row = node.closest('.table-card');
      var table = tableById(row ? row.dataset.id : '');
      if (!table) { return; }

      if (node.dataset.field === 'label') {
        var label = node.value.trim();
        if (!label) {
          node.value = table.label;
          toast('A table needs a name.', true);
          return;
        }
        table.label = txt(uniqueLabel(label, table.id), 60);
      } else if (node.dataset.field === 'capacity') {
        var raw = String(node.value).trim();
        var seats = parseInt(raw, 10);
        if (!/^\d+$/.test(raw) || seats < 1) {
          node.value = String(table.capacity);
          toast('Seats must be a whole number of 1 or more.', true);
          return;
        }
        table.capacity = Math.min(seats, 999);
        node.value = String(table.capacity);
      } else if (node.dataset.field === 'shape') {
        table.shape = node.value === 'long' ? 'long' : 'round';
      }

      save();
      renderTables();
      renderPlan();
      refreshCounts();
      schedulePreview();
    });

    list.addEventListener('click', function (event) {
      var button = event.target.closest('[data-act="delete"]');
      if (!button) { return; }
      var row = button.closest('.table-card');
      var table = tableById(row ? row.dataset.id : '');
      if (!table) { return; }
      var seated = guestsAt(table.id).length;
      confirmDialog({
        title: 'Delete ' + table.label + '?',
        text: seated
          ? seated + (seated === 1 ? ' guest is' : ' guests are') + ' seated here. They stay in the plan but become unseated.'
          : 'This table will be removed from the plan.',
        confirm: 'Delete table',
        danger: true
      }).then(function (ok) {
        if (!ok) { return; }
        state.guests.forEach(function (g) { if (g.tableId === table.id) { g.tableId = null; } });
        state.tables = state.tables.filter(function (t) { return t.id !== table.id; });
        selectedGuestId = null;
        save();
        renderTables();
        renderGuests();
        renderPlan();
        schedulePreview();
      });
    });
  }

  /* ------------------------------------------------------------------ plan */

  function guestChip(guest, withRemove) {
    var chip = el('div', 'chip' + (selectedGuestId === guest.id ? ' is-selected' : ''));
    chip.dataset.id = guest.id;
    chip.draggable = true;
    chip.tabIndex = 0;
    chip.setAttribute('role', 'button');
    chip.setAttribute('aria-pressed', selectedGuestId === guest.id ? 'true' : 'false');
    chip.setAttribute('aria-label', guest.name + (guest.tableId ? ', at ' + tableLabel(guest.tableId) : ', unseated'));
    chip.appendChild(el('span', 'chip__name', guest.name));

    if (withRemove) {
      var remove = el('button', 'chip__x', '✕');
      remove.type = 'button';
      remove.dataset.act = 'unseat';
      remove.setAttribute('aria-label', 'Remove ' + guest.name + ' from ' + tableLabel(guest.tableId));
      chip.appendChild(remove);
    }
    return chip;
  }

  function planTableCard(table) {
    var guests = guestsAt(table.id);
    var over = guests.length > table.capacity;
    var card = el('article', 'plan-table' +
      (over ? ' is-over' : '') +
      (selectedGuestId ? ' is-target' : ''));
    card.dataset.id = table.id;
    card.dataset.shape = table.shape;

    var head = el('div', 'plan-table__head');
    var shape = el('span', 'shape shape--' + table.shape);
    shape.appendChild(el('span', 'shape__count', guests.length + '/' + table.capacity));
    head.appendChild(shape);

    var title = el('div', 'plan-table__title');
    title.appendChild(el('span', 'plan-table__label', table.label));
    title.appendChild(el('span', 'plan-table__cap',
      table.capacity + (table.capacity === 1 ? ' seat' : ' seats') + ' · ' + table.shape));
    head.appendChild(title);
    card.appendChild(head);

    var chips = el('div', 'chip-list');
    var query = planQuery.trim().toLowerCase();
    guests.forEach(function (guest) {
      if (query && !matchesQuery(guest, query)) { return; }
      chips.appendChild(guestChip(guest, true));
    });
    if (!guests.length) {
      chips.appendChild(el('p', 'muted small', 'Empty — tap to seat the selected guest.'));
    }
    card.appendChild(chips);

    if (over) {
      card.appendChild(el('p', 'plan-table__warn',
        'Over capacity by ' + (guests.length - table.capacity) + '. Allowed, but check the list.'));
    }
    return card;
  }

  function renderPlan() {
    if (!byId('plan-tables')) { return; }
    var s = stats();

    byId('stat-seated').textContent = String(s.seated);
    byId('stat-unseated').textContent = String(s.unseated);
    byId('stat-seats').textContent = String(s.capacity);

    var freeNode = byId('stat-free');
    var freeLabel = byId('stat-free-label');
    if (s.free < 0) {
      freeNode.textContent = String(Math.abs(s.free));
      freeLabel.textContent = 'over capacity';
    } else {
      freeNode.textContent = String(s.free);
      freeLabel.textContent = 'free seats';
    }
    freeNode.parentNode.classList.toggle('is-over', s.free < 0);

    byId('plan-sub').textContent = s.guests
      ? (s.guests + (s.guests === 1 ? ' guest' : ' guests') + ' · ' + s.tables + (s.tables === 1 ? ' table' : ' tables'))
      : 'Add guests and tables first.';

    byId('unseated-count').textContent = String(s.unseated);

    var selected = selectedGuestId ? guestById(selectedGuestId) : null;
    byId('seat-bar').hidden = !selected;
    if (selected) {
      byId('seat-bar-text').textContent = selected.name + ' selected — tap a table to seat them.';
    }

    var unseatedList = byId('unseated-list');
    clear(unseatedList);
    var query = planQuery.trim().toLowerCase();
    var unseated = state.guests.filter(function (g) { return !g.tableId; });
    unseated.forEach(function (guest) {
      if (query && !matchesQuery(guest, query)) { return; }
      unseatedList.appendChild(guestChip(guest, false));
    });
    byId('unseated-empty').hidden = unseated.length > 0;

    var wrap = byId('plan-tables');
    clear(wrap);
    if (!state.tables.length) {
      wrap.appendChild(el('p', 'empty', 'No tables yet. Add tables in the Tables tab.'));
      return;
    }
    state.tables.forEach(function (table) {
      wrap.appendChild(planTableCard(table));
    });
  }

  function toggleSelect(guestId) {
    selectedGuestId = selectedGuestId === guestId ? null : guestId;
    renderPlan();
  }

  function setGuestTable(guestId, tableId) {
    var guest = guestById(guestId);
    if (!guest) { return; }
    var label = tableId ? tableLabel(tableId) : '';
    if (guest.tableId === tableId) {
      selectedGuestId = null;
      renderPlan();
      return;
    }
    guest.tableId = tableId;
    selectedGuestId = null;
    save();
    renderPlan();
    refreshCounts();
    schedulePreview();
    toast(label ? guest.name + ' → ' + label : guest.name + ' removed from their table.');
  }

  function bindPlanView() {
    var tablesNode = byId('plan-tables');
    var unseatedPanel = byId('unseated-panel');

    function handleClick(event) {
      if (Date.now() < suppressClickUntil) { return; }

      var remove = event.target.closest('[data-act="unseat"]');
      if (remove) {
        event.stopPropagation();
        var chip = remove.closest('.chip');
        if (chip) { setGuestTable(chip.dataset.id, null); }
        return;
      }

      var chipNode = event.target.closest('.chip');
      if (chipNode) {
        toggleSelect(chipNode.dataset.id);
        return;
      }

      var card = event.target.closest('.plan-table');
      if (card && selectedGuestId) {
        setGuestTable(selectedGuestId, card.dataset.id);
      }
    }

    tablesNode.addEventListener('click', handleClick);
    byId('unseated-list').addEventListener('click', handleClick);

    function handleKey(event) {
      if (event.key !== 'Enter' && event.key !== ' ') { return; }
      var chip = event.target.closest('.chip');
      if (!chip || event.target.closest('button')) { return; }
      event.preventDefault();
      toggleSelect(chip.dataset.id);
    }
    tablesNode.addEventListener('keydown', handleKey);
    byId('unseated-list').addEventListener('keydown', handleKey);

    byId('btn-cancel-select').addEventListener('click', function () {
      selectedGuestId = null;
      renderPlan();
    });

    byId('plan-search').addEventListener('input', function (event) {
      planQuery = event.target.value;
      renderPlan();
    });

    /* Drag and drop is a mouse convenience; taps work everywhere. */
    document.addEventListener('dragstart', function (event) {
      var chip = event.target.closest ? event.target.closest('.chip') : null;
      if (!chip) { return; }
      dragGuestId = chip.dataset.id;
      chip.classList.add('is-dragging');
      try {
        event.dataTransfer.setData('text/plain', dragGuestId);
        event.dataTransfer.effectAllowed = 'move';
      } catch (err) { /* some browsers refuse; the drop still reads dragGuestId */ }
    });

    document.addEventListener('dragend', function (event) {
      var chip = event.target.closest ? event.target.closest('.chip') : null;
      if (chip) { chip.classList.remove('is-dragging'); }
      dragGuestId = null;
      Array.prototype.forEach.call(document.querySelectorAll('.is-dragover, .is-drop-target'), function (node) {
        node.classList.remove('is-dragover');
        node.classList.remove('is-drop-target');
      });
    });

    tablesNode.addEventListener('dragover', function (event) {
      var card = event.target.closest('.plan-table');
      if (!card || !dragGuestId) { return; }
      event.preventDefault();
      if (event.dataTransfer) { event.dataTransfer.dropEffect = 'move'; }
      card.classList.add('is-dragover');
    });

    tablesNode.addEventListener('dragleave', function (event) {
      var card = event.target.closest('.plan-table');
      if (card) { card.classList.remove('is-dragover'); }
    });

    tablesNode.addEventListener('drop', function (event) {
      var card = event.target.closest('.plan-table');
      if (!card) { return; }
      event.preventDefault();
      card.classList.remove('is-dragover');
      var id = dragGuestId;
      if (!id && event.dataTransfer) {
        try { id = event.dataTransfer.getData('text/plain'); } catch (err) { id = ''; }
      }
      suppressClickUntil = Date.now() + 350;
      setGuestTable(id, card.dataset.id);
    });

    unseatedPanel.addEventListener('dragover', function (event) {
      if (!dragGuestId) { return; }
      event.preventDefault();
      if (event.dataTransfer) { event.dataTransfer.dropEffect = 'move'; }
      unseatedPanel.classList.add('is-drop-target');
    });

    unseatedPanel.addEventListener('dragleave', function (event) {
      if (event.target === unseatedPanel) { unseatedPanel.classList.remove('is-drop-target'); }
    });

    unseatedPanel.addEventListener('drop', function (event) {
      event.preventDefault();
      unseatedPanel.classList.remove('is-drop-target');
      var id = dragGuestId;
      if (!id && event.dataTransfer) {
        try { id = event.dataTransfer.getData('text/plain'); } catch (err) { id = ''; }
      }
      suppressClickUntil = Date.now() + 350;
      setGuestTable(id, null);
    });
  }

  /* ---------------------------------------------------------------- export */

  function shareTarget() {
    var hosted = location.protocol === 'http:' || location.protocol === 'https:';
    var saved = String(state.settings.shareBase || '').trim();
    var base = '';
    var source = 'none';
    var error = '';

    if (hosted) {
      var href = location.href.split('#')[0].split('?')[0];
      base = href.replace(/[^/]*$/, 'share.html');
      source = 'hosted';
    } else if (saved) {
      try {
        var url = new URL(saved);
        if (url.protocol !== 'http:' && url.protocol !== 'https:') { throw new Error('scheme'); }
        base = url.href.split('#')[0];
        source = 'saved';
      } catch (err) {
        error = 'The share page address must be a full web address, for example your-site.example/share.html.';
      }
    }

    return { url: base, source: source, error: error, hosted: hosted };
  }

  function shareLink(model, base) {
    return base + '#' + shareFragment(model);
  }

  function renderLock() {
    var unlocked = isUnlocked();
    var card = byId('lock-card');
    card.classList.toggle('is-unlocked', unlocked);
    byId('lock-title').textContent = unlocked ? 'Unlocked on this device' : 'Preview mode';
    byId('lock-text').textContent = unlocked
      ? 'Thank you — the PDF, the PNG and the find-your-seat sheet are all available. The purchase is remembered in this browser.'
      : 'Downloading is locked and the preview carries a watermark. Unlock once and this device keeps the purchase — no account needed.';
    byId('price-label').textContent = PRICE_LABEL;
    ['btn-pdf', 'btn-png', 'btn-qr-pdf'].forEach(function (id) {
      var button = byId(id);
      button.setAttribute('aria-disabled', unlocked ? 'false' : 'true');
      button.classList.toggle('is-locked', !unlocked);
    });
  }

  function renderShareBase() {
    var input = byId('ex-share-base');
    if (!input) { return; }
    var target = shareTarget();
    var hint = byId('share-base-hint');
    if (target.hosted) {
      input.value = target.url;
      input.readOnly = true;
      input.setAttribute('aria-readonly', 'true');
      hint.textContent = 'taken from this page';
    } else {
      input.readOnly = false;
      input.removeAttribute('aria-readonly');
      if (document.activeElement !== input) { input.value = state.settings.shareBase || ''; }
      hint.textContent = 'you opened the file directly, so type where share.html will live';
    }
  }

  function renderExport() {
    var st = state.settings;
    [['ex-title', 'title'], ['ex-names', 'names'], ['ex-date', 'date'], ['ex-venue', 'venue']].forEach(function (pair) {
      var node = byId(pair[0]);
      if (node && document.activeElement !== node) { node.value = st[pair[1]] || ''; }
    });

    Array.prototype.forEach.call(document.querySelectorAll('.style-card'), function (button) {
      var active = button.dataset.style === st.style;
      button.classList.toggle('is-active', active);
      button.setAttribute('aria-checked', active ? 'true' : 'false');
    });

    renderLock();
    renderShareBase();
  }

  function hideExportError() {
    var node = byId('export-error');
    if (node) { node.hidden = true; node.textContent = ''; }
  }

  function showExportError(message) {
    var node = byId('export-error');
    if (!node) { toast(message, true); return; }
    node.textContent = message;
    node.hidden = false;
  }

  function messageFor(err) {
    if (err && err.code === 'QR_TOO_LONG') {
      return 'This guest list is too long for one QR code — a QR holds about 2,900 characters, ' +
        'which is roughly 50 names with long names and 120 with short ones. Split the list, or ask your ' +
        'hosts for a page that hosts the list itself.';
    }
    return (err && err.message) ? err.message : 'Something went wrong while building the file.';
  }

  function appendPreviewPages(container, layout, label) {
    layout.pages.forEach(function (page) {
      var figure = el('figure', 'preview__page');
      figure.appendChild(renderPage(page, PREVIEW_PX, { watermark: !isUnlocked() }));
      figure.appendChild(el('figcaption', 'preview__cap',
        label + ' · page ' + page.index + ' of ' + layout.pages.length));
      container.appendChild(figure);
    });
  }

  function schedulePreview() {
    if (currentView !== 'export') { return; }
    clearTimeout(exportState.timer);
    exportState.timer = setTimeout(function () { refreshPreview(); }, 220);
  }

  async function refreshPreview() {
    var box = byId('preview');
    if (!box) { return; }
    var seq = ++exportState.seq;
    clear(box);
    box.appendChild(el('p', 'preview__note', 'Building the preview…'));

    try {
      var fonts = await fontsFor(state.settings.style);
      if (seq !== exportState.seq) { return; }
      clear(box);

      var mm = makeMetrics(fonts);
      var poster = layoutPoster(state, state.settings.style, mm);
      appendPreviewPages(box, poster, 'Poster');

      if (poster.unsupported.length) {
        box.appendChild(el('p', 'preview__note',
          'These characters are not in the PDF fonts: ' + poster.unsupported.join(' ') +
          '. The PNG will show them; for the PDF, replace them with plain letters.'));
      }

      var target = shareTarget();
      if (!target.url) {
        box.appendChild(el('p', 'preview__note', target.error ||
          'The find-your-seat sheet needs a hosted address for share.html before it can show a QR code.'));
      } else {
        try {
          var sheetMm = makeMetrics(fonts);
          var sheet = qrSheet(state, state.settings.style, sheetMm, shareLink(state, target.url));
          appendPreviewPages(box, sheet, 'Find your seat');
        } catch (sheetErr) {
          box.appendChild(el('p', 'preview__note', messageFor(sheetErr)));
        }
      }
    } catch (err) {
      if (seq !== exportState.seq) { return; }
      clear(box);
      box.appendChild(el('p', 'preview__note', 'The preview could not be built: ' + messageFor(err)));
    }
  }

  function blockIfLocked() {
    if (isUnlocked()) { return false; }
    toast('Downloads are locked — unlock SeatStory to export.', true);
    var card = byId('lock-card');
    if (card && card.scrollIntoView) { card.scrollIntoView({ behavior: 'smooth', block: 'center' }); }
    return true;
  }

  async function withBusy(button, task) {
    if (exportState.busy) { return; }
    exportState.busy = true;
    var original = button.textContent;
    button.textContent = 'Working…';
    button.setAttribute('aria-disabled', 'true');
    hideExportError();
    try {
      await task();
    } catch (err) {
      showExportError(messageFor(err));
    } finally {
      exportState.busy = false;
      button.textContent = original;
      button.removeAttribute('aria-disabled');
    }
  }

  function bindExportView() {
    byId('form-export').addEventListener('input', function (event) {
      var map = { 'ex-title': 'title', 'ex-names': 'names', 'ex-date': 'date', 'ex-venue': 'venue', 'ex-share-base': 'shareBase' };
      var key = map[event.target.id];
      if (!key) { return; }
      state.settings[key] = txt(event.target.value, key === 'shareBase' ? 500 : 80);
      save();
      if (key === 'shareBase') { schedulePreview(); }
      else { schedulePreview(); }
    });

    byId('style-picker').addEventListener('click', function (event) {
      var button = event.target.closest('.style-card');
      if (!button) { return; }
      state.settings.style = button.dataset.style;
      save();
      renderExport();
      refreshPreview();
    });

    byId('btn-unlock').addEventListener('click', function () {
      if (!PAYMENT_URL) {
        toast('No payment link is configured in assets/config.js yet.', true);
        return;
      }
      window.open(PAYMENT_URL, '_blank', 'noopener');
    });

    byId('btn-restore').addEventListener('click', function () {
      var input = byId('unlock-code');
      var error = byId('restore-error');
      var value = input.value.trim();
      if (!value) {
        error.textContent = 'Enter the unlock code from your receipt.';
        error.hidden = false;
        return;
      }
      if (UNLOCK_CODE && value.toUpperCase() === UNLOCK_CODE.toUpperCase()) {
        setUnlocked(true);
        input.value = '';
        error.hidden = true;
        renderLock();
        refreshPreview();
        toast('Purchase restored — downloads unlocked.');
      } else {
        error.textContent = 'That code is not right. Check your receipt, or unlock with the button above.';
        error.hidden = false;
      }
    });

    byId('btn-pdf').addEventListener('click', function () {
      var button = this;
      if (blockIfLocked()) { return; }
      withBusy(button, async function () {
        var bytes = await buildPdf(state, state.settings.style, 'poster', null);
        downloadBlob(new Blob([bytes], { type: 'application/pdf' }), 'seatstory-poster.pdf');
        toast('Poster PDF downloaded.');
      });
    });

    byId('btn-png').addEventListener('click', function () {
      var button = this;
      if (blockIfLocked()) { return; }
      withBusy(button, async function () {
        var fonts = await fontsFor(state.settings.style);
        var mm = makeMetrics(fonts);
        var layout = layoutPoster(state, state.settings.style, mm);
        for (var i = 0; i < layout.pages.length; i++) {
          var canvas = renderPage(layout.pages[i], PREVIEW_PX * 2, {});
          var filename = layout.pages.length > 1
            ? 'seatstory-poster-' + (i + 1) + '.png'
            : 'seatstory-poster.png';
          await new Promise(function (resolve) {
            canvas.toBlob(function (blob) {
              if (blob) { downloadBlob(blob, filename); }
              resolve();
            }, 'image/png');
          });
          await new Promise(function (resolve) { setTimeout(resolve, 180); });
        }
        toast(layout.pages.length > 1 ? 'Poster PNGs downloaded — one per page.' : 'Poster PNG downloaded.');
      });
    });

    byId('btn-qr-pdf').addEventListener('click', function () {
      var button = this;
      if (blockIfLocked()) { return; }
      withBusy(button, async function () {
        var target = shareTarget();
        if (!target.url) {
          throw new Error(target.error || 'Add the hosted address of share.html first — the QR code must point at a real page.');
        }
        var bytes = await buildPdf(state, state.settings.style, 'sheet', shareLink(state, target.url));
        downloadBlob(new Blob([bytes], { type: 'application/pdf' }), 'seatstory-find-your-seat.pdf');
        toast('Find-your-seat sheet downloaded.');
      });
    });
  }

  /* ------------------------------------------------------------- start over */

  function bindStartOver() {
    byId('btn-start-over').addEventListener('click', function () {
      confirmDialog({
        title: 'Start over?',
        text: 'This clears every guest, table and poster setting from this browser. Your purchase stays unlocked.',
        confirm: 'Start over',
        danger: true
      }).then(function (ok) {
        if (!ok) { return; }
        var unlocked = isUnlocked();
        state = defaultState();
        state.license.unlocked = unlocked;
        selectedGuestId = null;
        planQuery = '';
        guestQuery = '';
        byId('guest-search').value = '';
        byId('plan-search').value = '';
        save();
        renderGuests();
        renderTables();
        renderPlan();
        renderExport();
        switchView('guests');
        toast('Seating plan cleared.');
      });
    });
  }

  /* ------------------------------------------------------------- share page */

  function fold(value) {
    var text = String(value == null ? '' : value).toLowerCase();
    if (text.normalize) {
      text = text.normalize('NFD').replace(/[\u0300-\u036f]/g, '');
    }
    return text;
  }

  function initShare() {
    var errorNode = byId('share-error');
    var body = byId('share-body');
    var sub = byId('share-sub');
    var countNode = byId('share-count');
    var input = byId('share-query');
    var results = byId('share-results');
    var current = { guests: [] };

    function showMessage(message, subline) {
      errorNode.textContent = message;
      errorNode.hidden = false;
      body.hidden = true;
      sub.textContent = subline;
      clear(results);
    }

    function renderResults() {
      clear(results);
      var raw = input.value.trim();
      if (!raw) { return; }
      var query = fold(raw);
      var matches = current.guests.filter(function (g) {
        return fold(g.name).indexOf(query) !== -1;
      });

      if (!matches.length) {
        results.appendChild(el('p', 'banner banner--error',
          'No guest found for “' + raw + '”. Try part of your name, or ask your hosts.'));
        return;
      }

      if (matches.length > 6) {
        results.appendChild(el('p', 'muted small',
          matches.length + ' matches — keep typing to narrow it down.'));
      }

      matches.forEach(function (g) {
        var card = el('div', 'match' + (g.table ? '' : ' match--blank'));
        card.appendChild(el('p', 'match__name', g.name));
        card.appendChild(el('p', 'match__table', g.table || 'Not seated yet'));
        if (!g.table) {
          card.appendChild(el('p', 'match__note', 'Your hosts have not assigned a table to this name yet.'));
        }
        results.appendChild(card);
      });
    }

    function load() {
      errorNode.hidden = true;
      errorNode.textContent = '';
      body.hidden = false;
      sub.textContent = 'Type your name to see your table.';
      countNode.textContent = '';

      var parsed = parseShareHash(location.hash);
      if (!parsed.ok) {
        current = { guests: [] };
        showMessage(parsed.code === 'EMPTY'
          ? 'This page needs the link from your invitation — it carries the guest list. Open the link you were sent, or scan the QR code on the seating poster.'
          : 'This link looks incomplete or damaged. Scan the QR code again, or ask your hosts for a fresh link.',
          'The guest list could not be read.');
        return;
      }

      current = parsed;
      countNode.textContent = parsed.guests.length +
        (parsed.guests.length === 1 ? ' name on this list.' : ' names on this list.');
      renderResults();
    }

    input.addEventListener('input', renderResults);
    window.addEventListener('hashchange', load);
    window.addEventListener('load', load);
    load();
  }

  /* ------------------------------------------------------------------ boot */

  function handlePaidParam() {
    var params;
    try {
      params = new URL(location.href).searchParams;
    } catch (err) {
      return;
    }
    if (params.get('paid') !== '1') { return; }

    if (!isUnlocked()) { setUnlocked(true); }
    try {
      var clean = new URL(location.href);
      clean.searchParams.delete('paid');
      history.replaceState(null, '', clean.href);
    } catch (err) { /* file:// may refuse; the stored flag already did its job */ }
    toast('Purchase confirmed — downloads unlocked.');
  }

  function boot() {
    state = loadState();
    handlePaidParam();

    bindGuestView();
    bindTableView();
    bindPlanView();
    bindExportView();
    bindStartOver();

    Array.prototype.forEach.call(document.querySelectorAll('.tab'), function (tab) {
      tab.addEventListener('click', function () { switchView(tab.getAttribute('data-view')); });
    });

    renderGuests();
    renderTables();
    renderPlan();
    renderExport();
    switchView('guests');

    if (storageBroken) {
      toast('Local storage is blocked in this browser, so nothing will be saved.', true);
    }
  }

  /* Small surface for debugging and manual checks in the console. */
  window.SeatStory = {
    get state() { return state; },
    stats: stats,
    setUnlocked: setUnlocked,
    layout: layoutPoster,
    layoutSheet: qrSheet,
    csv: { build: buildCsv, parse: parseCsv, import: importCsv },
    buildPdf: buildPdf,
    layoutFor: async function (styleId, kind, url) {
      var fonts = await fontsFor(styleId);
      var mm = makeMetrics(fonts);
      var result = kind === 'sheet' ? qrSheet(state, styleId, mm, url) : layoutPoster(state, styleId, mm);
      return { pages: result.pages, unsupported: result.unsupported };
    },
    shareTarget: shareTarget,
    shareLink: shareLink,
    previewWidth: PREVIEW_PX
  };

  if (document.body && document.body.getAttribute('data-page') === 'share') {
    initShare();
  } else {
    boot();
  }
})();
