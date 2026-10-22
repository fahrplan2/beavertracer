# Playground — Markdown u quiz (paġna tat-test)

[[toc]]

Din il-paġna sservi biex tittestja s-sintassi tal-Markdown u t-tipi interattivi ta' mistoqsijiet.

---

## Sintassi tal-Markdown

### Formattjar tat-test

**Bold**, *korsiv*, ~~strikethrough~~, `Inline-Code`, u **_magħquda_**.

Paragrafu normali b'[link għal paġna oħra](01-einfuehrung.html) u b'[link estern](https://www.beavertracer.eu).

### Intestaturi

Il-livelli H2–H4 jidhru awtomatikament fil-werrej (TOC).

#### Dan huwa H4 — ma jidhirx fit-TOC

### Listi

Mhux ordnati:

- Ethernet
- IP
- TCP
  - HTTP
  - SMTP

Ordnati:

1. Modalità ta' editjar: ibni t-topoloġija
2. Modalità ta' tħaddim: ibda s-simulazzjoni
3. Modalità ta' traċċar: analizza l-packets

### Tabella

| Protokoll | Layer | Port |
|-----------|---------|------|
| HTTP      | 7       | 80   |
| HTTPS     | 7       | 443  |
| DNS       | 7       | 53   |
| TCP       | 4       | —    |

### Kodiċi

Inline: `ping 192.168.0.1`

Blokk:

```
$ ping 192.168.0.2
PING 192.168.0.2: 56 data bytes
64 bytes from 192.168.0.2: icmp_seq=0 ttl=64 time=0.4 ms
```

### Callouts

:::note
Dan huwa callout ta' tip **note** — għal noti newtrali u informazzjoni addizzjonali.
:::

:::tip
Dan huwa callout ta' tip **tip** — għal pariri utli u rakkomandazzjonijiet.
:::

:::warning
Dan huwa callout ta' tip **warning** — għal twissijiet li jeħtieġu attenzjoni.
:::

:::danger
Dan huwa callout ta' tip **danger** — għal sorsi kritiċi ta' żbalji.
:::

:::draft
:::

### Ikoni

Font Awesome Solid: :fa-play: :fa-stop: :fa-desktop: :fa-shield-halved: :fa-wifi:

Font Awesome Regular: :far-file: :far-circle:

Simboli tal-apparat: :router: :switch:

### Simulazzjoni inkorporata

:::sim
url=/sims/demo.btsim
:::

### Task b'kontroll tal-aġir

:::task
title: Ikkonnettja PC 1 u PC 2
Iċċekkja jekk PC 1 (id 9) għandux IP fin-network 192.168.0.0/24 u jistax jilħaq PC 2 (id 11).
check: ip(9, "192.168.0.0/24")
check: pingOk(9, 11)
:::

---

## Mudell ta' referenza OSI: skema tal-kuluri

Eżempju ta' tabella enfasizzata b'kuluri tal-qawsalla (layer 1 isfel, bħal fil-munzell) kif ukoll "sinjal tat-traffiku" fil-ġenb tal-paġna b'test li jiċċirkola madwaru.

### Tabella bil-kuluri

<table class="osi-table">
<thead>
<tr><th>Layer</th><th>Isem</th><th>Protokolli ta' eżempju</th></tr>
</thead>
<tbody>
<tr class="osi-l7"><td>7</td><td>Applikazzjoni</td><td>HTTP, DNS, SMTP</td></tr>
<tr class="osi-l6"><td>6</td><td>Preżentazzjoni</td><td>TLS, JPEG, ASCII</td></tr>
<tr class="osi-l5"><td>5</td><td>Sessjoni</td><td>RPC, NetBIOS</td></tr>
<tr class="osi-l4"><td>4</td><td>Transport</td><td>TCP, UDP</td></tr>
<tr class="osi-l3"><td>3</td><td>Network</td><td>IP, ICMP</td></tr>
<tr class="osi-l2"><td>2</td><td>Data link</td><td>Ethernet, ARP</td></tr>
<tr class="osi-l1"><td>1</td><td>Trasmissjoni tal-bits</td><td>Ram, fibra ottika, WLAN</td></tr>
</tbody>
</table>

### Sinjal tat-traffiku b'test li jiċċirkola

Is-sinjal tat-traffiku jinħoloq permezz ta' `:::osi N`, fejn `N` huwa l-layer li għandu jiġi enfasizzat (hawnhekk layer 3). Jonoq fil-ġenb, u t-test li jmiss jiċċirkola awtomatikament madwaru.

:::osi 3
:::

Lorem ipsum dolor sit amet, consetetur sadipscing elitr, sed diam nonumy eirmod tempor invidunt ut labore et dolore magna aliquyam erat, sed diam voluptua. At vero eos et accusam et justo duo dolores et ea rebum. Stet clita kasd gubergren, no sea takimata sanctus est Lorem ipsum dolor sit amet.

Lorem ipsum dolor sit amet, consetetur sadipscing elitr, sed diam nonumy eirmod tempor invidunt ut labore et dolore magna aliquyam erat, sed diam voluptua. At vero eos et accusam et justo duo dolores et ea rebum, u b'hekk din it-taqsima hija assoċjata, f'termini ta' kontenut, man-network layer (layer 3) — għalhekk eżattament din il-kaxxa fis-sinjal tat-traffiku hija bil-kulur, filwaqt li l-oħrajn kollha jibqgħu griżi.

---

## Taqsima 1: Kunċetti bażiċi

:::quiz short
X'inhi n-notazzjoni CIDR tas-subnet mask 255.255.255.0?
= /24
= 24
:::

:::quiz mc
Liema mill-indirizzi li ġejjin huwa n-network address ta' 192.168.1.42/24?
- [ ] 192.168.1.42
- [x] 192.168.1.0
- [ ] 192.168.1.255
- [ ] 192.168.0.0
:::

:::quiz fill
In-network address tinkiseb permezz ta' operazzjoni bit-bit {AND} bejn l-IP address u s-{subnet mask}. L-ogħla indirizz fis-subnet huwa l-{broadcast} address.
:::

:::evaluate
Iċċekkja t-taqsima 1
:::

---

## Taqsima 2: Tqabbil — protokolli u l-kompiti tagħhom

:::quiz match
ARP -> Isib il-MAC address ta' IP address
DNS -> Jirrisolvi host names f'IP addresses
DHCP -> Jassenja awtomatikament IP addresses lill-clients
ICMP -> Jintuża minn ping u traceroute
:::

:::evaluate
Iċċekkja t-taqsima 2
:::

---

## Taqsima 3: Subnetting

:::quiz short
Kemm għandu host addresses li jistgħu jintużaw subnet /30?
= 2
:::

:::quiz mc
Għal xiex normalment jintuża subnet /30?
- [ ] Għal networks kbar ta' uffiċċji b'ħafna apparati
- [ ] Bħala range ta' indirizzi għal DHCP pools
- [x] Bħala network ta' konnessjoni bejn żewġ routers
- [ ] Għal Access Points tal-WLAN
:::

:::quiz fill
Subnet /25 għandu {128} indirizzi, li {126} minnhom jistgħu jintużaw għal hosts.
:::

:::quiz match
/24 -> 254 host addresses li jistgħu jintużaw
/25 -> 126 host addresses li jistgħu jintużaw
/28 -> 14-il host address li jistgħu jintużaw
/30 -> 2 host addresses li jistgħu jintużaw
:::

:::evaluate
Iċċekkja t-taqsima 3
:::

## Taqsima 4: Għażla multipla u tasks każwali

Ma' `:::quiz multi` kwalunkwe numru ta' tweġibiet jistgħu jkunu korretti — kull dikjarazzjoni tiġi evalwata individwalment:

:::quiz multi
Liema dikjarazzjonijiet dwar ARP huma veri?
- [x] ARP isib il-MAC address ta' IP address
- [ ] ARP isib l-IP address ta' isem
- [x] ARP request huwa broadcast
- [ ] ARP reply huwa broadcast
:::

`:::quiz random <typ>` joħloq tasks ġodda kull darba li tiġi mitluba (`count=N` jiffissa n-numru). Tipi: `bin2dec`, `dec2bin`, `cidr2mask`, `hosts`, `netbcast`, `samenet`, `subnet`.

:::quiz random dec2bin
count=2
:::

:::quiz random netbcast
Ikkalkula għal dan l-indirizz:
:::

:::quiz random samenet
count=3
:::

:::quiz random subnet
:::

:::evaluate
Iċċekkja t-taqsima 4
:::

## Taqsima 4b: Tabella biex timtela

`:::quiz table` — tabella normali tal-Markdown; ċelloli `{Antwort}` isiru oqsma tal-input (separa l-varjanti b'`|`):

:::quiz table
Aqsam `192.168.42.0/24` fi tnejn subnets:
| Subnet | Network address | Broadcast address |
|---|---|---|
| 1 | {192.168.42.0} | {192.168.42.127} |
| 2 | {192.168.42.128} | {192.168.42.255} |
:::

:::evaluate
Iċċekkja t-tabella
:::

## Taqsima 5: Kulur tal-bits

Għall-kapitli dwar l-IP u s-subnetting: `[[n|…]]` = network part, `[[e|…]]` = estensjoni, `[[h|…]]` = host part — fit-test kontinwu u fit-tabelli:

[[n|11111111.11111111.11111111]].[[e|11]][[h|000000]] = `255.255.255.192`

Għal turi f'diversi linji, minflok ``` uża blokk `<pre class="bits-block">` (f'code blocks il-kuluri ma jintwerewx):

<pre class="bits-block">
vorher  (/24):  [[n|NNNNNNNN.NNNNNNNN.NNNNNNNN]].[[h|HHHHHHHH]]
nachher (/26):  [[n|NNNNNNNN.NNNNNNNN.NNNNNNNN]].[[e|EE]][[h|HHHHHH]]
</pre>

## Taqsima 6: Sequence diagram

`:::seq` jiddisinja dijagramma b'żewġ lifelines. In-numri SEQ u ACK kif ukoll il-counters fuq il-lifelines jiġu kkalkulati mill-flags u mid-data tal-payload (`"…"`). `-x` minflok `->` iġiegħel segment jintilef, `seq=…` jissostitwixxi numru (eż. f'retransmission).

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

Ma' `:::quiz seq`, `?` (qabel il-flags, jew `seq=?` / `ack=?`) isir qasam tal-input; `hide: counters` jaħbi l-counters:

:::quiz seq
Client -> Server: SYN
Server -> Client: ? SYN, ACK ack=?
Client -> Server: ? ACK ack=?
Client -> Server: PSH, ACK "Hello World"
Server -> Client: ACK ack=?
:::

:::evaluate
Iċċekkja d-dijagramma
:::
