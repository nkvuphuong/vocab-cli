# AGENTS.md — vocab-cli

Tool nhỏ: CLI stdlib Python + Apps Script endpoint, ghi từ vựng vào một Google Sheet
private. **Sheet là UI duy nhất** — không thêm web UI/extension trừ khi user yêu cầu.

Skill `vocab-capture` nằm trong repo (`.opencode/skills/`), đọc nó trước khi lưu từ.
Lệnh `vocab` chỉ có trong PATH khi user đã export; nếu không, gọi `bin/vocab` (tương đối
từ repo root) hoặc `<repo>/bin/vocab`.

## Kiểm tra trước khi kết thúc

```bash
python3 tests/test_cli.py    # CLI + gate + import chunking (no network, API faked)
node tests/test_gas.js       # chạy Code.gs thật với SpreadsheetApp giả lập
```

Sửa `apps-script/Code.gs` thì **bắt buộc** chạy `node tests/test_gas.js`. Sau khi sửa,
endpoint live KHÔNG tự cập nhật: user phải dán lại file trong Apps Script editor và
Deploy → Manage deployments → Edit → **New version**.

## Ràng buộc

- **Không bao giờ** đưa token/endpoint vào repo hay vào lệnh shell. Config ở
  `~/.config/vocab-cli/config.json` (600, ngoài repo).
- `HEADERS` là hợp đồng với Sheet: **thứ tự trong `HEADERS` phải khớp thứ tự cột thật**
  (`append`/`append_many` ghi theo vị trí; đọc và ghi một ô thì theo tên). Chèn hoặc đổi
  thứ tự cột phải sửa Sheet và `HEADERS` cùng lúc. Không đổi tên cột.
- `meaning_short` (gloss 1–4 từ) đứng ngay trước `meaning_vi` (nghĩa đầy đủ). Cả hai đều
  do agent soạn; `meaning_short` là cột người đọc quét nhanh.
- `normalizeKey()` (GAS) và `normalize_key()` (`vocab/normalize.py`) là bản sao của
  nhau — sửa cái này phải sửa cái kia và cập nhật `selftest()` + `T1Normalize`.
- `MAX_BATCH` (GAS) và `BATCH` (`vocab/cli.py`) phải bằng nhau.
- Dedupe theo `key`, không theo `term`: trùng thì `lookup_count+1`, **không** tạo dòng mới.
- `delete` là op phá huỷ duy nhất: bắt buộc `confirm: true`, trả về row đã xoá, xoá theo
  `key` đã chuẩn hoá. Không thêm `delete_many` — 11 lệnh rời vẫn rẻ hơn một op xoá hàng loạt.
- Nghĩa/IPA/ví dụ do agent soạn, không bắt user cung cấp — xem skill `vocab-capture`.
