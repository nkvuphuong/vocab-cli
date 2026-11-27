/**
 * vocab-cli — Google Apps Script endpoint.
 *
 * Setup: see docs/setup.md (Sheet must stay "Restricted"; this script runs as you).
 * Required Script Property: TOKEN  (random, 32+ bytes)
 * Deploy: Execute as "Me", Who has access "Anyone" — the token is the only gate.
 */

const SHEET_NAME = 'terms';
const INBOX_NAME = 'inbox';
const SHUFFLE_NAME = 'Shuffle';
const RECHECK_NAME = 'Recheck';

// Canonical order: what a human reads daily sits left, machine-only columns sit right.
// The live header row is the source of truth for position; this list is the field set,
// the bootstrap order for a fresh sheet, and the target of `reorder`.
const HEADERS = [
  'term', 'meaning_short', 'status', 'status_vi', 'ipa', 'meaning_vi', 'meaning_en',
  'type', 'pos', 'cefr', 'domain', 'example', 'example_type', 'context_note',
  'source_url', 'source_title', 'source_type', 'lookup_count', 'last_seen_at',
  'created_at', 'updated_at', 'key', 'id',
];

const OPS = ['ping', 'check', 'keys', 'append', 'append_many', 'update', 'delete', 'list', 'read',
  'draw', 'recheck', 'clear_inbox', 'reorder'];
const READ_ONLY_OPS = ['ping', 'check', 'keys', 'list', 'read'];
const WRITABLE = [
  'term', 'type', 'cefr', 'pos', 'domain', 'ipa', 'meaning_short', 'meaning_vi',
  'meaning_en', 'example', 'example_type', 'context_note', 'source_type',
  'source_url', 'source_title', 'status', 'status_vi',
];

// shortcut: CacheService caps TTL at 6h, so the daily cap resets every ~6h.
// Upgrade to a counter row in the sheet only if abuse becomes real.
const DAILY_WRITE_CAP = 1000;

// Max rows per append_many call; the CLI chunks larger imports.
const MAX_BATCH = 50;

// Default / max terms written by `draw` (same 10 the old RANDARRAY formula showed).
const DRAW_DEFAULT = 10;
const DRAW_MAX = 50;

function doPost(e) {
  try {
    const body = JSON.parse((e && e.postData && e.postData.contents) || '{}');
    if (!checkToken(body.token)) return json({ ok: false, error: 'unauthorized' });

    const op = String(body.op || '');
    if (OPS.indexOf(op) < 0) return json({ ok: false, error: 'unknown_op', op: op });
    if (READ_ONLY_OPS.indexOf(op) < 0 && !takeWriteSlot(op === 'append_many' ? (body.items || []).length : 1)) {
      return json({ ok: false, error: 'daily_cap_reached' });
    }

    const lock = LockService.getScriptLock();
    lock.waitLock(20000);
    try {
      return json(dispatch(op, body));
    } finally {
      lock.releaseLock();
    }
  } catch (err) {
    return json({ ok: false, error: 'exception', detail: String((err && err.message) || err) });
  }
}

function doGet() {
  return json({ ok: true, note: 'POST JSON to this URL. See vocab-cli README.' });
}

function dispatch(op, body) {
  if (op === 'ping') {
    const sheet = getSheet();
    return { ok: true, op: op, sheet: SHEET_NAME, rows: Math.max(0, sheet.getLastRow() - 1) };
  }
  if (op === 'check') {
    if (body.prompt !== undefined) return checkPrompt(body.prompt);
    const key = normalizeKey(body.term || body.key || '');
    const found = findRow(key);
    return { ok: true, op: op, key: key, exists: !!found, row: found ? found.row : null };
  }
  if (op === 'keys') return listKeys();
  if (op === 'append') return appendRow(body.row || {});
  if (op === 'append_many') return appendMany(body);
  if (op === 'update') return updateRow(body);
  if (op === 'delete') return deleteRow(body);
  if (op === 'list') return listRows(body);
  if (op === 'read') return readTab(body);
  if (op === 'draw') return draw(body);
  if (op === 'recheck') return recheck(body);
  if (op === 'clear_inbox') return clearInbox(body);
  if (op === 'reorder') return reorder(body);
  return { ok: false, error: 'unknown_op' };
}

