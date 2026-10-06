# زمین بازی — مارک‌داون و کوییز (صفحه آزمایشی)

[[toc]]

این صفحه برای آزمایش نحو مارک‌داون و انواع پرسش‌های تعاملی است.

---

## نحو مارک‌داون

### قالب‌بندی متن

**پررنگ**، *مورب*، ~~خط‌خورده~~، `Inline-Code` و **_ترکیبی_**.

یک پاراگراف معمولی با [پیوند به صفحه‌ای دیگر](01-einfuehrung.html) و یک [پیوند خارجی](https://www.beavertracer.eu).

### سرفصل‌ها

سطح‌های H2 تا H4 به‌طور خودکار در فهرست مطالب (TOC) نمایش داده می‌شوند.

#### این H4 است — در فهرست مطالب نمایش داده نمی‌شود

### فهرست‌ها

نامرتب:

- Ethernet
- IP
- TCP
  - HTTP
  - SMTP

مرتب:

1. حالت ویرایش: ساخت توپولوژی
2. حالت اجرا: شروع شبیه‌سازی
3. حالت ردیابی: تحلیل بسته‌ها

### جدول

| پروتکل | لایه | پورت |
|-----------|---------|------|
| HTTP      | 7       | 80   |
| HTTPS     | 7       | 443  |
| DNS       | 7       | 53   |
| TCP       | 4       | —    |

### کد

درون‌خطی: `ping 192.168.0.1`

بلوک:

```
$ ping 192.168.0.2
PING 192.168.0.2: 56 data bytes
64 bytes from 192.168.0.2: icmp_seq=0 ttl=64 time=0.4 ms
```

### کادرهای راهنما

:::note
این یک کادر **note** است — برای نکته‌های خنثی و اطلاعات تکمیلی.
:::

:::tip
این یک کادر **tip** است — برای نکته‌ها و توصیه‌های مفید.
:::

:::warning
این یک کادر **warning** است — برای هشدارهایی که نیاز به توجه دارند.
:::

:::danger
این یک کادر **danger** است — برای منابع خطای بحرانی.
:::

:::draft
:::

### آیکون‌ها

Font Awesome Solid: :fa-play: :fa-stop: :fa-desktop: :fa-shield-halved: :fa-wifi:

Font Awesome Regular: :far-file: :far-circle:

نماد دستگاه‌ها: :router: :switch:

### شبیه‌سازی توکار

:::sim
url=/sims/demo.btsim
:::

### تکلیف با بررسی رفتار

:::task
title: اتصال PC 1 و PC 2
بررسی کن که آیا PC 1 (id 9) در شبکه 192.168.0.0/24 یک IP دارد و می‌تواند به PC 2 (id 11) دسترسی پیدا کند.
check: ip(9, "192.168.0.0/24")
check: pingOk(9, 11)
:::

---

## مدل مرجع OSI: طرح رنگ

نمونه‌ای از یک جدول با رنگ‌های رنگین‌کمانی (لایه ۱ در پایین، مانند پشته) و یک «چراغ راهنما» در حاشیه صفحه با دور زدن متن.

### جدول رنگی

<table class="osi-table">
<thead>
<tr><th>لایه</th><th>نام</th><th>پروتکل‌های نمونه</th></tr>
</thead>
<tbody>
<tr class="osi-l7"><td>7</td><td>کاربرد</td><td>HTTP, DNS, SMTP</td></tr>
<tr class="osi-l6"><td>6</td><td>نمایش</td><td>TLS, JPEG, ASCII</td></tr>
<tr class="osi-l5"><td>5</td><td>نشست</td><td>RPC, NetBIOS</td></tr>
<tr class="osi-l4"><td>4</td><td>انتقال</td><td>TCP, UDP</td></tr>
<tr class="osi-l3"><td>3</td><td>شبکه</td><td>IP, ICMP</td></tr>
<tr class="osi-l2"><td>2</td><td>پیوند داده</td><td>Ethernet, ARP</td></tr>
<tr class="osi-l1"><td>1</td><td>فیزیکی</td><td>مس، فیبر نوری، WLAN</td></tr>
</tbody>
</table>

### چراغ راهنما با دور زدن متن

چراغ راهنما با `:::osi N` ساخته می‌شود؛ در اینجا `N` لایه‌ای است که باید برجسته شود (اینجا لایه ۳). این چراغ در حاشیه شناور است و متن بعدی به‌طور خودکار از کنار آن عبور می‌کند.

:::osi 3
:::

Lorem ipsum dolor sit amet, consetetur sadipscing elitr, sed diam nonumy eirmod tempor invidunt ut labore et dolore magna aliquyam erat, sed diam voluptua. At vero eos et accusam et justo duo dolores et ea rebum. Stet clita kasd gubergren, no sea takimata sanctus est Lorem ipsum dolor sit amet.

Lorem ipsum dolor sit amet, consetetur sadipscing elitr, sed diam nonumy eirmod tempor invidunt ut labore et dolore magna aliquyam erat, sed diam voluptua. At vero eos et accusam et justo duo dolores et ea rebum، و به همین دلیل این بخش از نظر محتوایی به لایه شبکه (Layer 3) تعلق دارد — برای همین دقیقاً همین کادر در چراغ راهنما رنگی است و بقیه خاکستری می‌مانند.

---

## بخش ۱: مفاهیم پایه

:::quiz short
نمادگذاری CIDR برای ماسک زیرشبکه 255.255.255.0 چیست؟
= /24
= 24
:::

:::quiz mc
کدام یک از آدرس‌های زیر آدرس شبکه 192.168.1.42/24 است؟
- [ ] 192.168.1.42
- [x] 192.168.1.0
- [ ] 192.168.1.255
- [ ] 192.168.0.0
:::

:::quiz fill
آدرس شبکه از یک عملیات {AND} بیتی بین آدرس IP و {ماسک زیرشبکه} به دست می‌آید. بالاترین آدرس در زیرشبکه، آدرس {پخش همگانی} است.
:::

:::evaluate
بررسی بخش ۱
:::

---

## بخش ۲: تطبیق — پروتکل‌ها و وظایفشان

:::quiz match
ARP -> آدرس MAC مربوط به یک آدرس IP را پیدا می‌کند
DNS -> نام میزبان‌ها را به آدرس‌های IP تبدیل می‌کند
DHCP -> آدرس‌های IP را به‌طور خودکار به کلاینت‌ها اختصاص می‌دهد
ICMP -> توسط ping و traceroute استفاده می‌شود
:::

:::evaluate
بررسی بخش ۲
:::

---

## بخش ۳: زیرشبکه‌بندی

:::quiz short
یک زیرشبکه /30 چند آدرس میزبان قابل استفاده دارد؟
= 2
:::

:::quiz mc
یک زیرشبکه /30 معمولاً برای چه کاری استفاده می‌شود؟
- [ ] برای شبکه‌های بزرگ اداری با دستگاه‌های زیاد
- [ ] به‌عنوان محدوده آدرس برای استخرهای DHCP
- [x] به‌عنوان شبکه ارتباطی بین دو مسیریاب
- [ ] برای نقطه‌های دسترسی WLAN
:::

:::quiz fill
یک زیرشبکه /25 دارای {128} آدرس است که {126} تای آن‌ها برای میزبان‌ها قابل استفاده است.
:::

:::quiz match
/24 -> 254 آدرس میزبان قابل استفاده
/25 -> 126 آدرس میزبان قابل استفاده
/28 -> 14 آدرس میزبان قابل استفاده
/30 -> 2 آدرس میزبان قابل استفاده
:::

:::evaluate
بررسی بخش ۳
:::

## بخش ۴: چندگزینه‌ای و تکالیف تصادفی

در `:::quiz multi` هر تعداد پاسخ می‌تواند درست باشد — هر گزاره جداگانه ارزیابی می‌شود:

:::quiz multi
کدام گزاره‌ها درباره ARP درست‌اند؟
- [x] ARP آدرس MAC مربوط به یک آدرس IP را پیدا می‌کند
- [ ] ARP آدرس IP مربوط به یک نام را پیدا می‌کند
- [x] یک درخواست ARP یک پخش همگانی است
- [ ] یک پاسخ ARP یک پخش همگانی است
:::

`:::quiz random <typ>` در هر بار فراخوانی تکالیف جدیدی تولید می‌کند (`count=N` تعداد را مشخص می‌کند). انواع: `bin2dec`، `dec2bin`، `cidr2mask`، `hosts`، `netbcast`، `samenet`، `subnet`.

:::quiz random dec2bin
count=2
:::

:::quiz random netbcast
برای آدرس زیر محاسبه کن:
:::

:::quiz random samenet
count=3
:::

:::quiz random subnet
:::

:::evaluate
بررسی بخش ۴
:::

## بخش ۴b: جدول برای تکمیل

`:::quiz table` — یک جدول معمولی مارک‌داون؛ سلول‌های `{Antwort}` به فیلدهای ورودی تبدیل می‌شوند (حالت‌های مختلف را با `|` جدا کن):

:::quiz table
شبکه `192.168.42.0/24` را به دو زیرشبکه تقسیم کن:
| زیرشبکه | آدرس شبکه | آدرس پخش همگانی |
|---|---|---|
| 1 | {192.168.42.0} | {192.168.42.127} |
| 2 | {192.168.42.128} | {192.168.42.255} |
:::

:::evaluate
بررسی جدول
:::

## بخش ۵: رنگ‌آمیزی بیت‌ها

برای فصل‌های IP و زیرشبکه‌بندی: `[[n|…]]` = بخش شبکه، `[[e|…]]` = گسترش، `[[h|…]]` = بخش میزبان — در متن عادی و در جدول‌ها:

[[n|11111111.11111111.11111111]].[[e|11]][[h|000000]] = `255.255.255.192`

برای نمایش چندخطی به‌جای ``` از یک بلوک `<pre class="bits-block">` استفاده کن (در بلوک‌های کد رنگ‌ها نمایش داده نمی‌شوند):

<pre class="bits-block">
vorher  (/24):  [[n|NNNNNNNN.NNNNNNNN.NNNNNNNN]].[[h|HHHHHHHH]]
nachher (/26):  [[n|NNNNNNNN.NNNNNNNN.NNNNNNNN]].[[e|EE]][[h|HHHHHH]]
</pre>

## بخش ۶: نمودار ارتباط

`:::seq` یک نمودار با دو خط حیات می‌کشد. شماره‌های SEQ و ACK و همچنین شمارنده‌های روی خطوط حیات از روی پرچم‌ها و داده‌های کاربر (`"…"`) محاسبه می‌شوند. `-x` به‌جای `->` باعث می‌شود یک سگمنت از بین برود، و `seq=…` یک شماره را بازنویسی می‌کند (مثلاً در یک ارسال مجدد).

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

با `:::quiz seq` علامت `?` (قبل از پرچم‌ها، یا `seq=?` / `ack=?`) به فیلد ورودی تبدیل می‌شود؛ `hide: counters` شمارنده‌ها را پنهان می‌کند:

:::quiz seq
Client -> Server: SYN
Server -> Client: ? SYN, ACK ack=?
Client -> Server: ? ACK ack=?
Client -> Server: PSH, ACK "Hello World"
Server -> Client: ACK ack=?
:::

:::evaluate
بررسی نمودار
:::
