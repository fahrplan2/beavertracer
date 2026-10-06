# Igralište — Markdown i kviz (testna stranica)

[[toc]]

Ova stranica služi za testiranje Markdown sintakse i interaktivnih vrsta pitanja.

---

## Markdown sintaksa

### Oblikovanje teksta

**Podebljano**, *kurziv*, ~~precrtano~~, `Inline-Code`, i **_kombinirano_**.

Običan odlomak s [poveznicom na drugu stranicu](01-einfuehrung.html) i [vanjskom poveznicom](https://www.beavertracer.eu).

### Naslovi

Razine H2–H4 automatski se pojavljuju u sadržaju (TOC).

#### Ovo je H4 — ne pojavljuje se u TOC-u

### Popisi

Neuređeni:

- Ethernet
- IP
- TCP
  - HTTP
  - SMTP

Uređeni:

1. Način uređivanja: izgradi topologiju
2. Način izvođenja: pokreni simulaciju
3. Način praćenja: analiziraj pakete

### Tablica

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

### Callouti

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
Ovo je **danger** callout — za kritične izvore pogrešaka.
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

Primjer tablice istaknute bojama duge (sloj 1 dolje, kao u stogu) te „semafora” na rubu stranice s obtjecanjem teksta.

### Obojena tablica

<table class="osi-table">
<thead>
<tr><th>Sloj</th><th>Naziv</th><th>Primjeri protokola</th></tr>
</thead>
<tbody>
<tr class="osi-l7"><td>7</td><td>Aplikacijski</td><td>HTTP, DNS, SMTP</td></tr>
<tr class="osi-l6"><td>6</td><td>Prikaz</td><td>TLS, JPEG, ASCII</td></tr>
<tr class="osi-l5"><td>5</td><td>Sesija</td><td>RPC, NetBIOS</td></tr>
<tr class="osi-l4"><td>4</td><td>Transportni</td><td>TCP, UDP</td></tr>
<tr class="osi-l3"><td>3</td><td>Mrežni</td><td>IP, ICMP</td></tr>
<tr class="osi-l2"><td>2</td><td>Podatkovni</td><td>Ethernet, ARP</td></tr>
<tr class="osi-l1"><td>1</td><td>Fizički</td><td>Bakar, optičko vlakno, WLAN</td></tr>
</tbody>
</table>

### Semafor s obtjecanjem teksta

Semafor se stvara pomoću `:::osi N`, pri čemu je `N` sloj koji treba istaknuti (ovdje sloj 3). Lebdi na rubu, a tekst koji slijedi automatski ga obtječe.

:::osi 3
:::

Lorem ipsum dolor sit amet, consetetur sadipscing elitr, sed diam nonumy eirmod tempor invidunt ut labore et dolore magna aliquyam erat, sed diam voluptua. At vero eos et accusam et justo duo dolores et ea rebum. Stet clita kasd gubergren, no sea takimata sanctus est Lorem ipsum dolor sit amet.

Lorem ipsum dolor sit amet, consetetur sadipscing elitr, sed diam nonumy eirmod tempor invidunt ut labore et dolore magna aliquyam erat, sed diam voluptua. At vero eos et accusam et justo duo dolores et ea rebum, zbog čega je ovaj odlomak sadržajno dodijeljen mrežnom sloju (sloj 3) — zato je upravo ovaj okvir u semaforu obojen, a svi ostali ostaju sivi.

---

## Odjeljak 1: Osnovni pojmovi

:::quiz short
Koji je CIDR zapis podmrežne maske 255.255.255.0?
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
Adresa mreže dobiva se bitovnom {AND} operacijom IP adrese i {mrežna maska}. Najviša adresa u podmreži je {broadcast} adresa.
:::

:::evaluate
Provjeri odjeljak 1
:::

---

## Odjeljak 2: Povezivanje — protokoli i njihove zadaće

:::quiz match
ARP -> Utvrđuje MAC adresu za IP adresu
DNS -> Razrješuje nazive računala u IP adrese
DHCP -> Automatski dodjeljuje IP adrese klijentima
ICMP -> Koriste ga ping i traceroute
:::

:::evaluate
Provjeri odjeljak 2
:::

---

## Odjeljak 3: Podmrežavanje

:::quiz short
Koliko iskoristivih adresa za računala ima /30 podmreža?
= 2
:::

:::quiz mc
Za što se tipično koristi /30 podmreža?
- [ ] Za velike uredske mreže s mnogo uređaja
- [ ] Kao raspon adresa za DHCP skupove
- [x] Kao poveznica između dva usmjernika
- [ ] Za WLAN pristupne točke
:::

:::quiz fill
/25 podmreža ima {128} adresa, od kojih je {126} iskoristivo za računala.
:::

:::quiz match
/24 -> 254 iskoristive adrese za računala
/25 -> 126 iskoristivih adresa za računala
/28 -> 14 iskoristivih adresa za računala
/30 -> 2 iskoristive adrese za računala
:::

:::evaluate
Provjeri odjeljak 3
:::

## Odjeljak 4: Višestruki odabir i nasumični zadaci

Kod `:::quiz multi` proizvoljan broj odgovora može biti točan — svaka se tvrdnja ocjenjuje zasebno:

:::quiz multi
Koje tvrdnje o ARP-u su točne?
- [x] ARP utvrđuje MAC adresu za IP adresu
- [ ] ARP utvrđuje IP adresu za naziv
- [x] ARP zahtjev je broadcast
- [ ] ARP odgovor je broadcast
:::

`:::quiz random <tip>` pri svakom pozivu stvara nove zadatke (`count=N` određuje broj). Tipovi: `bin2dec`, `dec2bin`, `cidr2mask`, `hosts`, `netbcast`, `samenet`, `subnet`.

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

## Odjeljak 4b: Tablica za popunjavanje

`:::quiz table` — obična Markdown tablica, ćelije `{odgovor}` postaju polja za unos (varijante odvoji znakom `|`):

:::quiz table
Podijeli `192.168.42.0/24` na dvije podmreže:
| Podmreža | Adresa mreže | Broadcast adresa |
|---|---|---|
| 1 | {192.168.42.0} | {192.168.42.127} |
| 2 | {192.168.42.128} | {192.168.42.255} |
:::

:::evaluate
Provjeri tablicu
:::

## Odjeljak 5: Bojanje bitova

Za poglavlja o IP-u i podmrežavanju: `[[n|…]]` = mrežni dio adrese, `[[e|…]]` = proširenje, `[[h|…]]` = dio adrese za računalo — u tekstu i u tablicama:

[[n|11111111.11111111.11111111]].[[e|11]][[h|000000]] = `255.255.255.192`

Za višeredne prikaze umjesto ``` koristi blok `<pre class="bits-block">` (u blokovima koda boje se ne bi prikazale):

<pre class="bits-block">
prije   (/24):  [[n|NNNNNNNN.NNNNNNNN.NNNNNNNN]].[[h|HHHHHHHH]]
poslije (/26):  [[n|NNNNNNNN.NNNNNNNN.NNNNNNNN]].[[e|EE]][[h|HHHHHH]]
</pre>

## Odjeljak 6: Dijagram slijeda

`:::seq` crta dijagram s dvije linije života. SEQ i ACK brojevi te brojači na linijama života izračunavaju se iz zastavica i korisnih podataka (`"…"`). `-x` umjesto `->` uzrokuje gubitak segmenta, `seq=…` nadjačava broj (npr. kod ponovnog slanja).

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

Kod `:::quiz seq` znakovi `?` (ispred zastavica, ili `seq=?` / `ack=?`) postaju polja za unos; `hide: counters` skriva brojače:

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
