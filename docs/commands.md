# Lệnh

```bash
vocab import --file rows.json
vocab import --file - --dry-run
vocab check "drift" "accuracy floor"
vocab check --prompt "lệch chất lượng"
vocab list --status new --domain evals --limit 10
vocab list --json
vocab keys --plain
vocab mark drift --status learning
vocab mark drift --status known --direction vi
vocab sheet --name Shuffle
vocab sheet --name Recheck --json
vocab draw
vocab draw --count 20 --direction mixed
vocab recheck
vocab update --file glosses.json --dry-run
vocab clear-inbox shovel scarf --confirm
vocab reorder --dry-run
vocab reorder --confirm
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
- `check --prompt "<gloss>"` — tra ngược một biến thể `meaning_short` ra `term` (dùng khi chấm
  thẻ `vi-en`). Nhiều dòng khớp thì trả hết; không khớp → `not_found`, exit 2.
- `keys --plain` — danh sách key đã lưu, để pre-filter rẻ.
- `list` — lọc `--status` / `--domain`, `--limit` (mặc định 20), `--json` cho máy đọc. `--status`
  vẫn chỉ lọc chiều Anh→Việt (`status`).
- `update` — sửa field của dòng đã có, theo `key`: mỗi dòng
  `{"term": "...", "<field>": "..."}`, `--dry-run` để xem trước. `import` không cập nhật field
  khi trùng key, nên backfill phải dùng lệnh này.
- `mark` — đổi trạng thái ôn tập: `new` → `learning` → `known`. `--direction en|vi` (mặc định
  `en`) chọn trục: `en` ghi `status`, `vi` ghi `status_vi`.
- `sheet` — đọc tab ôn tập, chỉ đọc. Với `Shuffle`/`Recheck` trả `prompt` + `direction` (cột B) +
  `answer` (cột C); với `inbox`/`glossary` trả `term` + `answer` (B) + `note` (C).
- `draw` — trộn thẻ vào `Shuffle`: ghi `prompt` + chiều vào `A:B` (**value tĩnh**, xoá `A:C`
  trước). `--direction en|vi|mixed` (mặc định `en`), `--count N` mặc định 10, chặn 1..50.
- `recheck` — như `draw` nhưng ghi vào `Recheck` và chỉ lấy thẻ đến hạn: `learning` sau 3 ngày,
  `known` sau 30 ngày, theo từng chiều. Mặc định `--direction mixed`.
- `delete` — xoá hẳn dòng (không hoàn tác được), `--dry-run` để xem trước. Key không thấy →
  exit 2, không xoá gì.
- `clear-inbox` — dọn dòng đã xử lý trong `inbox`: bắt buộc `--confirm`; chỉ xoá từ **đã có**
  trong `terms`, còn lại trả `giữ lại`. Tên tab hard-code trong `Code.gs`.
- `reorder` — đưa tab `terms` về đúng thứ tự cột chuẩn (`HEADERS` trong `Code.gs`): `--dry-run`
  in thứ tự hiện tại/đích, cột sẽ thêm và cột lạ; `--confirm` mới chuyển thật. Move theo tên
  header, thêm cột thiếu (rỗng) đúng chỗ, áp lại dropdown `status`/`status_vi`, **không** đổi
  `updated_at` nên lịch ôn không reset. Chạy lại khi đã đúng → `moved: 0`, không ghi.
  Từ chối khi có cột lạ chứa dữ liệu (`unknown_header`) hoặc ô công thức (`formula_in_terms`).
- `ping` — kiểm tra endpoint + token.

## Exit codes

| code | nghĩa |
|---|---|
| 0 | xong |
| 1 | lỗi API / token / mạng (không ghi gì) |
| 2 | thiếu thông tin hoặc `delete` không thấy key (không ghi gì) |