// Reverse lookup for the vi→en direction: the prompt is a `meaning_short` variant,
// the answer is `term`. Read-only, no writes.
function checkPrompt(prompt) {
  const key = normalizeKey(prompt);
  if (!key) return { ok: false, error: 'missing_prompt' };

  const matches = [];
  readAll(getSheet()).forEach(function (x) {
    const gloss = String(x.row.meaning_short || '');
    const variants = gloss.split('·');
    variants.push(gloss);
    for (let i = 0; i < variants.length; i++) {
      if (normalizeKey(variants[i]) === key) { matches.push(pick(x.row)); return; }
    }
  });
  if (!matches.length) return { ok: false, error: 'not_found', prompt: prompt };
  return { ok: true, op: 'check', prompt: prompt, count: matches.length, matches: matches };
}

// Raw cell values of any tab, so the grading skill can read the prompts, the
// direction markers and the answers typed into Shuffle/Recheck column C. Read-only,
// no writes, no range parsing.
function readTab(body) {
  const name = String(body.sheet || SHEET_NAME);
  const sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(name);
  if (!sheet) return { ok: false, error: 'sheet_not_found', sheet: name };
  return { ok: true, op: 'read', sheet: name, rows: sheet.getDataRange().getValues() };
}

// ---------------------------------------------------------------- sheet access

function getSheet() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  let sheet = ss.getSheetByName(SHEET_NAME);
  if (!sheet) sheet = ss.insertSheet(SHEET_NAME);
  if (sheet.getLastRow() === 0) {
    sheet.appendRow(HEADERS);
    sheet.setFrozenRows(1);
    applyColumnFormats(sheet);
  }
  return sheet;
}

function readAll(sheet) {
  const values = sheet.getDataRange().getValues();
  if (values.length < 2) return [];
  const headers = values[0].map(String);
  const out = [];
  for (let i = 1; i < values.length; i++) {
    const obj = {};
    for (let c = 0; c < headers.length; c++) obj[headers[c]] = values[i][c];
    out.push({ rowIndex: i + 1, row: obj });
  }
  return out;
}

function findRow(key) {
  if (!key) return null;
  const rows = readAll(getSheet());
  for (let i = 0; i < rows.length; i++) {
    if (String(rows[i].row.key) === key) return rows[i];
  }
  return null;
}

function setCell(sheet, rowIndex, headerName, value) {
  const col = headerNames(sheet).indexOf(headerName);
  if (col < 0) return false;
  sheet.getRange(rowIndex, col + 1).setValue(value);
  return true;
}

function headerNames(sheet) {
  return sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0].map(String);
}

// Header names outside HEADERS that hold data. Read-only: a stray empty column is
// harmless, a stray column with content is not ours to move or drop.
function unknownColumns(sheet, names) {
  const extra = [];
  names.forEach(function (n, i) { if (n && HEADERS.indexOf(n) < 0) extra.push(i); });
  const rows = Math.max(sheet.getLastRow() - 1, 0);
  if (!extra.length || !rows) return [];
  const values = sheet.getRange(2, 1, rows, names.length).getValues();
  return extra.filter(function (c) {
    return values.some(function (line) { return String(line[c] === undefined ? '' : line[c]).trim() !== ''; });
  }).map(function (c) { return names[c]; });
}

