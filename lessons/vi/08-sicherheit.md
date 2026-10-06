# Bảo mật: mã hóa và chứng chỉ

:::goal
**Mục tiêu bài học:** Bạn có thể giải thích ba mục tiêu bảo mật là tính bảo mật, tính toàn vẹn và tính xác thực, phân biệt mã hóa đối xứng và mã hóa bất đối xứng, phân loại giá trị băm và chữ ký số, đọc và tự cấp chứng chỉ, thiết lập HTTPS và hiểu các cảnh báo chứng chỉ thường gặp.
:::

Trong các chương trước, bạn có thể đọc được gần như mọi thứ trong Tracer:

- **Chương 3.3.2:** Trong WLAN, mọi thiết bị trong phạm vi đều nhận được tất cả các gói tin vô tuyến.
- **Chương 6.1.2:** Với HTTP, yêu cầu và trang web nằm trong gói tin dưới dạng văn bản thuần.
- **Chương 6.3.2:** Với SMTP và POP3, tên người dùng và mật khẩu gần như được truyền đi dưới dạng văn bản thuần — `AUTH PLAIN` chỉ là Base64.

Vì vậy, ai nghe lén trên đường truyền hoặc trong cùng một WLAN đều thấy được mật khẩu, điểm số, tin nhắn và dữ liệu ngân hàng. Và kẻ đó còn làm được nhiều hơn thế: **thay đổi** các gói tin hoặc **giả mạo** là một người khác.

## Ba mục tiêu bảo mật

Mật mã học giúp chống lại những mối nguy này. Người ta phân biệt ba **mục tiêu bảo mật**:

| Mục tiêu bảo mật | Câu hỏi | Ví dụ về một cuộc tấn công |
|---|---|---|
| **Tính bảo mật** | Chỉ người nhận đúng mới đọc được dữ liệu không? | Ai đó đọc lén mật khẩu của bạn trong WLAN. |
| **Tính toàn vẹn** | Dữ liệu có đến nơi mà không bị thay đổi không? | Ai đó thay đổi số tiền trong một lệnh chuyển khoản. |
| **Tính xác thực** | Dữ liệu có thực sự đến từ người gửi được nêu không? | Một trang web ngân hàng giả mạo yêu cầu bạn nhập mã PIN. |

Trong chương này, bạn sẽ làm quen với các công cụ giúp đạt được ba mục tiêu này — và cách chúng phối hợp với nhau trong **HTTPS**, biểu tượng ổ khóa trong trình duyệt.

:::quiz match
Ai đó đọc lén mật khẩu của bạn trong WLAN -> Tính bảo mật
Ai đó thay đổi số tiền của một lệnh chuyển khoản trên đường truyền -> Tính toàn vẹn
Một trang web giả mạo mạo danh ngân hàng của bạn -> Tính xác thực
:::

:::evaluate
Kiểm tra phần ghép đôi
:::
