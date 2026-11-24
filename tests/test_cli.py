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
        self.assertEqual(json.loads(out)["status"], "known")

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
    """`vocab sheet` reads the review tab so answers can be graded."""

    def fake(self):
        return FakeApi(read={"ok": True, "op": "read", "sheet": "Shuffle",
                             "rows": [["drift", "lệch chất lượng"], ["rubric", ""]]})

    def test_defaults_to_shuffle_and_prints_answers(self):
        fake = self.fake()
        code, out, _ = run(["sheet"], fake)
        self.assertEqual(code, cli.EXIT_OK)
        self.assertEqual(fake.calls[0], {"op": "read", "sheet": "Shuffle"})
        self.assertIn("drift", out)
        self.assertIn("lệch chất lượng", out)
        self.assertIn("2 dòng · 1 có đáp án", out)

    def test_json_shape(self):
        code, out, _ = run(["sheet", "--name", "Recheck", "--json"], self.fake())
        self.assertEqual(code, cli.EXIT_OK)
        payload = json.loads(out)
        self.assertEqual(payload["sheet"], "Shuffle")  # whatever the endpoint reports
        self.assertEqual(payload["rows"][0], {"term": "drift", "answer": "lệch chất lượng"})
        self.assertEqual(payload["rows"][1], {"term": "rubric", "answer": ""})


if __name__ == "__main__":
    unittest.main(verbosity=2)