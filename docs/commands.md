# Lệnh

```bash
vocab import --file rows.json
vocab import --file - --dry-run
vocab check "drift" "accuracy floor"
vocab list --status new --domain evals --limit 10
vocab list --json
vocab keys --plain
vocab mark drift --status learning
vocab sheet --name Shuffle
vocab sheet --name Recheck --json
vocab draw
vocab draw --count 20
vocab update --file glosses.json --dry-run
vocab clear-inbox shovel scarf --confirm
vocab delete "block a merge" "narrow the gap"
vocab delete "block a merge" --dry-run
vocab add "drift" --meaning-vi "sự lệch chất lượng" --context "…"
vocab ping
```

## Từng lệnh

- `import` — đường dẫn chính: nhận JSON array (hoặc `{"items": [...]}`), dedupe theo `key`,
  trùng thì chỉ `lookup_count+1`. Mọi dòng phải có `term`, `meaning_vi` và (`context_note`
  hoặc `source_url`) — thiếu thì **không ghi gì**, exit 2. Tự chia lô 50 dòng/request.
- `import --dry-run` — in `mới` / `đã có` mà không ghi.
- `add` — lưu đúng 1 từ bằng cờ (`--meaning-vi`, `--context`, `--ipa`, …); vẫn dùng được nhưng
  agent dùng `import` là chính.
- `check` — kiểm tra tồn tại + in nghĩa cũ (nhiều từ một lượt).
- `keys --plain` — danh sách key đã lưu, để pre-filter rẻ.
- `list` — lọc `--status` / `--domain`, `--limit` (mặc định 20), `--json` cho máy đọc.
- `update` — sửa field của dòng đã có, theo `key`: mỗi dòng
  `{"term": "...", "<field>": "..."}`, `--dry-run` để xem trước. `import` không cập nhật field
  khi trùng key, nên backfill phải dùng lệnh này.
- `mark` — đổi trạng thái ôn tập: `new` → `learning` → `known`.
- `sheet` — đọc tab ôn tập (`Shuffle`/`Recheck`/`inbox`/`glossary`), in `term` + cột B; `--json`
  cho máy. Chỉ đọc, không ghi gì.
- `draw` — trộn bộ từ mới vào `Shuffle`: ghi `term` vào cột A dưới dạng **value tĩnh** (xoá
  `A:B` trước). `--count N` mặc định 10, endpoint chặn 1..50.
- `delete` — xoá hẳn dòng (không hoàn tác được), `--dry-run` để xem trước. Key không thấy →
  exit 2, không xoá gì.
- `clear-inbox` — dọn dòng đã xử lý trong `inbox`: bắt buộc `--confirm`; chỉ xoá từ **đã có**
  trong `terms`, còn lại trả `giữ lại`. Tên tab hard-code trong `Code.gs`.
- `ping` — kiểm tra endpoint + token.

## Exit codes

| code | nghĩa |
|---|---|
| 0 | xong |
| 1 | lỗi API / token / mạng (không ghi gì) |
| 2 | thiếu thông tin hoặc `delete` không thấy key (không ghi gì) |
