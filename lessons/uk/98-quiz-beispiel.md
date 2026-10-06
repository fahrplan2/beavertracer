# Ігровий майданчик — Markdown і квіз (тестова сторінка)

[[toc]]

Ця сторінка призначена для тестування синтаксису Markdown та інтерактивних типів запитань.

---

## Синтаксис Markdown

### Форматування тексту

**Жирний**, *курсив*, ~~закреслений~~, `Inline-Code`, і **_поєднаний_**.

Звичайний абзац із [посиланням на іншу сторінку](01-einfuehrung.html) та [зовнішнім посиланням](https://www.beavertracer.eu).

### Заголовки

Рівні H2–H4 автоматично з'являються в змісті (TOC).

#### Це H4 — він не з'являється в TOC

### Списки

Невпорядкований:

- Ethernet
- IP
- TCP
  - HTTP
  - SMTP

Впорядкований:

1. Режим редагування: побудувати топологію
2. Режим виконання: запустити симуляцію
3. Режим трасування: аналізувати пакети

### Таблиця

| Протокол | Рівень | Порт |
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

### Виноски

:::note
Це виноска **note** — для нейтральних підказок і додаткової інформації.
:::

:::tip
Це виноска **tip** — для корисних порад і рекомендацій.
:::

:::warning
Це виноска **warning** — для попереджень, які потребують уваги.
:::

:::danger
Це виноска **danger** — для критичних джерел помилок.
:::

:::draft
:::

### Іконки

Font Awesome Solid: :fa-play: :fa-stop: :fa-desktop: :fa-shield-halved: :fa-wifi:

Font Awesome Regular: :far-file: :far-circle:

Символи пристроїв: :router: :switch:

### Вбудована симуляція

:::sim
url=/sims/demo.btsim
:::

### Завдання з перевіркою поведінки

:::task
title: З'єднати PC 1 і PC 2
Перевір, чи має PC 1 (id 9) IP-адресу в мережі 192.168.0.0/24 і чи може він досягти PC 2 (id 11).
check: ip(9, "192.168.0.0/24")
check: pingOk(9, 11)
:::

---

## Еталонна модель OSI: кольорова схема

Приклад таблиці з веселковим виділенням (рівень 1 внизу, як у стеку) та «світлофора» на полі сторінки з обтіканням текстом.

### Кольорова таблиця

<table class="osi-table">
<thead>
<tr><th>Рівень</th><th>Назва</th><th>Приклади протоколів</th></tr>
</thead>
<tbody>
<tr class="osi-l7"><td>7</td><td>Прикладний</td><td>HTTP, DNS, SMTP</td></tr>
<tr class="osi-l6"><td>6</td><td>Подання</td><td>TLS, JPEG, ASCII</td></tr>
<tr class="osi-l5"><td>5</td><td>Сеансовий</td><td>RPC, NetBIOS</td></tr>
<tr class="osi-l4"><td>4</td><td>Транспортний</td><td>TCP, UDP</td></tr>
<tr class="osi-l3"><td>3</td><td>Мережевий</td><td>IP, ICMP</td></tr>
<tr class="osi-l2"><td>2</td><td>Канальний</td><td>Ethernet, ARP</td></tr>
<tr class="osi-l1"><td>1</td><td>Фізичний</td><td>Мідь, оптоволокно, WLAN</td></tr>
</tbody>
</table>

### Світлофор з обтіканням текстом

Світлофор створюється за допомогою `:::osi N`, де `N` — рівень, який потрібно виділити (тут рівень 3). Він «плаває» біля краю, а наступний текст автоматично обтікає його.

:::osi 3
:::

Lorem ipsum dolor sit amet, consetetur sadipscing elitr, sed diam nonumy eirmod tempor invidunt ut labore et dolore magna aliquyam erat, sed diam voluptua. At vero eos et accusam et justo duo dolores et ea rebum. Stet clita kasd gubergren, no sea takimata sanctus est Lorem ipsum dolor sit amet.

Lorem ipsum dolor sit amet, consetetur sadipscing elitr, sed diam nonumy eirmod tempor invidunt ut labore et dolore magna aliquyam erat, sed diam voluptua. At vero eos et accusam et justo duo dolores et ea rebum, через що цей розділ за змістом належить до мережевого рівня (Layer 3) — тому саме цей блок у світлофорі кольоровий, а всі інші залишаються сірими.

---

## Розділ 1: Основні поняття

:::quiz short
Який CIDR-запис маски підмережі 255.255.255.0?
= /24
= 24
:::

:::quiz mc
Яка з наведених адрес є адресою мережі для 192.168.1.42/24?
- [ ] 192.168.1.42
- [x] 192.168.1.0
- [ ] 192.168.1.255
- [ ] 192.168.0.0
:::

:::quiz fill
Адресу мережі отримують побітовою операцією {AND} над IP-адресою та {маскою підмережі}. Найвища адреса в підмережі — це {широкомовна} адреса.
:::

:::evaluate
Перевірити розділ 1
:::

---

## Розділ 2: Зіставлення — протоколи та їхні завдання

:::quiz match
ARP -> Визначає MAC-адресу за IP-адресою
DNS -> Перетворює імена хостів на IP-адреси
DHCP -> Автоматично призначає IP-адреси клієнтам
ICMP -> Використовується командами ping і traceroute
:::

:::evaluate
Перевірити розділ 2
:::

---

## Розділ 3: Підмережі

:::quiz short
Скільки придатних для використання адрес хостів має підмережа /30?
= 2
:::

:::quiz mc
Для чого зазвичай використовують підмережу /30?
- [ ] Для великих офісних мереж із багатьма пристроями
- [ ] Як діапазон адрес для пулів DHCP
- [x] Як з'єднувальну мережу між двома маршрутизаторами
- [ ] Для точок доступу WLAN
:::

:::quiz fill
Підмережа /25 має {128} адрес, з яких {126} придатні для хостів.
:::

:::quiz match
/24 -> 254 придатні адреси хостів
/25 -> 126 придатних адрес хостів
/28 -> 14 придатних адрес хостів
/30 -> 2 придатні адреси хостів
:::

:::evaluate
Перевірити розділ 3
:::

## Розділ 4: Множинний вибір і випадкові завдання

У `:::quiz multi` правильними можуть бути довільна кількість відповідей — кожне твердження оцінюється окремо:

:::quiz multi
Які твердження про ARP правильні?
- [x] ARP визначає MAC-адресу за IP-адресою
- [ ] ARP визначає IP-адресу за іменем
- [x] ARP-запит є широкомовним
- [ ] ARP-відповідь є широкомовною
:::

`:::quiz random <typ>` створює нові завдання при кожному виклику (`count=N` задає кількість). Типи: `bin2dec`, `dec2bin`, `cidr2mask`, `hosts`, `netbcast`, `samenet`, `subnet`.

:::quiz random dec2bin
count=2
:::

:::quiz random netbcast
Обчисли для наведеної адреси:
:::

:::quiz random samenet
count=3
:::

:::quiz random subnet
:::

:::evaluate
Перевірити розділ 4
:::

## Розділ 4b: Таблиця для заповнення

`:::quiz table` — звичайна таблиця Markdown, комірки `{Antwort}` перетворюються на поля введення (варіанти розділяй за допомогою `|`):

:::quiz table
Поділи `192.168.42.0/24` на дві підмережі:
| Підмережа | Адреса мережі | Широкомовна адреса |
|---|---|---|
| 1 | {192.168.42.0} | {192.168.42.127} |
| 2 | {192.168.42.128} | {192.168.42.255} |
:::

:::evaluate
Перевірити таблицю
:::

## Розділ 5: Виділення бітів кольором

Для розділів про IP та підмережі: `[[n|…]]` = мережева частина, `[[e|…]]` = розширення, `[[h|…]]` = хостова частина — у суцільному тексті та в таблицях:

[[n|11111111.11111111.11111111]].[[e|11]][[h|000000]] = `255.255.255.192`

Для багаторядкового відображення замість ``` використовуй блок `<pre class="bits-block">` (у блоках коду кольори не відображалися б):

<pre class="bits-block">
vorher  (/24):  [[n|NNNNNNNN.NNNNNNNN.NNNNNNNN]].[[h|HHHHHHHH]]
nachher (/26):  [[n|NNNNNNNN.NNNNNNNN.NNNNNNNN]].[[e|EE]][[h|HHHHHH]]
</pre>

## Розділ 6: Діаграма послідовності

`:::seq` малює діаграму з двома лініями життя. Номери SEQ і ACK, а також лічильники на лініях життя обчислюються з прапорців і корисних даних (`"…"`). `-x` замість `->` призводить до втрати сегмента, `seq=…` перевизначає номер (наприклад, при повторному передаванні).

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

У `:::quiz seq` символи `?` (перед прапорцями, або `seq=?` / `ack=?`) перетворюються на поля введення; `hide: counters` приховує лічильники:

:::quiz seq
Client -> Server: SYN
Server -> Client: ? SYN, ACK ack=?
Client -> Server: ? ACK ack=?
Client -> Server: PSH, ACK "Hello World"
Server -> Client: ACK ack=?
:::

:::evaluate
Перевірити діаграму
:::
