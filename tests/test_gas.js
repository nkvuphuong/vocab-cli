#!/usr/bin/env node
/**
 * Runs apps-script/Code.gs against in-memory fakes of the Google services.
 * Catches typos and logic errors before you paste the file into the editor.
 *
 *     node tests/test_gas.js
 */

const fs = require('fs');
const path = require('path');
const vm = require('vm');

const SOURCE = fs.readFileSync(path.join(__dirname, '..', 'apps-script', 'Code.gs'), 'utf8');

let failures = 0;
function check(name, fn) {
  try {
    fn();
    console.log('ok   ' + name);
  } catch (err) {
    failures++;
    console.log('FAIL ' + name + '\n     ' + err.message);
  }
}
function eq(actual, expected, label) {
  const a = JSON.stringify(actual);
  const e = JSON.stringify(expected);
  if (a !== e) throw new Error((label || 'value') + ': got ' + a + ', expected ' + e);
}

function makeApi(initialRows, token, extraSheets) {
  const data = initialRows ? initialRows.map((r) => r.slice()) : [];
  let uuid = 0;
  const cache = {};
  const validations = {};
  const formats = {};
  const calls = { validation: [], format: [] };

  const sheet = {
    getName: () => 'terms',
    getDataRange: () => ({ getValues: () => data.map((r) => r.slice()) }),
    getLastRow: () => data.length,
    getLastColumn: () => (data.length ? Math.max.apply(null, data.map((r) => r.length)) : 0),
    getMaxRows: () => Math.max(data.length, 1),
    appendRow: (row) => data.push(row.slice()),
    setFrozenRows: () => {},
    insertSheet: () => sheet,
    deleteRow: (rowIndex) => { data.splice(rowIndex - 1, 1); },
    getRange: (row, col, numRows, numCols) => ({
      getValues: () => {
        const out = [];
        for (let r = 0; r < (numRows || 1); r++) {
          const line = data[row - 1 + r] || [];
          const cells = [];
          for (let c = 0; c < (numCols || 1); c++) cells.push(line[col - 1 + c] === undefined ? '' : line[col - 1 + c]);
          out.push(cells);
        }
        return out;
      },
      getFormulas: () => {
        const out = [];
        for (let r = 0; r < (numRows || 1); r++) {
          const line = data[row - 1 + r] || [];
          const cells = [];
          for (let c = 0; c < (numCols || 1); c++) {
            const v = line[col - 1 + c];
            cells.push(typeof v === 'string' && v.charAt(0) === '=' ? v : '');
          }
          out.push(cells);
        }
        return out;
      },
      setValue: (v) => {
        while (data.length < row) data.push([]);
        data[row - 1][col - 1] = v;
      },
      setValues: (matrix) => {
        matrix.forEach((line, i) => {
          while (data.length < row + i) data.push([]);
          line.forEach((v, c) => { data[row - 1 + i][col - 1 + c] = v; });
        });
      },
      clearContent: () => {
        for (let r = 0; r < (numRows || 1); r++) {
          const line = data[row - 1 + r];
          if (!line) continue;
          for (let c = 0; c < (numCols || 1); c++) line[col - 1 + c] = '';
        }
        while (data.length && data[data.length - 1].every((c) => c === '' || c === undefined)) data.pop();
      },
      clearDataValidations: () => { delete validations[col]; },
      setDataValidation: (rule) => {
        validations[col] = rule;
        calls.validation.push({ col: col, list: rule.list });
      },
      setNumberFormat: (fmt) => {
        formats[col] = fmt;
        calls.format.push({ col: col, fmt: fmt });
      },
    }),
  };

  const extras = {};
  Object.keys(extraSheets || {}).forEach((name) => {
    const values = extraSheets[name];
    const range = (row, col, numRows, numCols) => ({
      getValues: () => {
        const out = [];
        for (let r = 0; r < numRows; r++) {
          const line = values[row - 1 + r] || [];
          const cells = [];
          for (let c = 0; c < numCols; c++) cells.push(line[col - 1 + c] === undefined ? '' : line[col - 1 + c]);
          out.push(cells);
        }
        return out;
      },
      setValues: (matrix) => {
        matrix.forEach((line, i) => {
          while (values.length < row + i) values.push([]);
          line.forEach((v, c) => { values[row - 1 + i][col - 1 + c] = v; });
        });
      },
      clearContent: () => {
        for (let r = 0; r < numRows; r++) {
          const line = values[row - 1 + r];
          if (!line) continue;
          for (let c = 0; c < numCols; c++) line[col - 1 + c] = '';
        }
        // A cleared sheet has no data range any more: drop empty trailing rows.
        while (values.length && values[values.length - 1].every((c) => c === '' || c === undefined)) values.pop();
      },
    });
    extras[name] = {
      getName: () => name,
      getDataRange: () => ({ getValues: () => values.map((r) => r.slice()) }),
      getLastRow: () => values.length,
      deleteRow: (rowIndex) => { values.splice(rowIndex - 1, 1); },
      getRange: (a, b, c, d) => {
        if (typeof a === 'string') {
          const m = /^A:([A-Z])$/.exec(a);
          if (!m) throw new Error('fake only implements A:X ranges, got ' + a);
          return range(1, 1, Math.max(values.length, 1), m[1].charCodeAt(0) - 64);
        }
        return range(a, b, c, d);
      },
    };
  });

  const context = {
    PropertiesService: { getScriptProperties: () => ({ getProperty: () => token }) },
    CacheService: {
      getScriptCache: () => ({
        get: (k) => (cache[k] === undefined ? null : cache[k]),
        put: (k, v) => { cache[k] = v; },
      }),
    },
    LockService: { getScriptLock: () => ({ waitLock: () => {}, releaseLock: () => {} }) },
    SpreadsheetApp: {
      getActiveSpreadsheet: () => ({ getSheetByName: (name) => (name === undefined || name === 'terms' ? sheet : extras[name] || null), insertSheet: () => sheet }),
      newDataValidation: () => {
        const rule = {};
        const builder = {
          requireValueInList: (list) => { rule.list = list; rule.showDropdown = true; return builder; },
          setAllowInvalid: (v) => { rule.allowInvalid = v; return builder; },
          build: () => rule,
        };
        return builder;
      },
    },
    Utilities: {
      getUuid: () => 'id-' + (++uuid),
      formatDate: () => '20260101',
    },
    ContentService: {
      MimeType: { JSON: 'json' },
      createTextOutput: (text) => ({
        text: text,
        setMimeType: function () { return this; },
      }),
    },
    Logger: { log: () => {} },
  };
  vm.createContext(context);
  vm.runInContext(
    SOURCE + '\n;globalThis.__api = { doPost, appendMany, listKeys, normalizeKey, selftest, HEADERS };',
    context
  );
  return { api: context.__api, data, calls };
}

