# Tầng 3: Bộ định tuyến, địa chỉ IP và chia mạng con

:::goal
**Mục tiêu bài học:** Bạn có thể đọc địa chỉ IP ở dạng nhị phân, tính địa chỉ mạng và địa chỉ quảng bá, chia một mạng thành các mạng con có kích thước bằng nhau và kết nối các mạng với nhau qua bộ định tuyến bằng bảng định tuyến.
:::

:::osi 3
:::

:::sim
url=/sims/lesson-4.1.btsim
:::

Cho đến giờ, tất cả các thiết bị đều nằm trong *một* mạng cục bộ — được kết nối qua switch và điểm truy cập. Nhưng Internet gồm hàng triệu mạng như vậy: mạng gia đình của bạn, mạng của trường, mạng của nhà cung cấp dịch vụ di động, mạng của các trung tâm dữ liệu lớn.

Làm thế nào để một gói tin tìm được đường đi từ mạng này sang mạng khác? Đó là nhiệm vụ của **Tầng 3**, tức tầng mạng — với **Internet Protocol (IP)**, các địa chỉ IP và những thiết bị kết nối các mạng với nhau: **bộ định tuyến** (router).

:::note
IP được quy định trong một tiêu chuẩn từ năm 1981, đó là **RFC 791**. Phiên bản được đề cập chủ yếu trong chương này là **IPv4**. Bạn sẽ làm quen với phiên bản mới hơn là **IPv6** ở cuối chương.
:::
