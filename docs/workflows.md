# Luồng làm việc

Bốn việc thường ngày. Cách chính là **nói với agent**, không gõ lệnh.

| Bạn nói | Agent làm | Skill |
|---|---|---|
| "lưu từ vựng từ `<URL/đoạn văn>`" | trích từ → soạn đủ cột → `vocab import` | `vocab-capture` |
| "lưu `<một từ>`" | hỏi 1 câu chọn nghĩa → `vocab import` | `vocab-capture` |
| "điền inbox" | đọc tab `inbox` → `vocab check` → `vocab import` → hỏi → `vocab clear-inbox` | `vocab-capture` |
| "trộn bài" | `vocab draw` → hiện danh sách | `vocab-draw` |
| "chấm bài" | `vocab sheet` → `vocab check` → chấm theo nghĩa → `vocab mark` | `vocab-grade` |
| "sửa nghĩa của X" | `vocab update --file` | `vocab-capture` |

## Lưu từ mới

Bạn chỉ đưa nguồn (URL / đoạn văn / một từ). Agent đọc nguồn, tự trích từ/cụm từ đáng lưu (cả
thuật ngữ IT và từ nâng cao), tự viết nghĩa tiếng Việt + IPA + câu ví dụ, rồi gọi `vocab import`
một lần và trả về bảng:

```
term             loại       nghĩa                              kết quả
accuracy floor   phrase     ngưỡng sàn độ chính xác tối thiểu   mới
drift            tech_term  lệch chất lượng theo thời gian      đã có (gặp lần 3)

12 mới · 3 đã có · 0 lỗi
```

Bạn **không** cần cung cấp nghĩa, phiên âm hay ví dụ. Không giới hạn số từ mỗi lượt; CLI tự
chia lô 50 dòng/request.

Từ trần, chưa có ngữ cảnh (`floor`, `suite`, `run`) → agent **hỏi 1 câu** với 2–4 nghĩa, chưa
ghi cho tới khi bạn chốt.

Dạng dữ liệu agent gửi đi (`vocab import --file rows.json`, hoặc stdin):

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

Mọi dòng phải có `term`, `meaning_vi` và (`context_note` hoặc `source_url`) — thiếu thì
**không ghi gì**, exit 2. Dedupe theo `key`; trùng thì chỉ `lookup_count + 1`.

## Điền inbox

Cách nhanh khi đang cầm điện thoại: không cần mở chat, chỉ gõ từ vào tab `inbox`
(cột A hoặc B, mỗi dòng một từ — xem [sheet.md](sheet.md#tab-inbox-tuỳ-chọn)), rồi nói
"điền inbox".

```
bạn:   điền inbox
agent: vocab sheet --name inbox → vocab check từng từ → soạn đủ cột → vocab import
       → hỏi: "xoá 6 dòng đã xử lý?" → vocab clear-inbox … --confirm → bảng kết quả
```

| Lệnh | Việc |
|---|---|
| `vocab sheet --name inbox --json` | đọc những gì bạn gõ (chỉ đọc, không ghi) |
| `vocab check "shovel" …` | bỏ qua từ đã có, lấy gloss cũ nếu cần |
| `vocab import --file rows.json` | ghi các dòng mới, tự dedupe theo `key` |
| `vocab clear-inbox shovel scarf --confirm` | xoá dòng đã xử lý khỏi `inbox` |

Quy tắc agent giữ:

- Chỉ **đọc** `inbox`; chỉ xoá dòng khi bạn đồng ý, và endpoint chỉ xoá từ **đã có trong
  `terms`** — từ còn chờ chốt nghĩa thì trả `giữ lại`, không mất.
- Từ đã có trong `terms` → skip, báo trong bảng (không nhân đôi, không cộng `lookup_count`).
- Từ mơ hồ → import các từ rõ trước, rồi hỏi bạn 2–4 option, chưa ghi cho tới khi chốt.
- Ví dụ và nghĩa do agent tự soạn (`source_type: term`, `example_type: generated`),
  `status = new`.
- Gloss theo tab `glossary` nếu có.

> Gõ đúng chính tả: agent không tự sửa `term` bạn đã gõ. Sửa lại thì bảo agent `update`, đừng
> sửa tay cột `term` (cột `key` bên cạnh sẽ lệch và dedupe hỏng).

## Trộn bài

```
vocab draw              # 10 từ vào Shuffle!A1:A10
vocab draw --count 20   # 1..50
```

- Ghi **value** vào cột A (không công thức), xoá `A:B` trước khi ghi → đáp án cũ mất. Chỉ chạy
  khi bạn yêu cầu, đừng chạy giữa buổi chấm.
- Pool: `term` khác rỗng, `status <> known`.
- Lần đầu trên Sheet còn công thức `RANDARRAY` ở A1: lệnh này xoá luôn công thức đó.
- Chi tiết tab: [sheet.md](sheet.md#tab-shuffle--không-dùng-công-thức).

## Chấm bài

Bạn nhớ nghĩa rồi gõ tiếng Việt vào **cột B** của `Shuffle` (hoặc `Recheck`), sau đó nhờ agent
chấm. Không có đáp án nào khớp máy móc, nên việc chấm là của LLM: nó chấp nhận đồng nghĩa, diễn
giải, và lỗi chính tả không gây nhầm nghĩa.

```
bạn:   chấm bài giúp tôi
agent: vocab sheet → vocab check → chấm theo nghĩa → vocab mark → bảng kết quả
```

| Lệnh | Việc |
|---|---|
| `vocab sheet --name Shuffle` | đọc cặp (term, đáp án) ở cột A/B của tab |
| `vocab check "drift" …` | lấy `meaning_short`/`meaning_vi` làm đáp án chuẩn |
| `vocab mark "drift" --status known` | đạt → `known`, không đạt → `learning` |

Rubric đầy đủ nằm trong skill `.opencode/skills/vocab-grade/SKILL.md`.

**Ôn lại sau khi đã đúng:** `known` không phải vĩnh viễn. Tab `Recheck` hiện lại từ `learning`
sau 3 ngày và `known` sau 30 ngày; quên ở đó thì nó về `learning` và xuất hiện ngay trong
`Shuffle`.

**Cảnh báo:** ghi `status` làm `Recheck` tính lại (`TODAY`), nên cột B lệch hàng so với term
ngay sau khi chấm. Agent đọc A+B trước khi ghi; bạn xoá cột B sau mỗi buổi, và `vocab draw`
lần sau cũng tự xoá. `Shuffle` không còn vấn đề này vì cột A là value, không phải `FILTER`.
