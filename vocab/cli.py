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
DIRECTIONS = ["en", "vi", "mixed"]
TYPES = ["word", "phrase", "idiom", "phrasal_verb", "collocation", "abbrev", "tech_term",
         "pattern"]
EXAMPLE_TYPES = ["source", "generated"]
SOURCE_TYPES = ["url", "text", "term"]

SUMMARY_FIELDS = ["term", "meaning_short", "status", "status_vi", "ipa", "meaning_vi",
                  "type", "domain", "cefr", "example", "source_url", "key", "id"]

WRITABLE = ["type", "cefr", "pos", "domain", "ipa", "meaning_short", "meaning_vi",
            "meaning_en", "example", "example_type", "context_note", "source_type",
            "source_url", "source_title", "status", "status_vi"]

BATCH = 50  # must match MAX_BATCH in apps-script/Code.gs


def _emit(obj):
    print(json.dumps(obj, ensure_ascii=False, indent=2))


def _needs(reason, **extra):
    _emit({"ok": False, "needs_context": True, "reason": reason, **extra})
    return EXIT_NEEDS


def _summary(row):
    return {f: row.get(f, "") for f in SUMMARY_FIELDS}


def _clip(text, width=55):
    text = str(text or "")
    return text if len(text) <= width else text[: width - 3] + "..."


def _table(header, rows):
    if not rows:
        print("(no terms)")
        return
    data = [header] + [[_clip(c, 60) for c in row] for row in rows]
    widths = [max(len(str(r[i])) for r in data) for i in range(len(header))]
    for row in data:
        print("  ".join(str(c).ljust(widths[i]) for i, c in enumerate(row)).rstrip())


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
    for name in ("type", "cefr", "pos", "domain", "ipa", "meaning_short", "meaning_vi",
                 "meaning_en", "example", "example_type", "status"):
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


def _validate(items):
    """Every row needs a term, a meaning_vi and a context or source url."""
    valid, invalid = [], []
    for item in items:
        if not isinstance(item, dict):
            invalid.append({"term": "", "missing": ["row"]})
            continue
        term = str(item.get("term") or "").strip()
        missing = []
        if not term:
            missing.append("term")
        if not str(item.get("meaning_vi") or "").strip():
            missing.append("meaning_vi")
        if not str(item.get("context_note") or "").strip() and not str(item.get("source_url") or "").strip():
            missing.append("context_note|source_url")
        if item.get("type") in ("word", "abbrev") and " " in normalize_key(term):
            missing.append("type")  # a `word` with a space is a phrase; keep the type honest
        if missing:
            invalid.append({"term": term, "missing": missing})
        else:
            valid.append(dict(item, term=term))
    return valid, invalid


def _load_items(path):
    raw = sys.stdin.read() if path == "-" else open(path, encoding="utf-8").read()
    data = json.loads(raw)
    if isinstance(data, dict):
        data = data.get("items", [])
    if not isinstance(data, list):
        raise ValueError("expected a JSON array of rows")
    return data


def _import_rows(items):
    created, duplicates, errors = [], [], []
    for start in range(0, len(items), BATCH):
        result = api.call("append_many", items=items[start:start + BATCH])
        created += result.get("created", [])
        duplicates += result.get("duplicates", [])
        errors += result.get("errors", [])
    return created, duplicates, errors


