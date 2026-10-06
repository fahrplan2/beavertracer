# ساحة التجارب — Markdown والاختبارات (صفحة اختبار)

[[toc]]

تُستخدم هذه الصفحة لاختبار صيغة Markdown وأنواع الأسئلة التفاعلية.

---

## صيغة Markdown

### تنسيق النص

**غامق**، *مائل*، ~~مشطوب~~، `Inline-Code`، و**_مدمج_**.

فقرة عادية تحتوي على [رابط إلى صفحة أخرى](01-einfuehrung.html) و[رابط خارجي](https://www.beavertracer.eu).

### العناوين

تظهر المستويات H2–H4 تلقائيًا في جدول المحتويات (TOC).

#### هذا H4 — لا يظهر في جدول المحتويات

### القوائم

غير مرتبة:

- Ethernet
- IP
- TCP
  - HTTP
  - SMTP

مرتبة:

1. وضع التحرير: بناء الطوبولوجيا
2. وضع التشغيل: بدء المحاكاة
3. وضع التتبع: تحليل الحزم

### جدول

| البروتوكول | الطبقة | المنفذ |
|-----------|---------|------|
| HTTP      | 7       | 80   |
| HTTPS     | 7       | 443  |
| DNS       | 7       | 53   |
| TCP       | 4       | —    |

### الشيفرة البرمجية

داخل السطر: `ping 192.168.0.1`

كتلة:

```
$ ping 192.168.0.2
PING 192.168.0.2: 56 data bytes
64 bytes from 192.168.0.2: icmp_seq=0 ttl=64 time=0.4 ms
```

### المربعات التوضيحية

:::note
هذا مربع **note** — للملاحظات المحايدة والمعلومات الإضافية.
:::

:::tip
هذا مربع **tip** — للنصائح المفيدة والتوصيات.
:::

:::warning
هذا مربع **warning** — للتحذيرات التي تتطلب الانتباه.
:::

:::danger
هذا مربع **danger** — لمصادر الأخطاء الحرجة.
:::

:::draft
:::

### الأيقونات

Font Awesome Solid: :fa-play: :fa-stop: :fa-desktop: :fa-shield-halved: :fa-wifi:

Font Awesome Regular: :far-file: :far-circle:

رموز الأجهزة: :router: :switch:

### محاكاة مضمّنة

:::sim
url=/sims/demo.btsim
:::

### مهمة مع فحص السلوك

:::task
title: ربط PC 1 و PC 2
تحقق مما إذا كان لدى PC 1 (id 9) عنوان IP في الشبكة 192.168.0.0/24 وما إذا كان بإمكانه الوصول إلى PC 2 (id 11).
check: ip(9, "192.168.0.0/24")
check: pingOk(9, 11)
:::

---

## نموذج OSI المرجعي: مخطط الألوان

مثال على جدول مميَّز بألوان قوس قزح (الطبقة 1 في الأسفل، كما في الحزمة المتراصّة) وكذلك "إشارة مرور" على حافة الصفحة مع التفاف النص حولها.

### جدول ملوّن

<table class="osi-table">
<thead>
<tr><th>الطبقة</th><th>الاسم</th><th>أمثلة على البروتوكولات</th></tr>
</thead>
<tbody>
<tr class="osi-l7"><td>7</td><td>التطبيقات</td><td>HTTP, DNS, SMTP</td></tr>
<tr class="osi-l6"><td>6</td><td>العرض</td><td>TLS, JPEG, ASCII</td></tr>
<tr class="osi-l5"><td>5</td><td>الجلسة</td><td>RPC, NetBIOS</td></tr>
<tr class="osi-l4"><td>4</td><td>النقل</td><td>TCP, UDP</td></tr>
<tr class="osi-l3"><td>3</td><td>الشبكة</td><td>IP, ICMP</td></tr>
<tr class="osi-l2"><td>2</td><td>ارتباط البيانات</td><td>Ethernet, ARP</td></tr>
<tr class="osi-l1"><td>1</td><td>الطبقة الفيزيائية</td><td>نحاس، ألياف ضوئية، WLAN</td></tr>
</tbody>
</table>

### إشارة المرور مع التفاف النص

يتم إنشاء إشارة المرور باستخدام `:::osi N`، حيث `N` هي الطبقة المراد إبرازها (هنا الطبقة 3). تطفو على الحافة، ويتدفق النص التالي حولها تلقائيًا.

:::osi 3
:::

Lorem ipsum dolor sit amet, consetetur sadipscing elitr, sed diam nonumy eirmod tempor invidunt ut labore et dolore magna aliquyam erat, sed diam voluptua. At vero eos et accusam et justo duo dolores et ea rebum. Stet clita kasd gubergren, no sea takimata sanctus est Lorem ipsum dolor sit amet.

Lorem ipsum dolor sit amet, consetetur sadipscing elitr, sed diam nonumy eirmod tempor invidunt ut labore et dolore magna aliquyam erat, sed diam voluptua. At vero eos et accusam et justo duo dolores et ea rebum، ولذلك يُنسب هذا القسم من حيث المحتوى إلى طبقة الشبكة (Layer 3) — ولهذا السبب بالذات يكون هذا المربع وحده ملوّنًا في إشارة المرور، بينما تبقى جميع المربعات الأخرى رمادية.

---

## القسم 1: المفاهيم الأساسية

:::quiz short
ما هو تدوين CIDR لقناع الشبكة الفرعية 255.255.255.0؟
= /24
= 24
:::

:::quiz mc
أي من العناوين التالية هو عنوان الشبكة للعنوان 192.168.1.42/24؟
- [ ] 192.168.1.42
- [x] 192.168.1.0
- [ ] 192.168.1.255
- [ ] 192.168.0.0
:::

:::quiz fill
نحصل على عنوان الشبكة بإجراء عملية {AND} على مستوى البتات بين عنوان IP و{قناع الشبكة}. أعلى عنوان في الشبكة الفرعية هو عنوان {البث}.
:::

:::evaluate
التحقق من القسم 1
:::

---

## القسم 2: المطابقة — البروتوكولات ومهامها

:::quiz match
ARP -> يحدد عنوان MAC المقابل لعنوان IP
DNS -> يحوّل أسماء المضيفين إلى عناوين IP
DHCP -> يمنح العملاء عناوين IP تلقائيًا
ICMP -> يستخدمه ping وtraceroute
:::

:::evaluate
التحقق من القسم 2
:::

---

## القسم 3: تقسيم الشبكات الفرعية

:::quiz short
كم عدد عناوين المضيفين القابلة للاستخدام في شبكة فرعية من النوع /30؟
= 2
:::

:::quiz mc
فيمَ تُستخدم الشبكة الفرعية /30 عادةً؟
- [ ] لشبكات المكاتب الكبيرة التي تضم أجهزة كثيرة
- [ ] كنطاق عناوين لمجموعات DHCP
- [x] كشبكة ربط بين راوترين
- [ ] لنقاط الوصول اللاسلكية
:::

:::quiz fill
تحتوي الشبكة الفرعية /25 على {128} عنوانًا، منها {126} قابلة للاستخدام للمضيفين.
:::

:::quiz match
/24 -> 254 عنوان مضيف قابل للاستخدام
/25 -> 126 عنوان مضيف قابل للاستخدام
/28 -> 14 عنوان مضيف قابل للاستخدام
/30 -> 2 عنوان مضيف قابل للاستخدام
:::

:::evaluate
التحقق من القسم 3
:::

## القسم 4: الاختيار المتعدد والمسائل العشوائية

في `:::quiz multi` يمكن أن يكون أي عدد من الإجابات صحيحًا — ويُقيَّم كل عبارة على حدة:

:::quiz multi
أي العبارات التالية عن ARP صحيحة؟
- [x] يحدد ARP عنوان MAC المقابل لعنوان IP
- [ ] يحدد ARP عنوان IP المقابل لاسم
- [x] طلب ARP هو بث
- [ ] رد ARP هو بث
:::

ينشئ `:::quiz random <typ>` مسائل جديدة عند كل استدعاء (يحدد `count=N` العدد). الأنواع: `bin2dec`، `dec2bin`، `cidr2mask`، `hosts`، `netbcast`، `samenet`، `subnet`.

:::quiz random dec2bin
count=2
:::

:::quiz random netbcast
احسب للعنوان التالي:
:::

:::quiz random samenet
count=3
:::

:::quiz random subnet
:::

:::evaluate
التحقق من القسم 4
:::

## القسم 4b: جدول للتعبئة

`:::quiz table` — جدول Markdown عادي، وتتحول الخلايا `{Antwort}` إلى حقول إدخال (افصل البدائل بالرمز `|`):

:::quiz table
قسّم `192.168.42.0/24` إلى شبكتين فرعيتين:
| الشبكة الفرعية | عنوان الشبكة | عنوان البث |
|---|---|---|
| 1 | {192.168.42.0} | {192.168.42.127} |
| 2 | {192.168.42.128} | {192.168.42.255} |
:::

:::evaluate
التحقق من الجدول
:::

## القسم 5: تلوين البتات

لفصلي IP وتقسيم الشبكات الفرعية: `[[n|…]]` = جزء الشبكة، `[[e|…]]` = الامتداد، `[[h|…]]` = جزء المضيف — في النص المتصل وفي الجداول:

[[n|11111111.11111111.11111111]].[[e|11]][[h|000000]] = `255.255.255.192`

للعروض متعددة الأسطر، استخدم كتلة `<pre class="bits-block">` بدلًا من ``` (في كتل الشيفرة لن تُعرض الألوان):

<pre class="bits-block">
vorher  (/24):  [[n|NNNNNNNN.NNNNNNNN.NNNNNNNN]].[[h|HHHHHHHH]]
nachher (/26):  [[n|NNNNNNNN.NNNNNNNN.NNNNNNNN]].[[e|EE]][[h|HHHHHH]]
</pre>

## القسم 6: مخطط التراسل

يرسم `:::seq` مخططًا بخطَّي حياة. تُحسب أرقام SEQ وACK وكذلك العدّادات على خطوط الحياة من الأعلام (flags) والبيانات المفيدة (`"…"`). يتسبب `-x` بدلًا من `->` في فقدان قطعة (segment)، ويستبدل `seq=…` رقمًا (مثلًا عند إعادة الإرسال).

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

مع `:::quiz seq` تتحول علامات `?` (قبل الأعلام، أو `seq=?` / `ack=?`) إلى حقول إدخال؛ ويخفي `hide: counters` العدّادات:

:::quiz seq
Client -> Server: SYN
Server -> Client: ? SYN, ACK ack=?
Client -> Server: ? ACK ack=?
Client -> Server: PSH, ACK "Hello World"
Server -> Client: ACK ack=?
:::

:::evaluate
التحقق من المخطط
:::
