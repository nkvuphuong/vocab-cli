# Sheet: tab ôn tập, cột, glossary

Sheet là UI duy nhất của tool: điện thoại mở Google Sheets, xem/sửa như bình thường. Agent chỉ
ghi tab `terms`; hai ngoại lệ duy nhất là `vocab draw` và `vocab recheck`, mỗi lệnh ghi `A:B` của
đúng tab `Shuffle` / `Recheck`. Các tab còn lại là của bạn.

## Tab `terms` — nơi lưu duy nhất

23 cột, thứ tự chuẩn:

```
A term · B meaning_short · C status · D status_vi · E ipa · F meaning_vi
G meaning_en · H type · I pos · J cefr · K domain · L example
M example_type · N context_note · O source_url · P source_title · Q source_type
R lookup_count · S last_seen_at · T created_at · U updated_at · V key · W id
```

Năm cột đọc hằng ngày nằm ở A–E; `key`/`id` là cột máy dùng nên ở cuối.

- `key` = `term` đã chuẩn hoá (lowercase, gộp space, bỏ dấu câu hai đầu) — **dedupe theo cột này**.
- `meaning_short` = gloss 1–4 từ để quét nhanh (tab `Words`/`Phrases` và `vocab list` hiện cột
  này); `meaning_vi` = nghĩa đầy đủ theo ngữ cảnh.
- Gặp lại từ cũ: không thêm dòng, chỉ `lookup_count + 1` và cập nhật `last_seen_at`.
- **Vị trí cột do header row quyết định**, không phải `HEADERS`: endpoint đọc/ghi theo tên header
  nên kéo cột đi đâu cũng đúng. Muốn đổi thứ tự thì chạy `vocab reorder --confirm`, đừng kéo tay
  (kéo tay thì dropdown không đi theo). Đừng đổi tên header, đừng xoá dòng (xoá thì `mark` báo
  `not_found`, không hỏng gì khác).
- `status` là chiều **Anh→Việt**, `status_vi` là chiều **Việt→Anh**; mỗi trục `new` → `learning`
  → `known`, độc lập nhau (một từ có thể `known` chiều này, `learning` chiều kia). Dòng mới được
  ghi `new` ở cả hai cột; ô trống chỉ còn ở dòng cũ và vẫn tính là `new`, không cần backfill.
  Dropdown cho C2:C và D2:D:
  Data → Data validation → List of items → `new, learning, known`.
- Nếu header `status_vi` chưa có, lệnh ghi chiều Việt→Anh trả `missing_header` chứ không ghi
  hụt. `vocab reorder --confirm` thêm cột đó (rỗng) đúng vị trí.

### Đổi thứ tự cột

```bash
vocab reorder --dry-run    # in thứ tự hiện tại, thứ tự đích, cột sẽ thêm, cột lạ
vocab reorder --confirm    # move thật
```

Lệnh chuyển value theo tên header, thêm cột thiếu ở đúng chỗ (rỗng), áp lại dropdown
`status`/`status_vi` và format ngày cho 3 cột thời gian. Nó **không** đổi `updated_at` nên lịch
ôn không reset, và chạy lại khi đã đúng thứ tự thì không ghi gì (`moved: 0`).

Thêm cột mới trong tương lai: thêm field vào `HEADERS` (`Code.gs`) ở đúng vị trí muốn, deploy,
rồi `vocab reorder --confirm`. Không phải thêm ở cuối, không phải sửa chỗ ghi.

Lệnh từ chối ghi khi gặp cột lạ **có dữ liệu** (`unknown_header`) hoặc ô công thức trong `terms`
(`formula_in_terms`) — xử lý tay trước rồi chạy lại.

## Ba tab xem lại (công thức)

Tạo 3 tab, dán công thức vào ô A1. Đây là **view**, không phải nơi lưu — muốn đổi trạng thái
thì dùng `vocab mark`, đừng sửa trong các tab này.

**Tab `Review`** — từ chưa thuộc, mới gặp gần đây trước:
```
=IFERROR(SORT(CHOOSECOLS(FILTER(terms!A2:ZZ;INDEX(terms!A2:ZZ;;MATCH("status";terms!1:1;0))<>"known");MATCH("term";terms!1:1;0);MATCH("ipa";terms!1:1;0);MATCH("meaning_short";terms!1:1;0);MATCH("example";terms!1:1;0);MATCH("status";terms!1:1;0);MATCH("last_seen_at";terms!1:1;0));6;FALSE);"no terms yet")
```

**Tab `Words`** — chỉ từ đơn (key không có dấu cách):
```
=IFERROR(SORT(CHOOSECOLS(FILTER(terms!A2:ZZ;(INDEX(terms!A2:ZZ;;MATCH("key";terms!1:1;0))<>"")*ISERROR(FIND(" ";INDEX(terms!A2:ZZ;;MATCH("key";terms!1:1;0)))));MATCH("term";terms!1:1;0);MATCH("ipa";terms!1:1;0);MATCH("meaning_short";terms!1:1;0);MATCH("type";terms!1:1;0));1;TRUE);"no terms yet")
```

