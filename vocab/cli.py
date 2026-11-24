"""vocab — capture English vocab into a private Google Sheet."""

import argparse
import json
import sys

from . import api
from .normalize import normalize_key

EXIT_OK = 0
EXIT_API = 1
EXIT_NEEDS = 2  # caller must supply more info; nothing was written

STATUSES = ["new", "learning", "known"]
TYPES = ["word", "phrase", "idiom", "phrasal_verb", "collocation", "abbrev", "tech_term"]
EXAMPLE_TYPES = ["source", "generated"]
SOURCE_TYPES = ["url", "text", "term"]

SUMMARY_FIELDS = ["term", "key", "type", "cefr", "domain", "ipa", "meaning_vi", "status",
                  "example", "source_url", "id"]


def _emit(obj):
    print(json.dumps(obj, ensure_ascii=False, indent=2))


def _needs(reason, **extra):
    _emit({"ok": False, "needs_context": True, "reason": reason, **extra})
    return EXIT_NEEDS


def _summary(row):
    return {f: row.get(f, "") for f in SUMMARY_FIELDS}


# ------------------------------------------------------------------- commands

def cmd_add(args):
    term = (args.term or "").strip()
    if not term:
        return _needs("missing_term")
    if not (args.meaning_vi or "").strip():
        return _needs(
            "missing_meaning_vi",
            hint="Look at the sourced sentence, decide the sense, then pass --meaning-vi.",
            term=term,
        )
    if not (args.context or args.source_url):
        return _needs(
            "missing_context",
            hint="Ask the user which sentence/sense, or pass --source-url / --context.",
            term=term,
        )

    row = {
        "term": term,
        "meaning_vi": args.meaning_vi.strip(),
        "context_note": args.context or "",
        "source_type": args.source_type or ("url" if args.source_url else "text"),
        "source_url": args.source_url or "",
        "source_title": args.source_title or "",
    }
    for name in ("type", "cefr", "pos", "domain", "ipa", "meaning_en",
                 "example", "example_type", "status"):
        value = getattr(args, name)
        if value:
            row[name] = value

    result = api.call("append", row=row)
    payload = {
        "ok": True,
        "created": result["created"],
        "duplicate": result["duplicate"],
        **_summary(result["row"]),
    }
    if result["duplicate"]:
        payload["existing_meaning_vi"] = result["row"].get("meaning_vi", "")
        payload["lookup_count"] = result["row"].get("lookup_count", "")
        print(f"already saved: {payload['term']} — {payload['existing_meaning_vi']}",
              file=sys.stderr)
    _emit(payload)
    return EXIT_OK


def cmd_check(args):
    term = (args.term or "").strip()
    if not term:
        return _needs("missing_term")
    result = api.call("check", term=term)
    if not result["exists"]:
        _emit({"ok": True, "exists": False, "key": result["key"]})
        return EXIT_OK
    _emit({"ok": True, "exists": True, **_summary(result["row"])})
    return EXIT_OK


def cmd_list(args):
    result = api.call("list", status=args.status or "", domain=args.domain or "",
                      limit=args.limit)
    rows = result["rows"]
    if args.json:
        _emit({"ok": True, "count": len(rows), "rows": [_summary(r) for r in rows]})
        return EXIT_OK

    if not rows:
        print("(no terms)")
        return EXIT_OK

    table = [["term", "ipa", "meaning_vi", "status", "domain"]]
    for row in rows:
        meaning = str(row.get("meaning_vi", ""))
        table.append([
            str(row.get("term", "")),
            str(row.get("ipa", "")),
            meaning if len(meaning) <= 55 else meaning[:52] + "...",
            str(row.get("status", "")),
            str(row.get("domain", "")),
        ])
    widths = [max(len(r[i]) for r in table) for i in range(len(table[0]))]
    for row in table:
        print("  ".join(cell.ljust(widths[i]) for i, cell in enumerate(row)).rstrip())
    return EXIT_OK


def cmd_mark(args):
    term = (args.term or "").strip()
    if not term:
        return _needs("missing_term")
    if args.status not in STATUSES:
        return _needs("invalid_status", allowed=STATUSES)
    result = api.call("update", key=normalize_key(term), patch={"status": args.status})
    _emit({"ok": True, "term": result["row"].get("term", term),
           "status": result["row"].get("status", ""), "id": result.get("id", "")})
    return EXIT_OK


def cmd_ping(args):
    _emit(api.call("ping"))
    return EXIT_OK


# ---------------------------------------------------------------------- parser

def build_parser():
    parser = argparse.ArgumentParser(prog="vocab", description=__doc__)
    sub = parser.add_subparsers(dest="command", required=True)

    add = sub.add_parser("add", help="save a term/phrase (dedupes on the normalized term)")
    add.add_argument("term", nargs="?", help="word or phrase")
    add.add_argument("--term")
    add.add_argument("--meaning-vi", required=False, help="meaning in the current context")
    add.add_argument("--context", help="the sentence/paragraph it came from")
    add.add_argument("--type", choices=TYPES)
    add.add_argument("--cefr", help="A1..C2 (optional)")
    add.add_argument("--pos", help="noun/verb/adj/...")
    add.add_argument("--domain", help="topic tag, e.g. evals,git,devops,business")
    add.add_argument("--ipa", help="IPA, e.g. /drɪft/")
    add.add_argument("--meaning-en")
    add.add_argument("--example", help="example sentence")
    add.add_argument("--example-type", choices=EXAMPLE_TYPES)
    add.add_argument("--source-type", choices=SOURCE_TYPES)
    add.add_argument("--source-url")
    add.add_argument("--source-title")
    add.add_argument("--status", choices=STATUSES)
    add.set_defaults(func=cmd_add)

    check = sub.add_parser("check", help="does this term already exist?")
    check.add_argument("term")
    check.set_defaults(func=cmd_check)

    lst = sub.add_parser("list", help="browse saved terms")
    lst.add_argument("--status", choices=STATUSES)
    lst.add_argument("--domain")
    lst.add_argument("--limit", type=int, default=20)
    lst.add_argument("--json", action="store_true")
    lst.set_defaults(func=cmd_list)

    mark = sub.add_parser("mark", help="set review status")
    mark.add_argument("term")
    mark.add_argument("--status", required=True)  # validated in cmd_mark for a JSON error
    mark.set_defaults(func=cmd_mark)

    ping = sub.add_parser("ping", help="check endpoint + token")
    ping.set_defaults(func=cmd_ping)

    return parser


def main(argv=None):
    args = build_parser().parse_args(argv)
    try:
        return args.func(args)
    except api.ApiError as err:
        _emit({"ok": False, "error": str(err), "detail": err.payload})
        return EXIT_API
