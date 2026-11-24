# AGENTS.md — vocab-cli

Tool nhỏ: CLI stdlib Python + Apps Script endpoint, ghi từ vựng vào một Google Sheet
private. **Sheet là UI duy nhất** — không thêm web UI/extension trừ khi user yêu cầu.

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
- `HEADERS` là hợp đồng với Sheet: chỉ **thêm cột ở cuối**, không đổi tên/xoá cột
  (server đọc header dòng 1, dữ liệu cũ vẫn phải đọc được).
- `normalizeKey()` (GAS) và `normalize_key()` (`vocab/normalize.py`) là bản sao của
  nhau — sửa cái này phải sửa cái kia và cập nhật `selftest()` + `T1Normalize`.
- `MAX_BATCH` (GAS) và `BATCH` (`vocab/cli.py`) phải bằng nhau.
- Dedupe theo `key`, không theo `term`: trùng thì `lookup_count+1`, **không** tạo dòng mới.
- Không có op xoá dòng (cố ý). Đừng thêm nếu user không yêu cầu.
- Nghĩa/IPA/ví dụ do agent soạn, không bắt user cung cấp — xem skill `vocab-capture`.
