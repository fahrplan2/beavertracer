# Mạng gia đình: bộ định tuyến và NAT

:::goal
**Mục tiêu bài học:** Bạn có thể nêu các nhiệm vụ của một bộ định tuyến gia đình, thiết lập một bộ định tuyến gia đình, giải thích cách NAT đưa nhiều thiết bị ra Internet qua một địa chỉ công cộng, cũng như thiết lập và kiểm tra chuyển tiếp cổng.
:::

:::osi 3
:::

:::sim
url=/sims/lesson-7.1.btsim
:::

Ở nhà, chỉ trong chốc lát đã có mười thiết bị trở lên trong mạng: điện thoại, laptop, TV, máy chơi game, loa. Tất cả đều nhận các địa chỉ như `192.168.178.20` — thuộc một dải **riêng** (private), vốn hoàn toàn không được chuyển tiếp trên Internet (chương 4.2.2). Vậy mà thiết bị nào trong số đó cũng vào được Internet.

Điều này được thực hiện nhờ một chiếc hộp nhỏ không mấy nổi bật: **bộ định tuyến gia đình**. Trên Vùng làm việc, bên trái bạn thấy một mạng gia đình với một PC và một máy tính bảng, bên phải là „Internet“ — các bộ định tuyến của một nhà cung cấp dịch vụ, một máy chủ DNS và máy chủ web `www.beispiel.de`.

:::note
Các địa chỉ công cộng trong chương này (`203.0.113.…`, `198.51.100.…`, `192.0.2.…`) được dành riêng cho các ví dụ và tài liệu giảng dạy — giống như `2001:db8::` với IPv6.
:::
