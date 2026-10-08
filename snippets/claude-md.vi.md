## Telegram notify (cc-notify-telegram)

Khi đã hoàn thành **TOÀN BỘ** việc người dùng yêu cầu trong session hiện tại và không còn gì
để làm (đang bàn giao kết quả cuối cùng), hãy kết thúc tin nhắn cuối bằng marker ẩn, đặt trên
một dòng riêng, **KÈM tóm tắt cô đọng** theo cú pháp:

`<!-- CC_NOTIFY_DONE: <ý nhiệm vụ 1> | <ý nhiệm vụ 2> | ... -->`

KHÔNG gắn marker này cho bước trung gian, câu hỏi làm rõ, hay tiến độ một phần — chỉ khi đã
xong hẳn. Một Stop hook sẽ phát hiện marker, tách phần tóm tắt và gửi Telegram cho người dùng
(mỗi `|` thành một bullet).

Quy tắc viết tóm tắt (đây là nội dung Telegram, marker vẫn ẩn vì là HTML comment):
- **Cô đọng, bao quát** — mỗi nhiệm vụ chính một ý ngắn, cách nhau bằng ` | `.
- **KHÔNG** kèm link/URL; nếu có PR chỉ ghi gọn kiểu `merged #65`.
- **KHÔNG** liệt kê file đã sửa, **KHÔNG** lặp lại yêu cầu của người dùng.

Ví dụ: `<!-- CC_NOTIFY_DONE: Sửa hook gửi tóm tắt cô đọng | merged #65 -->`

Khi BẾ TẮC thật sự — cần người dùng can thiệp mới tiếp tục được (không phải câu hỏi làm rõ
thông thường) — kết thúc tin nhắn bằng một dòng bắt đầu bằng `🛑` mô tả ngắn việc cần người
dùng làm, kèm marker `<!-- CC_NOTIFY_ESCALATE -->` trên dòng riêng.

Cũng dùng ESCALATE khi bạn dừng để **chờ người dùng chọn hướng hoặc xác nhận** (vd "chọn phương án nào?", "commit và push luôn không?", "cần QC bổ sung") — Stop hook không gửi gì nếu thiếu marker nên người dùng sẽ không biết bạn đang chờ. Chỉ cần một dòng `🛑` ngắn nêu rõ cần gì.

Khi lập plan (plan mode), để tin Telegram gọn và đủ ý:
- Câu hỏi cần người dùng quyết thì hỏi bằng `AskUserQuestion` **TRƯỚC** khi gọi `ExitPlanMode`; đừng để lại mục "Câu hỏi mở" trong plan đã trình.
- Viết mục `## Các bước`: liệt kê **đủ** các bước chính, mỗi bước **một câu ngắn** nêu việc đạt được (không nêu tên file).
- Danh sách file/thay đổi cụ thể để ở mục `## Phạm vi thay đổi` — mục này **không** được gửi lên Telegram.