def cmd_import(args):
    try:
        items = _load_items(args.file)
    except (OSError, ValueError) as err:
        return _needs("bad_input", detail=str(err))

    valid, invalid = _validate(items)
    if invalid:
        return _needs("invalid_rows", invalid=invalid,
                      hint="Each row needs term, meaning_vi and context_note or source_url; "
                           "type word/abbrev must be a single word.")

    if args.dry_run:
        known = set(api.call("keys").get("keys", []))
        rows, new = [], 0
        for item in valid:
            is_new = normalize_key(item["term"]) not in known
            new += 1 if is_new else 0
            rows.append([item["term"], item.get("type", ""), item.get("meaning_vi", ""),
                         "mới" if is_new else "đã có"])
        if args.json:
            _emit({"ok": True, "dry_run": True, "new": new,
                   "existing": len(valid) - new, "rows": rows})
        else:
            _table(["term", "loại", "nghĩa", "kết quả"], rows)
            print(f"dry-run: {new} mới, {len(valid) - new} đã có — chưa ghi gì")
        return EXIT_OK

    created, duplicates, errors = _import_rows(valid)

    if args.json:
        _emit({"ok": True, "counts": {"created": len(created), "duplicates": len(duplicates),
                                      "errors": len(errors)},
               "created": created, "duplicates": duplicates, "errors": errors})
        return EXIT_OK if not errors else EXIT_NEEDS

    meanings = {item["term"]: item.get("meaning_vi", "") for item in valid}
    types = {item["term"]: item.get("type", "") for item in valid}
    rows = [[c["term"], types.get(c["term"], ""), meanings.get(c["term"], ""), "mới"]
            for c in created]
    rows += [[d["term"], types.get(d["term"], ""), d.get("meaning_vi", ""),
              f"đã có (gặp lần {d.get('lookup_count', '')})"] for d in duplicates]
    rows += [[e.get("term", ""), "", e.get("error", ""), "lỗi"] for e in errors]
    _table(["term", "loại", "nghĩa", "kết quả"], rows)
    print(f"{len(created)} mới · {len(duplicates)} đã có · {len(errors)} lỗi")
    return EXIT_OK if not errors else EXIT_NEEDS


def cmd_check(args):
    if args.prompt is not None:
        return _check_prompt(args.prompt)
    if not args.terms:
        return _needs("missing_term")
    results = []
    for term in args.terms:
        result = api.call("check", term=term.strip())
        if not result["exists"]:
            results.append({"term": term, "exists": False, "key": result["key"]})
        else:
            results.append({"exists": True, **_summary(result["row"])})
    if len(results) == 1:
        _emit({"ok": True, **results[0]})
    else:
        _emit({"ok": True, "count": len(results), "results": results})
    return EXIT_OK


def _check_prompt(prompt):
    """Reverse lookup for vi→en cards: a Vietnamese gloss in, the stored term out."""
    if not prompt.strip():
        return _needs("missing_prompt")
    try:
        result = api.call("check", prompt=prompt.strip())
    except api.ApiError as err:
        if str(err) != "not_found":
            raise
        _emit({"ok": False, "error": "not_found", "prompt": prompt})
        return EXIT_NEEDS
    fields = ("term", "meaning_short", "meaning_vi", "status", "status_vi")
    matches = [{f: m.get(f, "") for f in fields} for m in result.get("matches", [])]
    _emit({"ok": True, "prompt": prompt, "count": len(matches), "matches": matches})
    return EXIT_OK


def cmd_keys(args):
    result = api.call("keys")
    if args.plain:
        for key in result.get("keys", []):
            print(key)
        return EXIT_OK
    _emit(result)
    return EXIT_OK


def cmd_list(args):
    result = api.call("list", status=args.status or "", domain=args.domain or "",
                      limit=args.limit)
    rows = result["rows"]
    if args.json:
        _emit({"ok": True, "count": len(rows), "rows": [_summary(r) for r in rows]})
        return EXIT_OK
    _table(["term", "ipa", "nghĩa", "status", "domain"],
           [[r.get("term", ""), r.get("ipa", ""),
             _clip(r.get("meaning_short") or r.get("meaning_vi", "")),
             r.get("status", ""), r.get("domain", "")] for r in rows])
    return EXIT_OK