function post(api, body) {
  return JSON.parse(api.doPost({ postData: { contents: JSON.stringify(body) } }).text);
}

const HEADER = ['term', 'meaning_short', 'status', 'status_vi', 'ipa', 'meaning_vi',
  'meaning_en', 'type', 'pos', 'cefr', 'domain', 'example', 'example_type', 'context_note',
  'source_url', 'source_title', 'source_type', 'lookup_count', 'last_seen_at', 'created_at',
  'updated_at', 'key', 'id'];
const HEAD = [HEADER];

// Position of a header in the fake sheet; no test hard-codes a column number.
const col = (name, headers) => (headers || HEADER).indexOf(name);

const row = (term, meaning) => ({ term: term, meaning_vi: meaning, context_note: 'a sentence' });

check('selftest passes', () => {
  makeApi(HEAD, 'tok').api.selftest();
});

check('appendMany writes all new rows with one batch', () => {
  const { api, data } = makeApi(HEAD, 'tok');
  const res = post(api, { token: 'tok', op: 'append_many', items: [row('drift', 'lệch'), row('rubric', 'tiêu chí')] });
  eq(res.created.length, 2, 'created');
  eq(res.duplicates.length, 0, 'duplicates');
  eq(data.length, 3, 'sheet rows');
  eq(data[1][col('key')], 'drift', 'key col');
  eq(data[1][col('status')], 'new', 'status col');
  eq(data[1][col('status_vi')], '', 'status_vi col');
});

check('appendMany dedupes against existing rows and bumps lookup_count', () => {
  const { api, data } = makeApi(HEAD, 'tok');
  post(api, { token: 'tok', op: 'append_many', items: [row('drift', 'lệch')] });
  const res = post(api, { token: 'tok', op: 'append_many', items: [row('  DRIFT. ', 'lệch')] });
  eq(res.created.length, 0, 'created');
  eq(res.duplicates.length, 1, 'duplicates');
  eq(res.duplicates[0].lookup_count, 2, 'lookup_count');
  eq(data.length, 2, 'sheet rows');
});

check('appendMany catches repeats inside the same batch', () => {
  const { api, data } = makeApi(HEAD, 'tok');
  const res = post(api, { token: 'tok', op: 'append_many', items: [row('drift', 'lệch'), row('drift', 'lệch')] });
  eq(res.created.length, 1, 'created');
  eq(res.duplicates.length, 1, 'duplicates');
  eq(data.length, 2, 'sheet rows');
});

