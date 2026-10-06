# Igrišče — Markdown in kviz (testna stran)

[[toc]]

Ta stran služi za preizkušanje sintakse Markdown in interaktivnih vrst vprašanj.

---

## Sintaksa Markdown

### Oblikovanje besedila

**Krepko**, *poševno*, ~~prečrtano~~, `Inline-Code` in **_kombinirano_**.

Navaden odstavek s [povezavo na drugo stran](01-einfuehrung.html) in [zunanjo povezavo](https://www.beavertracer.eu).

### Naslovi

Ravni H2–H4 se samodejno prikažejo v kazalu vsebine (TOC).

#### To je H4 — ne pojavi se v TOC

### Seznami

Neurejen:

- Ethernet
- IP
- TCP
  - HTTP
  - SMTP

Urejen:

1. Način urejanja: izgradnja topologije
2. Način izvajanja: zagon simulacije
3. Način sledenja: analiza paketov

### Tabela

| Protokol | Plast | Vrata |
|-----------|---------|------|
| HTTP      | 7       | 80   |
| HTTPS     | 7       | 443  |
| DNS       | 7       | 53   |
| TCP       | 4       | —    |

### Koda

Inline: `ping 192.168.0.1`

Blok:

```
$ ping 192.168.0.2
PING 192.168.0.2: 56 data bytes
64 bytes from 192.168.0.2: icmp_seq=0 ttl=64 time=0.4 ms
```

### Okvirji

:::note
To je okvir **note** — za nevtralne opombe in dodatne informacije.
:::

:::tip
To je okvir **tip** — za uporabne nasvete in priporočila.
:::

:::warning
To je okvir **warning** — za opozorila, ki zahtevajo pozornost.
:::

:::danger
To je okvir **danger** — za kritične vire napak.
:::

:::draft
:::

### Ikone

Font Awesome Solid: :fa-play: :fa-stop: :fa-desktop: :fa-shield-halved: :fa-wifi:

Font Awesome Regular: :far-file: :far-circle:

Simboli naprav: :router: :switch:

### Vdelana simulacija

:::sim
url=/sims/demo.btsim
:::

### Naloga s preverjanjem vedenja

:::task
title: Poveži PC 1 in PC 2
Preveri, ali ima PC 1 (id 9) IP v omrežju 192.168.0.0/24 in ali lahko doseže PC 2 (id 11).
check: ip(9, "192.168.0.0/24")
check: pingOk(9, 11)
:::

---

## Referenčni model OSI: barvna shema

Primer mavrično obarvane tabele (plast 1 spodaj, kot v skladu) ter »semaforja« ob robu strani z obtekanjem besedila.

### Barvna tabela

<table class="osi-table">
<thead>
<tr><th>Plast</th><th>Ime</th><th>Primeri protokolov</th></tr>
</thead>
<tbody>
<tr class="osi-l7"><td>7</td><td>Aplikacijska</td><td>HTTP, DNS, SMTP</td></tr>
<tr class="osi-l6"><td>6</td><td>Predstavitvena</td><td>TLS, JPEG, ASCII</td></tr>
<tr class="osi-l5"><td>5</td><td>Sejna</td><td>RPC, NetBIOS</td></tr>
<tr class="osi-l4"><td>4</td><td>Prenosna</td><td>TCP, UDP</td></tr>
<tr class="osi-l3"><td>3</td><td>Omrežna</td><td>IP, ICMP</td></tr>
<tr class="osi-l2"><td>2</td><td>Povezavna</td><td>Ethernet, ARP</td></tr>
<tr class="osi-l1"><td>1</td><td>Fizična</td><td>baker, optično vlakno, WLAN</td></tr>
</tbody>
</table>

### Semafor z obtekanjem besedila

Semafor se ustvari z `:::osi N`, pri čemer je `N` plast, ki jo želimo poudariti (tukaj plast 3). Lebdi ob robu, naslednje besedilo pa ga samodejno obteka.

:::osi 3
:::

Lorem ipsum dolor sit amet, consetetur sadipscing elitr, sed diam nonumy eirmod tempor invidunt ut labore et dolore magna aliquyam erat, sed diam voluptua. At vero eos et accusam et justo duo dolores et ea rebum. Stet clita kasd gubergren, no sea takimata sanctus est Lorem ipsum dolor sit amet.

Lorem ipsum dolor sit amet, consetetur sadipscing elitr, sed diam nonumy eirmod tempor invidunt ut labore et dolore magna aliquyam erat, sed diam voluptua. At vero eos et accusam et justo duo dolores et ea rebum, zaradi česar je ta razdelek vsebinsko uvrščen v omrežno plast (plast 3) — zato je v semaforju obarvano prav to polje, vsa ostala pa ostanejo siva.

---

## Razdelek 1: Osnovni pojmi

:::quiz short
Kakšen je zapis CIDR za podomrežno masko 255.255.255.0?
= /24
= 24
:::

:::quiz mc
Kateri od naslednjih naslovov je omrežni naslov za 192.168.1.42/24?
- [ ] 192.168.1.42
- [x] 192.168.1.0
- [ ] 192.168.1.255
- [ ] 192.168.0.0
:::

:::quiz fill
Omrežni naslov dobimo z bitno operacijo {AND} med naslovom IP in {podomrežno masko}. Najvišji naslov v podomrežju je naslov {broadcast}.
:::

:::evaluate
Preveri razdelek 1
:::

---

## Razdelek 2: Povezovanje — protokoli in njihove naloge

:::quiz match
ARP -> Ugotovi naslov MAC za naslov IP
DNS -> Razreši imena gostiteljev v naslove IP
DHCP -> Odjemalcem samodejno dodeli naslove IP
ICMP -> Uporabljata ga ping in traceroute
:::

:::evaluate
Preveri razdelek 2
:::

---

## Razdelek 3: Podomrežja

:::quiz short
Koliko uporabnih naslovov gostiteljev ima podomrežje /30?
= 2
:::

:::quiz mc
Za kaj se običajno uporablja podomrežje /30?
- [ ] Za velika pisarniška omrežja z veliko napravami
- [ ] Kot naslovni razpon za bazene DHCP
- [x] Kot povezovalno omrežje med dvema usmerjevalnikoma
- [ ] Za brezžične dostopne točke
:::

:::quiz fill
Podomrežje /25 ima {128} naslovov, od katerih je {126} uporabnih za gostitelje.
:::

:::quiz match
/24 -> 254 uporabnih naslovov gostiteljev
/25 -> 126 uporabnih naslovov gostiteljev
/28 -> 14 uporabnih naslovov gostiteljev
/30 -> 2 uporabna naslova gostiteljev
:::

:::evaluate
Preveri razdelek 3
:::

## Razdelek 4: Izbira več odgovorov in naključne naloge

Pri `:::quiz multi` je lahko pravilnih poljubno mnogo odgovorov — vsaka trditev se ovrednoti posebej:

:::quiz multi
Katere trditve o ARP so pravilne?
- [x] ARP ugotovi naslov MAC za naslov IP
- [ ] ARP ugotovi naslov IP za ime
- [x] Zahteva ARP je razpošiljanje (broadcast)
- [ ] Odgovor ARP je razpošiljanje (broadcast)
:::

`:::quiz random <typ>` ob vsakem klicu ustvari nove naloge (`count=N` določi število). Vrste: `bin2dec`, `dec2bin`, `cidr2mask`, `hosts`, `netbcast`, `samenet`, `subnet`.

:::quiz random dec2bin
count=2
:::

:::quiz random netbcast
Izračunaj za naslednji naslov:
:::

:::quiz random samenet
count=3
:::

:::quiz random subnet
:::

:::evaluate
Preveri razdelek 4
:::

## Razdelek 4b: Tabela za izpolnjevanje

`:::quiz table` — navadna tabela Markdown, celice `{odgovor}` postanejo vnosna polja (različice ločuj z `|`):

:::quiz table
Razdeli `192.168.42.0/24` na dve podomrežji:
| Podomrežje | Omrežni naslov | Naslov za razpošiljanje |
|---|---|---|
| 1 | {192.168.42.0} | {192.168.42.127} |
| 2 | {192.168.42.128} | {192.168.42.255} |
:::

:::evaluate
Preveri tabelo
:::

## Razdelek 5: Barvanje bitov

Za poglavji o IP in podomrežjih: `[[n|…]]` = omrežni del, `[[e|…]]` = razširitev, `[[h|…]]` = gostiteljski del — v tekočem besedilu in v tabelah:

[[n|11111111.11111111.11111111]].[[e|11]][[h|000000]] = `255.255.255.192`

Za večvrstične prikaze namesto ``` uporabi blok `<pre class="bits-block">` (v blokih kode barve ne bi bile prikazane):

<pre class="bits-block">
vorher  (/24):  [[n|NNNNNNNN.NNNNNNNN.NNNNNNNN]].[[h|HHHHHHHH]]
nachher (/26):  [[n|NNNNNNNN.NNNNNNNN.NNNNNNNN]].[[e|EE]][[h|HHHHHH]]
</pre>

## Razdelek 6: Komunikacijski diagram

`:::seq` nariše diagram z dvema življenjskima črtama. Številke SEQ in ACK ter števci ob življenjskih črtah se izračunajo iz zastavic in koristnih podatkov (`"…"`). `-x` namesto `->` povzroči izgubo segmenta, `seq=…` prepiše številko (npr. pri ponovnem prenosu).

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

Pri `:::quiz seq` postanejo `?` (pred zastavicami ali `seq=?` / `ack=?`) vnosna polja; `hide: counters` skrije števce:

:::quiz seq
Client -> Server: SYN
Server -> Client: ? SYN, ACK ack=?
Client -> Server: ? ACK ack=?
Client -> Server: PSH, ACK "Hello World"
Server -> Client: ACK ack=?
:::

:::evaluate
Preveri diagram
:::