def cmd_update(args):
    """Patches existing rows by key. Used to backfill columns like meaning_short."""
    try:
        items = _load_items(args.file)
    except (OSError, ValueError) as err:
        return _needs("bad_input", detail=str(err))

    rows, changed, failed = [], 0, 0
    for item in items:
        if not isinstance(item, dict):
            rows.append(["", "", "row không phải object"])
            failed += 1
            continue
        term = str(item.get("term") or item.get("key") or "").strip()
        patch = {k: item[k] for k in WRITABLE if k in item and k != "term"}
        if not term or not patch:
            rows.append([term, "", "thiếu term hoặc không có field nào để sửa"])
            failed += 1
            continue
        fields = _clip(", ".join(f"{k}={v}" for k, v in patch.items()), 50)
        if args.dry_run:
            rows.append([term, fields, "sẽ sửa"])
            changed += 1
            continue
        try:
            result = api.call("update", key=normalize_key(term), patch=patch)
        except api.ApiError as err:
            if str(err) != "not_found":
                raise
            rows.append([term, fields, "không thấy"])
            failed += 1
            continue
        rows.append([result["row"].get("term", term), fields, "đã sửa"])
        changed += 1

    if args.json:
        _emit({"ok": not failed, "dry_run": args.dry_run, "changed": changed,
               "failed": failed, "rows": rows})
    else:
        _table(["term", "sửa gì", "kết quả"], rows)
        print(f"{changed} {'sẽ sửa' if args.dry_run else 'đã sửa'} · {failed} lỗi")
    return EXIT_OK if not failed else EXIT_NEEDS


def cmd_mark(args):
    term = (args.term or "").strip()
    if not term:
        return _needs("missing_term")
    if args.status not in STATUSES:
        return _needs("invalid_status", allowed=STATUSES)
    field = "status_vi" if args.direction == "vi" else "status"
    result = api.call("update", key=normalize_key(term), patch={field: args.status})
    _emit({"ok": True, "term": result["row"].get("term", term),
           "direction": args.direction,
           "status": result["row"].get("status", ""),
           "status_vi": result["row"].get("status_vi", ""), "id": result.get("id", "")})
    return EXIT_OK


def cmd_sheet(args):
    """Prints a review tab: card tabs have (prompt, direction, answer) in A/B/C."""
    result = api.call("read", sheet=args.name)
    raw = [r for r in result.get("rows", []) if r and str(r[0]).strip()]
    card = args.name.strip().lower() in ("shuffle", "recheck")

    if args.json:
        rows = []
        for r in raw:
            if card:
                rows.append({"prompt": str(r[0]),
                             "direction": str(r[1]) if len(r) > 1 else "",
                             "answer": str(r[2]) if len(r) > 2 else ""})
            else:
                rows.append({"term": str(r[0]),
                             "answer": str(r[1]) if len(r) > 1 else "",
                             "note": str(r[2]) if len(r) > 2 else ""})
        _emit({"ok": True, "sheet": result.get("sheet", args.name), "count": len(rows),
               "rows": rows})
        return EXIT_OK

    if card:
        table = [[i + 1, str(r[0]), str(r[2]) if len(r) > 2 else "",
                  str(r[1]) if len(r) > 1 else ""] for i, r in enumerate(raw)]
        _table(["#", "prompt", "bạn viết", "chiều"], table)
        answered = sum(1 for r in table if str(r[2]).strip())
    else:
        table = [[i + 1, str(r[0]), str(r[1]) if len(r) > 1 else ""]
                 for i, r in enumerate(raw)]
        _table(["#", "term", "bạn viết"], table)
        answered = sum(1 for r in table if str(r[2]).strip())
    print(f"{len(table)} dòng · {answered} có đáp án")
    return EXIT_OK


def cmd_draw(args):
    return _cards(args, "draw")


def cmd_recheck(args):
    return _cards(args, "recheck")


def _cards(args, op):
    """Writes one batch of review cards; prints each prompt with its direction."""
    result = api.call(op, count=min(max(args.count, 1), 50), direction=args.direction)
    items = result.get("items", [])
    for i, item in enumerate(items, 1):
        label = "EN→VI" if item.get("direction") == "en-vi" else "VI→EN"
        print(f"{i:>2}. [{label}] {item.get('prompt', '')}")
    print(f"{len(items)} thẻ · ghi đáp án vào cột C")
    return EXIT_OK