check('appendMany reports bad rows without writing them', () => {
  const { api, data } = makeApi(HEAD, 'tok');
  const res = post(api, { token: 'tok', op: 'append_many', items: [row('drift', 'lệch'), { term: 'floor' }] });
  eq(res.created.length, 1, 'created');
  eq(res.errors, [{ term: 'floor', error: 'missing_meaning_vi' }], 'errors');
  eq(data.length, 2, 'sheet rows');
});

check('appendMany rejects batches over MAX_BATCH', () => {
  const { api } = makeApi(HEAD, 'tok');
  const items = [];
  for (let i = 0; i < 51; i++) items.push(row('t' + i, 'n'));
  eq(post(api, { token: 'tok', op: 'append_many', items: items }).error, 'too_many_items');
});

check('keys returns every normalized key', () => {
  const { api } = makeApi(HEAD, 'tok');
  post(api, { token: 'tok', op: 'append_many', items: [row('Accuracy Floor', 'ngưỡng sàn')] });
  eq(post(api, { token: 'tok', op: 'keys' }).keys, ['accuracy floor']);
});

check('wrong token is rejected before any write', () => {
  const { api, data } = makeApi(HEAD, 'tok');
  eq(post(api, { token: 'nope', op: 'append_many', items: [row('drift', 'lệch')] }).error, 'unauthorized');
  eq(data.length, 1, 'sheet rows');
});

check('unknown op is rejected', () => {
  const { api } = makeApi(HEAD, 'tok');
  eq(post(api, { token: 'tok', op: 'drop_table' }).error, 'unknown_op');
});

check('check + update round-trip', () => {
  const { api } = makeApi(HEAD, 'tok');
  post(api, { token: 'tok', op: 'append_many', items: [row('drift', 'lệch')] });
  eq(post(api, { token: 'tok', op: 'check', term: 'Drift' }).exists, true);
  const upd = post(api, { token: 'tok', op: 'update', key: 'drift', patch: { status: 'learning' } });
  eq(upd.row.status, 'learning', 'status');
  eq(post(api, { token: 'tok', op: 'check', term: 'drift' }).row.status, 'learning');
});

check('list filters by status and domain', () => {
  const { api } = makeApi(HEAD, 'tok');
  post(api, { token: 'tok', op: 'append_many', items: [row('drift', 'lệch'), row('rubric', 'tiêu chí')] });
  post(api, { token: 'tok', op: 'update', key: 'rubric', patch: { status: 'known', domain: 'evals' } });
  eq(post(api, { token: 'tok', op: 'list', status: 'known' }).rows.map((r) => r.term), ['rubric']);
  eq(post(api, { token: 'tok', op: 'list', domain: 'eval' }).count, 1, 'domain substring');
});

check('delete removes the row and the ones below shift up', () => {
  const { api, data } = makeApi(HEAD, 'tok');
  post(api, { token: 'tok', op: 'append_many', items: [row('drift', 'lệch'), row('rubric', 'tiêu chí')] });
  const res = post(api, { token: 'tok', op: 'delete', key: 'drift', confirm: true });
  eq(res.term, 'drift', 'term echoed');
  eq(res.row.meaning_vi, 'lệch', 'deleted row returned');
  eq(data.length, 2, 'sheet rows');
  eq(post(api, { token: 'tok', op: 'keys' }).keys, ['rubric'], 'keys after delete');
  eq(post(api, { token: 'tok', op: 'check', term: 'drift' }).exists, false, 'gone');
});

check('delete needs confirm:true', () => {
  const { api, data } = makeApi(HEAD, 'tok');
  post(api, { token: 'tok', op: 'append_many', items: [row('drift', 'lệch')] });
  eq(post(api, { token: 'tok', op: 'delete', key: 'drift' }).error, 'confirm_required');
  eq(data.length, 2, 'nothing deleted');
});

check('delete reports not_found and deletes nothing', () => {
  const { api, data } = makeApi(HEAD, 'tok');
  post(api, { token: 'tok', op: 'append_many', items: [row('drift', 'lệch')] });
  eq(post(api, { token: 'tok', op: 'delete', key: 'nope', confirm: true }).error, 'not_found');
  eq(data.length, 2, 'nothing deleted');
});

check('delete is rejected for a wrong token', () => {
  const { api, data } = makeApi(HEAD, 'tok');
  post(api, { token: 'tok', op: 'append_many', items: [row('drift', 'lệch')] });
  eq(post(api, { token: 'nope', op: 'delete', key: 'drift', confirm: true }).error, 'unauthorized');
  eq(data.length, 2, 'nothing deleted');
});

