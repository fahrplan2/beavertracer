# Spațiu de joacă — Markdown și quiz (pagină de test)

[[toc]]

Această pagină servește la testarea sintaxei Markdown și a tipurilor de întrebări interactive.

---

## Sintaxa Markdown

### Formatarea textului

**Aldin**, *cursiv*, ~~tăiat~~, `Inline-Code`, și **_combinat_**.

Paragraf obișnuit cu un [link către o altă pagină](01-einfuehrung.html) și un [link extern](https://www.beavertracer.eu).

### Titluri

Nivelurile H2–H4 apar automat în cuprins (TOC).

#### Acesta este H4 — nu apare în TOC

### Liste

Neordonată:

- Ethernet
- IP
- TCP
  - HTTP
  - SMTP

Ordonată:

1. Modul Editare: construiești topologia
2. Modul Rulare: pornești simularea
3. Modul Urmărire: analizezi pachetele

### Tabel

| Protocol | Strat | Port |
|-----------|---------|------|
| HTTP      | 7       | 80   |
| HTTPS     | 7       | 443  |
| DNS       | 7       | 53   |
| TCP       | 4       | —    |

### Cod

Inline: `ping 192.168.0.1`

Bloc:

```
$ ping 192.168.0.2
PING 192.168.0.2: 56 data bytes
64 bytes from 192.168.0.2: icmp_seq=0 ttl=64 time=0.4 ms
```

### Callout-uri

:::note
Acesta este un callout **note** — pentru observații neutre și informații suplimentare.
:::

:::tip
Acesta este un callout **tip** — pentru sfaturi utile și recomandări.
:::

:::warning
Acesta este un callout **warning** — pentru avertismente care necesită atenție.
:::

:::danger
Acesta este un callout **danger** — pentru surse critice de erori.
:::

:::draft
:::

### Pictograme

Font Awesome Solid: :fa-play: :fa-stop: :fa-desktop: :fa-shield-halved: :fa-wifi:

Font Awesome Regular: :far-file: :far-circle:

Simboluri de dispozitive: :router: :switch:

### Simulare încorporată

:::sim
url=/sims/demo.btsim
:::

### Sarcină cu verificarea comportamentului

:::task
title: Conectează PC 1 și PC 2
Verifică dacă PC 1 (id 9) are o adresă IP în rețeaua 192.168.0.0/24 și poate ajunge la PC 2 (id 11).
check: ip(9, "192.168.0.0/24")
check: pingOk(9, 11)
:::

---

## Modelul de referință OSI: schema de culori

Exemplu de tabel evidențiat în culorile curcubeului (stratul 1 jos, ca în stivă), precum și un „semafor" pe margine, cu text care îl înconjoară.

### Tabel colorat

<table class="osi-table">
<thead>
<tr><th>Strat</th><th>Nume</th><th>Exemple de protocoale</th></tr>
</thead>
<tbody>
<tr class="osi-l7"><td>7</td><td>Aplicație</td><td>HTTP, DNS, SMTP</td></tr>
<tr class="osi-l6"><td>6</td><td>Prezentare</td><td>TLS, JPEG, ASCII</td></tr>
<tr class="osi-l5"><td>5</td><td>Sesiune</td><td>RPC, NetBIOS</td></tr>
<tr class="osi-l4"><td>4</td><td>Transport</td><td>TCP, UDP</td></tr>
<tr class="osi-l3"><td>3</td><td>Rețea</td><td>IP, ICMP</td></tr>
<tr class="osi-l2"><td>2</td><td>Legătură de date</td><td>Ethernet, ARP</td></tr>
<tr class="osi-l1"><td>1</td><td>Fizic</td><td>Cupru, fibră optică, WLAN</td></tr>
</tbody>
</table>

### Semafor cu text care îl înconjoară

Semaforul se creează cu `:::osi N`, unde `N` este stratul de evidențiat (aici stratul 3). El plutește pe margine, iar textul următor curge automat pe lângă el.

:::osi 3
:::

Lorem ipsum dolor sit amet, consetetur sadipscing elitr, sed diam nonumy eirmod tempor invidunt ut labore et dolore magna aliquyam erat, sed diam voluptua. At vero eos et accusam et justo duo dolores et ea rebum. Stet clita kasd gubergren, no sea takimata sanctus est Lorem ipsum dolor sit amet.

Lorem ipsum dolor sit amet, consetetur sadipscing elitr, sed diam nonumy eirmod tempor invidunt ut labore et dolore magna aliquyam erat, sed diam voluptua. At vero eos et accusam et justo duo dolores et ea rebum, motiv pentru care această secțiune este atribuită, ca topic, stratului rețea (Layer 3) — de aceea exact această casetă din semafor este colorată, iar toate celelalte rămân gri.

---

## Secțiunea 1: Noțiuni de bază

:::quiz short
Care este notația CIDR a măștii de subrețea 255.255.255.0?
= /24
= 24
:::

:::quiz mc
Care dintre următoarele adrese este adresa de rețea pentru 192.168.1.42/24?
- [ ] 192.168.1.42
- [x] 192.168.1.0
- [ ] 192.168.1.255
- [ ] 192.168.0.0
:::

:::quiz fill
Adresa de rețea se obține printr-o operație {AND} pe biți între adresa IP și {masca de subrețea}. Cea mai mare adresă din subrețea este adresa de {broadcast}.
:::

:::evaluate
Verifică secțiunea 1
:::

---

## Secțiunea 2: Asociere — protocoale și rolurile lor

:::quiz match
ARP -> Determină adresa MAC corespunzătoare unei adrese IP
DNS -> Rezolvă nume de gazdă în adrese IP
DHCP -> Atribuie automat adrese IP clienților
ICMP -> Este folosit de ping și traceroute
:::

:::evaluate
Verifică secțiunea 2
:::

---

## Secțiunea 3: Subnetting

:::quiz short
Câte adrese de gazdă utilizabile are o subrețea /30?
= 2
:::

:::quiz mc
Pentru ce se folosește de obicei o subrețea /30?
- [ ] Pentru rețele mari de birouri cu multe dispozitive
- [ ] Ca interval de adrese pentru pool-uri DHCP
- [x] Ca rețea de legătură între două routere
- [ ] Pentru puncte de acces WLAN
:::

:::quiz fill
O subrețea /25 are {128} de adrese, dintre care {126} sunt utilizabile pentru gazde.
:::

:::quiz match
/24 -> 254 adrese de gazdă utilizabile
/25 -> 126 adrese de gazdă utilizabile
/28 -> 14 adrese de gazdă utilizabile
/30 -> 2 adrese de gazdă utilizabile
:::

:::evaluate
Verifică secțiunea 3
:::

## Secțiunea 4: Alegere multiplă și sarcini aleatorii

La `:::quiz multi` oricâte răspunsuri pot fi corecte — fiecare afirmație este evaluată separat:

:::quiz multi
Care afirmații despre ARP sunt adevărate?
- [x] ARP determină adresa MAC corespunzătoare unei adrese IP
- [ ] ARP determină adresa IP corespunzătoare unui nume
- [x] O cerere ARP este un broadcast
- [ ] Un răspuns ARP este un broadcast
:::

`:::quiz random <typ>` generează sarcini noi la fiecare apel (`count=N` stabilește numărul). Tipuri: `bin2dec`, `dec2bin`, `cidr2mask`, `hosts`, `netbcast`, `samenet`, `subnet`.

:::quiz random dec2bin
count=2
:::

:::quiz random netbcast
Calculează pentru următoarea adresă:
:::

:::quiz random samenet
count=3
:::

:::quiz random subnet
:::

:::evaluate
Verifică secțiunea 4
:::

## Secțiunea 4b: Tabel de completat

`:::quiz table` — un tabel Markdown obișnuit; celulele `{răspuns}` devin câmpuri de introducere (variantele se separă cu `|`):

:::quiz table
Împarte `192.168.42.0/24` în două subrețele:
| Subrețea | Adresă de rețea | Adresă de broadcast |
|---|---|---|
| 1 | {192.168.42.0} | {192.168.42.127} |
| 2 | {192.168.42.128} | {192.168.42.255} |
:::

:::evaluate
Verifică tabelul
:::

## Secțiunea 5: Colorarea biților

Pentru capitolele despre IP și subnetting: `[[n|…]]` = partea de rețea, `[[e|…]]` = extensie, `[[h|…]]` = partea de gazdă — în text curent și în tabele:

[[n|11111111.11111111.11111111]].[[e|11]][[h|000000]] = `255.255.255.192`

Pentru reprezentări pe mai multe rânduri, în loc de ``` folosește un bloc `<pre class="bits-block">` (în blocurile de cod culorile nu ar fi afișate):

<pre class="bits-block">
înainte (/24):  [[n|NNNNNNNN.NNNNNNNN.NNNNNNNN]].[[h|HHHHHHHH]]
după    (/26):  [[n|NNNNNNNN.NNNNNNNN.NNNNNNNN]].[[e|EE]][[h|HHHHHH]]
</pre>

## Secțiunea 6: Diagramă de secvență

`:::seq` desenează o diagramă cu două linii de viață. Numerele SEQ și ACK, precum și contoarele de pe liniile de viață, sunt calculate din flaguri și datele utile (`"…"`). `-x` în loc de `->` face ca un segment să se piardă, `seq=…` suprascrie un număr (de ex. la o retransmisie).

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

Cu `:::quiz seq`, `?` (înaintea flagurilor, sau `seq=?` / `ack=?`) devin câmpuri de introducere; `hide: counters` ascunde contoarele:

:::quiz seq
Client -> Server: SYN
Server -> Client: ? SYN, ACK ack=?
Client -> Server: ? ACK ack=?
Client -> Server: PSH, ACK "Hello World"
Server -> Client: ACK ack=?
:::

:::evaluate
Verifică diagrama
:::
