#!/usr/bin/env python3
"""Self-check for vocab-cli. No network: the API is faked.

    python3 tests/test_cli.py
"""

import io
import json
import os
import sys
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


if __name__ == "__main__":
    unittest.main(verbosity=2)
