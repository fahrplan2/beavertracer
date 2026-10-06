# Firewall: Ai được vào, ai được ra?

:::goal
**Mục tiêu bài học:** Bạn có thể giải thích cách bộ lọc gói tin hoạt động với các quy tắc, tự thiết lập quy tắc và sắp xếp chúng theo đúng thứ tự, phân biệt việc loại bỏ (drop) và từ chối (reject), giải thích sự khác nhau giữa firewall phi trạng thái và firewall có trạng thái, xây dựng một DMZ và tìm lỗi trong các quy tắc firewall.
:::

:::osi 4
:::

:::sim
url=/sims/lesson-9.btsim
:::

Trường Beaver có các địa chỉ công khai riêng (`198.51.100.…`): **Schulserver** của trường có thể truy cập trực tiếp từ Internet — không qua NAT, giống như việc này sắp trở thành bình thường ở mọi nơi nhờ IPv6 (chương 7.3). Giữa Internet và **Schulrouter** có một **firewall**, nhưng hiện tại nó vẫn cho mọi thứ đi qua.

Bên trái bạn thấy "Internet": một **Internet-PC** và máy chủ web `www.beispiel.de`. Bên phải là mạng của trường với **Schulserver** và **Lehrer-PC**.

## Kẻ tấn công nhìn thấy gì?

Ai muốn tấn công một máy chủ thì trước tiên sẽ tìm các **cổng đang mở** — tức là các dịch vụ đang chờ kết nối. Công cụ để làm việc này gọi là **máy quét cổng (port scanner)**; nổi tiếng nhất là `nmap`.

Chuyển sang :fa-play: **Chạy** Chế độ chạy, mở :fa-terminal: **Terminal** trên **Internet-PC** và nhập:

```
$ nmap 198.51.100.10
```

`nmap` cố gắng thiết lập kết nối TCP tới 20 cổng phổ biến nhất và báo cáo cổng nào đang mở.

:::quiz multi
Những cổng nào trên Schulserver đang mở từ phía Internet?
- [x] 22 (SSH, bảo trì từ xa)
- [x] 25 (SMTP)
- [x] 80 (HTTP)
- [x] 110 (POP3)
- [x] 143 (IMAP)
- [ ] 443 (HTTPS)
:::

:::evaluate
Kiểm tra đáp án
:::

Trang web (80) và việc nhận e-mail (25) cần có thể truy cập được từ Internet. Nhưng **bảo trì từ xa** (22) và việc lấy thư (110, 143) chỉ mạng của trường mới cần. Mỗi cổng mở là một bề mặt tấn công tiềm tàng: nếu dịch vụ có lỗ hổng bảo mật hoặc mật khẩu yếu, kẻ tấn công có thể khai thác nó từ bất kỳ đâu trên thế giới — và các máy quét tự động trên Internet làm đúng việc đó suốt ngày đêm.

:::tip Ghi nhớ
Một **firewall** kiểm soát lưu lượng dữ liệu tại biên giữa hai mạng và chỉ cho đi qua những gì được cho phép một cách rõ ràng. Nhờ vậy, các dịch vụ chỉ cần dùng nội bộ sẽ vô hình đối với Internet.
:::
