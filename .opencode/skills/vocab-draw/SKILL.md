# Skill: vocab-draw

Hai lệnh, cùng một dạng thẻ:

```
vocab draw     ──► Shuffle   (pool chưa thuộc)
vocab recheck  ──► Recheck   (pool đến hạn)
```

Cột A là **prompt**, cột B là **chiều**, cột C là **bài làm** của user. Cột A/B là value tĩnh,
nên gõ đáp án hay `vocab mark` không làm thẻ xê dịch; bộ thẻ chỉ đổi khi chạy lại lệnh.

Repo: thư mục gốc (2 cấp trên file này). Nếu `vocab` không có trong PATH, gọi `<repo>/bin/vocab`.

## 1. Trộn / ôn

```bash
vocab draw                                  # 10 thẻ mới (Shuffle), mặc định en-vi
vocab draw --direction vi --count 20
vocab draw --direction mixed --count 20     # nửa Anh→Việt, nửa Việt→Anh
vocab recheck                               # thẻ đến hạn (Recheck), mặc định mixed
vocab recheck --direction en --count 5
```

- `--direction`: `en` (prompt tiếng Anh, trả lời tiếng Việt), `vi` (prompt là `meaning_short`,
  trả lời tiếng Anh), `mixed` (cả hai, trộn ngẫu nhiên).
- `--count` 1..50, mặc định 10.
- `draw` lấy từ chưa thuộc: `status` / `status_vi` khác `known`. `recheck` lấy từ đến hạn:
  `learning` sau 3 ngày, `known` sau 30 ngày, tính riêng từng chiều.
- Tab đích do user tạo. Chưa có → `sheet_not_found`, bảo user tạo tab, **đừng tự tạo**.
- Không còn gì để rút → `no_candidates`, báo user thay vì tự đổi `status`.

## 2. Báo lại

In danh sách đánh số y như output lệnh, giữ nhãn chiều:

```
 1. [EN→VI] drift
 2. [VI→EN] ngưỡng sàn · ngưỡng tối thiểu
10 thẻ · ghi đáp án vào cột C
```

Thêm một câu: `EN→VI` thì gõ nghĩa tiếng Việt, `VI→EN` thì gõ từ tiếng Anh, **vào cột C**, đừng
sửa cột A/B. Sau đó dừng — không tự chấm, không tự `mark`.

Khi user nói "chấm bài" thì chuyển sang skill `vocab-grade`.

## 3. Không làm

- **Chỉ chạy `draw`/`recheck` khi user yêu cầu.** Cả hai xoá `A:C`: bộ thẻ cũ và mọi đáp án đang
  viết dở đều mất.
- Không tự chạy giữa buổi chấm (đáp án cột C sẽ mất).
- Lần đầu chạy trên `Shuffle` còn công thức `RANDARRAY` ở `A1`, hoặc trên `Recheck` còn công thức
  cũ: lệnh xoá luôn. Nói trước cho user nếu họ chưa bỏ công thức.
- Không ghi `Shuffle`/`Recheck` bằng bất kỳ lệnh nào khác — chỉ `draw`/`recheck` được ghi `A:B`
  và xoá `C`.
