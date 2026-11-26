# Sheet: tab ôn tập, cột, glossary

Sheet là UI duy nhất của tool: điện thoại mở Google Sheets, xem/sửa như bình thường. Agent chỉ
ghi tab `terms` (và op `draw` ghi cột A của `Shuffle`); các tab còn lại là của bạn.

## Tab `terms` — nơi lưu duy nhất

22 cột, thứ tự cố định:

```
A id · B key · C term · D type · E cefr · F pos · G domain · H ipa
I meaning_short · J meaning_vi · K meaning_en · L example · M example_type
N context_note · O source_type · P source_url · Q source_title · R status
S lookup_count · T last_seen_at · U created_at · V updated_at
```

- `key` = `term` đã chuẩn hoá (lowercase, gộp space, bỏ dấu câu hai đầu) — **dedupe theo cột này**.
- `meaning_short` = gloss 1–4 từ để quét nhanh (tab `Words`/`Phrases` và `vocab list` hiện cột
  này); `meaning_vi` = nghĩa đầy đủ theo ngữ cảnh.
- Gặp lại từ cũ: không thêm dòng, chỉ `lookup_count + 1` và cập nhật `last_seen_at`.
- **Thứ tự cột phải khớp `HEADERS`** trong `Code.gs` vì `append` ghi theo vị trí; đọc/ghi một ô
  thì theo tên header. Chèn cột phải sửa Sheet và `HEADERS` cùng lúc. Đừng đổi tên header,
  đừng xoá dòng (xoá thì `mark` báo `not_found`, không hỏng gì khác).
- `status`: `new` → `learning` → `known`. Dropdown cho R2:R: Data → Data validation →
  List of items → `new, learning, known`.

## Bốn tab xem lại

Tạo 4 tab, dán công thức vào ô A1. Đây là **view**, không phải nơi lưu — muốn đổi trạng thái
thì dùng `vocab mark`, đừng sửa trong các tab này.

**Tab `Review`** — từ chưa thuộc, mới gặp gần đây trước:
```
=IFERROR(SORT(CHOOSECOLS(FILTER(terms!A2:V,terms!R2:R<>"known"),3,8,9,12,18,20),6,FALSE),"no terms yet")
```

**Tab `Words`** — chỉ từ đơn (key không có dấu cách):
```
=IFERROR(SORT(CHOOSECOLS(FILTER(terms!A2:V,(terms!B2:B<>"")*ISERROR(FIND(" ",terms!B2:B))),3,8,9,4),1,TRUE),"no terms yet")
```

**Tab `Phrases`** — chỉ cụm từ (key có dấu cách):
```
=IFERROR(SORT(CHOOSECOLS(FILTER(terms!A2:V,ISNUMBER(FIND(" ",terms!B2:B))),3,8,9,4),1,TRUE),"no terms yet")
```
Hai tab này dựa vào `key` sau chuẩn hoá: `high-stakes` nằm ở `Words` (một từ ghép),
`back up` / `at any price` nằm ở `Phrases`.

**Tab `Recheck`** — từ đã học nhưng đến hạn ôn lại (learning 3 ngày, known 30 ngày), cũ nhất trước:
```
=IFERROR(ARRAY_CONSTRAIN(CHOOSECOLS(SORT(FILTER(terms!A2:V,(terms!U2:U<>"")*(((terms!R2:R="learning")*(TODAY()-terms!U2:U>=3))+((terms!R2:R="known")*(TODAY()-terms!U2:U>=30)))),21,TRUE),3),10,1),"nothing due")
```
`U` là `updated_at` — GAS ghi ngày thật mỗi lần `vocab mark`, nên nó là đồng hồ ôn tập. Muốn
nhịp khác thì sửa `3` và `30` trong công thức.

> Công thức trên dùng `,` làm dấu ngăn cách tham số (locale mặc định). Nếu Sheet ở locale dùng
> `;` (vi_VN), đổi **mọi** `,` thành `;`.

## Tab `Shuffle` — không dùng công thức

Tab `Shuffle` để trống (chỉ cần tồn tại). Bộ từ do `vocab draw` chọn ngẫu nhiên và ghi **value**
vào cột A, rồi bạn gõ đáp án vào cột B.

```
vocab draw              # 10 từ vào A1:A10, xoá đáp án cũ ở cột B
vocab draw --count 20   # endpoint chặn 1..50
```

- Cột A là value tĩnh, không phải `RANDARRAY`/`FILTER`: gõ/lưu đáp án ở B hay `vocab mark` đều
  **không** làm từ xê dịch. Bộ từ chỉ đổi khi chạy lại `vocab draw`.
- Lần đầu chạy trên Sheet còn công thức `RANDARRAY` cũ ở A1: `draw` xoá luôn công thức đó
  (nó ghi đè `A:B`).
- Pool: `term` khác rỗng và `status <> known` — giống công thức cũ.
- Muốn xem thêm IPA/nghĩa thì mở `Review`/`terms`, đừng thêm cột vào `Shuffle`.

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
