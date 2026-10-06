# Legeplads — Markdown og quiz (testside)

[[toc]]

Denne side bruges til at teste Markdown-syntaks og interaktive spørgsmålstyper.

---

## Markdown-syntaks

### Tekstformatering

**Fed**, *kursiv*, ~~gennemstreget~~, `inline-kode` og **_kombineret_**.

Almindeligt afsnit med et [link til en anden side](01-einfuehrung.html) og et [eksternt link](https://www.beavertracer.eu).

### Overskrifter

Niveauerne H2–H4 vises automatisk i indholdsfortegnelsen (TOC).

#### Dette er H4 — vises ikke i TOC

### Lister

Uordnet:

- Ethernet
- IP
- TCP
  - HTTP
  - SMTP

Ordnet:

1. Redigeringstilstand: Opbyg topologien
2. Kør-tilstand: Start simuleringen
3. Spor-tilstand: Analysér pakker

### Tabel

| Protokol | Lag | Port |
|-----------|---------|------|
| HTTP      | 7       | 80   |
| HTTPS     | 7       | 443  |
| DNS       | 7       | 53   |
| TCP       | 4       | —    |

### Kode

Inline: `ping 192.168.0.1`

Blok:

```
$ ping 192.168.0.2
PING 192.168.0.2: 56 data bytes
64 bytes from 192.168.0.2: icmp_seq=0 ttl=64 time=0.4 ms
```

### Callouts

:::note
Dette er en **note**-callout — til neutrale henvisninger og supplerende oplysninger.
:::

:::tip
Dette er en **tip**-callout — til nyttige tips og anbefalinger.
:::

:::warning
Dette er en **warning**-callout — til advarsler, der kræver opmærksomhed.
:::

:::danger
Dette er en **danger**-callout — til kritiske fejlkilder.
:::

:::draft
:::

### Ikoner

Font Awesome Solid: :fa-play: :fa-stop: :fa-desktop: :fa-shield-halved: :fa-wifi:

Font Awesome Regular: :far-file: :far-circle:

Enhedssymboler: :router: :switch:

### Indlejret simulering

:::sim
url=/sims/demo.btsim
:::

### Opgave med adfærdstjek

:::task
title: Forbind PC 1 og PC 2
Tjek, om PC 1 (id 9) har en IP i netværket 192.168.0.0/24 og kan nå PC 2 (id 11).
check: ip(9, "192.168.0.0/24")
check: pingOk(9, 11)
:::

---

## OSI-referencemodellen: farveskema

Eksempel på en tabel fremhævet i regnbuefarver (lag 1 nederst, som i stakken) samt et "trafiklys" i sidemargenen med tekstombrydning.

### Farvet tabel

<table class="osi-table">
<thead>
<tr><th>Lag</th><th>Navn</th><th>Eksempelprotokoller</th></tr>
</thead>
<tbody>
<tr class="osi-l7"><td>7</td><td>Applikation</td><td>HTTP, DNS, SMTP</td></tr>
<tr class="osi-l6"><td>6</td><td>Præsentation</td><td>TLS, JPEG, ASCII</td></tr>
<tr class="osi-l5"><td>5</td><td>Session</td><td>RPC, NetBIOS</td></tr>
<tr class="osi-l4"><td>4</td><td>Transport</td><td>TCP, UDP</td></tr>
<tr class="osi-l3"><td>3</td><td>Netværk</td><td>IP, ICMP</td></tr>
<tr class="osi-l2"><td>2</td><td>Link</td><td>Ethernet, ARP</td></tr>
<tr class="osi-l1"><td>1</td><td>Fysisk</td><td>Kobber, fiber, WLAN</td></tr>
</tbody>
</table>

### Trafiklys med tekstombrydning

Trafiklyset oprettes med `:::osi N`, hvor `N` er det lag, der skal fremhæves (her lag 3). Det flyder i margenen, og den efterfølgende tekst løber automatisk forbi det.

:::osi 3
:::

Lorem ipsum dolor sit amet, consetetur sadipscing elitr, sed diam nonumy eirmod tempor invidunt ut labore et dolore magna aliquyam erat, sed diam voluptua. At vero eos et accusam et justo duo dolores et ea rebum. Stet clita kasd gubergren, no sea takimata sanctus est Lorem ipsum dolor sit amet.

Lorem ipsum dolor sit amet, consetetur sadipscing elitr, sed diam nonumy eirmod tempor invidunt ut labore et dolore magna aliquyam erat, sed diam voluptua. At vero eos et accusam et justo duo dolores et ea rebum, hvorved dette afsnit indholdsmæssigt hører til netværkslaget (lag 3) — derfor er netop denne boks i trafiklyset farvet, mens alle de andre forbliver grå.

---

## Afsnit 1: Grundbegreber

:::quiz short
Hvad er CIDR-notationen for subnetmasken 255.255.255.0?
= /24
= 24
:::

:::quiz mc
Hvilken af følgende adresser er netadressen for 192.168.1.42/24?
- [ ] 192.168.1.42
- [x] 192.168.1.0
- [ ] 192.168.1.255
- [ ] 192.168.0.0
:::

:::quiz fill
Netadressen får man ved en bitvis {AND}-operation mellem IP-adressen og {subnetmasken}. Den højeste adresse i delnetværket er {broadcast}-adressen.
:::

:::evaluate
Tjek afsnit 1
:::

---

## Afsnit 2: Sammenkobling — protokoller og deres opgaver

:::quiz match
ARP -> Finder MAC-adressen til en IP-adresse
DNS -> Omsætter værtsnavne til IP-adresser
DHCP -> Tildeler automatisk IP-adresser til klienter
ICMP -> Bruges af ping og traceroute
:::

:::evaluate
Tjek afsnit 2
:::

---

## Afsnit 3: Subnetting

:::quiz short
Hvor mange anvendelige værtsadresser har et /30-delnetværk?
= 2
:::

:::quiz mc
Hvad bruger man typisk et /30-delnetværk til?
- [ ] Til store kontornetværk med mange enheder
- [ ] Som adresseinterval til DHCP-pools
- [x] Som forbindelsesnetværk mellem to routere
- [ ] Til WLAN-access points
:::

:::quiz fill
Et /25-delnetværk har {128} adresser, hvoraf {126} kan bruges til værter.
:::

:::quiz match
/24 -> 254 anvendelige værtsadresser
/25 -> 126 anvendelige værtsadresser
/28 -> 14 anvendelige værtsadresser
/30 -> 2 anvendelige værtsadresser
:::

:::evaluate
Tjek afsnit 3
:::

## Afsnit 4: Flervalg og tilfældige opgaver

Ved `:::quiz multi` kan et vilkårligt antal svar være rigtige — hver påstand bedømmes for sig:

:::quiz multi
Hvilke udsagn om ARP er rigtige?
- [x] ARP finder MAC-adressen til en IP-adresse
- [ ] ARP finder IP-adressen til et navn
- [x] En ARP-forespørgsel er en broadcast
- [ ] Et ARP-svar er en broadcast
:::

`:::quiz random <type>` genererer nye opgaver ved hvert kald (`count=N` angiver antallet). Typer: `bin2dec`, `dec2bin`, `cidr2mask`, `hosts`, `netbcast`, `samenet`, `subnet`.

:::quiz random dec2bin
count=2
:::

:::quiz random netbcast
Beregn for følgende adresse:
:::

:::quiz random samenet
count=3
:::

:::quiz random subnet
:::

:::evaluate
Tjek afsnit 4
:::

## Afsnit 4b: Tabel til udfyldning

`:::quiz table` — en almindelig Markdown-tabel; `{svar}`-celler bliver til indtastningsfelter (adskil varianter med `|`):

:::quiz table
Del `192.168.42.0/24` i to delnetværk:
| Delnetværk | Netadresse | Broadcastadresse |
|---|---|---|
| 1 | {192.168.42.0} | {192.168.42.127} |
| 2 | {192.168.42.128} | {192.168.42.255} |
:::

:::evaluate
Tjek tabel
:::

## Afsnit 5: Farvelægning af bits

Til kapitlerne om IP og subnetting: `[[n|…]]` = netværksdel, `[[e|…]]` = udvidelse, `[[h|…]]` = værtsdel — i løbende tekst og i tabeller:

[[n|11111111.11111111.11111111]].[[e|11]][[h|000000]] = `255.255.255.192`

Til flerlinjede visninger bruges en `<pre class="bits-block">`-blok i stedet for ``` (i kodeblokke ville farverne ikke blive vist):

<pre class="bits-block">
vorher  (/24):  [[n|NNNNNNNN.NNNNNNNN.NNNNNNNN]].[[h|HHHHHHHH]]
nachher (/26):  [[n|NNNNNNNN.NNNNNNNN.NNNNNNNN]].[[e|EE]][[h|HHHHHH]]
</pre>

## Afsnit 6: Sekvensdiagram

`:::seq` tegner et diagram med to livslinjer. SEQ- og ACK-numre samt tællerne på livslinjerne beregnes ud fra flag og nyttedata (`"…"`). `-x` i stedet for `->` får et segment til at gå tabt, `seq=…` overskriver et nummer (f.eks. ved en gensendelse).

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

Med `:::quiz seq` bliver `?` (før flagene, eller `seq=?` / `ack=?`) til indtastningsfelter; `hide: counters` skjuler tællerne:

:::quiz seq
Client -> Server: SYN
Server -> Client: ? SYN, ACK ack=?
Client -> Server: ? ACK ack=?
Client -> Server: PSH, ACK "Hello World"
Server -> Client: ACK ack=?
:::

:::evaluate
Tjek diagram
:::
