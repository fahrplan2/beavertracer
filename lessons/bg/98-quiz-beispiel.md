# Игрална площадка — Markdown и тестове (тестова страница)

[[toc]]

Тази страница служи за тестване на Markdown синтаксиса и на интерактивните типове въпроси.

---

## Markdown синтаксис

### Форматиране на текст

**Получер**, *курсив*, ~~зачеркнат~~, `Inline-Code`, и **_комбиниран_**.

Обикновен абзац с [връзка към друга страница](01-einfuehrung.html) и [външна връзка](https://www.beavertracer.eu).

### Заглавия

Нива H2–H4 се появяват автоматично в съдържанието (TOC).

#### Това е H4 — не се показва в TOC

### Списъци

Неподредени:

- Ethernet
- IP
- TCP
  - HTTP
  - SMTP

Подредени:

1. Режим на редактиране: изграждане на топологията
2. Режим на изпълнение: стартиране на симулацията
3. Режим на проследяване: анализ на пакети

### Таблица

| Протокол | Слой | Порт |
|-----------|---------|------|
| HTTP      | 7       | 80   |
| HTTPS     | 7       | 443  |
| DNS       | 7       | 53   |
| TCP       | 4       | —    |

### Код

Inline: `ping 192.168.0.1`

Блок:

```
$ ping 192.168.0.2
PING 192.168.0.2: 56 data bytes
64 bytes from 192.168.0.2: icmp_seq=0 ttl=64 time=0.4 ms
```

### Callouts

:::note
Това е **note**-callout — за неутрални бележки и допълнителна информация.
:::

:::tip
Това е **tip**-callout — за полезни съвети и препоръки.
:::

:::warning
Това е **warning**-callout — за предупреждения, които изискват внимание.
:::

:::danger
Това е **danger**-callout — за критични източници на грешки.
:::

:::draft
:::

### Икони

Font Awesome Solid: :fa-play: :fa-stop: :fa-desktop: :fa-shield-halved: :fa-wifi:

Font Awesome Regular: :far-file: :far-circle:

Символи на устройства: :router: :switch:

### Вградена симулация

:::sim
url=/sims/demo.btsim
:::

### Задача с проверка на поведението

:::task
title: Свържи PC 1 и PC 2
Провери дали PC 1 (id 9) има IP адрес в мрежата 192.168.0.0/24 и може да достигне PC 2 (id 11).
check: ip(9, "192.168.0.0/24")
check: pingOk(9, 11)
:::

---

## OSI референтен модел: цветова схема

Пример за таблица, оцветена в цветовете на дъгата (слой 1 отдолу, както в стека), както и за „светофар“ в полето на страницата с обтичане на текста.

### Цветна таблица

<table class="osi-table">
<thead>
<tr><th>Слой</th><th>Име</th><th>Примерни протоколи</th></tr>
</thead>
<tbody>
<tr class="osi-l7"><td>7</td><td>Приложение</td><td>HTTP, DNS, SMTP</td></tr>
<tr class="osi-l6"><td>6</td><td>Представяне</td><td>TLS, JPEG, ASCII</td></tr>
<tr class="osi-l5"><td>5</td><td>Сесия</td><td>RPC, NetBIOS</td></tr>
<tr class="osi-l4"><td>4</td><td>Транспорт</td><td>TCP, UDP</td></tr>
<tr class="osi-l3"><td>3</td><td>Мрежа</td><td>IP, ICMP</td></tr>
<tr class="osi-l2"><td>2</td><td>Канал</td><td>Ethernet, ARP</td></tr>
<tr class="osi-l1"><td>1</td><td>Физически</td><td>Мед, оптично влакно, WLAN</td></tr>
</tbody>
</table>

### Светофар с обтичане на текста

Светофарът се създава чрез `:::osi N`, където `N` е слоят, който трябва да се подчертае (тук слой 3). Той се позиционира встрани, а следващият текст автоматично го обтича.

:::osi 3
:::

Lorem ipsum dolor sit amet, consetetur sadipscing elitr, sed diam nonumy eirmod tempor invidunt ut labore et dolore magna aliquyam erat, sed diam voluptua. At vero eos et accusam et justo duo dolores et ea rebum. Stet clita kasd gubergren, no sea takimata sanctus est Lorem ipsum dolor sit amet.

Lorem ipsum dolor sit amet, consetetur sadipscing elitr, sed diam nonumy eirmod tempor invidunt ut labore et dolore magna aliquyam erat, sed diam voluptua. At vero eos et accusam et justo duo dolores et ea rebum, поради което този раздел по съдържание се отнася към мрежовия слой (Layer 3) — затова точно тази кутия в светофара е оцветена, а всички останали остават сиви.

---

## Раздел 1: Основни понятия

:::quiz short
Какъв е CIDR записът на мрежовата маска 255.255.255.0?
= /24
= 24
:::

:::quiz mc
Кой от следните адреси е мрежовият адрес на 192.168.1.42/24?
- [ ] 192.168.1.42
- [x] 192.168.1.0
- [ ] 192.168.1.255
- [ ] 192.168.0.0
:::

:::quiz fill
Мрежовият адрес се получава чрез побитова {AND} операция между IP адреса и {мрежовата маска}. Най-високият адрес в подмрежата е {широковещателният} адрес.
:::

:::evaluate
Провери раздел 1
:::

---

## Раздел 2: Съпоставяне — протоколи и техните задачи

:::quiz match
ARP -> Определя MAC адреса за даден IP адрес
DNS -> Преобразува имена на хостове в IP адреси
DHCP -> Автоматично раздава IP адреси на клиентите
ICMP -> Използва се от ping и traceroute
:::

:::evaluate
Провери раздел 2
:::

---

## Раздел 3: Подмрежи

:::quiz short
Колко използваеми хост адреса има една /30 подмрежа?
= 2
:::

:::quiz mc
За какво обикновено се използва /30 подмрежа?
- [ ] За големи офис мрежи с много устройства
- [ ] Като адресен диапазон за DHCP пулове
- [x] Като свързваща мрежа между два рутера
- [ ] За WLAN точки за достъп
:::

:::quiz fill
Една /25 подмрежа има {128} адреса, от които {126} са използваеми за хостове.
:::

:::quiz match
/24 -> 254 използваеми хост адреса
/25 -> 126 използваеми хост адреса
/28 -> 14 използваеми хост адреса
/30 -> 2 използваеми хост адреса
:::

:::evaluate
Провери раздел 3
:::

## Раздел 4: Множествен избор и случайни задачи

При `:::quiz multi` произволен брой отговори могат да са верни — всяко твърдение се оценява поотделно:

:::quiz multi
Кои твърдения за ARP са верни?
- [x] ARP определя MAC адреса за даден IP адрес
- [ ] ARP определя IP адреса за дадено име
- [x] ARP заявката е широковещателна
- [ ] ARP отговорът е широковещателен
:::

`:::quiz random <typ>` генерира при всяко отваряне нови задачи (`count=N` определя броя). Типове: `bin2dec`, `dec2bin`, `cidr2mask`, `hosts`, `netbcast`, `samenet`, `subnet`.

:::quiz random dec2bin
count=2
:::

:::quiz random netbcast
Изчисли за следния адрес:
:::

:::quiz random samenet
count=3
:::

:::quiz random subnet
:::

:::evaluate
Провери раздел 4
:::

## Раздел 4b: Таблица за попълване

`:::quiz table` — обикновена Markdown таблица, клетките `{Antwort}` стават полета за въвеждане (вариантите се разделят с `|`):

:::quiz table
Раздели `192.168.42.0/24` на две подмрежи:
| Подмрежа | Мрежов адрес | Широковещателен адрес |
|---|---|---|
| 1 | {192.168.42.0} | {192.168.42.127} |
| 2 | {192.168.42.128} | {192.168.42.255} |
:::

:::evaluate
Провери таблицата
:::

## Раздел 5: Оцветяване на битове

За главите за IP и подмрежите: `[[n|…]]` = мрежова част, `[[e|…]]` = разширение, `[[h|…]]` = хост част — в текста и в таблици:

[[n|11111111.11111111.11111111]].[[e|11]][[h|000000]] = `255.255.255.192`

За многоредово представяне вместо ``` се използва блок `<pre class="bits-block">` (в кодови блокове цветовете не биха се показали):

<pre class="bits-block">
преди   (/24):  [[n|NNNNNNNN.NNNNNNNN.NNNNNNNN]].[[h|HHHHHHHH]]
после   (/26):  [[n|NNNNNNNN.NNNNNNNN.NNNNNNNN]].[[e|EE]][[h|HHHHHH]]
</pre>

## Раздел 6: Диаграма на комуникацията

`:::seq` чертае диаграма с две линии на живота. SEQ и ACK номерата, както и броячите при линиите на живота, се изчисляват от флаговете и полезните данни (`"…"`). `-x` вместо `->` води до загуба на сегмента, `seq=…` замества даден номер (напр. при повторно предаване).

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

При `:::quiz seq` символите `?` (преди флаговете или `seq=?` / `ack=?`) стават полета за въвеждане; `hide: counters` скрива броячите:

:::quiz seq
Client -> Server: SYN
Server -> Client: ? SYN, ACK ack=?
Client -> Server: ? ACK ack=?
Client -> Server: PSH, ACK "Hello World"
Server -> Client: ACK ack=?
:::

:::evaluate
Провери диаграмата
:::
