---
name: vocab-capture
description: Trích và lưu từ/cụm từ tiếng Anh (chuyên ngành IT + từ nâng cao) từ URL, đoạn văn bản, hoặc một từ/cụm từ vào Google Sheet private qua CLI `vocab import`. Dùng khi user nói "lưu từ vựng", "lưu từ mới", "quét từ vựng trang này", "vocab", "ghi lại các từ này". Agent tự phân tích nghĩa/IPA/ví dụ/phân loại; chỉ hỏi lại khi từ có nghĩa quá rộng.
license: MIT
compatibility: opencode
metadata:
  tool: vocab-cli
  storage: google-sheets
---

# vocab-capture

User **không bao giờ** phải cung cấp nghĩa, IPA, hay câu ví dụ. Họ chỉ đưa nguồn (URL /
đoạn văn / một từ) và nhận lại một bảng kết quả. Toàn bộ phân tích là việc của bạn.

```
nguồn ──► trích ứng viên ──► (hỏi 1 câu nếu mơ hồ) ──► vocab import ──► bảng kết quả
```

Repo: thư mục gốc của repo này (2 cấp trên file này); config: `~/.config/vocab-cli/config.json`.
Nếu shell báo `command not found: vocab` (shell không tương tác không source `~/.zshrc`),
gọi `<repo>/bin/vocab` — thêm `bin/` vào PATH mới gõ được `vocab`.

## 1. Lấy nguồn

| Input | Cách lấy |
|---|---|
| URL | `webfetch`; trang cần login → chrome-devtools (`list_pages` → `select_page` → `take_snapshot`) |
| Đoạn văn bản / PDF dán vào | dùng nguyên văn |
| Một từ/cụm từ trần | **hỏi 1 câu** (mục 3) rồi mới lưu |

## 2. Trích ứng viên

**Lấy** (không giới hạn số lượng, lấy hết những gì đạt tiêu chí):

1. Thuật ngữ IT/software xuất hiện trong ngữ cảnh kỹ thuật (`eval`, `drift`, `smoke test`,
   `collocation`, `pull request`, `backport`).
2. Từ/cụm **≥ B2** không phải từ vựng cơ bản hằng ngày (`set a floor`, `block a merge`,
   `catch drift`, `from evidence`).
3. Collocation / phrasal verb / idiom đáng học nguyên cụm, không tách rời.

**Bỏ**:

- A1–B1 thông dụng (`make`, `use`, `small`, `get`).
- Tên riêng, tên sản phẩm (`Claude`, `Bedrock`, `Meridian`), tên người, tên công ty.
- Identifier/code/API (`SpreadsheetApp`, `drift_check`, `e.postData`, `--source-url`).
- Số liệu, ngày tháng, đơn vị đo.
- Từ mà nghĩa trong câu không khác gì nghĩa đen hiển nhiên (trừ khi là thuật ngữ).
- Cụm mà nghĩa **cộng lại được** từ các từ đơn (`block a merge`, `narrow the gap`,
  `domain expertise`, `task delegation`, `extraction prompt`). Chỉ lưu cụm khi nghĩa
  **lệch** khỏi tổng các phần: idiom, phrasal verb, ẩn dụ/thuật ngữ (`accuracy floor`,
  `pull request`, `live traffic`, `smoke eval`). Cụm cơ học thì lưu các **từ đơn** đáng
  học bên trong nó (`expertise`, `awareness`, `evidence`).

Một tài liệu dài có thể ra 40–60 từ. Không cắt bớt cho tròn số; cũng đừng thêm từ rác
cho đủ số lượng.

## 3. Gate mơ hồ — hỏi đúng 1 câu

Chỉ hỏi khi **không có ngữ cảnh** hoặc ngữ cảnh không đủ để chọn nghĩa:

- User đưa một từ/cụm trần (`floor`, `run`, `issue`, `suite`).
- Từ có ≥2 nghĩa thường gặp **và** câu trong tài liệu không phân biệt được.
- Không rõ muốn lưu 1 từ hay cả cụm (`pull` vs `pull request`).

Mẫu: đưa 2–4 option lấy từ chính tài liệu, kèm option mặc định.

> "`floor` — lưu nghĩa nào? A. ngưỡng sàn tối thiểu (khớp câu *'Set an accuracy floor'*) ·
> B. sàn nhà · C. cả cụm `set a floor`"

Có URL/đoạn văn → **không hỏi gì**. Chưa được trả lời → không ghi.

## 4. Soạn JSON và gọi `vocab import`