check('list returns newest first by date, not by weekday name', () => {
  // Wed Nov 18 vs Thu Nov 19 2026: sorting the Date strings alphabetically puts
  // "Wed" first, which is the older row. Only real date math gets this right.
  const { api, data } = makeApi(HEAD, 'tok');
  post(api, { token: 'tok', op: 'append_many', items: [row('older', 'cũ'), row('newer', 'mới')] });
  data[1][col('last_seen_at')] = new Date('2026-11-18T10:00:00Z');
  data[2][col('last_seen_at')] = new Date('2026-11-19T10:00:00Z');
  eq(post(api, { token: 'tok', op: 'list' }).rows.map((r) => r.term), ['newer', 'older']);
});

check('meaning_short goes to its own column, before meaning_vi', () => {
  const { api, data } = makeApi(HEAD, 'tok');
  post(api, { token: 'tok', op: 'append_many', items: [{ term: 'drift', meaning_short: 'lệch', meaning_vi: 'sự lệch chất lượng theo thời gian', context_note: 'x' }] });
  eq(data[0][col('meaning_short')], 'meaning_short', 'header');
  eq(data[1][col('meaning_short')], 'lệch', 'short meaning');
  eq(data[1][col('meaning_vi')], 'sự lệch chất lượng theo thời gian', 'long meaning');
  eq(post(api, { token: 'tok', op: 'list' }).rows[0].meaning_short, 'lệch', 'returned by list');
});

check('update can backfill meaning_short', () => {
  const { api, data } = makeApi(HEAD, 'tok');
  post(api, { token: 'tok', op: 'append_many', items: [row('drift', 'sự lệch chất lượng')] });
  eq(data[1][col('meaning_short')], '', 'empty before');
  const res = post(api, { token: 'tok', op: 'update', key: 'drift', patch: { meaning_short: 'lệch' } });
  eq(res.row.meaning_short, 'lệch', 'patch returned');
  eq(data[1][col('meaning_short')], 'lệch', 'written to its column');
});

check('read returns the raw cells of a named tab (grading input)', () => {
  const { api } = makeApi(HEAD, 'tok', { Shuffle: [['drift', 'lệch chất lượng'], ['rubric', '']] });
  const res = post(api, { token: 'tok', op: 'read', sheet: 'Shuffle' });
  eq(res.ok, true, 'ok');
  eq(res.sheet, 'Shuffle', 'sheet name');
  eq(res.rows, [['drift', 'lệch chất lượng'], ['rubric', '']], 'cells');
});

check('read defaults to terms and rejects an unknown tab', () => {
  const { api } = makeApi(HEAD, 'tok');
  eq(post(api, { token: 'tok', op: 'read' }).rows[0][0], 'term', 'header row of terms');
  eq(post(api, { token: 'tok', op: 'read', sheet: 'Nope' }).error, 'sheet_not_found');
});

// n rows of the real header shape, so draw/recheck see term/status/gloss in place.
function termRows(n, status, statusVi) {
  const rows = [HEADER.slice()];
  for (let i = 1; i <= n; i++) {
    const r = new Array(HEADER.length).fill('');
    r[col('id')] = 'id-' + i; r[col('key')] = 't' + i; r[col('term')] = 't' + i;
    r[col('meaning_short')] = 'nghĩa ' + i;
    r[col('status')] = status || 'new';
    r[col('updated_at')] = new Date();
    r[col('status_vi')] = statusVi === undefined ? '' : statusVi;
    rows.push(r);
  }
  return rows;
}

check('draw writes prompt + direction into A:B and clears the old answers in C', () => {
  const shuffle = [['cũ-1', 'en-vi', 'đáp án cũ'], ['cũ-2', 'vi-en', 'đáp án cũ 2']];
  const { api } = makeApi(termRows(12), 'tok', { Shuffle: shuffle });
  const res = post(api, { token: 'tok', op: 'draw' });
  eq(res.ok, true, 'ok');
  eq(res.op, 'draw', 'op echoed');
  eq(res.count, 10, 'default count');
  eq(shuffle.length, 10, 'old rows replaced');
  eq(shuffle.map((r) => r[1]), new Array(10).fill('en-vi'), 'direction in B');
  eq(shuffle.map((r) => r[2] || ''), new Array(10).fill(''), 'column C cleared');
  eq(res.items.map((x) => x.prompt), shuffle.map((r) => r[0]), 'response matches column A');
});