**Tab `Phrases`** — chỉ cụm từ (key có dấu cách):
```
=IFERROR(SORT(CHOOSECOLS(FILTER(terms!A2:ZZ;ISNUMBER(FIND(" ";INDEX(terms!A2:ZZ;;MATCH("key";terms!1:1;0)))));MATCH("term";terms!1:1;0);MATCH("ipa";terms!1:1;0);MATCH("meaning_short";terms!1:1;0);MATCH("type";terms!1:1;0));1;TRUE);"no terms yet")
```
Công thức tìm cột bằng `MATCH("<header>"; terms!1:1; 0)` nên đổi thứ tự cột không làm hỏng view.

**Dấu phân cách**: Sheet này dùng locale lấy `;` làm dấu ngăn tham số và `,` làm dấu thập phân
(`=SUM(1;2)` → 3). Dán công thức bằng `,` sẽ ra `#ERROR!`. Nếu đổi locale của Sheet sang
kiểu Mỹ thì phải đổi hết `;` thành `,`.
Hai tab này dựa vào `key` sau chuẩn hoá: `high-stakes` nằm ở `Words` (một từ ghép),
`back up` / `at any price` nằm ở `Phrases`.

**Tab `Recheck`** — không còn công thức. Bộ thẻ đến hạn do `vocab recheck` ghi vào (xem
[hai tab thẻ](#hai-tab-thẻ-shuffle-và-recheck)). Lần đầu chạy lệnh này, công thức cũ ở `A1` bị xoá.

## Hai tab thẻ: `Shuffle` và `Recheck`

Cả hai tab dùng **cùng một layout**, chỉ khác nguồn thẻ:

```
A = prompt                     B = en-vi | vi-en        C = bài làm của bạn
   en-vi: từ tiếng Anh            chiều học               gõ câu trả lời ở đây
   vi-en: gloss tiếng Việt
```

- `Shuffle` = pool **chưa thuộc** (`status`/`status_vi` khác `known`). `vocab draw` ghi vào đây.
- `Recheck` = pool **đến hạn**: `learning` sau 3 ngày, `known` sau 30 ngày, tính từ `updated_at`
  và theo từng chiều. `vocab recheck` ghi vào đây, mặc định trộn cả hai chiều.
- Cả hai lệnh xoá `A:C` trước khi ghi → bộ thẻ cũ và đáp án cũ mất. Chỉ chạy khi bạn yêu cầu.
- Cột A/B là value tĩnh, không phải công thức: gõ đáp án ở C hay `vocab mark` đều **không** làm
  thẻ xê dịch. Bộ thẻ chỉ đổi khi chạy lại lệnh.
- `--direction en|vi|mixed` (mặc định `en` cho `draw`, `mixed` cho `recheck`); `--count` 1..50.
- Lần đầu chạy trên `Shuffle` còn công thức `RANDARRAY` cũ ở A1: lệnh xoá luôn công thức đó.

## Tab `glossary` (tuỳ chọn)

Nơi ghi lại **quyết định dịch** để agent không lặp lỗi cũ (`"chạy nền"` cho *asynchronously*,
`"co giãn được"` cho *scalable*…). Không tạo cũng không sao — skill tự bỏ qua bước đọc.

Tạo tab tên `glossary`, **không đặt header**, 3 cột:

| Cột | Nội dung |
|---|---|
| A | term tiếng Anh — có thể là *họ từ* (`asynchronous`), không cần trùng key đã lưu |
| B | gloss chuẩn; nhiều biến thể ngăn bằng ` · `, phổ biến nhất trước |
| C | ghi chú: `không dùng …`, nguồn dịch sai, hoặc `bạn chốt` |

Agent đọc tab này **trước khi** soạn gloss (`vocab sheet --name glossary --json`, chỉ đọc), nên
nó là **luật** áp cho cả họ từ — khác `terms`, chỉ áp cho đúng từ đã lưu. Mỗi lần bạn sửa gloss
của agent, ghi thêm một dòng vào đây.

Bắt đầu nhanh bằng [`glossary.csv`](../glossary.csv) (File → Import → Upload → *Insert new
sheet*, dấu phân cách **Comma**). Header dòng 1 là tuỳ chọn — agent tự bỏ qua.

## Tab `inbox` (tuỳ chọn)

Nơi bạn gõ từ thô trên điện thoại, để agent điền nghĩa sau. Chỉ cần tab tên đúng `inbox`,
không cần header; gõ từ vào cột A hoặc B. Luồng xử lý: [workflows.md](workflows.md#điền-inbox).
