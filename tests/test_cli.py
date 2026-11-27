#!/usr/bin/env python3
"""Self-check for vocab-cli. No network: the API is faked.

    python3 tests/test_cli.py
"""

import io
import json
import os
import sys
import tempfile
import unittest
from contextlib import redirect_stderr, redirect_stdout
from unittest.mock import patch

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from vocab import api as api_module
from vocab import cli
from vocab.normalize import normalize_key

ROW = {
    "id": "id-1", "key": "drift", "term": "drift", "type": "tech_term",
    "cefr": "C1", "domain": "evals", "ipa": "/drɪft/",
    "meaning_vi": "sự lệch chất lượng theo thời gian", "status": "new",
    "example": "Catch drift by grading a nightly sample.",
    "source_url": "https://example.test/course", "lookup_count": 1,
}


class FakeApi:
    def __init__(self, **responses):
        self.calls = []
        self.responses = responses

    def __call__(self, op, timeout=None, **payload):
        self.calls.append({"op": op, **payload})
        return self.responses[op]


def run(argv, fake):
    out, err = io.StringIO(), io.StringIO()
    with patch.object(api_module, "call", fake), \
            redirect_stdout(out), redirect_stderr(err):
        code = cli.main(argv)
    return code, out.getvalue(), err.getvalue()


def added(duplicate=False):
    row = dict(ROW, lookup_count=2 if duplicate else 1)
    return FakeApi(append={"ok": True, "created": not duplicate,
                           "duplicate": duplicate, "id": row["id"], "row": row})


class T1Normalize(unittest.TestCase):
    """Mirrors selftest() in apps-script/Code.gs."""

    def test_cases(self):
        cases = [
            ("Pull   Request.", "pull request"),
            (" drift ", "drift"),
            ("\u201cfloor\u201d", "floor"),
            ("Set a floor?", "set a floor"),
            ("", ""),
        ]
        for raw, expected in cases:
            self.assertEqual(normalize_key(raw), expected, raw)


class T2AddGate(unittest.TestCase):

    def test_missing_meaning_asks_instead_of_writing(self):
        fake = FakeApi()
        code, out, _ = run(["add", "floor", "--context", "Set an accuracy floor"], fake)
        self.assertEqual(code, cli.EXIT_NEEDS)
        self.assertTrue(json.loads(out)["needs_context"])
        self.assertEqual(json.loads(out)["reason"], "missing_meaning_vi")
        self.assertEqual(fake.calls, [])

    def test_missing_context_asks_instead_of_writing(self):
        fake = FakeApi()
        code, out, _ = run(["add", "floor", "--meaning-vi", "ngưỡng sàn"], fake)
        self.assertEqual(code, cli.EXIT_NEEDS)
        self.assertEqual(json.loads(out)["reason"], "missing_context")
        self.assertEqual(fake.calls, [])


class T3AddWrites(unittest.TestCase):

    def test_payload_shape_and_defaults(self):
        fake = added()
        code, out, _ = run(
            ["add", "drift", "--meaning-vi", "sự lệch", "--context", "Catch drift",
             "--type", "tech_term", "--domain", "evals", "--ipa", "/drɪft/"],
            fake,
        )
        self.assertEqual(code, cli.EXIT_OK)
        self.assertTrue(json.loads(out)["created"])
        sent = fake.calls[0]
        self.assertEqual(sent["op"], "append")
        self.assertEqual(sent["row"]["term"], "drift")
        self.assertEqual(sent["row"]["source_type"], "text")
        self.assertEqual(sent["row"]["domain"], "evals")
        # every add must carry a context or a source url
        self.assertTrue(sent["row"]["context_note"] or sent["row"]["source_url"])

    def test_url_becomes_source_url(self):
        fake = added()
        run(["add", "drift", "--meaning-vi", "x", "--source-url", "https://e.test/a"], fake)
        self.assertEqual(fake.calls[0]["row"]["source_type"], "url")
        self.assertEqual(fake.calls[0]["row"]["source_url"], "https://e.test/a")

    def test_duplicate_is_reported_not_duplicated(self):
        fake = added(duplicate=True)
        code, out, err = run(
            ["add", "drift", "--meaning-vi", "khác nghĩa", "--context", "some sentence"], fake
        )
        self.assertEqual(code, cli.EXIT_OK)
        payload = json.loads(out)
        self.assertTrue(payload["duplicate"])
        self.assertFalse(payload["created"])
        self.assertIn("already saved", err)