check('draw en pool: term non-empty, status not known', () => {
  const rows = termRows(6);
  rows[3][col('status')] = 'known';  // t3 learned
  rows[5][col('term')] = '';        // t5 has no term
  const { api } = makeApi(rows, 'tok', { Shuffle: [['t1', 'en-vi', 'đáp án cũ']] });
  const res = post(api, { token: 'tok', op: 'draw', count: 3 });
  eq(res.count, 3, 'count');
  eq(res.items.some((x) => x.prompt === 't3'), false, 'known excluded');
  eq(res.items.some((x) => x.prompt === 't5'), false, 'empty term excluded');
  eq(res.items.every((x) => x.direction === 'en-vi'), true, 'en marker');
});

check('draw vi uses meaning_short and the status_vi pool', () => {
  const rows = termRows(4);
  rows[2][col('status_vi')] = 'known';  // t2 learned vi→en
  rows[3][col('meaning_short')] = '';        // t3 has no gloss
  const { api } = makeApi(rows, 'tok', { Shuffle: [['x', 'vi-en', 'y']] });
  const res = post(api, { token: 'tok', op: 'draw', direction: 'vi' });
  eq(res.ok, true, 'ok');
  eq(res.items.map((x) => x.prompt).sort(), ['nghĩa 1', 'nghĩa 4'], 'gloss prompts');
  eq(res.items.every((x) => x.direction === 'vi-en'), true, 'vi marker');
});

check('draw vi skips duplicate glosses', () => {
  const rows = termRows(4);
  rows[2][col('meaning_short')] = rows[1][col('meaning_short')];  // t1 and t2 share one gloss
  const { api } = makeApi(rows, 'tok', { Shuffle: [['x', 'vi-en', '']] });
  const res = post(api, { token: 'tok', op: 'draw', direction: 'vi', count: 5 });
  eq(res.count, 3, 'one card per distinct gloss');
});

check('draw mixed halves the batch and never repeats a term', () => {
  const { api } = makeApi(termRows(20), 'tok', { Shuffle: [['x', 'en-vi', '']] });
  const res = post(api, { token: 'tok', op: 'draw', direction: 'mixed', count: 10 });
  eq(res.count, 10, 'count');
  eq(res.items.filter((x) => x.direction === 'en-vi').length, 5, '5 en');
  eq(res.items.filter((x) => x.direction === 'vi-en').length, 5, '5 vi');
  const keys = res.items.map((x) => (x.direction === 'en-vi' ? x.prompt : x.prompt.replace('nghĩa ', 't')));
  eq(new Set(keys).size, 10, 'no term appears in both directions');
});

check('draw mixed fills a short pool from the other direction', () => {
  const rows = termRows(10);
  rows.slice(1).forEach((r, i) => {   // en pool: t3..t10, vi pool: t1, t2
    if (i < 2) r[col('status')] = 'known'; else r[col('status_vi')] = 'known';
  });
  const { api } = makeApi(rows, 'tok', { Shuffle: [['x', 'en-vi', '']] });
  const res = post(api, { token: 'tok', op: 'draw', direction: 'mixed', count: 10 });
  eq(res.count, 10, 'full batch');
  eq(res.items.filter((x) => x.direction === 'vi-en').length, 2, 'all vi candidates used');
  eq(res.items.filter((x) => x.direction === 'en-vi').length, 8, 'rest from en');
});

check('draw clamps count to 1..50 and defaults to 10', () => {
  const { api } = makeApi(termRows(60), 'tok', { Shuffle: [['x', 'en-vi', 'y']] });
  eq(post(api, { token: 'tok', op: 'draw', count: 999 }).count, 50, 'clamped to DRAW_MAX');
  eq(post(api, { token: 'tok', op: 'draw', count: 0 }).count, 1, 'floor 1');
  eq(post(api, { token: 'tok', op: 'draw' }).count, 10, 'default');
});

check('draw never writes when there is nothing to draw or no Shuffle tab', () => {
  const known = [['cũ', 'en-vi', 'đáp án']];
  const { api } = makeApi(termRows(2, 'known'), 'tok', { Shuffle: known });
  eq(post(api, { token: 'tok', op: 'draw' }).error, 'no_candidates');
  eq(known, [['cũ', 'en-vi', 'đáp án']], 'Shuffle untouched');

  const bare = makeApi(termRows(3), 'tok');
  eq(post(bare.api, { token: 'tok', op: 'draw' }).error, 'sheet_not_found');
});

