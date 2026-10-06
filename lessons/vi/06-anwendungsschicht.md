# Tầng 5–7: Tầng ứng dụng

:::goal
**Mục tiêu bài học:** Bạn có thể nhận biết các giao thức quan trọng nhất của tầng ứng dụng — HTTP, DNS, SMTP/POP3/IMAP và DHCP — trong Tracer, giải thích cách hoạt động của chúng và tìm ra các lỗi thường gặp.
:::

:::osi 7
:::

:::sim
url=/sims/lesson-6.1.btsim
:::

Ở chương 5, bạn đã thấy: TCP và UDP chuyển dữ liệu một cách tin cậy (hoặc nhanh chóng) đến đúng chương trình — thông qua các cổng. *Nội dung* nằm trong dữ liệu đó là do các giao thức của **tầng ứng dụng** quy định. Trong mô hình TCP/IP, đây là một tầng; trong mô hình ISO/OSI, nó tương ứng với các tầng 5 đến 7.

Mỗi giao thức này có nhiệm vụ riêng — và cổng riêng:

| Giao thức | Nhiệm vụ | Cổng | Giao vận |
|---|---|---|---|
| **HTTP** | lấy trang web | 80 | TCP |
| **DNS** | chuyển đổi tên thành địa chỉ IP | 53 | thường là UDP |
| **SMTP** | gửi e-mail | 25 | TCP |
| **POP3** / **IMAP** | nhận e-mail về | 110 / 143 | TCP |
| **DHCP** | tự động cấp địa chỉ IP cho một thiết bị | 67 / 68 | UDP |

Ở chương 1.3, bạn vẫn truy cập một trang web thông qua địa chỉ IP của nó. Trong cuộc sống hằng ngày, không ai gõ `192.168.0.20` — và không có chiếc laptop mới nào phải nhập địa chỉ bằng tay. Tất cả những điều này phối hợp với nhau như thế nào, bạn sẽ khám phá trong chương này, từng giao thức một.