// Gate for every write op: a layout we do not recognise means a write could land in
// the wrong column. `allowMissing` is for `reorder`, which adds absent fields itself.
function assertColumns(sheet, allowMissing) {
  const names = headerNames(sheet);
  const seen = {};
  for (let i = 0; i < names.length; i++) {
    if (!names[i]) continue;
    if (seen[names[i]] !== undefined) return { ok: false, error: 'duplicate_header', header: names[i] };
    seen[names[i]] = i;
  }
  if (!allowMissing) {
    const missing = HEADERS.filter(function (h) { return names.indexOf(h) < 0; });
    if (missing.length) {
      return { ok: false, error: 'missing_header', header: missing[0], headers: missing };
    }
  }
  const unknown = unknownColumns(sheet, names);
  if (unknown.length) return { ok: false, error: 'unknown_header', headers: unknown };
  return null;
}

function applyColumnFormats(sheet) {
  const names = headerNames(sheet);
  const rows = Math.max(sheet.getMaxRows() - 1, 0);
  if (!rows) return;
  const column = function (h) { return names.indexOf(h) + 1; };
  ['status', 'status_vi'].forEach(function (h) {
    const c = column(h);
    if (!c) return;
    const range = sheet.getRange(2, c, rows, 1);
    range.clearDataValidations();
    range.setDataValidation(SpreadsheetApp.newDataValidation()
      .requireValueInList(['new', 'learning', 'known'], true)
      .setAllowInvalid(false)
      .build());
  });
  ['last_seen_at', 'created_at', 'updated_at'].forEach(function (h) {
    const c = column(h);
    if (c) sheet.getRange(2, c, rows, 1).setNumberFormat('yyyy-mm-dd hh:mm');
  });
}

// Re-runnable migration: align the header row to HEADERS, keeping every value under its
// own header name. Values only — never `new Date()` — so the review schedule survives.
function reorder(body) {
  const sheet = getSheet();
  const names = headerNames(sheet);
  const added = HEADERS.filter(function (h) { return names.indexOf(h) < 0; });
  const unknown = unknownColumns(sheet, names);

  if (body.dry_run === true) {
    return {
      ok: true, op: 'reorder', dry_run: true, moved: 0,
      current: names.filter(function (n) { return n; }),
      target: HEADERS.slice(), added: added, unknown: unknown,
    };
  }
  if (body.confirm !== true) return { ok: false, error: 'confirm_required' };

  const problem = assertColumns(sheet, true);
  if (problem) return problem;

  const lastRow = sheet.getLastRow();
  const formulas = sheet.getRange(1, 1, Math.max(lastRow, 1), Math.max(names.length, 1)).getFormulas();
  const hasFormula = formulas.some(function (line) {
    return line.some(function (f) { return String(f || '').trim() !== ''; });
  });
  if (hasFormula) return { ok: false, error: 'formula_in_terms' };

  let moved = 0;
  for (let i = 0; i < HEADERS.length; i++) if (names[i] !== HEADERS[i]) moved++;
  if (!moved && names.length === HEADERS.length) {
    applyColumnFormats(sheet);
    return { ok: true, op: 'reorder', dry_run: false, moved: 0, added: added };
  }

  const index = {};
  names.forEach(function (n, i) { if (n) index[n] = i; });
  const width = Math.max(names.length, HEADERS.length);
  const values = lastRow
    ? sheet.getRange(1, 1, lastRow, width).getValues()
    : [HEADERS.slice()];
  const matrix = values.map(function (line) {
    return HEADERS.map(function (h) { return index[h] === undefined ? '' : line[index[h]]; });
  });
  matrix[0] = HEADERS.slice();  // a column being added has no header cell to copy

  sheet.getRange(1, 1, matrix.length, HEADERS.length).setValues(matrix);
  if (width > HEADERS.length) {
    sheet.getRange(1, HEADERS.length + 1, matrix.length, width - HEADERS.length).clearContent();
  }
  applyColumnFormats(sheet);
  return { ok: true, op: 'reorder', dry_run: false, moved: moved, added: added };
}

// ------------------------------------------------------------------- operations

