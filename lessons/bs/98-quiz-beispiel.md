# Igralište — Markdown i kviz (testna stranica)

[[toc]]

Ova stranica služi za testiranje Markdown sintakse i interaktivnih tipova pitanja.

---

## Markdown sintaksa

### Formatiranje teksta

**Podebljano**, *kurziv*, ~~precrtano~~, `Inline-Code`, i **_kombinirano_**.

Normalan odlomak s [linkom na drugu stranicu](01-einfuehrung.html) i [vanjskim linkom](https://www.beavertracer.eu).

### Naslovi

Nivoi H2–H4 automatski se pojavljuju u sadržaju (TOC).

#### Ovo je H4 — ne pojavljuje se u TOC-u

### Liste

Neuređena:

- Ethernet
- IP
- TCP
  - HTTP
  - SMTP

Uređena:

1. Način rada Uređivanje: izgradi topologiju
2. Način rada Pokretanje: pokreni simulaciju
3. Način rada Trag: analiziraj pakete

### Tabela

| Protokol | Sloj | Port |
|-----------|---------|------|
| HTTP      | 7       | 80   |
| HTTPS     | 7       | 443  |
| DNS       | 7       | 53   |
| TCP       | 4       | —    |

### Kod

Inline: `ping 192.168.0.1`

Blok:

```
$ ping 192.168.0.2
PING 192.168.0.2: 56 data bytes
64 bytes from 192.168.0.2: icmp_seq=0 ttl=64 time=0.4 ms
```

### Callouts

:::note
Ovo je **note** callout — za neutralne napomene i dodatne informacije.
:::

:::tip
Ovo je **tip** callout — za korisne savjete i preporuke.
:::

:::warning
Ovo je **warning** callout — za upozorenja koja zahtijevaju pažnju.
:::

:::danger
Ovo je **danger** callout — za kritične izvore grešaka.
:::

:::draft
:::

### Ikone

Font Awesome Solid: :fa-play: :fa-stop: :fa-desktop: :fa-shield-halved: :fa-wifi:

Font Awesome Regular: :far-file: :far-circle:

Simboli uređaja: :router: :switch:

### Ugrađena simulacija

:::sim
url=/sims/demo.btsim
:::

### Zadatak s provjerom ponašanja

:::task
title: Poveži PC 1 i PC 2
Provjeri ima li PC 1 (id 9) IP adresu u mreži 192.168.0.0/24 i može li doseći PC 2 (id 11).
check: ip(9, "192.168.0.0/24")
check: pingOk(9, 11)
:::

---

## OSI referentni model: shema boja

Primjer tabele istaknute bojama duge (sloj 1 dolje, kao u steku) te "semafor" na rubu stranice s obtokom teksta.

### Obojena tabela

<table class="osi-table">
<thead>
<tr><th>Sloj</th><th>Naziv</th><th>Primjeri protokola</th></tr>
</thead>
<tbody>
<tr class="osi-l7"><td>7</td><td>Aplikacija</td><td>HTTP, DNS, SMTP</td></tr>
<tr class="osi-l6"><td>6</td><td>Prezentacija</td><td>TLS, JPEG, ASCII</td></tr>
<tr class="osi-l5"><td>5</td><td>Sesija</td><td>RPC, NetBIOS</td></tr>
<tr class="osi-l4"><td>4</td><td>Transport</td><td>TCP, UDP</td></tr>
<tr class="osi-l3"><td>3</td><td>Mrežni sloj</td><td>IP, ICMP</td></tr>
<tr class="osi-l2"><td>2</td><td>Podatkovna veza</td><td>Ethernet, ARP</td></tr>
<tr class="osi-l1"><td>1</td><td>Fizički sloj</td><td>Bakar, optičko vlakno, WLAN</td></tr>
</tbody>
</table>

### Semafor s obtokom teksta

Semafor se stvara pomoću `:::osi N`, pri čemu je `N` sloj koji treba istaknuti (ovdje sloj 3). Lebdi na rubu, a tekst koji slijedi automatski ga obilazi.

:::osi 3
:::

Lorem ipsum dolor sit amet, consetetur sadipscing elitr, sed diam nonumy eirmod tempor invidunt ut labore et dolore magna aliquyam erat, sed diam voluptua. At vero eos et accusam et justo duo dolores et ea rebum. Stet clita kasd gubergren, no sea takimata sanctus est Lorem ipsum dolor sit amet.

Lorem ipsum dolor sit amet, consetetur sadipscing elitr, sed diam nonumy eirmod tempor invidunt ut labore et dolore magna aliquyam erat, sed diam voluptua. At vero eos et accusam et justo duo dolores et ea rebum, zbog čega je ovaj odjeljak sadržajno pridružen mrežnom sloju (Layer 3) — zato je upravo ovaj okvir u semaforu obojen, a svi ostali ostaju sivi.

---

## Odjeljak 1: Osnovni pojmovi

:::quiz short
Kako glasi CIDR notacija podmrežne maske 255.255.255.0?
= /24
= 24
:::

:::quiz mc
Koja od sljedećih adresa je adresa mreže za 192.168.1.42/24?
- [ ] 192.168.1.42
- [x] 192.168.1.0
- [ ] 192.168.1.255
- [ ] 192.168.0.0
:::

:::quiz fill
Adresa mreže dobiva se bitovnom {AND} operacijom IP adrese i {podmrežne maske}. Najviša adresa u podmreži je {broadcast} adresa.
:::

:::evaluate
Provjeri odjeljak 1
:::

---

## Odjeljak 2: Povezivanje — protokoli i njihovi zadaci

:::quiz match
ARP -> Određuje MAC adresu za IP adresu
DNS -> Prevodi nazive hostova u IP adrese
DHCP -> Automatski dodjeljuje IP adrese klijentima
ICMP -> Koriste ga ping i traceroute
:::

:::evaluate
Provjeri odjeljak 2
:::

---

## Odjeljak 3: Podmrežavanje

:::quiz short
Koliko iskoristivih adresa hostova ima /30 podmreža?
= 2
:::

:::quiz mc
Za šta se obično koristi /30 podmreža?
- [ ] Za velike uredske mreže s mnogo uređaja
- [ ] Kao raspon adresa za DHCP pulove
- [x] Kao povezna mreža između dva rutera
- [ ] Za WLAN pristupne tačke
:::

:::quiz fill
/25 podmreža ima {128} adresa, od kojih je {126} iskoristivo za hostove.
:::

:::quiz match
/24 -> 254 iskoristive adrese hostova
/25 -> 126 iskoristivih adresa hostova
/28 -> 14 iskoristivih adresa hostova
/30 -> 2 iskoristive adrese hostova
:::

:::evaluate
Provjeri odjeljak 3
:::

## Odjeljak 4: Višestruki izbor i nasumični zadaci

Kod `:::quiz multi` proizvoljan broj odgovora može biti tačan — svaka tvrdnja se ocjenjuje zasebno:

:::quiz multi
Koje tvrdnje o ARP-u su tačne?
- [x] ARP određuje MAC adresu za IP adresu
- [ ] ARP određuje IP adresu za naziv
- [x] ARP zahtjev je broadcast
- [ ] ARP odgovor je broadcast
:::

`:::quiz random <tip>` pri svakom pozivu generira nove zadatke (`count=N` određuje broj). Tipovi: `bin2dec`, `dec2bin`, `cidr2mask`, `hosts`, `netbcast`, `samenet`, `subnet`.

:::quiz random dec2bin
count=2
:::

:::quiz random netbcast
Izračunaj za sljedeću adresu:
:::

:::quiz random samenet
count=3
:::

:::quiz random subnet
:::

:::evaluate
Provjeri odjeljak 4
:::

## Odjeljak 4b: Tabela za popunjavanje

`:::quiz table` — obična Markdown tabela, ćelije `{odgovor}` postaju polja za unos (varijante odvoji znakom `|`):

:::quiz table
Podijeli `192.168.42.0/24` na dvije podmreže:
| Podmreža | Adresa mreže | Broadcast adresa |
|---|---|---|
| 1 | {192.168.42.0} | {192.168.42.127} |
| 2 | {192.168.42.128} | {192.168.42.255} |
:::

:::evaluate
Provjeri tabelu
:::

## Odjeljak 5: Bojenje bitova

Za poglavlja o IP-u i podmrežavanju: `[[n|…]]` = mrežni dio, `[[e|…]]` = proširenje, `[[h|…]]` = dio za host — u tekstu i u tabelama:

[[n|11111111.11111111.11111111]].[[e|11]][[h|000000]] = `255.255.255.192`

Za višeredne prikaze umjesto ``` koristi blok `<pre class="bits-block">` (u blokovima koda boje se ne bi prikazale):

<pre class="bits-block">
prije   (/24):  [[n|NNNNNNNN.NNNNNNNN.NNNNNNNN]].[[h|HHHHHHHH]]
poslije (/26):  [[n|NNNNNNNN.NNNNNNNN.NNNNNNNN]].[[e|EE]][[h|HHHHHH]]
</pre>

## Odjeljak 6: Dijagram komunikacije

`:::seq` crta dijagram s dvije linije života. SEQ i ACK brojevi te brojači na linijama života izračunavaju se iz flagova i korisnih podataka (`"…"`). `-x` umjesto `->` uzrokuje gubitak segmenta, `seq=…` nadjačava broj (npr. kod ponovnog slanja).

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

Pomoću `:::quiz seq` znakovi `?` (ispred flagova, ili `seq=?` / `ack=?`) postaju polja za unos; `hide: counters` sakriva brojače:

:::quiz seq
Client -> Server: SYN
Server -> Client: ? SYN, ACK ack=?
Client -> Server: ? ACK ack=?
Client -> Server: PSH, ACK "Hello World"
Server -> Client: ACK ack=?
:::

:::evaluate
Provjeri dijagram
:::
