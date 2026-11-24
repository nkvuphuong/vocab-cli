# vocab-cli

Lưu từ/cụm từ tiếng Anh gặp khi đọc docs vào một Google Sheet **private**, có phân loại,
IPA, nghĩa theo ngữ cảnh và câu ví dụ. Không UI, không dependency, không API key LLM —
phần "hiểu nghĩa" do agent trong phiên chat làm.

```
agent (chat) ──► bin/vocab ──HTTPS+token──► Apps Script ──► Google Sheet (Restricted)
```

- Sheet là nơi bạn **xem lại** (điện thoại/web), có tab `Review` + `Shuffle`.
- `bin/vocab` chỉ là HTTP client ~200 dòng, stdlib, không giữ secret trong repo.

## Cài đặt (làm 1 lần, ~10 phút)

**1. Tạo Sheet**
Tạo Google Sheet mới → nút **Share** → giữ **Restricted**, không thêm ai, không bật
"anyone with the link". Đây là lớp bảo vệ dữ liệu chính.

**2. Dán script**
Trong Sheet: **Extensions → Apps Script** → xoá nội dung mặc định → dán toàn bộ
`apps-script/Code.gs` → Save.

**3. Đặt token + deploy**
- Apps Script → **Project Settings → Script Properties → Add script property**
  - name: `TOKEN`
  - value: một chuỗi random ≥ 32 byte, ví dụ `python3 -c "import secrets;print(secrets.token_urlsafe(32))"`
- **Deploy → New deployment → Web app**
  - Execute as: **Me**
  - Who has access: **Anyone** (bắt buộc, để CLI gọi được không cần OAuth — token là cổng duy nhất)
- Copy **Web app URL** (dạng `https://script.google.com/macros/s/AKfy.../exec`).

**4. Cấu hình máy local**
```bash
mkdir -p ~/.config/vocab-cli
cat > ~/.config/vocab-cli/config.json <<'JSON'
{ "endpoint": "https://script.google.com/macros/s/PASTE/exec", "token": "PASTE_TOKEN" }
JSON
chmod 600 ~/.config/vocab-cli/config.json
```

**5. Kiểm tra**
Thêm `bin/` vào PATH (copy nguyên 3 dòng dưới, không dán kèm ghi chú — zsh không coi
`#` là comment khi gõ tay, nó sẽ thành một lệnh lỗi):

```bash
echo 'export PATH="$HOME/Documents/dev/personal_projects/vocab-cli/bin:$PATH"' >> ~/.zshrc
source ~/.zshrc
vocab ping
```

Kết quả đúng: `{ "ok": true, "op": "ping", "sheet": "terms", "rows": 0 }`

Nếu muốn đặt lệnh ở `/usr/local/bin` thì cần `sudo` — PATH là cách gọn hơn.

`TOKEN`/`ENDPOINT` cũng đọc được từ biến môi trường `VOCAB_TOKEN` / `VOCAB_ENDPOINT`
(ưu tiên cao hơn file config — dùng khi chạy CI, đừng dùng khi không cần).

## Dùng

Lưu một từ (dán nguyên khối, **không** kèm ghi chú `#` — zsh sẽ coi đó là argument):

```bash
vocab add drift \
  --meaning-vi "sự lệch chất lượng model/output theo thời gian" \
  --context "Catch drift by grading a nightly sample of live traffic." \
  --type tech_term --cefr C1 --domain evals --ipa "/drɪft/" \
  --example "Catch drift by grading a nightly sample of live traffic." \
  --example-type source \
  --source-url "https://academy.claude.com/courses/introduction-to-evals" \
  --source-title "Introduction to evals"
```

Các lệnh còn lại, mỗi lệnh một dòng:

```bash
vocab check drift
vocab list --status new --domain evals --limit 10
vocab list --json
vocab mark drift --status learning
```

`check` = đã có chưa (in luôn nghĩa cũ, exit 0 cả khi chưa có, xem `exists`).
`list --json` = dạng máy đọc, cho agent.
`mark` = đổi trạng thái ôn tập: `new` → `learning` → `known`.

`add` **từ chối ghi** (exit `2`, JSON `{"needs_context": true}`) khi thiếu
`--meaning-vi` hoặc thiếu cả `--context` lẫn `--source-url`. Đó là gate chống lưu
nghĩa đoán — agent phải hỏi lại ngữ cảnh trước.

### Exit codes

| code | nghĩa |
|---|---|
| 0 | xong |
| 1 | lỗi API / token / mạng (không ghi gì) |
| 2 | thiếu thông tin, cần hỏi lại (không ghi gì) |