function appendRow(input) {
  const term = String(input.term || '').trim();
  if (!term) return { ok: false, error: 'missing_term' };
  if (!String(input.meaning_vi || '').trim()) return { ok: false, error: 'missing_meaning_vi' };

  const key = normalizeKey(term);
  const sheet = getSheet();
  const problem = assertColumns(sheet);
  if (problem) return problem;
  const existing = findRow(key);

  if (existing) {
    const r = existing.rowIndex;
    const count = Number(existing.row.lookup_count || 0) + 1;
    const now = new Date();
    setCell(sheet, r, 'lookup_count', count);
    setCell(sheet, r, 'last_seen_at', now);
    setCell(sheet, r, 'updated_at', now);
    const merged = {};
    HEADERS.forEach(function (h) { merged[h] = existing.row[h] === undefined ? '' : existing.row[h]; });
    merged.lookup_count = count;
    merged.last_seen_at = now;
    merged.updated_at = now;
    return {
      ok: true, op: 'append', created: false, duplicate: true,
      id: existing.row.id, row: pick(merged),
    };
  }

  const now = new Date();
  const rec = newRecord(input, now);
  sheet.appendRow(headerNames(sheet).map(function (h) { return rec[h] === undefined ? '' : rec[h]; }));
  return { ok: true, op: 'append', created: true, duplicate: false, id: rec.id, row: pick(rec) };
}

function newRecord(input, now) {
  const term = String(input.term || '').trim();
  const rec = {
    id: Utilities.getUuid(), key: normalizeKey(term), term: term,
    status: 'new', status_vi: 'new', lookup_count: 1,
    created_at: now, updated_at: now, last_seen_at: now,
  };
  WRITABLE.forEach(function (f) {
    if (input[f] !== undefined && input[f] !== '') rec[f] = input[f];
  });
  rec.status = String(rec.status || 'new');
  rec.example_type = String(rec.example_type || 'generated');
  return rec;
}

// Batch path: one lock, one read, one setValues() for all new rows.
function appendMany(body) {
  const items = body.items;
  if (!Array.isArray(items) || !items.length) return { ok: false, error: 'missing_items' };
  if (items.length > MAX_BATCH) return { ok: false, error: 'too_many_items', max: MAX_BATCH };

  const sheet = getSheet();
  const problem = assertColumns(sheet);
  if (problem) return problem;
  const names = headerNames(sheet);
  const index = {};
  readAll(sheet).forEach(function (x) { index[String(x.row.key)] = x; });

  const matrix = [];
  const created = [];
  const duplicates = [];
  const errors = [];
  const now = new Date();

  items.forEach(function (input) {
    const term = String((input && input.term) || '').trim();
    if (!term) return errors.push({ term: '', error: 'missing_term' });
    if (!String(input.meaning_vi || '').trim()) return errors.push({ term: term, error: 'missing_meaning_vi' });

    const key = normalizeKey(term);
    const hit = index[key];
    if (hit) {
      const count = Number(hit.row.lookup_count || 0) + 1;
      if (hit.rowIndex > 0) {
        setCell(sheet, hit.rowIndex, 'lookup_count', count);
        setCell(sheet, hit.rowIndex, 'last_seen_at', now);
        setCell(sheet, hit.rowIndex, 'updated_at', now);
      }
      hit.row.lookup_count = count;
      return duplicates.push({
        key: key, term: hit.row.term, lookup_count: count,
        meaning_vi: hit.row.meaning_vi,
      });
    }

    const rec = newRecord(input, now);
    index[key] = { rowIndex: -1, row: rec };  // catches repeats inside the same batch
    matrix.push(names.map(function (h) { return rec[h] === undefined ? '' : rec[h]; }));
    created.push({ key: key, term: term, id: rec.id, meaning_vi: rec.meaning_vi });
  });

  if (matrix.length) {
    sheet.getRange(sheet.getLastRow() + 1, 1, matrix.length, names.length).setValues(matrix);
  }
  return { ok: true, op: 'append_many', created: created, duplicates: duplicates, errors: errors };
}