class T4Other(unittest.TestCase):

    def test_check_missing(self):
        fake = FakeApi(check={"ok": True, "key": "drift", "exists": False, "row": None})
        code, out, _ = run(["check", "drift"], fake)
        self.assertEqual(code, cli.EXIT_OK)
        self.assertFalse(json.loads(out)["exists"])

    def test_check_found(self):
        fake = FakeApi(check={"ok": True, "key": "drift", "exists": True, "row": ROW})
        _, out, _ = run(["check", "  Drift. "], fake)
        self.assertEqual(json.loads(out)["meaning_vi"], ROW["meaning_vi"])

    def test_mark_rejects_unknown_status(self):
        fake = FakeApi()
        code, out, _ = run(["mark", "drift", "--status", "delete"], fake)
        self.assertEqual(code, cli.EXIT_NEEDS)
        self.assertEqual(json.loads(out)["reason"], "invalid_status")
        self.assertEqual(fake.calls, [])

    def test_mark_sends_normalized_key(self):
        fake = FakeApi(update={"ok": True, "id": "id-1", "row": dict(ROW, status="known")})
        code, out, _ = run(["mark", "  Drift. ", "--status", "known"], fake)
        self.assertEqual(code, cli.EXIT_OK)
        self.assertEqual(fake.calls[0]["key"], "drift")
        self.assertEqual(fake.calls[0]["patch"], {"status": "known"})
        self.assertEqual(json.loads(out)["status"], "known")

    def test_mark_vi_direction_patches_status_vi_only(self):
        fake = FakeApi(update={"ok": True, "id": "id-1",
                               "row": dict(ROW, status_vi="learning")})
        code, out, _ = run(["mark", "drift", "--status", "learning", "--direction", "vi"], fake)
        self.assertEqual(code, cli.EXIT_OK)
        self.assertEqual(fake.calls[0]["patch"], {"status_vi": "learning"})
        self.assertEqual(json.loads(out)["direction"], "vi")

    def test_check_prompt_returns_matches(self):
        fake = FakeApi(check={"ok": True, "op": "check", "prompt": "lệch chất lượng",
                              "count": 1, "matches": [dict(ROW, status_vi="learning")]})
        code, out, _ = run(["check", "--prompt", "lệch chất lượng"], fake)
        self.assertEqual(code, cli.EXIT_OK)
        payload = json.loads(out)
        self.assertEqual(payload["matches"][0]["term"], "drift")
        self.assertEqual(payload["matches"][0]["status_vi"], "learning")
        self.assertEqual(fake.calls[0], {"op": "check", "prompt": "lệch chất lượng"})

    def test_check_prompt_not_found_exits_needs(self):
        def nf(op, timeout=None, **payload):
            raise api_module.ApiError("not_found", {"ok": False, "error": "not_found"})

        code, out, _ = run(["check", "--prompt", "không có"], nf)
        self.assertEqual(code, cli.EXIT_NEEDS)
        self.assertEqual(json.loads(out)["error"], "not_found")

    def test_check_without_terms_or_prompt_needs_info(self):
        fake = FakeApi()
        code, out, _ = run(["check"], fake)
        self.assertEqual(code, cli.EXIT_NEEDS)
        self.assertEqual(json.loads(out)["reason"], "missing_term")
        self.assertEqual(fake.calls, [])

    def test_list_json(self):
        fake = FakeApi(list={"ok": True, "count": 1, "rows": [ROW]})
        code, out, _ = run(["list", "--json"], fake)
        self.assertEqual(code, cli.EXIT_OK)
        self.assertEqual(json.loads(out)["rows"][0]["term"], "drift")

    def test_api_error_exits_1(self):
        def boom(op, timeout=None, **payload):
            raise api_module.ApiError("unauthorized")

        code, out, _ = run(["ping"], boom)
        self.assertEqual(code, cli.EXIT_API)
        self.assertEqual(json.loads(out)["error"], "unauthorized")