check('draw is rejected for a wrong token', () => {
  const shuffle = [['giữ nguyên', 'en-vi', 'đáp án']];
  const { api } = makeApi(termRows(3), 'tok', { Shuffle: shuffle });
  eq(post(api, { token: 'nope', op: 'draw' }).error, 'unauthorized');
  eq(shuffle, [['giữ nguyên', 'en-vi', 'đáp án']], 'nothing written');
});

check('recheck picks due cards per direction, and writes nothing when none are due', () => {
  const daysAgo = (n) => new Date(Date.now() - n * 86400000);
  const rows = termRows(4);
  rows[1][col('status')] = 'learning'; rows[1][col('updated_at')] = daysAgo(4);   // t1: en due
  rows[2][col('status')] = 'known'; rows[2][col('updated_at')] = daysAgo(31);     // t2: en due, vi not started
  rows[3][col('status')] = 'new'; rows[3][col('updated_at')] = daysAgo(1);        // t3: nothing
  rows[4][col('status')] = 'learning'; rows[4][col('updated_at')] = daysAgo(10);  // t4: both directions due
  rows[4][col('status_vi')] = 'learning';

  const { api } = makeApi(rows, 'tok', { Recheck: [['cũ', 'en-vi', 'đáp án']] });
  const res = post(api, { token: 'tok', op: 'recheck', direction: 'mixed', count: 10 });
  eq(res.ok, true, 'ok');
  eq(res.sheet, 'Recheck', 'tab');
  eq(res.items.map((x) => x.direction).sort(), ['en-vi', 'en-vi', 'en-vi', 'vi-en'], 't1 en, t2 en, t4 en+vi');

  const kept = [['giữ', 'en-vi', 'đáp án']];
  const empty = makeApi(termRows(2, 'new'), 'tok', { Recheck: kept });
  eq(post(empty.api, { token: 'tok', op: 'recheck' }).error, 'no_candidates');
  eq(kept, [['giữ', 'en-vi', 'đáp án']], 'Recheck untouched');

  const bare = makeApi(termRows(3), 'tok');
  eq(post(bare.api, { token: 'tok', op: 'recheck' }).error, 'sheet_not_found');
});

check('check prompt resolves a gloss variant to its term', () => {
  const rows = termRows(3);
  rows[1][col('meaning_short')] = 'lệch chất lượng · trôi lệch';
  const { api } = makeApi(rows, 'tok');
  const res = post(api, { token: 'tok', op: 'check', prompt: '  Trôi Lệch. ' });
  eq(res.ok, true, 'ok');
  eq(res.matches.length, 1, 'one match');
  eq(res.matches[0].term, 't1', 'term');
});

check('check prompt returns every match, or not_found', () => {
  const rows = termRows(3);
  rows[1][col('meaning_short')] = 'một gloss';
  rows[2][col('meaning_short')] = 'một gloss';
  const { api } = makeApi(rows, 'tok');
  eq(post(api, { token: 'tok', op: 'check', prompt: 'một gloss' }).matches.length, 2, 'ambiguous');
  eq(post(api, { token: 'tok', op: 'check', prompt: 'không có' }).error, 'not_found');
});

check('update reports missing_header instead of silently skipping status_vi', () => {
  const header = HEADER.filter((h) => h !== 'status_vi');
  const rows = [header];
  const r = new Array(header.length).fill('');
  r[col('id', header)] = 'id-1'; r[col('key', header)] = 't1';
  r[col('term', header)] = 't1'; r[col('status', header)] = 'new';
  rows.push(r);
  const { api, data } = makeApi(rows, 'tok');
  const res = post(api, { token: 'tok', op: 'update', key: 't1', patch: { status_vi: 'known' } });
  eq(res.error, 'missing_header', 'error');
  eq(res.header, 'status_vi', 'names the missing column');
  eq(data[1][col('status', header)], 'new', 'status untouched');
});

check('clear_inbox deletes done rows, keeps the ones not yet saved', () => {
  const inbox = [['shovel'], ['scarf'], ['mittens'], ['driveway']];
  const { api } = makeApi(HEAD, 'tok', { inbox: inbox });
  post(api, { token: 'tok', op: 'append_many', items: [row('shovel', 'xúc'), row('scarf', 'khăn')] });
  const res = post(api, { token: 'tok', op: 'clear_inbox', confirm: true, terms: ['scarf', 'shovel', 'mittens'] });
  eq(res.ok, true, 'ok');
  eq(res.removed, 2, 'removed');
  eq(res.skipped, ['mittens'], 'skipped = not in terms, row kept');
  eq(inbox, [['mittens'], ['driveway']], 'inbox after');
});