function listKeys() {
  const rows = readAll(getSheet());
  return { ok: true, op: 'keys', count: rows.length, keys: rows.map(function (x) { return String(x.row.key); }) };
}

function updateRow(body) {
  const key = normalizeKey(body.key || body.term || '');
  const patch = body.patch || {};
  if (!key) return { ok: false, error: 'missing_key' };
  if (!body.patch) return { ok: false, error: 'missing_patch' };

  const found = findRow(key);
  if (!found) return { ok: false, error: 'not_found', key: key };

  const sheet = getSheet();
  const problem = assertColumns(sheet);
  if (problem) return problem;

  let touched = 0;
  WRITABLE.forEach(function (f) {
    if (patch[f] === undefined) return;
    setCell(sheet, found.rowIndex, f, patch[f]);
    touched++;
  });
  if (!touched) return { ok: false, error: 'empty_patch' };
  setCell(sheet, found.rowIndex, 'updated_at', new Date());

  const updated = {};
  HEADERS.forEach(function (h) { updated[h] = found.row[h]; });
  WRITABLE.forEach(function (f) { if (patch[f] !== undefined) updated[f] = patch[f]; });
  return { ok: true, op: 'update', key: key, id: found.row.id, row: pick(updated) };
}

// Destructive: the sheet has no undo, so the caller must pass confirm:true and the
// deleted row comes back in the response for a manual restore.
function deleteRow(body) {
  const key = normalizeKey(body.key || body.term || '');
  if (!key) return { ok: false, error: 'missing_key' };
  if (body.confirm !== true) return { ok: false, error: 'confirm_required' };

  const sheet = getSheet();
  const problem = assertColumns(sheet);
  if (problem) return problem;
  const found = findRow(key);
  if (!found) return { ok: false, error: 'not_found', key: key };

  sheet.deleteRow(found.rowIndex);
  return {
    ok: true, op: 'delete', key: key, term: found.row.term, id: found.row.id,
    row: pick(found.row),
  };
}

// ---------------------------------------------------------------- review cards

// Shuffle and Recheck share one card layout: A = prompt, B = direction marker,
// C = the answer the user types. Values are plain (no formulas) so typing an answer
// or a `mark` never moves the prompts. Only `draw` and `recheck` write outside
// `terms`, each into one hard-coded tab.
const DUE_DAYS = { learning: 3, known: 30 };

function cardLimit(body) {
  let want = parseInt(body.count, 10);
  if (isNaN(want)) want = DRAW_DEFAULT;
  return Math.min(Math.max(want, 1), DRAW_MAX);
}

function shuffleCards(cards) {
  const out = cards.slice();
  for (let i = out.length - 1; i > 0; i--) {  // Fisher-Yates, uniform
    const j = Math.floor(Math.random() * (i + 1));
    const swap = out[i]; out[i] = out[j]; out[j] = swap;
  }
  return out;
}

// One candidate per term per direction. The vi→en prompt is `meaning_short`, deduped
// so two terms sharing a gloss can never produce an ambiguous card.
// `due` false = the Shuffle pool (not learned yet), true = the Recheck pool (age).
// shortcut: both directions read the shared `updated_at`, so marking one direction
// postpones the other. Add updated_at_vi only if the vi pool starves.
function cardPools(due) {
  const now = new Date();
  const seenPrompt = {};
  const out = { en: [], vi: [] };

  readAll(getSheet()).forEach(function (x) {
    const term = String(x.row.term || '').trim();
    if (!term) return;
    const gloss = String(x.row.meaning_short || '').trim();
    const atMs = new Date(x.row.updated_at).getTime();

    const ready = function (status) {
      const days = DUE_DAYS[status] || 0;
      if (!due) return status !== 'known';
      if (!days || isNaN(atMs)) return false;
      return (now.getTime() - atMs) / 86400000 >= days;
    };

    const key = String(x.row.key || '');
    if (ready(String(x.row.status || 'new'))) {
      out.en.push({ key: key, prompt: term, direction: 'en-vi' });
    }
    const promptKey = normalizeKey(gloss);
    if (gloss && !seenPrompt[promptKey] && ready(String(x.row.status_vi || 'new'))) {
      seenPrompt[promptKey] = true;
      out.vi.push({ key: key, prompt: gloss, direction: 'vi-en' });
    }
  });
  return out;
}

