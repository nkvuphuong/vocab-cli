# AGENTS.md — vocab-cli

Tool nhỏ: CLI stdlib Python + Apps Script endpoint, ghi từ vựng vào một Google Sheet
private. **Sheet là UI duy nhất** — không thêm web UI/extension trừ khi user yêu cầu.

Skill nằm trong repo (`.opencode/skills/`): `vocab-capture` (trích/lưu từ) và `vocab-grade`
(chấm bài trên `Shuffle`/`Recheck`). Đọc skill tương ứng trước khi làm.
Lệnh `vocab` chỉ có trong PATH khi user đã export; nếu không, gọi `bin/vocab` (tương đối
từ repo root) hoặc `<repo>/bin/vocab`.

## Prompt → lệnh

| User nói | Làm gì | Skill |
|---|---|---|
| "lưu từ vựng từ `<URL/đoạn văn>`" | trích ứng viên → soạn đủ cột → `vocab import` | `vocab-capture` |
| "lưu `<một từ/cụm>`" | chưa có ngữ cảnh → hỏi 1 câu chọn nghĩa → `vocab import` | `vocab-capture` mục 3 |
| "điền inbox" | `vocab sheet --name inbox --json` → `vocab check` từng từ → soạn → `vocab import` → **hỏi** → `vocab clear-inbox … --confirm` | `vocab-capture` mục 0 |
| "chấm bài" | `vocab sheet --name Shuffle/Recheck` → `vocab check` → `vocab mark` | `vocab-grade` |
| "sửa nghĩa/gloss của X" | `vocab update --file` (không `import`, không sửa tay Sheet) | `vocab-capture` mục 4 |

Lệnh/exit code và luồng từng prompt có trong `README.md` (mục "Dùng", "Nhập từ mới bằng cách
gõ vào Sheet", "Chấm bài").

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
- Không chèn cột, không ghi ra ngoài `terms`: `terms` là tab duy nhất agent ghi nội dung;
  `inbox`, `Shuffle`, `Recheck` là tab user tự gõ — agent đọc qua `vocab sheet --name <tab>`.
  Chỉ `inbox` được xoá dòng, và chỉ qua `clear_inbox` (xem dưới).
- `inbox` (tính năng nhập tay): user gõ từ vào cột A hoặc B, agent soạn đủ cột còn lại rồi
  `vocab import` (`source_type: "term"`, `example_type: "generated"`). Từ mơ hồ thì **hỏi**,
  không đoán. Từ đã có trong `terms` thì skip. Sau khi import, hỏi user rồi mới
  `vocab clear-inbox <terms> --confirm` để dọn dòng đã xử lý; từ chưa lưu được giữ nguyên.
- `glossary` (tuỳ chọn, user ghi): A = term EN (có thể là họ từ), B = gloss chuẩn (nhiều biến thể
  ngăn ` · `), C = ghi chú/cấm kỵ. Agent **chỉ đọc** trước khi soạn gloss
  (`vocab sheet --name glossary --json`), bỏ qua dòng header nếu có; không ghi, không xoá.
  User sửa gloss thì thêm một dòng vào đây — đó là luật cho cả họ từ, mạnh hơn `terms`.
- `HEADERS` là hợp đồng với Sheet: **thứ tự trong `HEADERS` phải khớp thứ tự cột thật**
  (`append`/`append_many` ghi theo vị trí; đọc và ghi một ô thì theo tên). Chèn hoặc đổi
  thứ tự cột phải sửa Sheet và `HEADERS` cùng lúc. Không đổi tên cột.
- `meaning_short` (1–3 gloss ngăn bằng ` · `, gloss đầu là cách gọi phổ biến nhất) đứng ngay
  trước `meaning_vi` (nghĩa đầy đủ). Cả hai đều do agent soạn; `meaning_short` là cột người đọc
  quét nhanh; user chốt gloss nào thì sửa ô còn 1 giá trị.
- `normalizeKey()` (GAS) và `normalize_key()` (`vocab/normalize.py`) là bản sao của
  nhau — sửa cái này phải sửa cái kia và cập nhật `selftest()` + `T1Normalize`.
- `MAX_BATCH` (GAS) và `BATCH` (`vocab/cli.py`) phải bằng nhau.
- Dedupe theo `key`, không theo `term`: trùng thì `lookup_count+1`, **không** tạo dòng mới.
- `delete` và `clear_inbox` là **hai op phá huỷ**, cả hai bắt buộc `confirm: true`:
  `delete` xoá một dòng trong `terms` theo `key` đã chuẩn hoá và trả về row đã xoá;
  `clear_inbox` chỉ xoá dòng trong tab `inbox`, chỉ khi `term` đó **đã có** trong `terms`
  (không có thì trả về `skipped` và giữ dòng), tên tab hard-code nên không đụng được
  `Shuffle`/`Recheck`. Không thêm `delete_many` — lệnh rời vẫn rẻ hơn một op xoá hàng loạt.
- `read` là op chỉ-đọc duy nhất trả cell thô của **một tab bất kỳ** (không nhận range), để
  `vocab sheet` đọc bài làm. Không mở đường ghi ra ngoài `terms` — ngoại lệ duy nhất là
  `clear_inbox` ở trên.
- Cột B của `Shuffle`/`Recheck` là bài làm của người dùng: agent đọc, **không ghi, không xoá**.
- Lịch ôn dùng `status` + `updated_at` (3/30 ngày nằm trong công thức `Recheck`), không thêm
  cột SRS trừ khi user yêu cầu.
- Nghĩa/IPA/ví dụ do agent soạn, không bắt user cung cấp — xem skill `vocab-capture`.