## Cột trong sheet

`id key term type cefr pos domain ipa meaning_vi meaning_en example example_type
context_note source_type source_url source_title status lookup_count last_seen_at
created_at updated_at` → A…U.

- `key` = term đã chuẩn hoá (lowercase, gộp space, bỏ dấu câu hai đầu) — **dedupe theo cột này**.
- Gặp lại từ cũ: không thêm dòng, chỉ `lookup_count + 1` và cập nhật `last_seen_at`.
- Server đọc header ở dòng 1 nên **đổi thứ tự cột vẫn được**; đừng đổi tên header,
  đừng xoá dòng (xoá thì `mark` báo `not_found`, không hỏng gì khác).

## Xem lại trên điện thoại (M4)

Trong Sheet tạo 2 tab, dán công thức vào ô A1:

**Tab `Review`** — từ chưa thuộc, mới gặp gần đây trước:
```
=IFERROR(SORT(CHOOSECOLS(FILTER(terms!A2:U,terms!Q2:Q<>"known"),3,8,9,11,17,19),6,FALSE),"no terms yet")
```

**Tab `Shuffle`** — 10 flashcard ngẫu nhiên (term, IPA, nghĩa):
```
=IFERROR(LET(d,FILTER(terms!A2:U,terms!Q2:Q<>"known"),
  ARRAY_CONSTRAIN(CHOOSECOLS(SORT({d,RANDARRAY(ROWS(d))},22,FALSE),3,8,9),10,3)),"no terms yet")
```
`RANDARRAY` là volatile → tab này xáo lại mỗi khi sheet tính lại; muốn xáo tay thì
sửa 1 ô trống bất kỳ. Ở `Shuffle`, che cột nghĩa (cột C) nếu muốn tự nhớ trước.

**Dropdown cho cột `status`** (Q2:Q): Data → Data validation → List of items →
`new, learning, known`.

## Bảo mật

| Mối đe doạ | Chặn bằng |
|---|---|
| Link Sheet lộ | Sheet Restricted, không share → link vô dụng |
| URL Web App lộ | token 32B so sánh constant-time, chỉ 5 op trong allowlist, cap 200 write/6h |
| Token bị commit | config nằm ngoài repo (`~/.config`), 600, `.gitignore` chặn `config.json`/`.env` |
| Script lạm quyền | chỉ `SpreadsheetApp` của đúng file, không `DriveApp` |
| Token lộ thật | đổi `TOKEN` trong Script Properties + config; Sheet vẫn private nên dữ liệu không bị đọc |

**Residual risk:** endpoint để "Anyone" nên token là cổng duy nhất. Ai có token thì
đọc/ghi được nội dung từ vựng (dữ liệu ít nhạy cảm) và có thể append rác — rotate token
là xử lý xong.

## Troubleshoot

| Triệu chứng | Nguyên nhân |
|---|---|
| `ln: PATH: No such file or directory` | Dán kèm comment `#` khi gõ trong zsh: `#` chỉ là comment khi bật `setopt interactive_comments`. Triệu chứng khác của cùng lỗi: `zsh: no matches found: chưa?`, `vocab: error: unrecognized arguments: # ...`. Chỉ dán phần lệnh, không dán ghi chú cuối dòng. |
| `CERTIFICATE_VERIFY_FAILED` | Bản Python tải từ python.org không có CA path. `vocab/api.py` dùng `certifi` nếu có; nếu vẫn lỗi thì chạy `/Applications/Python 3.13/Install Certificates.command`. |
| `HTTP 405` hoặc HTML thay vì JSON | Apps Script trả 302 sang `script.googleusercontent.com` (chỉ nhận GET). Bản mới follow redirect bằng GET; nếu bạn tự viết `curl` thì dùng `curl -L` (không `-X POST`). |
| `error: unauthorized` | token trong config khác `Script Properties.TOKEN`, hoặc chưa deploy lại sau khi sửa |
| `error: missing_meaning_vi` | `add` gọi mà không có `--meaning-vi` (gate hoạt động đúng) |
| HTML thay vì JSON, hoặc `HTTP 401` | deployment để access "Only myself" thay vì "Anyone" |
| `error: daily_cap_reached` | >200 lần ghi trong ~6h — chờ, hoặc nâng `DAILY_WRITE_CAP` |
| Sửa `Code.gs` xong không thấy đổi | phải **Deploy → Manage deployments → Edit → New version** |

Chạy self-check của tool:
```bash
python3 tests/test_cli.py
```
Và trong Apps Script editor: chọn hàm `selftest` → Run → xem Logs `selftest OK`.
