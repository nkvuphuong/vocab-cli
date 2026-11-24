---
name: vocab-grade
description: Chấm bài ôn từ vựng trên tab `Shuffle` / `Recheck` của Google Sheet — đọc đáp án tiếng Việt người dùng tự nhập, đối chiếu tab `terms`, chấm theo nghĩa (chấp nhận đồng nghĩa, diễn giải, lỗi chính tả), rồi cập nhật `status`. Dùng khi user nói "chấm bài", "chấm điểm", "kiểm tra đáp án", "xem tôi làm đúng không", "grade".
license: MIT
compatibility: opencode
metadata:
  tool: vocab-cli
  storage: google-sheets
---

# vocab-grade

Người dùng tự nhớ nghĩa rồi gõ tiếng Việt vào **cột B** của tab `Shuffle` (hoặc `Recheck`).
Việc của bạn: đọc bài, chấm theo nghĩa, ghi `status` về `terms`, báo một bảng ngắn.

```
vocab sheet ──► vocab check ──► chấm theo nghĩa ──► vocab mark ──► bảng kết quả
```

Repo: thư mục gốc (2 cấp trên file này). Nếu `vocab` không có trong PATH, gọi `<repo>/bin/vocab`.

## 1. Đọc bài làm

```bash
vocab sheet --name Shuffle      # hoặc --name Recheck
vocab sheet --name Shuffle --json
```

- Dòng có `bạn viết` trống → **bỏ qua**, không chấm, không ghi status.
- 0 dòng có đáp án → nói "chưa có đáp án nào" và dừng.
- Đọc **hết** A+B trước khi ghi bất cứ thứ gì: ghi status làm tab tính lại và cột B lệch
  hàng so với term.

## 2. Lấy đáp án chuẩn

```bash
vocab check "drift" "accuracy floor" "take ownership"
```

Một lời gọi cho cả lượt. `meaning_short` là nghĩa lõi, `meaning_vi` cho sắc thái; khi term
đa nghĩa hoặc bài làm "gần đúng", đọc thêm `example` rồi mới kết luận. Term không có trong
`terms` (hiếm) → ghi chú, không chấm, không ghi status.

## 3. Chấm: 2 mức

Chấm **theo nghĩa**, không so chuỗi — không có đáp án nào khớp 1:1.

| Bài làm | Kết quả |
|---|---|
| Cùng nghĩa lõi, khác chữ (`lệch chất lượng` / `sự lệch chất lượng`) | đạt |
| Đồng nghĩa, diễn giải, phương ngữ (`chứng cứ` ≈ `bằng chứng`) | đạt |
| Sai dấu / sai 1–2 ký tự mà chỉ ứng với đúng một nghĩa (`nguong san`, `bang chung`) | đạt, ghi chú từ đúng |
| Hẹp hơn nhưng không sai trọng tâm (`sàn` cho `accuracy floor`) | đạt + ghi chú thiếu gì |
| Đúng một nghĩa khác, không có trong `meaning_vi` | không đạt + ghi chú nghĩa bị thiếu |
| Mơ hồ, không thành nghĩa (`cái này`, `quan trọng`, `làm gì đó`) | không đạt |
| Lặp lại chính term tiếng Anh, hoặc dịch từng từ | không đạt |
| Sai sắc thái rõ (`lỗi` cho `drift` khi sheet ghi *lệch dần theo thời gian*) | không đạt |

Luật thêm:

- **Sai dấu**: chỉ tha khi không nhầm được sang từ khác. `mã` / `má` / `ma` là ba nghĩa →
  xét nghĩa, không tha máy móc.
- **Nhiều nghĩa**: chấp nhận nếu nghĩa người dùng nêu có trong `meaning_vi`. Nếu đúng tiếng Anh
  nhưng sheet lưu nghĩa khác → `không đạt` + nói rõ, và đề nghị `vocab update` nếu nghĩa đó
  đáng thêm.
- **Tự tin thấp** (nghĩa quá rộng, bài làm lửng lơ, từ đồng âm): đánh `?`, **không ghi status**,
  nêu 1 câu lý do. Thà hỏi lại còn hơn ghi sai `known`.

## 4. Ghi status

| Kết quả | Lệnh |
|---|---|
| đạt | `vocab mark "<term>" --status known` |
| không đạt | `vocab mark "<term>" --status learning` |
| `?` | không ghi |

- Mỗi từ một lệnh; `not_found` → báo, không thử lại.
- Không ghi gì vào cột B, không xoá dòng, không sửa nghĩa trong `terms`.
- `unknown_op` / `sheet_not_found` → endpoint chạy `Code.gs` cũ: báo user dán lại file và
  Deploy → **New version**, đừng tự workaround.

## 5. Báo lại

```
term            bạn viết              nghĩa chuẩn                  kết quả
drift           lệch chất lượng       sự lệch chất lượng theo …    đạt
accuracy floor  san                   ngưỡng sàn độ chính xác …    đạt (thiếu "độ chính xác")
take ownership  chịu trách nhiệm      sự chủ động nhận việc        đạt
```

`7/10 đạt · 2 không đạt · 1 cần bạn xác nhận · đã cập nhật status`

- Chỉ nêu ghi chú cho dòng không đạt hoặc đạt kèm thiếu sót; đừng giải thích lại từng từ.
- Nhắc 1 dòng: cột B giờ đã lệch hàng (tab tính lại) → xoá B trước buổi sau.
- Từ `known` quay lại `Recheck` sau 30 ngày, `learning` sau 3 ngày — chỉ nhắc khi user hỏi.

## 6. Không làm

- Không chấm bằng so khớp chuỗi / `difflib` / lowercase-rồi-so.
- Không ghi `known` khi độ tự tin thấp, khi term không có trong `terms`, hoặc khi cột B trống.
- Không tự thêm từ mới hay sửa `meaning_vi` trong lúc chấm (việc của `vocab-capture`).
- Không sửa công thức tab `Shuffle`/`Recheck`, không đổi `status` của từ không có trong bài.