check('clear_inbox matches case and spacing, and only the first two columns', () => {
  const inbox = [['  Shovel. '], ['scarf', '', 'shovel in the note column']];
  const { api } = makeApi(HEAD, 'tok', { inbox: inbox });
  post(api, { token: 'tok', op: 'append_many', items: [row('shovel', 'xúc')] });
  const res = post(api, { token: 'tok', op: 'clear_inbox', confirm: true, terms: ['shovel'] });
  eq(res.removed, 1, 'removed');
  eq(inbox.length, 1, 'note-only row survives');
});

check('clear_inbox needs confirm:true and at least one term', () => {
  const { api } = makeApi(HEAD, 'tok', { inbox: [['shovel']] });
  eq(post(api, { token: 'tok', op: 'clear_inbox', terms: ['shovel'] }).error, 'confirm_required');
  eq(post(api, { token: 'tok', op: 'clear_inbox', confirm: true, terms: [] }).error, 'missing_terms');
});

check('clear_inbox never touches the Shuffle answers', () => {
  const { api } = makeApi(HEAD, 'tok', { Shuffle: [['drift', 'lệch']] });
  eq(post(api, { token: 'tok', op: 'clear_inbox', confirm: true, terms: ['drift'] }).error,
     'sheet_not_found');
});

// Map rows stored in `source` order into `order`, keeping each value under its header.
function mapRows(rows, order, source) {
  return rows.map((line) => order.map((h) => {
    const v = line[col(h, source || HEADER)];
    return v === undefined ? '' : v;
  }));
}
const REVERSED = HEADER.slice().reverse();
const reversedRows = (n) => mapRows(termRows(n), REVERSED);

check('append writes by header name on a shuffled sheet', () => {
  const { api, data } = makeApi(mapRows([HEADER], REVERSED), 'tok');
  const res = post(api, { token: 'tok', op: 'append_many', items: [row('drift', 'lệch')] });
  eq(res.created.length, 1, 'created');
  eq(data[0], REVERSED, 'header untouched');
  eq(data[1][col('key', REVERSED)], 'drift', 'key under its own header');
  eq(data[1][col('status', REVERSED)], 'new', 'status under its own header');
  eq(data[1][col('status_vi', REVERSED)], '', 'status_vi under its own header');
});

check('append refuses a sheet missing a canonical header', () => {
  const header = HEADER.filter((h) => h !== 'status_vi');
  const { api, data } = makeApi([header], 'tok');
  const res = post(api, { token: 'tok', op: 'append_many', items: [row('drift', 'lệch')] });
  eq(res.error, 'missing_header', 'error');
  eq(res.header, 'status_vi', 'names it');
  eq(data.length, 1, 'nothing written');
});

check('append refuses a duplicated header', () => {
  const header = HEADER.slice();
  header[col('meaning_short')] = 'term';
  const { api, data } = makeApi([header], 'tok');
  eq(post(api, { token: 'tok', op: 'append_many', items: [row('drift', 'lệch')] }).error, 'duplicate_header');
  eq(data.length, 1, 'nothing written');
});

check('reorder dry run reports the diff and writes nothing', () => {
  const rows = reversedRows(3);
  const before = JSON.stringify(rows);
  const { api, data } = makeApi(rows, 'tok');
  const res = post(api, { token: 'tok', op: 'reorder', dry_run: true });
  eq(res.ok, true, 'ok');
  eq(res.dry_run, true, 'dry run');
  eq(res.current, REVERSED, 'current order');
  eq(res.target, HEADER, 'target order');
  eq(res.added, [], 'nothing to add');
  eq(res.unknown, [], 'no unknown columns');
  eq(JSON.stringify(data), before, 'sheet untouched');
});

check('reorder moves columns and keeps every value under its header', () => {
  const byName = (line) => HEADER.map((h) => line[col(h)]);
  const before = termRows(3).slice(1).map(byName);
  const { api, data } = makeApi(reversedRows(3), 'tok');
  const res = post(api, { token: 'tok', op: 'reorder', confirm: true });
  eq(res.ok, true, 'ok');
  eq(res.moved, HEADER.length - 1, 'every column but the middle one moved');
  eq(data[0], HEADER, 'canonical header');
  eq(data.slice(1).map(byName), before, 'values preserved');
  eq(data.slice(1).map((r) => r[col('updated_at')]).map(String),
     before.map((r) => r[col('updated_at')]).map(String), 'updated_at untouched');
  eq(data.slice(1).map((r) => r[col('status')]), ['new', 'new', 'new'], 'status kept');
});