// `oncePerTerm` = true for draw (one card per term), false for recheck (both
// directions of a due term are separate reviews and both must appear).
function pickCards(body, pools, oncePerTerm) {
  const limit = cardLimit(body);
  const direction = String(body.direction || 'en');
  if (direction === 'vi') return shuffleCards(pools.vi).slice(0, limit);
  if (direction !== 'mixed') return shuffleCards(pools.en).slice(0, limit);

  const half = Math.ceil(limit / 2);
  const out = [];
  const seen = {};
  // draw dedupes by term (one card per term); recheck dedupes per term+direction,
  // so a term due in both directions yields two cards.
  const stamp = function (card) {
    return oncePerTerm ? card.key : card.key + '|' + card.direction;
  };
  const take = function (pool, n) {
    n = Math.min(n, limit - out.length);
    for (let i = 0; i < pool.length && n > 0; i++) {
      const id = stamp(pool[i]);
      if (seen[id]) continue;
      seen[id] = true;
      out.push(pool[i]);
      n--;
    }
  };
  const en = shuffleCards(pools.en);
  const vi = shuffleCards(pools.vi);
  take(en, half);
  take(vi, half);
  take(en, limit - out.length);  // one pool short: fill from the other
  take(vi, limit - out.length);
  return shuffleCards(out);
}

function writeCards(sheet, op, cards) {
  if (!cards.length) return { ok: false, error: 'no_candidates' };
  sheet.getRange('A:C').clearContent();
  sheet.getRange(1, 1, cards.length, 2)
    .setValues(cards.map(function (c) { return [c.prompt, c.direction]; }));
  return {
    ok: true, op: op, sheet: sheet.getName(), count: cards.length,
    items: cards.map(function (c) { return { prompt: c.prompt, direction: c.direction }; }),
  };
}

// Destructive: overwrites A:C of Shuffle (prompts, markers and old answers).
function draw(body) {
  const sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(SHUFFLE_NAME);
  if (!sheet) return { ok: false, error: 'sheet_not_found', sheet: SHUFFLE_NAME };
  return writeCards(sheet, 'draw', pickCards(body, cardPools(false), true));
}

// Destructive: overwrites A:C of Recheck. Replaces the old live formula, which had
// to reflow on every `mark` and dragged the answers out of line.
function recheck(body) {
  const sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(RECHECK_NAME);
  if (!sheet) return { ok: false, error: 'sheet_not_found', sheet: RECHECK_NAME };
  return writeCards(sheet, 'recheck', pickCards(body, cardPools(true), false));
}

