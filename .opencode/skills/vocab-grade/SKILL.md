# Skill: vocab-grade

Người dùng gõ câu trả lời vào **cột C** của tab `Shuffle` hoặc `Recheck`; cột B ghi chiều của
thẻ. Việc của bạn: đọc bài, tra đáp án chuẩn theo đúng chiều, chấm theo nghĩa, ghi trạng thái về
đúng trục, báo một bảng ngắn.

```
vocab sheet ──► check (en-vi) / check --prompt (vi-en) ──► chấm ──► mark --direction ──► bảng
```

Repo: thư mục gốc (2 cấp trên file này). Nếu `vocab` không có trong PATH, gọi `<repo>/bin/vocab`.

## 1. Đọc bài làm

```bash
vocab sheet --name Shuffle      # hoặc --name Recheck
vocab sheet --name Shuffle --json
```

Mỗi dòng: `prompt` (cột A), `direction` (cột B: `en-vi` | `vi-en`), `answer` (cột C).

- Dòng có `answer` trống → **bỏ qua**, không chấm, không ghi status.
- 0 dòng có đáp án → nói "chưa có đáp án nào" và dừng.
- Đọc **hết** A+B+C trước khi ghi bất cứ thứ gì: ghi status không làm thẻ xê dịch nữa (thẻ là
  value tĩnh), nhưng vẫn đọc trọn một lượt cho chắc.
- Dòng thiếu `direction` (dữ liệu cũ) → coi là `en-vi` và ghi chú.

## 2. Lấy đáp án chuẩn theo chiều

| Chiều | Prompt | Đáp án chuẩn | Lệnh |
|---|---|---|---|
| `en-vi` | từ tiếng Anh | `meaning_short` / `meaning_vi` | `vocab check "<prompt>"` |
| `vi-en` | gloss tiếng Việt | `term` | `vocab check --prompt "<prompt>"` |

```bash
vocab check "drift" "accuracy floor"
vocab check --prompt "lệch chất lượng · trôi lệch"
```

- Gom một lời gọi cho cả lượt (mỗi chiều một lời gọi).
- `meaning_short` là nghĩa lõi, `meaning_vi` cho sắc thái; term đa nghĩa hoặc bài làm "gần đúng"
  thì đọc thêm `example` rồi mới kết luận.
- `check --prompt` trả **nhiều** match → prompt nhập nhằng: đánh `?`, không ghi status.
- `not_found` (term hoặc prompt không có trong `terms`) → ghi chú, không chấm, không ghi status.

## 3. Chấm: 2 chiều, cùng tinh thần "theo nghĩa"

### `en-vi` (trả lời bằng tiếng Việt)

| Bài làm | Kết quả |
|---|---|
| Cùng nghĩa lõi, khác chữ (`lệch chất lượng` / `sự lệch chất lượng`) | đạt |
| Đồng nghĩa, diễn giải, phương ngữ (`chứng cứ` ≈ `bằng chứng`) | đạt |
| Sai dấu / sai 1–2 ký tự mà chỉ ứng với đúng một nghĩa (`nguong san`, `bang chung`) | đạt, ghi chú từ đúng |
| Hẹp hơn nhưng không sai trọng tâm (`sàn` cho `accuracy floor`) | đạt + ghi chú thiếu gì |
| Đúng một nghĩa khác, không có trong `meaning_vi` | không đạt + ghi chú nghĩa bị thiếu |
| Mơ hồ (`cái này`, `quan trọng`), lặp lại term tiếng Anh, dịch từng từ | không đạt |
| Sai sắc thái rõ (`lỗi` cho `drift` khi sheet ghi *lệch dần theo thời gian*) | không đạt |

### `vi-en` (trả lời bằng tiếng Anh)

| Bài làm | Kết quả |
|---|---|
| Đúng `term` | đạt |
| Sai chính tả / biến thể số nhiều, chia động từ, không nhầm từ khác (`drifts`, `acuracy floor`) | đạt, ghi chú nếu cần |
| Từ tiếng Anh đồng nghĩa diễn đạt đúng gloss (`evaluation` cho `eval`) | đạt + ghi chú "chuẩn là `<term>`" |
| Đúng nghĩa khác hẳn (`catch drift` cho `lệch chất lượng`) | không đạt + nói rõ |
| Viết lại prompt tiếng Việt, hoặc một từ tiếng Anh mơ hồ | không đạt |

Luật thêm:

- **Sai dấu** (chiều Việt): chỉ tha khi không nhầm được sang từ khác. `mã` / `má` / `ma` là ba
  nghĩa → xét nghĩa, không tha máy móc.
- **Nhiều nghĩa**: chấp nhận nếu nghĩa người dùng nêu có trong `meaning_vi`. Đúng tiếng Anh nhưng
  sheet lưu nghĩa khác → `không đạt` + nói rõ, đề nghị `vocab update` nếu nghĩa đó đáng thêm.
- **Tự tin thấp** (nghĩa quá rộng, bài làm lửng lơ, prompt khớp nhiều dòng): đánh `?`, **không
  ghi status**, nêu 1 câu lý do. Thà hỏi lại còn hơn ghi sai `known`.

## 4. Ghi status đúng chiều

| Chiều | Đạt | Không đạt |
|---|---|---|
| `en-vi` | `vocab mark "<term>" --status known` | `vocab mark "<term>" --status learning` |
| `vi-en` | `vocab mark "<term>" --status known --direction vi` | `vocab mark "<term>" --status learning --direction vi` |

- `?` → không ghi.
- Mỗi từ một lệnh; `not_found` → báo, không thử lại. `missing_header` → bảo user thêm header
  `status_vi` ở W1, đừng workaround.
- Không ghi gì vào cột C, không xoá dòng, không sửa nghĩa trong `terms`.
- `unknown_op` / `sheet_not_found` → endpoint chạy `Code.gs` cũ: báo user dán lại file và
  Deploy → **New version**.

## 5. Báo lại

```
#  chiều   prompt            bạn viết          đáp án chuẩn                kết quả
1  en-vi   drift             lệch chất lượng   sự lệch chất lượng theo …   đạt
2  vi-en   ngưỡng sàn …      accuracy floor    accuracy floor              đạt
3  vi-en   bộ đánh giá …     evaluation        eval                        đạt (chuẩn là "eval")
4  en-vi   take ownership    chịu trách nhiệm  sự chủ động nhận việc       đạt
```

`7/10 đạt · 2 không đạt · 1 cần bạn xác nhận · đã cập nhật status`

- Chỉ nêu ghi chú cho dòng không đạt hoặc đạt kèm thiếu sót; đừng giải thích lại từng từ.
- Nhắc 1 dòng: cột C là bài làm của bạn, xoá trước buổi sau (`draw`/`recheck` cũng tự xoá).
- Từ `known` quay lại sau 30 ngày, `learning` sau 3 ngày, tính riêng từng chiều — chỉ nhắc khi
  user hỏi.

## 6. Không làm

- Không chấm bằng so khớp chuỗi / `difflib` / lowercase-rồi-so.
- Không ghi `known` khi độ tự tin thấp, khi term/prompt không có trong `terms`, hoặc khi cột C trống.
- Không tự thêm từ mới hay sửa `meaning_vi` trong lúc chấm (việc của `vocab-capture`).
- Không ghi vào tab `Shuffle`/`Recheck` (chỉ `draw`/`recheck` được ghi `A:B`), không đổi `status`
  của từ không có trong bài, không ghi sai trục.