class ImportFake:
    """Simulates append_many/keys as the Apps Script endpoint would behave."""

    def __init__(self, existing=()):
        self.calls = []
        self.existing = set(existing)

    def __call__(self, op, timeout=None, **payload):
        self.calls.append({"op": op, **payload})
        if op == "keys":
            return {"ok": True, "count": len(self.existing), "keys": sorted(self.existing)}
        if op == "append_many":
            created, duplicates = [], []
            for item in payload["items"]:
                key = normalize_key(item["term"])
                if key in self.existing:
                    duplicates.append({"key": key, "term": item["term"],
                                       "lookup_count": 2, "meaning_vi": item["meaning_vi"]})
                else:
                    self.existing.add(key)
                    created.append({"key": key, "term": item["term"], "id": "x",
                                    "meaning_vi": item["meaning_vi"]})
            return {"ok": True, "op": "append_many", "created": created,
                    "duplicates": duplicates, "errors": []}
        raise AssertionError(f"unexpected op {op}")


def update_args(rows, *extra):
    argv, path = import_args(rows, *extra)
    argv[0] = "update"
    return argv, path


def import_args(rows, *extra):
    handle = tempfile.NamedTemporaryFile("w", suffix=".json", delete=False, encoding="utf-8")
    json.dump(rows, handle)
    handle.close()
    return ["import", "--file", handle.name, *extra], handle.name


ROWS = [
    {"term": "accuracy floor", "meaning_vi": "ngưỡng sàn độ chính xác", "type": "phrase",
     "context_note": "Set an accuracy floor from what one wrong answer would cost you."},
    {"term": "LLM judge", "meaning_vi": "dùng LLM khác để chấm output", "type": "tech_term",
     "source_url": "https://example.test/evals"},
]