// Destructive but narrow: only the `inbox` tab, and only rows whose term is already
// saved in `terms` — the word is safe before its inbox row disappears. Deleting the
// wrong tab would wipe the user's own typing, so the tab name is hard-coded.
function clearInbox(body) {
  if (body.confirm !== true) return { ok: false, error: 'confirm_required' };
  const terms = (body.terms || []).map(function (t) { return String(t || '').trim(); })
    .filter(function (t) { return t; });
  if (!terms.length) return { ok: false, error: 'missing_terms' };

  const inbox = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(INBOX_NAME);
  if (!inbox) return { ok: false, error: 'sheet_not_found', sheet: INBOX_NAME };

  const saved = {};
  readAll(getSheet()).forEach(function (x) { saved[String(x.row.key)] = true; });

  const wanted = {};
  const skipped = [];
  terms.forEach(function (t) {
    const key = normalizeKey(t);
    if (!saved[key]) return skipped.push(t);
    wanted[key] = t;
  });
  if (!Object.keys(wanted).length) {
    return { ok: true, op: 'clear_inbox', removed: 0, skipped: skipped };
  }

  const values = inbox.getDataRange().getValues();
  const hits = [];
  for (let i = 0; i < values.length; i++) {
    for (let c = 0; c < 2; c++) {
      const key = normalizeKey(String(values[i][c] === undefined ? '' : values[i][c]));
      if (key && wanted[key] !== undefined) { hits.push(i + 1); break; }
    }
  }
  hits.sort(function (a, b) { return b - a; })
    .forEach(function (rowIndex) { inbox.deleteRow(rowIndex); });

  return { ok: true, op: 'clear_inbox', sheet: INBOX_NAME, removed: hits.length, skipped: skipped };
}

function listRows(body) {
  const status = String(body.status || '');
  const domain = String(body.domain || '').toLowerCase();
  const limit = Math.min(Math.max(Number(body.limit || 20), 1), 200);

  const rows = readAll(getSheet())
    .filter(function (x) {
      if (status && String(x.row.status) !== status) return false;
      if (domain && String(x.row.domain).toLowerCase().indexOf(domain) < 0) return false;
      return true;
    })
    .sort(function (a, b) {
      return (new Date(b.row.last_seen_at) - new Date(a.row.last_seen_at)) || 0;
    })
    .slice(0, limit)
    .map(function (x) { return pick(x.row); });

  return { ok: true, op: 'list', count: rows.length, rows: rows };
}

function pick(row) {
  const out = {};
  HEADERS.forEach(function (h) { out[h] = row[h] === undefined ? '' : row[h]; });
  return out;
}

// ----------------------------------------------------------------------- guards

function checkToken(given) {
  const expected = PropertiesService.getScriptProperties().getProperty('TOKEN');
  if (!expected) return false;
  return timingSafeEqual(String(given || ''), expected);
}

function timingSafeEqual(a, b) {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

function takeWriteSlot(cost) {
  const cache = CacheService.getScriptCache();
  const k = 'w_' + Utilities.formatDate(new Date(), 'UTC', 'yyyyMMdd');
  const n = Number(cache.get(k) || 0);
  const c = Math.max(1, Number(cost) || 1);
  if (n + c > DAILY_WRITE_CAP) return false;
  cache.put(k, String(n + c), 21600);
  return true;
}

// ---------------------------------------------------------------------- helpers

function normalizeKey(s) {
  return String(s || '')
    .normalize('NFKC')
    .replace(/[\u2018\u2019\u201B]/g, "'")
    .replace(/[\u201C\u201D]/g, '"')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase()
    .replace(/^[.,;:!?()[\]{}"']+/, '')
    .replace(/[.,;:!?()[\]{}"']+$/, '');
}

function json(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}

// Run this once in the Apps Script editor (Run > selftest) to verify pure logic.
function selftest() {
  const cases = [
    ['Pull   Request.', 'pull request'],
    [' drift ', 'drift'],
    ['\u201cfloor\u201d', 'floor'],
    ['Set a floor?', 'set a floor'],
    ['', ''],
  ];
  cases.forEach(function (c) {
    const got = normalizeKey(c[0]);
    if (got !== c[1]) throw new Error('normalizeKey(' + c[0] + ') = [' + got + '] expected [' + c[1] + ']');
  });
  if (timingSafeEqual('abc', 'abd')) throw new Error('timingSafeEqual must reject');
  if (!timingSafeEqual('abc', 'abc')) throw new Error('timingSafeEqual must accept');
  Logger.log('selftest OK');
}
