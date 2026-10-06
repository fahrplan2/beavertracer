# Igralište — Markdown i kviz (probna stranica)

[[toc]]

Ova stranica služi za testiranje Markdown sintakse i interaktivnih tipova pitanja.

---

## Markdown sintaksa

### Formatiranje teksta

**Podebljano**, *kurziv*, ~~precrtano~~, `Inline-Code`, i **_kombinovano_**.

Običan pasus sa [linkom na drugu stranicu](01-einfuehrung.html) i [spoljnim linkom](https://www.beavertracer.eu).

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

1. Edit-Modus: Topologie aufbauen
2. Run-Modus: Simulation starten
3. Trace-Modus: Pakete analysieren

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

### Calloutovi

:::note
Ovo je **note**-callout — za neutralne napomene i dopunske informacije.
:::

:::tip
Ovo je **tip**-callout — za korisne savete i preporuke.
:::

:::warning
Ovo je **warning**-callout — za upozorenja koja zahtevaju pažnju.
:::

:::danger
Ovo je **danger**-callout — za kritične izvore grešaka.
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

### Zadatak sa proverom ponašanja

:::task
title: Povezivanje PC 1 i PC 2
Proveri da li PC 1 (id 9) ima IP adresu u mreži 192.168.0.0/24 i može li da dosegne PC 2 (id 11).
check: ip(9, "192.168.0.0/24")
check: pingOk(9, 11)
:::

---

## OSI referentni model: šema boja

Primer tabele istaknute bojama duge (sloj 1 dole, kao u steku) i „semafora" na ivici stranice sa opticanjem teksta.

### Obojena tabela

<table class="osi-table">
<thead>
<tr><th>Sloj</th><th>Naziv</th><th>Primeri protokola</th></tr>
</thead>
<tbody>
<tr class="osi-l7"><td>7</td><td>Aplikacija</td><td>HTTP, DNS, SMTP</td></tr>
<tr class="osi-l6"><td>6</td><td>Prezentacija</td><td>TLS, JPEG, ASCII</td></tr>
<tr class="osi-l5"><td>5</td><td>Sesija</td><td>RPC, NetBIOS</td></tr>
<tr class="osi-l4"><td>4</td><td>Transport</td><td>TCP, UDP</td></tr>
<tr class="osi-l3"><td>3</td><td>Mreža</td><td>IP, ICMP</td></tr>
<tr class="osi-l2"><td>2</td><td>Veza podataka</td><td>Ethernet, ARP</td></tr>
<tr class="osi-l1"><td>1</td><td>Fizički sloj</td><td>Bakar, optičko vlakno, WLAN</td></tr>
</tbody>
</table>

### Semafor sa opticanjem teksta

Semafor se pravi pomoću `:::osi N`, pri čemu je `N` sloj koji treba istaći (ovde sloj 3). Lebdi na ivici, a tekst koji sledi automatski ga opticše.

:::osi 3
:::

Lorem ipsum dolor sit amet, consetetur sadipscing elitr, sed diam nonumy eirmod tempor invidunt ut labore et dolore magna aliquyam erat, sed diam voluptua. At vero eos et accusam et justo duo dolores et ea rebum. Stet clita kasd gubergren, no sea takimata sanctus est Lorem ipsum dolor sit amet.

Lorem ipsum dolor sit amet, consetetur sadipscing elitr, sed diam nonumy eirmod tempor invidunt ut labore et dolore magna aliquyam erat, sed diam voluptua. At vero eos et accusam et justo duo dolores et ea rebum, zbog čega je ovaj odeljak sadržajno svrstan u mrežni sloj (Layer 3) — zato je upravo ovaj okvir u semaforu obojen, a svi ostali ostaju sivi.

---

## Odeljak 1: Osnovni pojmovi

:::quiz short
Koja je CIDR notacija podmrežne maske 255.255.255.0?
= /24
= 24
:::

:::quiz mc
Koja od sledećih adresa je adresa mreže za 192.168.1.42/24?
- [ ] 192.168.1.42
- [x] 192.168.1.0
- [ ] 192.168.1.255
- [ ] 192.168.0.0
:::

:::quiz fill
Adresa mreže dobija se bitskom {AND} operacijom IP adrese i {podmrežne maske}. Najviša adresa u podmreži je {broadcast} adresa.
:::

:::evaluate
Proveri odeljak 1
:::

---

## Odeljak 2: Povezivanje — protokoli i njihovi zadaci

:::quiz match
ARP -> Utvrđuje MAC adresu za IP adresu
DNS -> Prevodi nazive hostova u IP adrese
DHCP -> Automatski dodeljuje IP adrese klijentima
ICMP -> Koriste ga ping i traceroute
:::

:::evaluate
Proveri odeljak 2
:::

---

## Odeljak 3: Podmrežavanje

:::quiz short
Koliko upotrebljivih adresa hostova ima /30 podmreža?
= 2
:::

:::quiz mc
Za šta se tipično koristi /30 podmreža?
- [ ] Za velike kancelarijske mreže sa mnogo uređaja
- [ ] Kao opseg adresa za DHCP pulove
- [x] Kao spojna mreža između dva rutera
- [ ] Za WLAN pristupne tačke
:::

:::quiz fill
/25 podmreža ima {128} adresa, od kojih je {126} upotrebljivo za hostove.
:::

:::quiz match
/24 -> 254 upotrebljive adrese hostova
/25 -> 126 upotrebljivih adresa hostova
/28 -> 14 upotrebljivih adresa hostova
/30 -> 2 upotrebljive adrese hostova
:::

:::evaluate
Proveri odeljak 3
:::

## Odeljak 4: Višestruki izbor i nasumični zadaci

Kod `:::quiz multi` proizvoljan broj odgovora može biti tačan — svaka tvrdnja se ocenjuje pojedinačno:

:::quiz multi
Koje tvrdnje o ARP-u su tačne?
- [x] ARP utvrđuje MAC adresu za IP adresu
- [ ] ARP utvrđuje IP adresu za ime
- [x] ARP zahtev je broadcast
- [ ] ARP odgovor je broadcast
:::

`:::quiz random <typ>` pri svakom pozivu pravi nove zadatke (`count=N` određuje broj). Tipovi: `bin2dec`, `dec2bin`, `cidr2mask`, `hosts`, `netbcast`, `samenet`, `subnet`.

:::quiz random dec2bin
count=2
:::

:::quiz random netbcast
Izračunaj za sledeću adresu:
:::

:::quiz random samenet
count=3
:::

:::quiz random subnet
:::

:::evaluate
Proveri odeljak 4
:::

## Odeljak 4b: Tabela za popunjavanje

`:::quiz table` — obična Markdown tabela, ćelije `{Antwort}` postaju polja za unos (varijante razdvoj sa `|`):

:::quiz table
Podeli `192.168.42.0/24` na dve podmreže:
| Podmreža | Adresa mreže | Broadcast adresa |
|---|---|---|
| 1 | {192.168.42.0} | {192.168.42.127} |
| 2 | {192.168.42.128} | {192.168.42.255} |
:::

:::evaluate
Proveri tabelu
:::

## Odeljak 5: Bojenje bitova

Za poglavlja o IP-u i podmrežavanju: `[[n|…]]` = mrežni deo, `[[e|…]]` = proširenje, `[[h|…]]` = deo za host — u tekstu i u tabelama:

[[n|11111111.11111111.11111111]].[[e|11]][[h|000000]] = `255.255.255.192`

Za višelinijske prikaze umesto ``` koristi `<pre class="bits-block">` blok (u blokovima koda boje se ne bi prikazale):

<pre class="bits-block">
vorher  (/24):  [[n|NNNNNNNN.NNNNNNNN.NNNNNNNN]].[[h|HHHHHHHH]]
nachher (/26):  [[n|NNNNNNNN.NNNNNNNN.NNNNNNNN]].[[e|EE]][[h|HHHHHH]]
</pre>

## Odeljak 6: Dijagram komunikacije

`:::seq` crta dijagram sa dve linije života. SEQ i ACK brojevi, kao i brojači na linijama života, izračunavaju se iz flagova i korisnih podataka (`"…"`). `-x` umesto `->` dovodi do gubitka segmenta, `seq=…` zamenjuje broj (npr. kod ponovnog slanja).

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
Proveri dijagram
:::
