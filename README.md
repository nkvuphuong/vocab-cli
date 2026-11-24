# vocab-cli

Lưu từ/cụm từ tiếng Anh gặp khi đọc docs vào một Google Sheet **private**, có phân loại,
IPA, nghĩa theo ngữ cảnh và câu ví dụ. Không UI, không dependency, không API key LLM —
phần "hiểu nghĩa" do agent trong phiên chat làm.

```
agent (chat) ──► bin/vocab ──HTTPS+token──► Apps Script ──► Google Sheet (Restricted)
```

- Sheet là nơi bạn **xem lại** (điện thoại/web), có tab `Review` + `Shuffle`.
- `bin/vocab` chỉ là HTTP client ~200 dòng, stdlib, không giữ secret trong repo.
  (`certifi` là dependency **tuỳ chọn**, chỉ cần khi OpenSSL của Python không có CA path.)

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
echo 'export PATH="$HOME/path/to/vocab-cli/bin:$PATH"' >> ~/.zshrc
source ~/.zshrc
vocab ping
```

Kết quả đúng: `{ "ok": true, "op": "ping", "sheet": "terms", "rows": 0 }`

Nếu muốn đặt lệnh ở `/usr/local/bin` thì cần `sudo` — PATH là cách gọn hơn.

`TOKEN`/`ENDPOINT` cũng đọc được từ biến môi trường `VOCAB_TOKEN` / `VOCAB_ENDPOINT`
(ưu tiên cao hơn file config — dùng khi chạy CI, đừng dùng khi không cần).

## Dùng

**Cách chính: nói với agent, không gõ lệnh.**

> "lưu từ vựng từ `https://academy.claude.com/courses/introduction-to-evals`"
> "lưu các từ mới trong đoạn này: …"
> "lưu `accuracy floor`"  ← từ trần, agent sẽ hỏi 1 câu để chọn nghĩa

Agent đọc nguồn, tự trích từ/cụm từ đáng lưu (cả thuật ngữ IT và từ nâng cao), tự viết
nghĩa tiếng Việt + IPA + câu ví dụ, rồi gọi `vocab import` một lần và trả về bảng:

```
term             loại       nghĩa                              kết quả
accuracy floor   phrase     ngưỡng sàn độ chính xác tối thiểu   mới
drift            tech_term  lệch chất lượng theo thời gian      đã có (gặp lần 3)

12 mới · 3 đã có · 0 lỗi
```

Bạn **không** cần cung cấp nghĩa, phiên âm hay ví dụ. Không giới hạn số từ mỗi lượt;
CLI tự chia lô 50 dòng/request.

### Lệnh cho agent (và cho bạn khi cần)

```bash
vocab import --file rows.json
vocab import --file - --dry-run
vocab check "drift" "accuracy floor"
vocab list --status new --domain evals --limit 10
vocab list --json
vocab keys --plain
vocab mark drift --status learning
vocab delete "block a merge" "narrow the gap"
vocab delete "block a merge" --dry-run
```

- `import` — đường dẫn chính: nhận JSON array (hoặc `{"items": [...]}`), dedupe theo
  `key`, trùng thì chỉ `lookup_count+1`. Mọi dòng phải có `term`, `meaning_vi` và
  (`context_note` hoặc `source_url`) — thiếu thì **không ghi gì**, exit 2.
- `import --dry-run` — in `mới` / `đã có` mà không ghi.
- `check` — kiểm tra tồn tại + in nghĩa cũ (nhiều từ một lượt).
- `keys` — danh sách key đã lưu, để pre-filter rẻ.
- `list --json` — dạng máy đọc.
- `mark` — đổi trạng thái ôn tập: `new` → `learning` → `known`.
- `delete` — xoá hẳn dòng (không hoàn tác được): `vocab delete "block a merge"`,
  hoặc `--dry-run` để xem trước. Key không thấy → exit 2, không xoá gì.
- `add` — lưu đúng 1 từ bằng cờ (`--meaning-vi`, `--context`, …); vẫn dùng được nhưng
  agent dùng `import` là chính.