class T5Import(unittest.TestCase):

    def tearDown(self):
        for arg in list(getattr(self, "_tmp", [])):
            os.unlink(arg)

    def _run(self, rows, *extra):
        argv, path = import_args(rows, *extra)
        self._tmp = getattr(self, "_tmp", []) + [path]
        return run(argv, ImportFake())

    def test_writes_all_rows_in_one_call(self):
        fake = ImportFake()
        argv, path = import_args(ROWS)
        self._tmp = [path]
        code, out, _ = run(argv, fake)
        self.assertEqual(code, cli.EXIT_OK)
        self.assertEqual([c["op"] for c in fake.calls], ["append_many"])
        self.assertEqual(len(fake.calls[0]["items"]), 2)
        self.assertIn("2 mới", out)

    def test_mixed_new_and_existing(self):
        fake = ImportFake(existing=["drift"])
        argv, path = import_args(ROWS + [{"term": "drift", "meaning_vi": "sự lệch",
                                          "context_note": "x"}])
        self._tmp = [path]
        code, out, _ = run(argv, fake)
        self.assertEqual(code, cli.EXIT_OK)
        self.assertIn("2 mới", out)
        self.assertIn("1 đã có", out)

    def test_chunks_large_import(self):
        rows = [{"term": f"term {i}", "meaning_vi": "nghĩa", "context_note": "ctx"}
                for i in range(120)]
        fake = ImportFake()
        argv, path = import_args(rows)
        self._tmp = [path]
        code, out, _ = run(argv, fake)
        self.assertEqual(code, cli.EXIT_OK)
        self.assertEqual([len(c["items"]) for c in fake.calls], [50, 50, 20])

    def test_rejects_rows_without_meaning(self):
        fake = ImportFake()
        argv, path = import_args([{"term": "floor", "context_note": "Set an accuracy floor"}])
        self._tmp = [path]
        code, out, _ = run(argv, fake)
        self.assertEqual(code, cli.EXIT_NEEDS)
        payload = json.loads(out)
        self.assertEqual(payload["reason"], "invalid_rows")
        self.assertEqual(payload["invalid"][0]["missing"], ["meaning_vi"])
        self.assertEqual(fake.calls, [])

    def test_rejects_rows_without_context(self):
        fake = ImportFake()
        argv, path = import_args([{"term": "floor", "meaning_vi": "ngưỡng sàn"}])
        self._tmp = [path]
        code, out, _ = run(argv, fake)
        self.assertEqual(code, cli.EXIT_NEEDS)
        self.assertEqual(json.loads(out)["invalid"][0]["missing"], ["context_note|source_url"])
        self.assertEqual(fake.calls, [])

    def test_rejects_word_type_that_contains_a_space(self):
        fake = ImportFake()
        argv, path = import_args([{"term": "heavy rain", "meaning_vi": "mưa to",
                                   "type": "word", "context_note": "Heavy rain hit the coast."}])
        self._tmp = [path]
        code, out, _ = run(argv, fake)
        self.assertEqual(code, cli.EXIT_NEEDS)
        self.assertEqual(json.loads(out)["invalid"][0]["missing"], ["type"])
        self.assertEqual(fake.calls, [])

    def test_allows_tech_term_with_a_space(self):
        fake = ImportFake()
        argv, path = import_args([{"term": "run cost", "meaning_vi": "chi phí một lượt chạy",
                                   "type": "tech_term", "context_note": "Add up the run cost."}])
        self._tmp = [path]
        code, _, _ = run(argv, fake)
        self.assertEqual(code, cli.EXIT_OK)
        self.assertEqual(fake.calls[0]["op"], "append_many")

    def test_allows_pattern_with_spaces_and_slots(self):
        fake = ImportFake()
        argv, path = import_args([{"term": "teach someone about something",
                                   "meaning_vi": "dạy ai về điều gì", "type": "pattern",
                                   "context_note": "Mr. Parker teaches them about letters."}])
        self._tmp = [path]
        code, _, _ = run(argv, fake)
        self.assertEqual(code, cli.EXIT_OK)
        self.assertEqual(fake.calls[0]["op"], "append_many")

    def test_dry_run_writes_nothing(self):
        fake = ImportFake(existing=["drift"])
        argv, path = import_args(ROWS, "--dry-run")
        self._tmp = [path]
        code, out, _ = run(argv, fake)
        self.assertEqual(code, cli.EXIT_OK)
        self.assertEqual([c["op"] for c in fake.calls], ["keys"])
        self.assertIn("chưa ghi gì", out)


class T6KeysAndMultiCheck(unittest.TestCase):

    def test_keys_plain(self):
        fake = ImportFake(existing=["drift", "rubric"])
        code, out, _ = run(["keys", "--plain"], fake)
        self.assertEqual(code, cli.EXIT_OK)
        self.assertEqual(out.split(), ["drift", "rubric"])

    def test_check_many_terms(self):
        fake = FakeApi(
            check={"ok": True, "key": "drift", "exists": True, "row": ROW},
        )
        code, out, _ = run(["check", "drift", "floor"], fake)
        self.assertEqual(code, cli.EXIT_OK)
        payload = json.loads(out)
        self.assertEqual(payload["count"], 2)
        self.assertTrue(payload["results"][0]["exists"])
        self.assertEqual(len(fake.calls), 2)