def cmd_delete(args):
    rows, hit, missing = [], 0, 0
    for term in args.terms:
        key = normalize_key(term.strip())
        if args.dry_run:
            found = api.call("check", term=term.strip())
            row = found.get("row") or {}
            rows.append([row.get("term", term), row.get("type", ""),
                         "sẽ xoá" if found["exists"] else "không thấy"])
            hit, missing = (hit + 1, missing) if found["exists"] else (hit, missing + 1)
            continue
        if not key:
            rows.append([term, "", "trống"])
            missing += 1
            continue
        try:
            result = api.call("delete", key=key, confirm=True)
        except api.ApiError as err:
            if str(err) != "not_found":
                raise
            rows.append([term, "", "không thấy"])
            missing += 1
            continue
        rows.append([result["row"].get("term", term), result["row"].get("type", ""), "đã xoá"])
        hit += 1

    if args.json:
        _emit({"ok": not missing, "dry_run": args.dry_run, "deleted": hit,
               "missing": missing, "rows": rows})
    else:
        _table(["term", "loại", "kết quả"], rows)
        print(f"{hit} {'sẽ xoá' if args.dry_run else 'đã xoá'} · {missing} không thấy")
    return EXIT_OK if not missing else EXIT_NEEDS


def cmd_clear_inbox(args):
    """Deletes inbox rows for terms already saved in `terms`; needs --confirm."""
    if not args.terms:
        return _needs("missing_terms")
    if not args.confirm:
        return _needs("confirm_required", terms=args.terms,
                      hint="Hỏi user trước, rồi chạy lại với --confirm.")

    result = api.call("clear_inbox", terms=args.terms, confirm=True)
    removed, skipped = result.get("removed", 0), result.get("skipped", [])
    if args.json:
        _emit({"ok": True, "removed": removed, "skipped": skipped})
    else:
        for term in skipped:
            print(f"giữ lại: {term} (chưa có trong terms)")
        print(f"{removed} dòng đã xoá khỏi inbox · {len(skipped)} từ giữ lại")
    return EXIT_OK


def cmd_reorder(args):
    """Moves the `terms` columns into the canonical order; needs --confirm."""
    if args.dry_run:
        result = api.call("reorder", dry_run=True)
        print("hiện tại: " + " · ".join(result.get("current") or []))
        print("đích:     " + " · ".join(result.get("target") or []))
        if result.get("added"):
            print("thêm:     " + " · ".join(result["added"]))
        if result.get("unknown"):
            print("cột lạ:   " + " · ".join(result["unknown"]) + " (có dữ liệu → --confirm sẽ từ chối)")
        return EXIT_OK
    if not args.confirm:
        return _needs("confirm_required",
                      hint="Chạy --dry-run để xem diff, rồi --confirm để chuyển cột.")

    result = api.call("reorder", confirm=True)
    added = result.get("added") or []
    print(f"đã chuyển {result.get('moved', 0)} cột · thêm {len(added)}"
          + (f" ({', '.join(added)})" if added else ""))
    return EXIT_OK


def cmd_ping(args):
    _emit(api.call("ping"))
    return EXIT_OK


# ---------------------------------------------------------------------- parser