check('reorder is idempotent and refreshes the dropdowns either way', () => {
  const { api, data, calls } = makeApi(reversedRows(2), 'tok');
  post(api, { token: 'tok', op: 'reorder', confirm: true });
  const snapshot = JSON.stringify(data);
  const again = post(api, { token: 'tok', op: 'reorder', confirm: true });
  eq(again.ok, true, 'ok');
  eq(again.moved, 0, 'nothing to move');
  eq(JSON.stringify(data), snapshot, 'no cell rewritten');
  const cols = Array.from(new Set(calls.validation.map((c) => c.col))).sort((a, b) => a - b);
  eq(cols, [col('status') + 1, col('status_vi') + 1].sort((a, b) => a - b), 'both dropdowns');
  eq(calls.validation[0].list, ['new', 'learning', 'known'], 'list items');
  const dates = Array.from(new Set(calls.format.map((c) => c.col))).sort((a, b) => a - b);
  eq(dates, ['last_seen_at', 'created_at', 'updated_at'].map((h) => col(h) + 1).sort((a, b) => a - b), 'date formats');
});

check('reorder adds a missing field empty in its canonical position', () => {
  const header = HEADER.filter((h) => h !== 'status_vi');
  const rows = mapRows(termRows(2), header);
  rows[0] = header.slice();
  const { api, data } = makeApi(rows, 'tok');
  const res = post(api, { token: 'tok', op: 'reorder', confirm: true });
  eq(res.ok, true, 'ok');
  eq(res.added, ['status_vi'], 'added');
  eq(data[0], HEADER, 'canonical header');
  eq(data.slice(1).every((r) => r[col('status_vi')] === ''), true, 'added column empty');
  eq(data[1][col('term')], 't1', 'other values kept');
});

check('reorder reports unknown columns in a dry run and refuses to write over data', () => {
  const header = HEADER.concat(['notes2']);
  const rows = mapRows(termRows(2), header);
  rows[0] = header.slice();
  rows[1][col('notes2', header)] = 'keep me';
  const before = JSON.stringify(rows);
  const { api, data } = makeApi(rows, 'tok');
  const dry = post(api, { token: 'tok', op: 'reorder', dry_run: true });
  eq(dry.unknown, ['notes2'], 'dry run lists it');
  eq(JSON.stringify(data), before, 'dry run writes nothing');
  const res = post(api, { token: 'tok', op: 'reorder', confirm: true });
  eq(res.error, 'unknown_header', 'confirm refuses');
  eq(res.headers, ['notes2'], 'names it');
  eq(JSON.stringify(data), before, 'sheet untouched');
});

check('reorder drops an unknown column that is empty', () => {
  const header = HEADER.concat(['notes2']);
  const rows = mapRows(termRows(2), header);
  rows[0] = header.slice();
  const { api, data } = makeApi(rows, 'tok');
  const res = post(api, { token: 'tok', op: 'reorder', confirm: true });
  eq(res.ok, true, 'ok');
  eq(data[0].slice(0, HEADER.length), HEADER, 'canonical header');
  eq(data.every((line) => line.slice(HEADER.length).every((c) => c === '' || c === undefined)),
     true, 'orphan column cleared');
});

check('reorder refuses a formula in terms', () => {
  const rows = reversedRows(2);
  rows[1][col('meaning_vi', REVERSED)] = '=UPPER("x")';
  const before = JSON.stringify(rows);
  const { api, data } = makeApi(rows, 'tok');
  eq(post(api, { token: 'tok', op: 'reorder', confirm: true }).error, 'formula_in_terms');
  eq(JSON.stringify(data), before, 'not flattened to a value');
});

check('reorder needs confirm and reports it without writing', () => {
  const rows = reversedRows(2);
  const before = JSON.stringify(rows);
  const { api, data } = makeApi(rows, 'tok');
  eq(post(api, { token: 'tok', op: 'reorder' }).error, 'confirm_required');
  eq(JSON.stringify(data), before, 'sheet untouched');
});

check('docs/sheet.md column map matches HEADERS', () => {
  const doc = fs.readFileSync(path.join(__dirname, '..', 'docs', 'sheet.md'), 'utf8');
  const m = /```\n([A-Z] [^\n]*(?:\n[A-Z] [^\n]*)*)\n```/.exec(doc);
  if (!m) throw new Error('column map block not found in docs/sheet.md');
  const names = m[1].split(/[·\n]/).map((s) => s.trim().replace(/^[A-Z] /, '')).filter(Boolean);
  eq(names, HEADER, 'docs column map');
});

console.log(failures ? '\n' + failures + ' FAILED' : '\nall passed');
process.exit(failures ? 1 : 0);