class DeleteFake:
    """Simulates check/delete; deleting a row really removes it from the fake sheet."""

    def __init__(self, existing=("drift", "rubric")):
        self.calls = []
        self.existing = {k: dict(ROW, key=k, term=k, type="word") for k in existing}

    def __call__(self, op, timeout=None, **payload):
        self.calls.append({"op": op, **payload})
        if op == "check":
            key = normalize_key(payload["term"])
            if key in self.existing:
                return {"ok": True, "key": key, "exists": True, "row": dict(self.existing[key])}
            return {"ok": True, "key": key, "exists": False, "row": None}
        if op == "delete":
            key = payload["key"]
            if key not in self.existing:
                raise api_module.ApiError("not_found", {"ok": False, "error": "not_found"})
            return {"ok": True, "op": "delete", "key": key, "id": "id-1",
                    "row": dict(self.existing.pop(key))}
        raise AssertionError(f"unexpected op {op}")


class UpdateFake:
    """Simulates the endpoint's update op: patches by key, not_found otherwise."""

    def __init__(self, existing=("drift",)):
        self.calls = []
        self.existing = {k: dict(ROW, key=k, term=k) for k in existing}

    def __call__(self, op, timeout=None, **payload):
        self.calls.append({"op": op, **payload})
        if op == "update":
            key = payload["key"]
            if key not in self.existing:
                raise api_module.ApiError("not_found", {"ok": False, "error": "not_found"})
            self.existing[key].update(payload["patch"])
            return {"ok": True, "op": "update", "key": key, "id": "id-1",
                    "row": dict(self.existing[key])}
        raise AssertionError(f"unexpected op {op}")


class T7Delete(unittest.TestCase):

    def test_deletes_and_asks_for_confirm(self):
        fake = DeleteFake()
        code, out, _ = run(["delete", "Drift."], fake)
        self.assertEqual(code, cli.EXIT_OK)
        self.assertEqual(fake.calls, [{"op": "delete", "key": "drift", "confirm": True}])
        self.assertIn("đã xoá", out)
        self.assertIn("1 đã xoá · 0 không thấy", out)
        self.assertEqual(list(fake.existing), ["rubric"])

    def test_missing_key_exits_needs_without_writing(self):
        fake = DeleteFake()
        code, out, _ = run(["delete", "nope"], fake)
        self.assertEqual(code, cli.EXIT_NEEDS)
        self.assertIn("không thấy", out)
        self.assertEqual(len(fake.existing), 2)

    def test_dry_run_never_deletes(self):
        fake = DeleteFake()
        code, out, _ = run(["delete", "drift", "--dry-run"], fake)
        self.assertEqual(code, cli.EXIT_OK)
        self.assertEqual([c["op"] for c in fake.calls], ["check"])
        self.assertIn("sẽ xoá", out)
        self.assertEqual(len(fake.existing), 2)

    def test_many_terms_in_one_call(self):
        fake = DeleteFake()
        code, out, _ = run(["delete", "drift", "rubric"], fake)
        self.assertEqual(code, cli.EXIT_OK)
        self.assertEqual(len([c for c in fake.calls if c["op"] == "delete"]), 2)
        self.assertEqual(fake.existing, {})


class T8MeaningShort(unittest.TestCase):

    def test_add_sends_meaning_short(self):
        fake = added()
        code, out, _ = run(["add", "drift", "--meaning-vi", "sự lệch chất lượng",
                            "--context", "Catch drift", "--meaning-short", "lệch"], fake)
        self.assertEqual(code, cli.EXIT_OK)
        self.assertEqual(fake.calls[0]["row"]["meaning_short"], "lệch")

    def test_list_prefers_short_meaning_and_falls_back(self):
        short = dict(ROW, meaning_short="lệch")
        fake = FakeApi(list={"ok": True, "count": 2, "rows": [short, dict(ROW, term="rubric")]})
        code, out, _ = run(["list"], fake)
        self.assertEqual(code, cli.EXIT_OK)
        self.assertIn("lệch", out)
        self.assertIn(ROW["meaning_vi"], out)  # fallback when meaning_short is empty


