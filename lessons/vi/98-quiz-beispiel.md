# Sân chơi — Markdown & câu đố (trang thử nghiệm)

[[toc]]

Trang này dùng để thử nghiệm cú pháp Markdown và các dạng câu hỏi tương tác.

---

## Cú pháp Markdown

### Định dạng văn bản

**Đậm**, *nghiêng*, ~~gạch ngang~~, `Inline-Code`, và **_kết hợp_**.

Đoạn văn bình thường với một [liên kết đến trang khác](01-einfuehrung.html) và một [liên kết ngoài](https://www.beavertracer.eu).

### Tiêu đề

Các cấp H2–H4 tự động xuất hiện trong mục lục (TOC).

#### Đây là H4 — không xuất hiện trong TOC

### Danh sách

Không có thứ tự:

- Ethernet
- IP
- TCP
  - HTTP
  - SMTP

Có thứ tự:

1. Chế độ chỉnh sửa: xây dựng cấu trúc mạng
2. Chế độ chạy: bắt đầu mô phỏng
3. Chế độ theo dõi: phân tích các gói tin

### Bảng

| Giao thức | Tầng | Cổng |
|-----------|---------|------|
| HTTP      | 7       | 80   |
| HTTPS     | 7       | 443  |
| DNS       | 7       | 53   |
| TCP       | 4       | —    |

### Mã

Nội dòng: `ping 192.168.0.1`

Khối:

```
$ ping 192.168.0.2
PING 192.168.0.2: 56 data bytes
64 bytes from 192.168.0.2: icmp_seq=0 ttl=64 time=0.4 ms
```

### Callout

:::note
Đây là một callout **note** — dành cho các lưu ý trung tính và thông tin bổ sung.
:::

:::tip
Đây là một callout **tip** — dành cho các mẹo và khuyến nghị hữu ích.
:::

:::warning
Đây là một callout **warning** — dành cho các cảnh báo cần được chú ý.
:::

:::danger
Đây là một callout **danger** — dành cho các nguồn lỗi nghiêm trọng.
:::

:::draft
:::

### Biểu tượng

Font Awesome Solid: :fa-play: :fa-stop: :fa-desktop: :fa-shield-halved: :fa-wifi:

Font Awesome Regular: :far-file: :far-circle:

Biểu tượng thiết bị: :router: :switch:

### Mô phỏng nhúng

:::sim
url=/sims/demo.btsim
:::

### Bài tập có kiểm tra hành vi

:::task
title: Kết nối PC 1 và PC 2
Hãy kiểm tra xem PC 1 (id 9) có địa chỉ IP trong mạng 192.168.0.0/24 hay không và có thể kết nối tới PC 2 (id 11) hay không.
check: ip(9, "192.168.0.0/24")
check: pingOk(9, 11)
:::

---

## Mô hình tham chiếu OSI: bảng màu

Ví dụ về một bảng được tô màu cầu vồng (tầng 1 ở dưới cùng, như trong chồng giao thức) và một "đèn giao thông" ở lề trang với văn bản chảy bao quanh.

### Bảng có màu

<table class="osi-table">
<thead>
<tr><th>Tầng</th><th>Tên</th><th>Các giao thức ví dụ</th></tr>
</thead>
<tbody>
<tr class="osi-l7"><td>7</td><td>Ứng dụng</td><td>HTTP, DNS, SMTP</td></tr>
<tr class="osi-l6"><td>6</td><td>Trình bày</td><td>TLS, JPEG, ASCII</td></tr>
<tr class="osi-l5"><td>5</td><td>Phiên</td><td>RPC, NetBIOS</td></tr>
<tr class="osi-l4"><td>4</td><td>Giao vận</td><td>TCP, UDP</td></tr>
<tr class="osi-l3"><td>3</td><td>Mạng</td><td>IP, ICMP</td></tr>
<tr class="osi-l2"><td>2</td><td>Liên kết dữ liệu</td><td>Ethernet, ARP</td></tr>
<tr class="osi-l1"><td>1</td><td>Vật lý</td><td>Cáp đồng, cáp quang, WLAN</td></tr>
</tbody>
</table>

### Đèn giao thông với văn bản chảy bao quanh

Đèn giao thông được tạo bằng `:::osi N`, trong đó `N` là tầng cần làm nổi bật (ở đây là tầng 3). Nó nổi ở lề trang, còn văn bản phía sau tự động chảy bao quanh nó.

:::osi 3
:::

Lorem ipsum dolor sit amet, consetetur sadipscing elitr, sed diam nonumy eirmod tempor invidunt ut labore et dolore magna aliquyam erat, sed diam voluptua. At vero eos et accusam et justo duo dolores et ea rebum. Stet clita kasd gubergren, no sea takimata sanctus est Lorem ipsum dolor sit amet.

Lorem ipsum dolor sit amet, consetetur sadipscing elitr, sed diam nonumy eirmod tempor invidunt ut labore et dolore magna aliquyam erat, sed diam voluptua. At vero eos et accusam et justo duo dolores et ea rebum, nhờ đó phần này về mặt nội dung thuộc về tầng mạng (Layer 3) — vì vậy chính ô này trong đèn giao thông được tô màu, tất cả các ô khác vẫn màu xám.

---

## Phần 1: Các khái niệm cơ bản

:::quiz short
Ký hiệu CIDR của mặt nạ mạng con 255.255.255.0 là gì?
= /24
= 24
:::

:::quiz mc
Địa chỉ nào trong các địa chỉ sau là địa chỉ mạng của 192.168.1.42/24?
- [ ] 192.168.1.42
- [x] 192.168.1.0
- [ ] 192.168.1.255
- [ ] 192.168.0.0
:::

:::quiz fill
Địa chỉ mạng có được bằng phép toán {AND} theo từng bit giữa địa chỉ IP và {mặt nạ mạng con}. Địa chỉ cao nhất trong mạng con là địa chỉ {quảng bá}.
:::

:::evaluate
Kiểm tra phần 1
:::

---

## Phần 2: Ghép đôi — các giao thức và nhiệm vụ của chúng

:::quiz match
ARP -> Xác định địa chỉ MAC tương ứng với một địa chỉ IP
DNS -> Phân giải tên máy chủ thành địa chỉ IP
DHCP -> Tự động cấp phát địa chỉ IP cho các máy khách
ICMP -> Được ping và traceroute sử dụng
:::

:::evaluate
Kiểm tra phần 2
:::

---

## Phần 3: Chia mạng con

:::quiz short
Một mạng con /30 có bao nhiêu địa chỉ máy chủ có thể sử dụng?
= 2
:::

:::quiz mc
Mạng con /30 thường được dùng để làm gì?
- [ ] Cho các mạng văn phòng lớn với nhiều thiết bị
- [ ] Làm dải địa chỉ cho các pool DHCP
- [x] Làm mạng kết nối giữa hai bộ định tuyến
- [ ] Cho các điểm truy cập WLAN
:::

:::quiz fill
Một mạng con /25 có {128} địa chỉ, trong đó {126} địa chỉ có thể dùng cho các máy chủ.
:::

:::quiz match
/24 -> 254 địa chỉ máy chủ có thể sử dụng
/25 -> 126 địa chỉ máy chủ có thể sử dụng
/28 -> 14 địa chỉ máy chủ có thể sử dụng
/30 -> 2 địa chỉ máy chủ có thể sử dụng
:::

:::evaluate
Kiểm tra phần 3
:::

## Phần 4: Chọn nhiều đáp án và bài tập ngẫu nhiên

Với `:::quiz multi`, số đáp án đúng có thể là bất kỳ — mỗi phát biểu được chấm điểm riêng:

:::quiz multi
Những phát biểu nào về ARP là đúng?
- [x] ARP xác định địa chỉ MAC tương ứng với một địa chỉ IP
- [ ] ARP xác định địa chỉ IP tương ứng với một tên
- [x] Một yêu cầu ARP là một gói quảng bá
- [ ] Một phản hồi ARP là một gói quảng bá
:::

`:::quiz random <typ>` tạo ra các bài tập mới mỗi lần gọi (`count=N` quy định số lượng). Các loại: `bin2dec`, `dec2bin`, `cidr2mask`, `hosts`, `netbcast`, `samenet`, `subnet`.

:::quiz random dec2bin
count=2
:::

:::quiz random netbcast
Hãy tính cho địa chỉ sau:
:::

:::quiz random samenet
count=3
:::

:::quiz random subnet
:::

:::evaluate
Kiểm tra phần 4
:::

## Phần 4b: Bảng điền đáp án

`:::quiz table` — một bảng Markdown thông thường, các ô `{Antwort}` trở thành ô nhập liệu (các biến thể được phân tách bằng `|`):

:::quiz table
Chia `192.168.42.0/24` thành hai mạng con:
| Mạng con | Địa chỉ mạng | Địa chỉ quảng bá |
|---|---|---|
| 1 | {192.168.42.0} | {192.168.42.127} |
| 2 | {192.168.42.128} | {192.168.42.255} |
:::

:::evaluate
Kiểm tra bảng
:::

## Phần 5: Tô màu các bit

Dành cho các chương về IP và chia mạng con: `[[n|…]]` = phần mạng, `[[e|…]]` = phần mở rộng, `[[h|…]]` = phần máy chủ — trong văn bản thường và trong bảng:

[[n|11111111.11111111.11111111]].[[e|11]][[h|000000]] = `255.255.255.192`

Đối với các cách trình bày nhiều dòng, hãy dùng khối `<pre class="bits-block">` thay cho ``` (trong khối mã, các màu sẽ không được hiển thị):

<pre class="bits-block">
vorher  (/24):  [[n|NNNNNNNN.NNNNNNNN.NNNNNNNN]].[[h|HHHHHHHH]]
nachher (/26):  [[n|NNNNNNNN.NNNNNNNN.NNNNNNNN]].[[e|EE]][[h|HHHHHH]]
</pre>

## Phần 6: Sơ đồ trình tự

`:::seq` vẽ một sơ đồ với hai đường sống. Số SEQ và ACK cũng như các bộ đếm trên các đường sống được tính từ các cờ và dữ liệu tải (`"…"`). `-x` thay cho `->` làm cho một segment bị mất, `seq=…` ghi đè một số (ví dụ khi truyền lại).

:::seq
Client -> Server: SYN
Server -> Client: SYN, ACK
Client -> Server: ACK
Client -> Server: PSH, ACK "Hello World"
Server -> Client: ACK
Client -x Server: PSH, ACK "Hallo"
Client -> Server: PSH, ACK "Hallo" seq=12
Server -> Client: ACK
Client -> Server: FIN, ACK
Server -> Client: ACK
Server -> Client: FIN, ACK
Client -> Server: ACK
:::

Với `:::quiz seq`, dấu `?` (trước các cờ, hoặc `seq=?` / `ack=?`) trở thành ô nhập liệu; `hide: counters` ẩn các bộ đếm:

:::quiz seq
Client -> Server: SYN
Server -> Client: ? SYN, ACK ack=?
Client -> Server: ? ACK ack=?
Client -> Server: PSH, ACK "Hello World"
Server -> Client: ACK ack=?
:::

:::evaluate
Kiểm tra sơ đồ
:::
