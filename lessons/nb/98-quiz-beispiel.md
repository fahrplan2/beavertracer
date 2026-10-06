# Lekeplass — Markdown og quiz (testside)

[[toc]]

Denne siden brukes til å teste Markdown-syntaks og interaktive spørsmålstyper.

---

## Markdown-syntaks

### Tekstformatering

**Fet**, *kursiv*, ~~gjennomstreket~~, `Inline-Code`, og **_kombinert_**.

Vanlig avsnitt med en [lenke til en annen side](01-einfuehrung.html) og en [ekstern lenke](https://www.beavertracer.eu).

### Overskrifter

Nivåene H2–H4 vises automatisk i innholdsfortegnelsen (TOC).

#### Dette er H4 — vises ikke i TOC

### Lister

Uordnet:

- Ethernet
- IP
- TCP
  - HTTP
  - SMTP

Ordnet:

1. Redigeringsmodus: bygge opp topologien
2. Kjør-modus: starte simuleringen
3. Sporing-modus: analysere pakker

### Tabell

| Protokoll | Lag | Port |
|-----------|---------|------|
| HTTP      | 7       | 80   |
| HTTPS     | 7       | 443  |
| DNS       | 7       | 53   |
| TCP       | 4       | —    |

### Kode

Inline: `ping 192.168.0.1`

Blokk:

```
$ ping 192.168.0.2
PING 192.168.0.2: 56 data bytes
64 bytes from 192.168.0.2: icmp_seq=0 ttl=64 time=0.4 ms
```

### Callouts

:::note
Dette er en **note**-callout — for nøytrale merknader og tilleggsinformasjon.
:::

:::tip
Dette er en **tip**-callout — for nyttige tips og anbefalinger.
:::

:::warning
Dette er en **warning**-callout — for advarsler som krever oppmerksomhet.
:::

:::danger
Dette er en **danger**-callout — for kritiske feilkilder.
:::

:::draft
:::

### Ikoner

Font Awesome Solid: :fa-play: :fa-stop: :fa-desktop: :fa-shield-halved: :fa-wifi:

Font Awesome Regular: :far-file: :far-circle:

Enhetssymboler: :router: :switch:

### Innebygd simulering

:::sim
url=/sims/demo.btsim
:::

### Oppgave med atferdssjekk

:::task
title: Koble sammen PC 1 og PC 2
Kontroller om PC 1 (id 9) har en IP i nettverket 192.168.0.0/24 og kan nå PC 2 (id 11).
check: ip(9, "192.168.0.0/24")
check: pingOk(9, 11)
:::

---

## OSI-referansemodellen: fargeskjema

Eksempel på en tabell uthevet i regnbuefarger (lag 1 nederst, som i stakken) samt et «trafikklys» i sidekanten med tekstflyt rundt.

### Farget tabell

<table class="osi-table">
<thead>
<tr><th>Lag</th><th>Navn</th><th>Eksempelprotokoller</th></tr>
</thead>
<tbody>
<tr class="osi-l7"><td>7</td><td>Applikasjon</td><td>HTTP, DNS, SMTP</td></tr>
<tr class="osi-l6"><td>6</td><td>Presentasjon</td><td>TLS, JPEG, ASCII</td></tr>
<tr class="osi-l5"><td>5</td><td>Sesjon</td><td>RPC, NetBIOS</td></tr>
<tr class="osi-l4"><td>4</td><td>Transport</td><td>TCP, UDP</td></tr>
<tr class="osi-l3"><td>3</td><td>Nettverk</td><td>IP, ICMP</td></tr>
<tr class="osi-l2"><td>2</td><td>Link</td><td>Ethernet, ARP</td></tr>
<tr class="osi-l1"><td>1</td><td>Bitoverføring</td><td>Kobber, fiber, WLAN</td></tr>
</tbody>
</table>

### Trafikklys med tekstflyt

Trafikklyset opprettes med `:::osi N`, der `N` er laget som skal utheves (her lag 3). Det flyter i kanten, og teksten som følger, flyter automatisk forbi det.

:::osi 3
:::

Lorem ipsum dolor sit amet, consetetur sadipscing elitr, sed diam nonumy eirmod tempor invidunt ut labore et dolore magna aliquyam erat, sed diam voluptua. At vero eos et accusam et justo duo dolores et ea rebum. Stet clita kasd gubergren, no sea takimata sanctus est Lorem ipsum dolor sit amet.

Lorem ipsum dolor sit amet, consetetur sadipscing elitr, sed diam nonumy eirmod tempor invidunt ut labore et dolore magna aliquyam erat, sed diam voluptua. At vero eos et accusam et justo duo dolores et ea rebum, og derfor hører dette avsnittet innholdsmessig til nettverkslaget (lag 3) — derfor er akkurat denne boksen i trafikklyset farget, mens alle de andre forblir grå.

---

## Del 1: Grunnbegreper

:::quiz short
Hva er CIDR-notasjonen for subnettmasken 255.255.255.0?
= /24
= 24
:::

:::quiz mc
Hvilken av følgende adresser er nettverksadressen til 192.168.1.42/24?
- [ ] 192.168.1.42
- [x] 192.168.1.0
- [ ] 192.168.1.255
- [ ] 192.168.0.0
:::

:::quiz fill
Nettverksadressen får man ved en bitvis {AND}-operasjon mellom IP-adressen og {nettmaske}. Den høyeste adressen i delnettet er {kringkasting}-adressen.
:::

:::evaluate
Kontroller del 1
:::

---

## Del 2: Kobling — protokoller og oppgavene deres

:::quiz match
ARP -> Finner MAC-adressen til en IP-adresse
DNS -> Løser opp vertsnavn til IP-adresser
DHCP -> Tildeler IP-adresser automatisk til klienter
ICMP -> Brukes av ping og traceroute
:::

:::evaluate
Kontroller del 2
:::

---

## Del 3: Delnetting

:::quiz short
Hvor mange brukbare vertsadresser har et /30-delnett?
= 2
:::

:::quiz mc
Hva brukes et /30-delnett typisk til?
- [ ] Til store kontornettverk med mange enheter
- [ ] Som adresseområde for DHCP-pooler
- [x] Som forbindelsesnett mellom to rutere
- [ ] Til WLAN-tilgangspunkter
:::

:::quiz fill
Et /25-delnett har {128} adresser, og av dem er {126} brukbare for verter.
:::

:::quiz match
/24 -> 254 brukbare vertsadresser
/25 -> 126 brukbare vertsadresser
/28 -> 14 brukbare vertsadresser
/30 -> 2 brukbare vertsadresser
:::

:::evaluate
Kontroller del 3
:::

## Del 4: Flervalg og tilfeldige oppgaver

Ved `:::quiz multi` kan et vilkårlig antall svar være riktige — hvert utsagn vurderes for seg:

:::quiz multi
Hvilke utsagn om ARP stemmer?
- [x] ARP finner MAC-adressen til en IP-adresse
- [ ] ARP finner IP-adressen til et navn
- [x] En ARP-forespørsel er en kringkasting
- [ ] Et ARP-svar er en kringkasting
:::

`:::quiz random <typ>` lager nye oppgaver hver gang (`count=N` bestemmer antallet). Typer: `bin2dec`, `dec2bin`, `cidr2mask`, `hosts`, `netbcast`, `samenet`, `subnet`.

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
Kontroller del 4
:::

## Del 4b: Tabell som skal fylles ut

`:::quiz table` — en vanlig Markdown-tabell, `{svar}`-celler blir til inndatafelt (skill varianter med `|`):

:::quiz table
Del `192.168.42.0/24` i to delnett:
| Delnett | Nettverksadresse | Kringkastingsadresse |
|---|---|---|
| 1 | {192.168.42.0} | {192.168.42.127} |
| 2 | {192.168.42.128} | {192.168.42.255} |
:::

:::evaluate
Kontroller tabell
:::

## Del 5: Farge på bits

For kapitlene om IP og delnetting: `[[n|…]]` = nettverksdel, `[[e|…]]` = utvidelse, `[[h|…]]` = vertsdel — i løpende tekst og i tabeller:

[[n|11111111.11111111.11111111]].[[e|11]][[h|000000]] = `255.255.255.192`

For flerlinjers visninger bruker du en `<pre class="bits-block">`-blokk i stedet for ``` (i kodeblokker ville ikke fargene blitt vist):

<pre class="bits-block">
før   (/24):  [[n|NNNNNNNN.NNNNNNNN.NNNNNNNN]].[[h|HHHHHHHH]]
etter (/26):  [[n|NNNNNNNN.NNNNNNNN.NNNNNNNN]].[[e|EE]][[h|HHHHHH]]
</pre>

## Del 6: Sekvensdiagram

`:::seq` tegner et diagram med to livslinjer. SEQ- og ACK-numre samt tellerne ved livslinjene beregnes ut fra flagg og nyttedata (`"…"`). `-x` i stedet for `->` lar et segment gå tapt, `seq=…` overstyrer et nummer (f.eks. ved en retransmisjon).

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

Med `:::quiz seq` blir `?` (foran flaggene, eller `seq=?` / `ack=?`) til inndatafelt; `hide: counters` skjuler tellerne:

:::quiz seq
Client -> Server: SYN
Server -> Client: ? SYN, ACK ack=?
Client -> Server: ? ACK ack=?
Client -> Server: PSH, ACK "Hello World"
Server -> Client: ACK ack=?
:::

:::evaluate
Kontroller diagram
:::