class T9Update(unittest.TestCase):

    def tearDown(self):
        for arg in list(getattr(self, "_tmp", [])):
            os.unlink(arg)

    def test_patches_by_normalized_key(self):
        fake = UpdateFake()
        argv, path = update_args([{"term": "  Drift. ", "meaning_short": "lệch"}])
        self._tmp = [path]
        code, out, _ = run(argv, fake)
        self.assertEqual(code, cli.EXIT_OK)
        self.assertEqual(fake.calls[0]["op"], "update")
        self.assertEqual(fake.calls[0]["key"], "drift")
        self.assertEqual(fake.calls[0]["patch"], {"meaning_short": "lệch"})
        self.assertIn("1 đã sửa · 0 lỗi", out)

    def test_missing_key_exits_needs(self):
        fake = UpdateFake()
        argv, path = update_args([{"term": "nope", "meaning_short": "x"}])
        self._tmp = [path]
        code, out, _ = run(argv, fake)
        self.assertEqual(code, cli.EXIT_NEEDS)
        self.assertIn("không thấy", out)

    def test_row_without_patch_fields_is_rejected(self):
        fake = UpdateFake()
        argv, path = update_args([{"term": "drift", "term_typo": "x"}])
        self._tmp = [path]
        code, out, _ = run(argv, fake)
        self.assertEqual(code, cli.EXIT_NEEDS)
        self.assertEqual(fake.calls, [])

    def test_dry_run_writes_nothing(self):
        fake = UpdateFake()
        argv, path = update_args([{"term": "drift", "meaning_short": "lệch"}], "--dry-run")
        self._tmp = [path]
        code, out, _ = run(argv, fake)
        self.assertEqual(code, cli.EXIT_OK)
        self.assertEqual(fake.calls, [])
        self.assertIn("sẽ sửa", out)


class T10Sheet(unittest.TestCase):
    """`vocab sheet` reads a review tab so answers can be graded."""

    def fake(self):
        return FakeApi(read={"ok": True, "op": "read", "sheet": "Shuffle",
                             "rows": [["drift", "en-vi", "lệch chất lượng"],
                                      ["rubric", "vi-en", ""]]})

    def test_defaults_to_shuffle_and_prints_direction(self):
        fake = self.fake()
        code, out, _ = run(["sheet"], fake)
        self.assertEqual(code, cli.EXIT_OK)
        self.assertEqual(fake.calls[0], {"op": "read", "sheet": "Shuffle"})
        self.assertIn("drift", out)
        self.assertIn("lệch chất lượng", out)
        self.assertIn("en-vi", out)
        self.assertIn("2 dòng · 1 có đáp án", out)

    def test_json_shape_for_card_tabs(self):
        code, out, _ = run(["sheet", "--name", "Recheck", "--json"], self.fake())
        self.assertEqual(code, cli.EXIT_OK)
        payload = json.loads(out)
        self.assertEqual(payload["sheet"], "Shuffle")  # whatever the endpoint reports
        self.assertEqual(payload["rows"][0], {"prompt": "drift", "direction": "en-vi",
                                              "answer": "lệch chất lượng"})
        self.assertEqual(payload["rows"][1], {"prompt": "rubric", "direction": "vi-en",
                                              "answer": ""})

    def test_json_keeps_three_columns_for_other_tabs(self):
        fake = FakeApi(read={"ok": True, "op": "read", "sheet": "glossary",
                             "rows": [["asynchronously", "bất đồng bộ", "không dùng chạy nền"]]})
        code, out, _ = run(["sheet", "--name", "glossary", "--json"], fake)
        self.assertEqual(code, cli.EXIT_OK)
        self.assertEqual(json.loads(out)["rows"][0]["note"], "không dùng chạy nền")


