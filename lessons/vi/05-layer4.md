# Tầng 4: Tầng giao vận

:::goal
**Mục tiêu bài học:** Bạn có thể nêu các nhiệm vụ của tầng giao vận, trình bày diễn biến của một kết nối TCP (thiết lập, truyền dữ liệu, kết thúc) dưới dạng sơ đồ trình tự, giải thích cổng (port) cũng như số thứ tự và số xác nhận, và lý giải khi nào dùng UDP thay vì TCP.
:::

:::osi 4
:::

:::sim
url=/sims/lesson-5.1.btsim
:::

Nhìn lại nhanh chương 4: **Internet Protocol** ở tầng 3 đưa một gói tin đến đúng *máy tính*, kể cả khi phải đi qua nhiều bộ định tuyến. Nhưng IP không đảm bảo thêm điều gì nữa:

- Trên một máy tính có nhiều chương trình chạy cùng lúc: trình duyệt, chương trình thư điện tử, ứng dụng nhắn tin. Gói tin này dành cho chương trình nào? Điều đó không có trong phần đầu (header) của IP.
- Nếu một gói tin bị mất trên đường đi, IP không hề biết. Gói tin cũng có thể đến hai lần hoặc sai thứ tự. Người ta nói: IP chỉ phân phối theo nguyên tắc nỗ lực tối đa (*best effort*).

**Tầng 4**, tức tầng giao vận, lấp những khoảng trống này. Trên Vùng làm việc, bạn thấy một **Client-PC** và một **Server**. Qua chúng, trong chương này bạn sẽ khảo sát hai giao thức quan trọng nhất của tầng 4: **TCP** và **UDP**.

:::note
TCP được chuẩn hóa từ năm 1981 (**RFC 793**, ngày nay là **RFC 9293**), UDP thậm chí từ năm 1980 (**RFC 768**).
:::