Ví dụ JSON cho `import`:

```json
[
  {"term": "accuracy floor", "meaning_vi": "ngưỡng sàn độ chính xác tối thiểu phải đạt",
   "type": "phrase", "cefr": "C1", "domain": "evals",
   "example": "Set an accuracy floor from what one wrong answer would cost you.",
   "example_type": "source",
   "context_note": "Set an accuracy floor from what one wrong answer would cost you.",
   "source_url": "https://academy.claude.com/courses/introduction-to-evals"}
]
```

### Exit codes

| code | nghĩa |
|---|---|
| 0 | xong |
| 1 | lỗi API / token / mạng (không ghi gì) |
| 2 | thiếu thông tin hoặc `delete` không thấy key (không ghi gì) |

## Cột trong sheet

`id key term type cefr pos domain ipa meaning_vi meaning_en example example_type
context_note source_type source_url source_title status lookup_count last_seen_at
created_at updated_at` → A…U.

- `key` = term đã chuẩn hoá (lowercase, gộp space, bỏ dấu câu hai đầu) — **dedupe theo cột này**.
- Gặp lại từ cũ: không thêm dòng, chỉ `lookup_count + 1` và cập nhật `last_seen_at`.
- Server đọc header ở dòng 1 nên **đổi thứ tự cột vẫn được**; đừng đổi tên header,
  đừng xoá dòng (xoá thì `mark` báo `not_found`, không hỏng gì khác).

## Xem lại trên điện thoại (M4)

Trong Sheet tạo 4 tab, dán công thức vào ô A1:

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

**Tab `Words`** — chỉ từ đơn (key không có dấu cách):
```
=IFERROR(SORT(CHOOSECOLS(FILTER(terms!A2:U,(terms!B2:B<>"")*ISERROR(FIND(" ",terms!B2:B))),3,8,9,4),1,TRUE),"no terms yet")
```

**Tab `Phrases`** — chỉ cụm từ (key có dấu cách):
```
=IFERROR(SORT(CHOOSECOLS(FILTER(terms!A2:U,ISNUMBER(FIND(" ",terms!B2:B))),3,8,9,4),1,TRUE),"no terms yet")
```
Hai tab này dựa vào cột `key` sau chuẩn hoá: `high-stakes` nằm ở `Words` (một từ ghép),
`back up` / `at any price` nằm ở `Phrases`. Đây là **view**, không phải nơi lưu — sửa
`status` bằng `vocab mark`, đừng sửa trong 2 tab này.

**Dropdown cho cột `status`** (Q2:Q): Data → Data validation → List of items →
`new, learning, known`.

## Bảo mật

| Mối đe doạ | Chặn bằng |
|---|---|
| Link Sheet lộ | Sheet Restricted, không share → link vô dụng |
| URL Web App lộ | token 32B so sánh constant-time, chỉ 8 op trong allowlist, cap 1000 row/6h |
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
| `error: daily_cap_reached` | >1000 row trong ~6h — chờ, hoặc nâng `DAILY_WRITE_CAP` |
| `unknown_op` | endpoint chạy `Code.gs` cũ: dán lại file → Deploy → **New version** |
| `delete` báo `not_found` | key sai hoặc dòng đã bị xoá — `vocab keys --plain` để xem key thật |
| `error: confirm_required` | gọi `delete` thẳng qua HTTP mà thiếu `confirm:true`; CLI luôn gửi kèm |
| `too_many_items` | gửi >50 item trong 1 request — dùng `vocab import` (tự chia lô) |
| Sửa `Code.gs` xong không thấy đổi | phải **Deploy → Manage deployments → Edit → New version** |

Chạy self-check của tool:
```bash
python3 tests/test_cli.py
node tests/test_gas.js
```
`test_gas.js` chạy `Code.gs` với SpreadsheetApp/CacheService giả lập — bắt lỗi logic
append/dedupe **trước khi** dán vào editor. Ngoài ra trong Apps Script editor: chọn hàm
`selftest` → Run → xem Logs `selftest OK`.