class T11ClearInbox(unittest.TestCase):
    """`vocab clear-inbox` dọn tab inbox, nhưng phải --confirm và chỉ từ đã có trong terms."""

    def fake(self):
        return FakeApi(clear_inbox={"ok": True, "removed": 2, "skipped": ["mittens"]})

    def test_needs_confirm_before_any_call(self):
        fake = self.fake()
        code, out, _ = run(["clear-inbox", "shovel", "scarf"], fake)
        self.assertEqual(code, cli.EXIT_NEEDS)
        self.assertEqual(fake.calls, [])
        self.assertEqual(json.loads(out)["reason"], "confirm_required")

    def test_confirmed_call_reports_removed_and_skipped(self):
        fake = self.fake()
        code, out, _ = run(["clear-inbox", "shovel", "scarf", "mittens", "--confirm"], fake)
        self.assertEqual(code, cli.EXIT_OK)
        self.assertEqual(fake.calls[0]["op"], "clear_inbox")
        self.assertEqual(fake.calls[0]["terms"], ["shovel", "scarf", "mittens"])
        self.assertIn("2 dòng đã xoá", out)
        self.assertIn("giữ lại: mittens", out)


class T12Draw(unittest.TestCase):
    """`vocab draw` ghi bộ thẻ vào Shuffle: prompt + chiều ở A/B, đáp án ở cột C."""

    def fake(self):
        return FakeApi(draw={"ok": True, "op": "draw", "sheet": "Shuffle", "count": 3,
                             "items": [{"prompt": "drift", "direction": "en-vi"},
                                       {"prompt": "ngưỡng sàn", "direction": "vi-en"},
                                       {"prompt": "accuracy floor", "direction": "en-vi"}]})

    def test_defaults_to_ten_and_labels_each_direction(self):
        fake = self.fake()
        code, out, _ = run(["draw"], fake)
        self.assertEqual(code, cli.EXIT_OK)
        self.assertEqual(fake.calls[0], {"op": "draw", "count": 10, "direction": "en"})
        self.assertIn("1. [EN→VI] drift", out)
        self.assertIn("2. [VI→EN] ngưỡng sàn", out)
        self.assertIn("3 thẻ · ghi đáp án vào cột C", out)

    def test_count_and_direction_are_forwarded(self):
        fake = self.fake()
        code, _, _ = run(["draw", "--count", "20", "--direction", "mixed"], fake)
        self.assertEqual(code, cli.EXIT_OK)
        self.assertEqual(fake.calls[0], {"op": "draw", "count": 20, "direction": "mixed"})

    def test_count_is_clamped_to_1_50(self):
        fake = self.fake()
        run(["draw", "--count", "999"], fake)
        self.assertEqual(fake.calls[0]["count"], 50)
        low = self.fake()
        run(["draw", "--count", "0"], low)
        self.assertEqual(low.calls[0]["count"], 1)

    def test_unknown_direction_never_calls_the_api(self):
        fake = self.fake()
        with self.assertRaises(SystemExit):
            run(["draw", "--direction", "fr"], fake)
        self.assertEqual(fake.calls, [])


class T13Recheck(unittest.TestCase):
    """`vocab recheck` ghi thẻ đến hạn vào Recheck, mặc định cả hai chiều."""

    def fake(self):
        return FakeApi(recheck={"ok": True, "op": "recheck", "sheet": "Recheck", "count": 2,
                                "items": [{"prompt": "drift", "direction": "en-vi"},
                                          {"prompt": "lệch chất lượng", "direction": "vi-en"}]})

    def test_defaults_to_mixed_and_mentions_column_c(self):
        fake = self.fake()
        code, out, _ = run(["recheck"], fake)
        self.assertEqual(code, cli.EXIT_OK)
        self.assertEqual(fake.calls[0], {"op": "recheck", "count": 10, "direction": "mixed"})
        self.assertIn("[VI→EN] lệch chất lượng", out)
        self.assertIn("2 thẻ · ghi đáp án vào cột C", out)

    def test_direction_can_be_narrowed(self):
        fake = self.fake()
        run(["recheck", "--direction", "vi", "--count", "5"], fake)
        self.assertEqual(fake.calls[0], {"op": "recheck", "count": 5, "direction": "vi"})


if __name__ == "__main__":
    unittest.main(verbosity=2)