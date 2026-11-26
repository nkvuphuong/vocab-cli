# Cài đặt & vận hành

Một lần, ~10 phút. Sau đó chỉ còn `vocab ...` và nói với agent.

## 1. Tạo Sheet

Tạo Google Sheet mới → **Share** → giữ **Restricted**, không thêm ai, không bật
"anyone with the link". Đây là lớp bảo vệ dữ liệu chính.

## 2. Dán script

Trong Sheet: **Extensions → Apps Script** → xoá nội dung mặc định → dán toàn bộ
[`apps-script/Code.gs`](../apps-script/Code.gs) → Save.

## 3. Đặt token + deploy

- Apps Script → **Project Settings → Script Properties → Add script property**
  - name: `TOKEN`
  - value: chuỗi random ≥ 32 byte, ví dụ
    `python3 -c "import secrets;print(secrets.token_urlsafe(32))"`
- **Deploy → New deployment → Web app**
  - Execute as: **Me**
  - Who has access: **Anyone** (bắt buộc để CLI gọi được không cần OAuth — token là cổng duy nhất)
- Copy **Web app URL** (`https://script.google.com/macros/s/AKfy.../exec`).

## 4. Cấu hình máy local

```bash
mkdir -p ~/.config/vocab-cli
cat > ~/.config/vocab-cli/config.json <<'JSON'
{ "endpoint": "https://script.google.com/macros/s/PASTE/exec", "token": "PASTE_TOKEN" }
JSON
chmod 600 ~/.config/vocab-cli/config.json
```

`TOKEN`/`ENDPOINT` cũng đọc được từ `VOCAB_TOKEN` / `VOCAB_ENDPOINT` (ưu tiên cao hơn file
config — dùng khi chạy CI, đừng dùng khi không cần).

## 5. Thêm PATH + kiểm tra

Dán đúng 3 dòng dưới, không kèm ghi chú — zsh gõ tay không coi `#` là comment:

```bash
echo 'export PATH="$HOME/path/to/vocab-cli/bin:$PATH"' >> ~/.zshrc
source ~/.zshrc
vocab ping
```

Kết quả đúng: `{ "ok": true, "op": "ping", "sheet": "terms", "rows": 0 }`.
Muốn đặt lệnh ở `/usr/local/bin` thì cần `sudo` — PATH là cách gọn hơn.

Tiếp theo: tạo các tab ôn tập theo [sheet.md](sheet.md).

## Sửa `Code.gs` thì phải deploy lại

Endpoint live **không** tự cập nhật. Dán lại file trong Apps Script editor → **Deploy →
Manage deployments → Edit → New version** (chỉ Save là chưa đủ). Quên bước này thì CLI mới
gặp op lạ sẽ báo `unknown_op`.

## Bảo mật

| Mối đe doạ | Chặn bằng |
|---|---|
| Link Sheet lộ | Sheet Restricted, không share → link vô dụng |
| URL Web App lộ | token 32B so sánh constant-time, allowlist 11 op (5 read-only), cap 1000 row/6h |
| Token bị commit | config ngoài repo (`~/.config`), 600, `.gitignore` chặn `config.json`/`.env` |
| Script lạm quyền | chỉ `SpreadsheetApp` của đúng file, không `DriveApp` |
| Token lộ thật | đổi `TOKEN` trong Script Properties + config; Sheet vẫn private nên dữ liệu không bị đọc |

**Residual risk:** endpoint để "Anyone" nên token là cổng duy nhất. Ai có token thì đọc/ghi
được nội dung từ vựng (dữ liệu ít nhạy cảm) và có thể append rác — rotate token là xử lý xong.

## Self-check

```bash
python3 tests/test_cli.py    # CLI + gate + chunking (no network, API faked)
node tests/test_gas.js       # chạy Code.gs thật với SpreadsheetApp giả lập
```

`test_gas.js` bắt lỗi logic append/dedupe/draw **trước khi** dán vào editor. Trong Apps Script
editor còn một lớp nữa: chọn hàm `selftest` → Run → Logs phải là `selftest OK`.

## Troubleshoot

| Triệu chứng | Nguyên nhân |
|---|---|
| `ln: PATH: No such file or directory` | Dán kèm comment `#` khi gõ trong zsh: `#` chỉ là comment khi bật `setopt interactive_comments`. Triệu chứng khác của cùng lỗi: `zsh: no matches found: chưa?`, `vocab: error: unrecognized arguments: # ...`. Chỉ dán phần lệnh, không dán ghi chú cuối dòng. |
| `CERTIFICATE_VERIFY_FAILED` | Bản Python tải từ python.org không có CA path. `vocab/api.py` dùng `certifi` nếu có; nếu vẫn lỗi thì chạy `/Applications/Python 3.13/Install Certificates.command`. |
| `HTTP 405` hoặc HTML thay vì JSON | Apps Script trả 302 sang `script.googleusercontent.com` (chỉ nhận GET). Bản mới follow redirect bằng GET; nếu tự viết `curl` thì dùng `curl -L` (không `-X POST`). |
| `error: unauthorized` | token trong config khác `Script Properties.TOKEN`, hoặc chưa deploy lại sau khi sửa |
| `error: missing_meaning_vi` | `add` gọi mà không có `--meaning-vi` (gate hoạt động đúng) |
| HTML thay vì JSON, hoặc `HTTP 401` | deployment để access "Only myself" thay vì "Anyone" |
| `error: daily_cap_reached` | >1000 row trong ~6h — chờ, hoặc nâng `DAILY_WRITE_CAP` |
| `unknown_op` | endpoint chạy `Code.gs` cũ: dán lại file → Deploy → **New version** |
| `delete` báo `not_found` | key sai hoặc dòng đã bị xoá — `vocab keys --plain` để xem key thật |
| `error: confirm_required` | gọi `delete`/`clear_inbox` thẳng qua HTTP mà thiếu `confirm:true`; CLI luôn gửi kèm — riêng `vocab clear-inbox` cần cờ `--confirm` |
| `error: sheet_not_found` | `vocab sheet` gõ sai tên tab (`--name`), hoặc tab chưa tạo; `vocab draw` cần tab `Shuffle` |
| `error: no_candidates` | mọi từ đã `known` — thêm từ mới hoặc `vocab mark` về `learning` |
| `too_many_items` | gửi >50 item trong 1 request — dùng `vocab import` (tự chia lô) |
| Sửa `Code.gs` xong không thấy đổi | phải **Deploy → Manage deployments → Edit → New version** |
