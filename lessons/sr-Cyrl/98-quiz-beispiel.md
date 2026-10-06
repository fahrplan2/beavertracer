# Игралиште — Markdown и квиз (пробна страница)

[[toc]]

Ова страница служи за тестирање Markdown синтаксе и интерактивних типова питања.

---

## Markdown синтакса

### Форматирање текста

**Подебљано**, *курзив*, ~~прецртано~~, `Inline-Code`, и **_комбиновано_**.

Обичан пасус са [везом ка другој страници](01-einfuehrung.html) и [спољном везом](https://www.beavertracer.eu).

### Наслови

Нивои H2–H4 аутоматски се појављују у садржају (TOC).

#### Ово је H4 — не појављује се у садржају

### Листе

Неуређена:

- Ethernet
- IP
- TCP
  - HTTP
  - SMTP

Уређена:

1. Режим уређивања: изградња топологије
2. Режим извршавања: покретање симулације
3. Режим трагања: анализа пакета

### Табела

| Протокол | Слој | Порт |
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

### Calloutи

:::note
Ово је **note** callout — за неутралне напомене и допунске информације.
:::

:::tip
Ово је **tip** callout — за корисне савете и препоруке.
:::

:::warning
Ово је **warning** callout — за упозорења која захтевају пажњу.
:::

:::danger
Ово је **danger** callout — за критичне изворе грешака.
:::

:::draft
:::

### Иконе

Font Awesome Solid: :fa-play: :fa-stop: :fa-desktop: :fa-shield-halved: :fa-wifi:

Font Awesome Regular: :far-file: :far-circle:

Симболи уређаја: :router: :switch:

### Уграђена симулација

:::sim
url=/sims/demo.btsim
:::

### Задатак са провером понашања

:::task
title: Повежи PC 1 и PC 2
Провери да ли PC 1 (id 9) има IP адресу у мрежи 192.168.0.0/24 и да ли може да досегне PC 2 (id 11).
check: ip(9, "192.168.0.0/24")
check: pingOk(9, 11)
:::

---

## OSI референтни модел: шема боја

Пример табеле истакнуте бојама дуге (слој 1 доле, као у стеку) и „semafora“ на ивици странице са обтицањем текста.

### Обојена табела

<table class="osi-table">
<thead>
<tr><th>Слој</th><th>Назив</th><th>Примери протокола</th></tr>
</thead>
<tbody>
<tr class="osi-l7"><td>7</td><td>Апликација</td><td>HTTP, DNS, SMTP</td></tr>
<tr class="osi-l6"><td>6</td><td>Презентација</td><td>TLS, JPEG, ASCII</td></tr>
<tr class="osi-l5"><td>5</td><td>Сесија</td><td>RPC, NetBIOS</td></tr>
<tr class="osi-l4"><td>4</td><td>Транспорт</td><td>TCP, UDP</td></tr>
<tr class="osi-l3"><td>3</td><td>Мрежа</td><td>IP, ICMP</td></tr>
<tr class="osi-l2"><td>2</td><td>Веза података</td><td>Ethernet, ARP</td></tr>
<tr class="osi-l1"><td>1</td><td>Физички пренос бита</td><td>Бакар, оптичко влакно, WLAN</td></tr>
</tbody>
</table>

### Семафор са обтицањем текста

Семафор се креира помоћу `:::osi N`, при чему је `N` слој који треба истаћи (овде слој 3). Он лебди на ивици, а текст који следи аутоматски тече поред њега.

:::osi 3
:::

Lorem ipsum dolor sit amet, consetetur sadipscing elitr, sed diam nonumy eirmod tempor invidunt ut labore et dolore magna aliquyam erat, sed diam voluptua. At vero eos et accusam et justo duo dolores et ea rebum. Stet clita kasd gubergren, no sea takimata sanctus est Lorem ipsum dolor sit amet.

Lorem ipsum dolor sit amet, consetetur sadipscing elitr, sed diam nonumy eirmod tempor invidunt ut labore et dolore magna aliquyam erat, sed diam voluptua. At vero eos et accusam et justo duo dolores et ea rebum, због чега је овај одељак садржајно придружен мрежном слоју (Layer 3) — зато је управо ово поље у семафору обојено, а сва остала остају сива.

---

## Одељак 1: Основни појмови

:::quiz short
Која је CIDR нотација подмрежне маске 255.255.255.0?
= /24
= 24
:::

:::quiz mc
Која од следећих адреса је адреса мреже за 192.168.1.42/24?
- [ ] 192.168.1.42
- [x] 192.168.1.0
- [ ] 192.168.1.255
- [ ] 192.168.0.0
:::

:::quiz fill
Адреса мреже добија се битовском {AND} операцијом IP адресе и {подмрежне маске}. Највиша адреса у подмрежи је {броадкаст} адреса.
:::

:::evaluate
Провери одељак 1
:::

---

## Одељак 2: Придруживање — протоколи и њихови задаци

:::quiz match
ARP -> Одређује MAC адресу за дату IP адресу
DNS -> Преводи називе хостова у IP адресе
DHCP -> Аутоматски додељује IP адресе клијентима
ICMP -> Користе га ping и traceroute
:::

:::evaluate
Провери одељак 2
:::

---

## Одељак 3: Подмрежавање

:::quiz short
Колико употребљивих адреса хостова има /30 подмрежа?
= 2
:::

:::quiz mc
За шта се типично користи /30 подмрежа?
- [ ] За велике канцеларијске мреже са много уређаја
- [ ] Као опсег адреса за DHCP пулове
- [x] Као спојна мрежа између два рутера
- [ ] За WLAN приступне тачке
:::

:::quiz fill
/25 подмрежа има {128} адреса, од којих је {126} употребљиво за хостове.
:::

:::quiz match
/24 -> 254 употребљиве адресе хостова
/25 -> 126 употребљивих адреса хостова
/28 -> 14 употребљивих адреса хостова
/30 -> 2 употребљиве адресе хостова
:::

:::evaluate
Провери одељак 3
:::

## Одељак 4: Вишеструки избор и насумични задаци

Код `:::quiz multi` било који број одговора може бити тачан — свака тврдња се вреднује појединачно:

:::quiz multi
Које тврдње о ARP-у су тачне?
- [x] ARP одређује MAC адресу за IP адресу
- [ ] ARP одређује IP адресу за име
- [x] ARP упит је броадкаст
- [ ] ARP одговор је броадкаст
:::

`:::quiz random <typ>` при сваком позиву ствара нове задатке (`count=N` одређује број). Типови: `bin2dec`, `dec2bin`, `cidr2mask`, `hosts`, `netbcast`, `samenet`, `subnet`.

:::quiz random dec2bin
count=2
:::

:::quiz random netbcast
Израчунај за следећу адресу:
:::

:::quiz random samenet
count=3
:::

:::quiz random subnet
:::

:::evaluate
Провери одељак 4
:::

## Одељак 4b: Табела за попуњавање

`:::quiz table` — обична Markdown табела, ћелије `{Antwort}` постају поља за унос (варијанте раздвој знаком `|`):

:::quiz table
Подели `192.168.42.0/24` на две подмреже:
| Подмрежа | Адреса мреже | Броадкаст адреса |
|---|---|---|
| 1 | {192.168.42.0} | {192.168.42.127} |
| 2 | {192.168.42.128} | {192.168.42.255} |
:::

:::evaluate
Провери табелу
:::

## Одељак 5: Бојење бита

За поглавља о IP-у и подмрежавању: `[[n|…]]` = мрежни део, `[[e|…]]` = проширење, `[[h|…]]` = хост део — у току текста и у табелама:

[[n|11111111.11111111.11111111]].[[e|11]][[h|000000]] = `255.255.255.192`

За приказе у више редова уместо ``` користи блок `<pre class="bits-block">` (у блоковима кода боје се не би приказале):

<pre class="bits-block">
vorher  (/24):  [[n|NNNNNNNN.NNNNNNNN.NNNNNNNN]].[[h|HHHHHHHH]]
nachher (/26):  [[n|NNNNNNNN.NNNNNNNN.NNNNNNNN]].[[e|EE]][[h|HHHHHH]]
</pre>

## Одељак 6: Дијаграм комуникације

`:::seq` црта дијаграм са две линије живота. SEQ и ACK бројеви, као и бројачи на линијама живота, израчунавају се из заставица (flags) и корисних података (`"…"`). `-x` уместо `->` узрокује да се сегмент изгуби, `seq=…` надјачава број (нпр. код поновног слања).

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

Са `:::quiz seq` знак `?` (испред заставица, или `seq=?` / `ack=?`) постаје поље за унос; `hide: counters` сакрива бројаче:

:::quiz seq
Client -> Server: SYN
Server -> Client: ? SYN, ACK ack=?
Client -> Server: ? ACK ack=?
Client -> Server: PSH, ACK "Hello World"
Server -> Client: ACK ack=?
:::

:::evaluate
Провери дијаграм
:::