def build_parser():
    parser = argparse.ArgumentParser(prog="vocab", description=__doc__)
    sub = parser.add_subparsers(dest="command", required=True)

    add = sub.add_parser("add", help="save one term (dedupes on the normalized term)")
    add.add_argument("term", nargs="?", help="word or phrase")
    add.add_argument("--term")
    add.add_argument("--meaning-short", help="1-4 word gloss; what `list` and the tabs show")
    add.add_argument("--meaning-vi", help="meaning in the current context")
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

    imp = sub.add_parser("import", help="append a JSON array of rows (agent path)")
    imp.add_argument("--file", "-f", default="-", help="path, or - for stdin (default)")
    imp.add_argument("--dry-run", action="store_true", help="show new/existing, write nothing")
    imp.add_argument("--json", action="store_true")
    imp.set_defaults(func=cmd_import)

    check = sub.add_parser("check", help="does this term already exist?")
    check.add_argument("terms", nargs="*")
    check.add_argument("--prompt", help="reverse lookup: a meaning_short gloss → term")
    check.set_defaults(func=cmd_check)

    keys = sub.add_parser("keys", help="list every saved key (cheap pre-filter)")
    keys.add_argument("--plain", action="store_true")
    keys.set_defaults(func=cmd_keys)

    lst = sub.add_parser("list", help="browse saved terms")
    lst.add_argument("--status", choices=STATUSES)
    lst.add_argument("--domain")
    lst.add_argument("--limit", type=int, default=20)
    lst.add_argument("--json", action="store_true")
    lst.set_defaults(func=cmd_list)

    upd = sub.add_parser("update", help="patch fields of existing rows (backfill)")
    upd.add_argument("--file", "-f", default="-", help="path, or - for stdin (default)")
    upd.add_argument("--dry-run", action="store_true", help="show the patches, write nothing")
    upd.add_argument("--json", action="store_true")
    upd.set_defaults(func=cmd_update)

    mark = sub.add_parser("mark", help="set review status")
    mark.add_argument("term")
    mark.add_argument("--status", required=True)  # validated in cmd_mark for a JSON error
    mark.add_argument("--direction", choices=("en", "vi"), default="en",
                      help="trục trạng thái: en = status, vi = status_vi")
    mark.set_defaults(func=cmd_mark)

    ping = sub.add_parser("ping", help="check endpoint + token")
    ping.set_defaults(func=cmd_ping)

    sheet = sub.add_parser("sheet", help="read a review tab so the answers can be graded")
    sheet.add_argument("--name", default="Shuffle", help="tab name (default Shuffle)")
    sheet.add_argument("--json", action="store_true")
    sheet.set_defaults(func=cmd_sheet)

    draw = sub.add_parser("draw", help="write N new cards into the Shuffle tab")
    draw.add_argument("--count", type=int, default=10)
    draw.add_argument("--direction", choices=DIRECTIONS, default="en")
    draw.set_defaults(func=cmd_draw)

    recheck_parser = sub.add_parser("recheck", help="write due cards into the Recheck tab")
    recheck_parser.add_argument("--count", type=int, default=10)
    recheck_parser.add_argument("--direction", choices=DIRECTIONS, default="mixed")
    recheck_parser.set_defaults(func=cmd_recheck)

    clear = sub.add_parser("clear-inbox",
                           help="delete inbox rows whose term is already saved in terms")
    clear.add_argument("terms", nargs="+")
    clear.add_argument("--confirm", action="store_true", help="actually delete (ask user first)")
    clear.add_argument("--json", action="store_true")
    clear.set_defaults(func=cmd_clear_inbox)

    delete = sub.add_parser("delete", help="remove rows for good (Sheet has no undo)")
    delete.add_argument("terms", nargs="+")
    delete.add_argument("--dry-run", action="store_true", help="show what would go, delete nothing")
    delete.add_argument("--json", action="store_true")
    delete.set_defaults(func=cmd_delete)

    reorder = sub.add_parser("reorder",
                             help="move terms columns into the canonical order (Code.gs HEADERS)")
    reorder.add_argument("--dry-run", action="store_true", help="show current/target, write nothing")
    reorder.add_argument("--confirm", action="store_true", help="actually move the columns")
    reorder.set_defaults(func=cmd_reorder)

    return parser


def main(argv=None):
    args = build_parser().parse_args(argv)
    try:
        return args.func(args)
    except api.ApiError as err:
        payload = {"ok": False, "error": str(err), "detail": err.payload}
        if str(err) == "unknown_op":
            payload["hint"] = ("endpoint is running an older Code.gs — paste it again and "
                               "deploy a new version (Manage deployments → Edit)")
        _emit(payload)
        return EXIT_API
