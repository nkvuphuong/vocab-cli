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

  const sheet = {
    getName: () => 'terms',
    getDataRange: () => ({ getValues: () => data.map((r) => r.slice()) }),
    getLastRow: () => data.length,
    getLastColumn: () => (data.length ? Math.max.apply(null, data.map((r) => r.length)) : 0),
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
          if (a !== 'A:B') throw new Error('fake only implements A:B, got ' + a);
          return range(1, 1, Math.max(values.length, 1), 2);
        }
        return range(a, b, c, d);
      },
    };
  });

  const context = {
    SpreadsheetApp: { getActiveSpreadsheet: () => ({ getSheetByName: (name) => (name === undefined || name === 'terms' ? sheet : extras[name] || null), insertSheet: () => sheet }) },
    PropertiesService: { getScriptProperties: () => ({ getProperty: () => token }) },
    CacheService: {
      getScriptCache: () => ({
        get: (k) => (cache[k] === undefined ? null : cache[k]),
        put: (k, v) => { cache[k] = v; },
      }),
    },
    LockService: { getScriptLock: () => ({ waitLock: () => {}, releaseLock: () => {} }) },
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
    SOURCE + '\n;globalThis.__api = { doPost, appendMany, listKeys, normalizeKey, selftest };',
    context
  );
  return { api: context.__api, data };
}

function post(api, body) {
  return JSON.parse(api.doPost({ postData: { contents: JSON.stringify(body) } }).text);
}

const HEADER = ['id', 'key', 'term', 'type', 'cefr', 'pos', 'domain', 'ipa', 'meaning_short',
  'meaning_vi', 'meaning_en', 'example', 'example_type', 'context_note', 'source_type',
  'source_url', 'source_title', 'status', 'lookup_count', 'last_seen_at', 'created_at',
  'updated_at'];
const HEAD = [HEADER];
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
  eq(data[1][1], 'drift', 'key col');
  eq(data[1][17], 'new', 'status col');
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
  data[1][19] = new Date('2026-11-18T10:00:00Z');
  data[2][19] = new Date('2026-11-19T10:00:00Z');
  eq(post(api, { token: 'tok', op: 'list' }).rows.map((r) => r.term), ['newer', 'older']);
});

check('meaning_short goes to its own column, before meaning_vi', () => {
  const { api, data } = makeApi(HEAD, 'tok');
  post(api, { token: 'tok', op: 'append_many', items: [{ term: 'drift', meaning_short: 'lệch', meaning_vi: 'sự lệch chất lượng theo thời gian', context_note: 'x' }] });
  eq(data[0][8], 'meaning_short', 'header col I');
  eq(data[1][8], 'lệch', 'short meaning col I');
  eq(data[1][9], 'sự lệch chất lượng theo thời gian', 'long meaning col J');
  eq(post(api, { token: 'tok', op: 'list' }).rows[0].meaning_short, 'lệch', 'returned by list');
});

check('update can backfill meaning_short', () => {
  const { api, data } = makeApi(HEAD, 'tok');
  post(api, { token: 'tok', op: 'append_many', items: [row('drift', 'sự lệch chất lượng')] });
  eq(data[1][8], '', 'empty before');
  const res = post(api, { token: 'tok', op: 'update', key: 'drift', patch: { meaning_short: 'lệch' } });
  eq(res.row.meaning_short, 'lệch', 'patch returned');
  eq(data[1][8], 'lệch', 'written to column I');
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
  eq(post(api, { token: 'tok', op: 'read' }).rows[0][0], 'id', 'header row of terms');
  eq(post(api, { token: 'tok', op: 'read', sheet: 'Nope' }).error, 'sheet_not_found');
});

// n rows of the real header shape, so `draw` sees term + status in the right columns.
function termRows(n, status) {
  const rows = [HEADER.slice()];
  for (let i = 1; i <= n; i++) {
    const r = new Array(HEADER.length).fill('');
    r[0] = 'id-' + i; r[1] = 't' + i; r[2] = 't' + i; r[17] = status || 'new';
    rows.push(r);
  }
  return rows;
}

check('draw writes plain terms into Shuffle A and clears the old answers in B', () => {
  const shuffle = [['cũ-1', 'đáp án cũ'], ['cũ-2', 'đáp án cũ 2']];
  const { api } = makeApi(termRows(12), 'tok', { Shuffle: shuffle });
  const res = post(api, { token: 'tok', op: 'draw' });
  eq(res.ok, true, 'ok');
  eq(res.op, 'draw', 'op echoed');
  eq(res.count, 10, 'default count');
  eq(shuffle.length, 10, 'old rows replaced');
  eq(shuffle.map((r) => r[1] || ''), new Array(10).fill(''), 'column B cleared');
  eq(new Set(shuffle.map((r) => r[0])).size, 10, 'ten distinct terms');
  eq(res.terms, shuffle.map((r) => r[0]), 'response matches column A');
});

check('draw uses the old formula pool: term non-empty, status not known', () => {
  const rows = termRows(6);
  rows[3][17] = 'known';  // t3 learned
  rows[5][2] = '';        // t5 has no term
  const { api } = makeApi(rows, 'tok', { Shuffle: [['t1', 'đáp án cũ']] });
  const res = post(api, { token: 'tok', op: 'draw', count: 3 });
  eq(res.count, 3, 'count');
  eq(res.terms.indexOf('t3'), -1, 'known excluded');
  eq(res.terms.indexOf('t5'), -1, 'empty term excluded');
  res.terms.forEach((t) => eq(['t1', 't2', 't4', 't6'].indexOf(t) >= 0, true, 'pool member ' + t));
});

check('draw clamps count to 1..50 and defaults to 10', () => {
  const { api } = makeApi(termRows(60), 'tok', { Shuffle: [['x', 'y']] });
  eq(post(api, { token: 'tok', op: 'draw', count: 999 }).count, 50, 'clamped to DRAW_MAX');
  eq(post(api, { token: 'tok', op: 'draw', count: 0 }).count, 1, 'floor 1');
  eq(post(api, { token: 'tok', op: 'draw' }).count, 10, 'default');
});

check('draw never writes when there is nothing to draw or no Shuffle tab', () => {
  const known = [['cũ', 'đáp án']];
  const { api } = makeApi(termRows(2, 'known'), 'tok', { Shuffle: known });
  eq(post(api, { token: 'tok', op: 'draw' }).error, 'no_candidates');
  eq(known, [['cũ', 'đáp án']], 'Shuffle untouched');

  const bare = makeApi(termRows(3), 'tok');
  eq(post(bare.api, { token: 'tok', op: 'draw' }).error, 'sheet_not_found');
});

check('draw is rejected for a wrong token', () => {
  const shuffle = [['giữ nguyên', 'đáp án']];
  const { api } = makeApi(termRows(3), 'tok', { Shuffle: shuffle });
  eq(post(api, { token: 'nope', op: 'draw' }).error, 'unauthorized');
  eq(shuffle, [['giữ nguyên', 'đáp án']], 'nothing written');
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

console.log(failures ? '\n' + failures + ' FAILED' : '\nall passed');
process.exit(failures ? 1 : 0);
