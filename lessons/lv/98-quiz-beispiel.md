# Rotaļu laukums — Markdown un viktorīnas (testa lapa)

[[toc]]

Šī lapa paredzēta Markdown sintakses un interaktīvo jautājumu veidu testēšanai.

---

## Markdown sintakse

### Teksta formatēšana

**Treknraksts**, *kursīvs*, ~~pārsvītrots~~, `Inline-Code`, un **_kombinēts_**.

Parasts rindkopas teksts ar [saiti uz citu lapu](01-einfuehrung.html) un [ārēju saiti](https://www.beavertracer.eu).

### Virsraksti

H2–H4 līmeņi automātiski parādās satura rādītājā (TOC).

#### Šis ir H4 — satura rādītājā neparādās

### Saraksti

Nenumurēts:

- Ethernet
- IP
- TCP
  - HTTP
  - SMTP

Numurēts:

1. Edit-Modus: Topologie aufbauen
2. Run-Modus: Simulation starten
3. Trace-Modus: Pakete analysieren

### Tabula

| Protokoll | Schicht | Port |
|-----------|---------|------|
| HTTP      | 7       | 80   |
| HTTPS     | 7       | 443  |
| DNS       | 7       | 53   |
| TCP       | 4       | —    |

### Kods

Inline: `ping 192.168.0.1`

Bloks:

```
$ ping 192.168.0.2
PING 192.168.0.2: 56 data bytes
64 bytes from 192.168.0.2: icmp_seq=0 ttl=64 time=0.4 ms
```

### Izcēlumi

:::note
Šis ir **note** izcēlums — neitrāliem norādījumiem un papildu informācijai.
:::

:::tip
Šis ir **tip** izcēlums — noderīgiem padomiem un ieteikumiem.
:::

:::warning
Šis ir **warning** izcēlums — brīdinājumiem, kuriem jāpievērš uzmanība.
:::

:::danger
Šis ir **danger** izcēlums — kritiskiem kļūdu avotiem.
:::

:::draft
:::

### Ikonas

Font Awesome Solid: :fa-play: :fa-stop: :fa-desktop: :fa-shield-halved: :fa-wifi:

Font Awesome Regular: :far-file: :far-circle:

Ierīču simboli: :router: :switch:

### Iegulta simulācija

:::sim
url=/sims/demo.btsim
:::

### Uzdevums ar uzvedības pārbaudi

:::task
title: Savieno PC 1 un PC 2
Pārbaudi, vai PC 1 (id 9) ir IP adrese tīklā 192.168.0.0/24 un vai tas var sasniegt PC 2 (id 11).
check: ip(9, "192.168.0.0/24")
check: pingOk(9, 11)
:::

---

## OSI atsauces modelis: krāsu shēma

Piemērs varavīksnes krāsās izceltai tabulai (1. slānis apakšā, kā kaudzē) un "luksoforam" malā ar teksta aplaušanu.

### Krāsaina tabula

<table class="osi-table">
<thead>
<tr><th>Slānis</th><th>Nosaukums</th><th>Protokolu piemēri</th></tr>
</thead>
<tbody>
<tr class="osi-l7"><td>7</td><td>Lietojumu</td><td>HTTP, DNS, SMTP</td></tr>
<tr class="osi-l6"><td>6</td><td>Prezentācijas</td><td>TLS, JPEG, ASCII</td></tr>
<tr class="osi-l5"><td>5</td><td>Sesijas</td><td>RPC, NetBIOS</td></tr>
<tr class="osi-l4"><td>4</td><td>Transporta</td><td>TCP, UDP</td></tr>
<tr class="osi-l3"><td>3</td><td>Tīkla</td><td>IP, ICMP</td></tr>
<tr class="osi-l2"><td>2</td><td>Datu saites</td><td>Ethernet, ARP</td></tr>
<tr class="osi-l1"><td>1</td><td>Fiziskais</td><td>Varš, optiskā šķiedra, WLAN</td></tr>
</tbody>
</table>

### Luksofors ar teksta aplaušanu

Luksofors tiek izveidots ar `:::osi N`, kur `N` ir izceļamais slānis (šeit 3. slānis). Tas peld malā, un nākamais teksts automātiski plūst tam apkārt.

:::osi 3
:::

Lorem ipsum dolor sit amet, consetetur sadipscing elitr, sed diam nonumy eirmod tempor invidunt ut labore et dolore magna aliquyam erat, sed diam voluptua. At vero eos et accusam et justo duo dolores et ea rebum. Stet clita kasd gubergren, no sea takimata sanctus est Lorem ipsum dolor sit amet.

Lorem ipsum dolor sit amet, consetetur sadipscing elitr, sed diam nonumy eirmod tempor invidunt ut labore et dolore magna aliquyam erat, sed diam voluptua. At vero eos et accusam et justo duo dolores et ea rebum, kā dēļ šī sadaļa pēc satura ir piesaistīta tīkla slānim (Layer 3) — tāpēc tieši šī kaste luksoforā ir krāsaina, bet visas pārējās paliek pelēkas.

---

## 1. sadaļa: pamatjēdzieni

:::quiz short
Kāds ir apakštīkla maskas 255.255.255.0 CIDR pieraksts?
= /24
= 24
:::

:::quiz mc
Kura no šīm adresēm ir 192.168.1.42/24 tīkla adrese?
- [ ] 192.168.1.42
- [x] 192.168.1.0
- [ ] 192.168.1.255
- [ ] 192.168.0.0
:::

:::quiz fill
Tīkla adresi iegūst ar bitu {AND} operāciju starp IP adresi un {apakštīkla maska}. Augstākā adrese apakštīklā ir {apraides} adrese.
:::

:::evaluate
Pārbaudīt 1. sadaļu
:::

---

## 2. sadaļa: sasaiste — protokoli un to uzdevumi

:::quiz match
ARP -> Noskaidro IP adresei atbilstošo MAC adresi
DNS -> Atrisina resursdatoru vārdus IP adresēs
DHCP -> Automātiski piešķir klientiem IP adreses
ICMP -> To izmanto ping un traceroute
:::

:::evaluate
Pārbaudīt 2. sadaļu
:::

---

## 3. sadaļa: apakštīklu veidošana

:::quiz short
Cik lietojamu resursdatoru adrešu ir /30 apakštīklā?
= 2
:::

:::quiz mc
Kam parasti izmanto /30 apakštīklu?
- [ ] Lieliem biroja tīkliem ar daudzām ierīcēm
- [ ] Kā adrešu diapazonu DHCP pūliem
- [x] Kā savienojuma tīklu starp diviem maršrutētājiem
- [ ] WLAN Access Point ierīcēm
:::

:::quiz fill
/25 apakštīklā ir {128} adreses, no kurām {126} ir izmantojamas resursdatoriem.
:::

:::quiz match
/24 -> 254 lietojamas resursdatoru adreses
/25 -> 126 lietojamas resursdatoru adreses
/28 -> 14 lietojamas resursdatoru adreses
/30 -> 2 lietojamas resursdatoru adreses
:::

:::evaluate
Pārbaudīt 3. sadaļu
:::

## 4. sadaļa: vairākatbilžu izvēle un nejaušie uzdevumi

Ar `:::quiz multi` jebkurš skaits atbilžu var būt pareizs — katrs apgalvojums tiek vērtēts atsevišķi:

:::quiz multi
Kuri apgalvojumi par ARP ir pareizi?
- [x] ARP noskaidro IP adresei atbilstošo MAC adresi
- [ ] ARP noskaidro vārdam atbilstošo IP adresi
- [x] ARP pieprasījums ir apraide
- [ ] ARP atbilde ir apraide
:::

`:::quiz random <typ>` katru reizi izveido jaunus uzdevumus (`count=N` nosaka skaitu). Veidi: `bin2dec`, `dec2bin`, `cidr2mask`, `hosts`, `netbcast`, `samenet`, `subnet`.

:::quiz random dec2bin
count=2
:::

:::quiz random netbcast
Aprēķini šādai adresei:
:::

:::quiz random samenet
count=3
:::

:::quiz random subnet
:::

:::evaluate
Pārbaudīt 4. sadaļu
:::

## 4b. sadaļa: aizpildāma tabula

`:::quiz table` — parasta Markdown tabula, `{Antwort}` šūnas kļūst par ievades laukiem (variantus atdala ar `|`):

:::quiz table
Sadali `192.168.42.0/24` divos apakštīklos:
| Apakštīkls | Tīkla adrese | Apraides adrese |
|---|---|---|
| 1 | {192.168.42.0} | {192.168.42.127} |
| 2 | {192.168.42.128} | {192.168.42.255} |
:::

:::evaluate
Pārbaudīt tabulu
:::

## 5. sadaļa: bitu iekrāsošana

IP un apakštīklu veidošanas nodaļām: `[[n|…]]` = tīkla daļa, `[[e|…]]` = paplašinājums, `[[h|…]]` = resursdatora daļa — tekstā un tabulās:

[[n|11111111.11111111.11111111]].[[e|11]][[h|000000]] = `255.255.255.192`

Daudzrindu attēlojumiem ``` vietā izmanto `<pre class="bits-block">` bloku (koda blokos krāsas netiktu attēlotas):

<pre class="bits-block">
vorher  (/24):  [[n|NNNNNNNN.NNNNNNNN.NNNNNNNN]].[[h|HHHHHHHH]]
nachher (/26):  [[n|NNNNNNNN.NNNNNNNN.NNNNNNNN]].[[e|EE]][[h|HHHHHH]]
</pre>

## 6. sadaļa: sekvenču diagramma

`:::seq` zīmē diagrammu ar divām dzīvildzēm. SEQ un ACK numuri, kā arī skaitītāji pie dzīvildzēm tiek aprēķināti no karodziņiem un lietderīgajiem datiem (`"…"`). `-x` `->` vietā liek segmentam pazust, `seq=…` pārraksta numuru (piem., atkārtotas pārraides gadījumā).

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

Ar `:::quiz seq` `?` (pirms karodziņiem vai `seq=?` / `ack=?`) kļūst par ievades laukiem; `hide: counters` paslēpj skaitītājus:

:::quiz seq
Client -> Server: SYN
Server -> Client: ? SYN, ACK ack=?
Client -> Server: ? ACK ack=?
Client -> Server: PSH, ACK "Hello World"
Server -> Client: ACK ack=?
:::

:::evaluate
Pārbaudīt diagrammu
:::