Mỗi phần tử:

| Field | Luật |
|---|---|
| `term` | dạng gốc như trong tài liệu |
| `meaning_short` | gloss **1–4 từ**, không giải thích, không ngoặc (`accuracy floor` → `ngưỡng sàn`); đây là cột người dùng quét nhanh — **luôn điền** |
| `meaning_vi` | nghĩa **theo ngữ cảnh này**, ≤20 từ, nêu sắc thái nếu cần |
| `type` | `tech_term` (jargon IT) · `word` · `phrase` · `collocation` · `idiom` · `phrasal_verb` · `abbrev` |
| `cefr` | chỉ điền khi chắc; không chắc thì **bỏ trống** |
| `domain` | tag theo tài liệu (`evals`, `git`, `devops`, `business`…). Tái dùng tag đã có: `vocab list --json --limit 200` |
| `ipa` | 1 dạng, ưu tiên US; **bỏ** với abbreviation/tên riêng |
| `example` | **câu gốc** trong tài liệu + `example_type: "source"` |
| `context_note` | câu gốc hoặc 1 dòng lý do chọn nghĩa này |
| `source_url` / `source_title` | khi có |
| `status` | bỏ trống → `new` |

```bash
cat > /tmp/vocab.json <<'JSON'
[
  {"term": "accuracy floor", "meaning_short": "ngưỡng sàn", "meaning_vi": "ngưỡng sàn độ chính xác tối thiểu phải đạt",
   "type": "phrase", "cefr": "C1", "domain": "evals",
   "example": "Set an accuracy floor from what one wrong answer would cost you.",
   "example_type": "source",
   "context_note": "Set an accuracy floor from what one wrong answer would cost you.",
   "source_url": "https://…", "source_title": "Introduction to evals"}
]
JSON
vocab import --file /tmp/vocab.json
```

CLI tự chia lô 50 dòng, dedupe theo `key` (trùng → `lookup_count+1`, không tạo dòng mới).

### Chọn `type`

| type | Tiêu chí | Ví dụ |
|---|---|---|
| `word` | 1 chữ, **không** thuộc ngôn ngữ chuyên ngành | `narrow`, `polish` |
| `abbrev` | viết tắt | `CI` |
| `phrasal_verb` | động từ + tiểu từ, nghĩa đổi | `back up`, `vouch for` |
| `idiom` | nghĩa **không** suy ra được chút nào từ các phần | `at any price` |
| `collocation` | cụm **động từ** + bổ ngữ, động từ mang nghĩa ẩn dụ/cố định | `go green`, `take ownership` |
| `phrase` | cụm **danh từ** cố định, không phải thuật ngữ ngành | `accuracy floor`, `outside knowledge` |
| `tech_term` | thuật ngữ ngành, **1 chữ hoặc nhiều chữ** đều được | `rubric`, `run cost` |

Trục phân biệt: đầu cụm là **động từ** → `collocation`; là **danh từ** và không phải jargon → `phrase`;
có mặt trong ngôn ngữ chuyên ngành → `tech_term` thắng `word`/`phrase`. `word`/`abbrev` chứa
dấu cách sẽ bị CLI từ chối.

Tuỳ chọn:
- `vocab import --file rows.json --dry-run` — xem trước, không ghi.
- `vocab import --file - --json` — đọc stdin, in JSON cho máy.
- `vocab check "a" "b"` — kiểm tra tồn tại + nghĩa cũ.

## 5. Báo lại

In nguyên bảng CLI trả về:

```
term             loại       nghĩa                             kết quả
accuracy floor   phrase     ngưỡng sàn độ chính xác tối thiểu  mới
drift            tech_term  lệch chất lượng theo thời gian     đã có (gặp lần 3)

12 mới · 3 đã có · 0 lỗi
```

Thêm tối đa 2 dòng nhận xét nếu có gì đáng nói (vd 5 từ C1 trở lên đáng học trước).
Không mô tả lại từng từ một lần nữa.

## 6. Không làm

- Không bắt user cung cấp nghĩa/IPA/ví dụ/phân loại.
- Không ghi trực tiếp vào Sheet hay gọi endpoint bằng `curl` — luôn qua `vocab`.
- Không lưu secret vào lệnh, không sửa `Code.gs` khi user chỉ muốn lưu từ.
- Không đề xuất danh sách rồi bắt user duyệt, trừ khi user yêu cầu rõ.
- `unknown_op` → endpoint đang chạy bản `Code.gs` cũ: báo user dán lại file và deploy
  **New version**, đừng tự workaround.
