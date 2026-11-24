/**
 * vocab-cli — Google Apps Script endpoint.
 *
 * Setup: see README.md (Sheet must stay "Restricted"; this script runs as you).
 * Required Script Property: TOKEN  (random, 32+ bytes)
 * Deploy: Execute as "Me", Who has access "Anyone" — the token is the only gate.
 */

const SHEET_NAME = 'terms';

const HEADERS = [
  'id', 'key', 'term', 'type', 'cefr', 'pos', 'domain', 'ipa', 'meaning_vi',
  'meaning_en', 'example', 'example_type', 'context_note', 'source_type',
  'source_url', 'source_title', 'status', 'lookup_count', 'last_seen_at',
  'created_at', 'updated_at',
];

const OPS = ['ping', 'check', 'append', 'update', 'list'];
const READ_ONLY_OPS = ['ping', 'check', 'list'];
const WRITABLE = [
  'term', 'type', 'cefr', 'pos', 'domain', 'ipa', 'meaning_vi', 'meaning_en',
  'example', 'example_type', 'context_note', 'source_type', 'source_url',
  'source_title', 'status',
];

// shortcut: CacheService caps TTL at 6h, so the daily cap resets every ~6h.
// Upgrade to a counter row in the sheet only if abuse becomes real.
const DAILY_WRITE_CAP = 200;

function doPost(e) {
  try {
    const body = JSON.parse((e && e.postData && e.postData.contents) || '{}');
    if (!checkToken(body.token)) return json({ ok: false, error: 'unauthorized' });

    const op = String(body.op || '');
    if (OPS.indexOf(op) < 0) return json({ ok: false, error: 'unknown_op', op: op });
    if (READ_ONLY_OPS.indexOf(op) < 0 && !takeWriteSlot()) {
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
    const key = normalizeKey(body.term || body.key || '');
    const found = findRow(key);
    return { ok: true, op: op, key: key, exists: !!found, row: found ? found.row : null };
  }
  if (op === 'append') return appendRow(body.row || {});
  if (op === 'update') return updateRow(body);
  if (op === 'list') return listRows(body);
  return { ok: false, error: 'unknown_op' };
}

// ---------------------------------------------------------------- sheet access

function getSheet() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  let sheet = ss.getSheetByName(SHEET_NAME);
  if (!sheet) sheet = ss.insertSheet(SHEET_NAME);
  if (sheet.getLastRow() === 0) {
    sheet.appendRow(HEADERS);
    sheet.setFrozenRows(1);
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
  const headers = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0].map(String);
  const col = headers.indexOf(headerName);
  if (col >= 0) sheet.getRange(rowIndex, col + 1).setValue(value);
}

// ------------------------------------------------------------------- operations

function appendRow(input) {
  const term = String(input.term || '').trim();
  if (!term) return { ok: false, error: 'missing_term' };
  if (!String(input.meaning_vi || '').trim()) return { ok: false, error: 'missing_meaning_vi' };

  const key = normalizeKey(term);
  const sheet = getSheet();
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
  const rec = {
    id: Utilities.getUuid(), key: key, term: term,
    status: 'new', lookup_count: 1,
    created_at: now, updated_at: now, last_seen_at: now,
  };
  WRITABLE.forEach(function (f) {
    if (input[f] !== undefined && input[f] !== '') rec[f] = input[f];
  });
  rec.status = String(rec.status || 'new');
  rec.example_type = String(rec.example_type || 'generated');

  sheet.appendRow(HEADERS.map(function (h) { return rec[h] === undefined ? '' : rec[h]; }));
  return { ok: true, op: 'append', created: true, duplicate: false, id: rec.id, row: pick(rec) };
}

function updateRow(body) {
  const key = normalizeKey(body.key || body.term || '');
  const patch = body.patch || {};
  if (!key) return { ok: false, error: 'missing_key' };
  if (!body.patch) return { ok: false, error: 'missing_patch' };

  const found = findRow(key);
  if (!found) return { ok: false, error: 'not_found', key: key };

  const sheet = getSheet();
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
    .sort(function (a, b) { return String(b.row.last_seen_at).localeCompare(String(a.row.last_seen_at)); })
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

function takeWriteSlot() {
  const cache = CacheService.getScriptCache();
  const k = 'w_' + Utilities.formatDate(new Date(), 'UTC', 'yyyyMMdd');
  const n = Number(cache.get(k) || 0);
  if (n >= DAILY_WRITE_CAP) return false;
  cache.put(k, String(n + 1), 21600);
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
