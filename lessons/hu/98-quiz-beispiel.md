# Játszótér — Markdown és kvíz (tesztoldal)

[[toc]]

Ez az oldal a Markdown-szintaxis és az interaktív kérdéstípusok tesztelésére szolgál.

---

## Markdown-szintaxis

### Szövegformázás

**Félkövér**, *dőlt*, ~~áthúzott~~, `beágyazott kód`, és **_kombinálva_**.

Egy normál bekezdés egy [hivatkozással egy másik oldalra](01-einfuehrung.html) és egy [külső hivatkozással](https://www.beavertracer.eu).

### Címsorok

A H2–H4 szintek automatikusan megjelennek a tartalomjegyzékben (TOC).

#### Ez egy H4 — nem jelenik meg a tartalomjegyzékben

### Listák

Rendezetlen:

- Ethernet
- IP
- TCP
  - HTTP
  - SMTP

Rendezett:

1. Szerkesztés mód: a topológia felépítése
2. Futtatás mód: a szimuláció indítása
3. Nyomkövetés mód: csomagok elemzése

### Táblázat

| Protokoll | Réteg | Port |
|-----------|---------|------|
| HTTP      | 7       | 80   |
| HTTPS     | 7       | 443  |
| DNS       | 7       | 53   |
| TCP       | 4       | —    |

### Kód

Beágyazva: `ping 192.168.0.1`

Blokk:

```
$ ping 192.168.0.2
PING 192.168.0.2: 56 data bytes
64 bytes from 192.168.0.2: icmp_seq=0 ttl=64 time=0.4 ms
```

### Kiemelt dobozok

:::note
Ez egy **note** doboz — semleges megjegyzésekhez és kiegészítő információkhoz.
:::

:::tip
Ez egy **tip** doboz — hasznos tippekhez és ajánlásokhoz.
:::

:::warning
Ez egy **warning** doboz — figyelmet igénylő figyelmeztetésekhez.
:::

:::danger
Ez egy **danger** doboz — kritikus hibaforrásokhoz.
:::

:::draft
:::

### Ikonok

Font Awesome Solid: :fa-play: :fa-stop: :fa-desktop: :fa-shield-halved: :fa-wifi:

Font Awesome Regular: :far-file: :far-circle:

Eszközszimbólumok: :router: :switch:

### Beágyazott szimuláció

:::sim
url=/sims/demo.btsim
:::

### Feladat viselkedésellenőrzéssel

:::task
title: PC 1 és PC 2 összekötése
Ellenőrizd, hogy a PC 1 (id 9) rendelkezik-e IP-címmel a 192.168.0.0/24 hálózatban, és eléri-e a PC 2-t (id 11).
check: ip(9, "192.168.0.0/24")
check: pingOk(9, 11)
:::

---

## OSI-referenciamodell: színséma

Példa egy szivárványszínekkel kiemelt táblázatra (az 1. réteg alul, ahogy a veremben), valamint egy „lámpára" az oldal szélén szövegkörbefuttatással.

### Színes táblázat

<table class="osi-table">
<thead>
<tr><th>Réteg</th><th>Név</th><th>Példaprotokollok</th></tr>
</thead>
<tbody>
<tr class="osi-l7"><td>7</td><td>Alkalmazási</td><td>HTTP, DNS, SMTP</td></tr>
<tr class="osi-l6"><td>6</td><td>Megjelenítési</td><td>TLS, JPEG, ASCII</td></tr>
<tr class="osi-l5"><td>5</td><td>Viszony</td><td>RPC, NetBIOS</td></tr>
<tr class="osi-l4"><td>4</td><td>Szállítási</td><td>TCP, UDP</td></tr>
<tr class="osi-l3"><td>3</td><td>Hálózati</td><td>IP, ICMP</td></tr>
<tr class="osi-l2"><td>2</td><td>Adatkapcsolati</td><td>Ethernet, ARP</td></tr>
<tr class="osi-l1"><td>1</td><td>Fizikai</td><td>Réz, üvegszál, WLAN</td></tr>
</tbody>
</table>

### Lámpa szövegkörbefuttatással

A lámpát a `:::osi N` hozza létre, ahol `N` a kiemelendő réteg (itt a 3. réteg). A szélen lebeg, a következő szöveg automatikusan elfolyik mellette.

:::osi 3
:::

Lorem ipsum dolor sit amet, consetetur sadipscing elitr, sed diam nonumy eirmod tempor invidunt ut labore et dolore magna aliquyam erat, sed diam voluptua. At vero eos et accusam et justo duo dolores et ea rebum. Stet clita kasd gubergren, no sea takimata sanctus est Lorem ipsum dolor sit amet.

Lorem ipsum dolor sit amet, consetetur sadipscing elitr, sed diam nonumy eirmod tempor invidunt ut labore et dolore magna aliquyam erat, sed diam voluptua. At vero eos et accusam et justo duo dolores et ea rebum, ezáltal ez a szakasz tartalmilag a hálózati réteghez (3. réteg) tartozik — ezért pontosan ez a doboz színes a lámpán, az összes többi szürke marad.

---

## 1. szakasz: alapfogalmak

:::quiz short
Mi a 255.255.255.0 alhálózati maszk CIDR-jelölése?
= /24
= 24
:::

:::quiz mc
Az alábbi címek közül melyik a 192.168.1.42/24 hálózati címe?
- [ ] 192.168.1.42
- [x] 192.168.1.0
- [ ] 192.168.1.255
- [ ] 192.168.0.0
:::

:::quiz fill
A hálózati címet az IP-cím és az {alhálózati maszk} bitenkénti {ÉS} műveletével kapjuk. Az alhálózat legmagasabb címe a {broadcast} cím.
:::

:::evaluate
Az 1. szakasz ellenőrzése
:::

---

## 2. szakasz: párosítás — protokollok és feladataik

:::quiz match
ARP -> Meghatározza egy IP-címhez tartozó MAC-címet
DNS -> A gazdagépneveket IP-címekké oldja fel
DHCP -> Automatikusan oszt ki IP-címeket a klienseknek
ICMP -> A ping és a traceroute használja
:::

:::evaluate
A 2. szakasz ellenőrzése
:::

---

## 3. szakasz: alhálózatok kialakítása

:::quiz short
Hány használható állomáscíme van egy /30-as alhálózatnak?
= 2
:::

:::quiz mc
Mire használnak jellemzően egy /30-as alhálózatot?
- [ ] Sok eszközt tartalmazó, nagy irodai hálózatokhoz
- [ ] DHCP-címkészletek címtartományaként
- [x] Két router közötti összekötő hálózatként
- [ ] WLAN hozzáférési pontokhoz
:::

:::quiz fill
Egy /25-ös alhálózatnak {128} címe van, ebből {126} használható állomásokhoz.
:::

:::quiz match
/24 -> 254 használható állomáscím
/25 -> 126 használható állomáscím
/28 -> 14 használható állomáscím
/30 -> 2 használható állomáscím
:::

:::evaluate
A 3. szakasz ellenőrzése
:::

## 4. szakasz: többszörös választás és véletlenszerű feladatok

A `:::quiz multi` esetén tetszőleges számú válasz lehet helyes — minden állítást külön értékel a rendszer:

:::quiz multi
Mely állítások igazak az ARP-ra?
- [x] Az ARP egy IP-címhez meghatározza a MAC-címet
- [ ] Az ARP egy névhez meghatározza az IP-címet
- [x] Az ARP-kérés broadcast
- [ ] Az ARP-válasz broadcast
:::

A `:::quiz random <típus>` minden megnyitáskor új feladatokat generál (a `count=N` adja meg a darabszámot). Típusok: `bin2dec`, `dec2bin`, `cidr2mask`, `hosts`, `netbcast`, `samenet`, `subnet`.

:::quiz random dec2bin
count=2
:::

:::quiz random netbcast
Számítsd ki a következő címre:
:::

:::quiz random samenet
count=3
:::

:::quiz random subnet
:::

:::evaluate
A 4. szakasz ellenőrzése
:::

## 4b. szakasz: kitöltendő táblázat

`:::quiz table` — egy normál Markdown-táblázat, a `{válasz}` cellákból beviteli mezők lesznek (a változatokat `|` jellel válaszd el):

:::quiz table
Oszd fel a `192.168.42.0/24` hálózatot két alhálózatra:
| Alhálózat | Hálózati cím | Broadcast cím |
|---|---|---|
| 1 | {192.168.42.0} | {192.168.42.127} |
| 2 | {192.168.42.128} | {192.168.42.255} |
:::

:::evaluate
Táblázat ellenőrzése
:::

## 5. szakasz: bitek színezése

Az IP- és az alhálózat-kialakítási fejezetekhez: `[[n|…]]` = hálózati rész, `[[e|…]]` = kiterjesztés, `[[h|…]]` = állomásrész — folyó szövegben és táblázatokban egyaránt:

[[n|11111111.11111111.11111111]].[[e|11]][[h|000000]] = `255.255.255.192`

Többsoros megjelenítéshez a ``` helyett egy `<pre class="bits-block">` blokkot használj (kódblokkokban a színek nem jelennének meg):

<pre class="bits-block">
előtte  (/24):  [[n|NNNNNNNN.NNNNNNNN.NNNNNNNN]].[[h|HHHHHHHH]]
utána   (/26):  [[n|NNNNNNNN.NNNNNNNN.NNNNNNNN]].[[e|EE]][[h|HHHHHH]]
</pre>

## 6. szakasz: üzenetváltási diagram

A `:::seq` egy két életvonalas diagramot rajzol. A SEQ- és ACK-számokat, valamint az életvonalakon lévő számlálókat a rendszer a flagekből és a hasznos adatokból (`"…"`) számolja ki. A `->` helyett a `-x` egy szegmens elvesztését jelenti, a `seq=…` felülír egy számot (pl. újraküldésnél).

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

A `:::quiz seq` esetén a `?` (a flagek előtt, vagy `seq=?` / `ack=?`) beviteli mezővé válik; a `hide: counters` elrejti a számlálókat:

:::quiz seq
Client -> Server: SYN
Server -> Client: ? SYN, ACK ack=?
Client -> Server: ? ACK ack=?
Client -> Server: PSH, ACK "Hello World"
Server -> Client: ACK ack=?
:::

:::evaluate
Diagram ellenőrzése
:::
