---
name: vocab-draw
description: Trộn một bộ từ mới vào tab `Shuffle` của Google Sheet bằng `vocab draw` (cột A là value tĩnh, không phải công thức), rồi để user gõ nghĩa vào cột B. Dùng khi user nói "trộn bài", "trộn bộ mới", "rút 10 từ", "cho tôi 10 từ ôn", "draw".
license: MIT
compatibility: opencode
metadata:
  tool: vocab-cli
  storage: google-sheets
---

# vocab-draw

Cột A của `Shuffle` **không còn công thức**. Bộ từ do endpoint chọn ngẫu nhiên và ghi
thành value, nên gõ/lưu đáp án ở cột B — và cả `vocab mark` — không làm từ xê dịch nữa.
Bộ từ chỉ đổi khi bạn chạy `vocab draw`.

```
vocab draw ──► user gõ nghĩa vào cột B ──► (skill vocab-grade)
```

Repo: thư mục gốc (2 cấp trên file này). Nếu `vocab` không có trong PATH, gọi `<repo>/bin/vocab`.

## 1. Trộn

```bash
vocab draw              # 10 từ (mặc định)
vocab draw --count 20   # endpoint chặn 1..50
```

- Pool giống công thức cũ: `term` khác rỗng và `status <> known`.
- Tab `Shuffle` do user tạo; chưa có → lỗi `sheet_not_found`, bảo user tạo tab, **đừng tự tạo**.
- Toàn bộ từ đã `known` → lỗi `no_candidates`, báo user thay vì tự đổi status.

## 2. Báo lại

In danh sách đánh số y như output lệnh, thêm một câu: gõ nghĩa tiếng Việt vào **cột B**,
đừng sửa cột A. Sau đó dừng — không tự chấm, không tự `mark`.

Khi user nói "chấm bài" thì chuyển sang skill `vocab-grade`.

## 3. Không làm

- **Chỉ chạy `draw` khi user yêu cầu.** Nó xoá `A:B` của tab `Shuffle`: bộ cũ và mọi đáp án
  đang viết dở đều mất.
- Không tự chạy `draw` giữa buổi chấm (đáp án cột B sẽ mất).
- Lần đầu chạy trên Sheet còn công thức `RANDARRAY` ở `A1`: `draw` xoá luôn công thức đó.
  Nói trước cho user nếu họ chưa bỏ công thức.
- Không ghi `Shuffle`/`Recheck` bằng bất kỳ lệnh nào khác — chỉ op `draw` này được ghi cột A
  và xoá cột B.
