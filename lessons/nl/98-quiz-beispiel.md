# Speeltuin — Markdown & quiz (testpagina)

[[toc]]

Deze pagina dient om Markdown-syntaxis en interactieve vraagtypen te testen.

---

## Markdown-syntaxis

### Tekstopmaak

**Vet**, *cursief*, ~~doorgehaald~~, `Inline-Code`, en **_gecombineerd_**.

Normale alinea met een [link naar een andere pagina](01-einfuehrung.html) en een [externe link](https://www.beavertracer.eu).

### Kopjes

De niveaus H2–H4 verschijnen automatisch in de inhoudsopgave (TOC).

#### Dit is H4 — komt niet voor in de TOC

### Lijsten

Ongeordend:

- Ethernet
- IP
- TCP
  - HTTP
  - SMTP

Geordend:

1. Bewerkmodus: topologie opbouwen
2. Uitvoermodus: simulatie starten
3. Traceermodus: pakketten analyseren

### Tabel

| Protocol | Laag | Poort |
|-----------|---------|------|
| HTTP      | 7       | 80   |
| HTTPS     | 7       | 443  |
| DNS       | 7       | 53   |
| TCP       | 4       | —    |

### Code

Inline: `ping 192.168.0.1`

Blok:

```
$ ping 192.168.0.2
PING 192.168.0.2: 56 data bytes
64 bytes from 192.168.0.2: icmp_seq=0 ttl=64 time=0.4 ms
```

### Callouts

:::note
Dit is een **note**-callout — voor neutrale opmerkingen en aanvullende informatie.
:::

:::tip
Dit is een **tip**-callout — voor nuttige tips en aanbevelingen.
:::

:::warning
Dit is een **warning**-callout — voor waarschuwingen die aandacht vereisen.
:::

:::danger
Dit is een **danger**-callout — voor kritieke foutbronnen.
:::

:::draft
:::

### Iconen

Font Awesome Solid: :fa-play: :fa-stop: :fa-desktop: :fa-shield-halved: :fa-wifi:

Font Awesome Regular: :far-file: :far-circle:

Apparaatsymbolen: :router: :switch:

### Ingebedde simulatie

:::sim
url=/sims/demo.btsim
:::

### Taak met gedragscontrole

:::task
title: PC 1 en PC 2 verbinden
Controleer of PC 1 (id 9) een IP-adres in het netwerk 192.168.0.0/24 heeft en PC 2 (id 11) kan bereiken.
check: ip(9, "192.168.0.0/24")
check: pingOk(9, 11)
:::

---

## OSI-referentiemodel: kleurenschema

Voorbeeld van een in regenboogkleuren gemarkeerde tabel (laag 1 onderaan, zoals in de stapel) en een "stoplicht" aan de zijkant met tekstomloop.

### Gekleurde tabel

<table class="osi-table">
<thead>
<tr><th>Laag</th><th>Naam</th><th>Voorbeeldprotocollen</th></tr>
</thead>
<tbody>
<tr class="osi-l7"><td>7</td><td>Applicatie</td><td>HTTP, DNS, SMTP</td></tr>
<tr class="osi-l6"><td>6</td><td>Presentatie</td><td>TLS, JPEG, ASCII</td></tr>
<tr class="osi-l5"><td>5</td><td>Sessie</td><td>RPC, NetBIOS</td></tr>
<tr class="osi-l4"><td>4</td><td>Transport</td><td>TCP, UDP</td></tr>
<tr class="osi-l3"><td>3</td><td>Netwerk</td><td>IP, ICMP</td></tr>
<tr class="osi-l2"><td>2</td><td>Datalink</td><td>Ethernet, ARP</td></tr>
<tr class="osi-l1"><td>1</td><td>Fysiek</td><td>Koper, glasvezel, wifi</td></tr>
</tbody>
</table>

### Stoplicht met tekstomloop

Het stoplicht wordt gemaakt met `:::osi N`, waarbij `N` de te markeren laag is (hier laag 3). Het zweeft aan de rand, de tekst die erna komt loopt er automatisch omheen.

:::osi 3
:::

Lorem ipsum dolor sit amet, consetetur sadipscing elitr, sed diam nonumy eirmod tempor invidunt ut labore et dolore magna aliquyam erat, sed diam voluptua. At vero eos et accusam et justo duo dolores et ea rebum. Stet clita kasd gubergren, no sea takimata sanctus est Lorem ipsum dolor sit amet.

Lorem ipsum dolor sit amet, consetetur sadipscing elitr, sed diam nonumy eirmod tempor invidunt ut labore et dolore magna aliquyam erat, sed diam voluptua. At vero eos et accusam et justo duo dolores et ea rebum, waardoor deze alinea inhoudelijk bij de netwerklaag (laag 3) hoort — daarom is precies dit vak in het stoplicht gekleurd en blijven alle andere grijs.

---

## Onderdeel 1: basisbegrippen

:::quiz short
Wat is de CIDR-notatie van het netmasker 255.255.255.0?
= /24
= 24
:::

:::quiz mc
Welk van de volgende adressen is het netwerkadres van 192.168.1.42/24?
- [ ] 192.168.1.42
- [x] 192.168.1.0
- [ ] 192.168.1.255
- [ ] 192.168.0.0
:::

:::quiz fill
Het netwerkadres verkrijg je door een bitsgewijze {AND}-bewerking van het IP-adres en het {netmasker}. Het hoogste adres in het subnet is het {broadcast}adres.
:::

:::evaluate
Onderdeel 1 controleren
:::

---

## Onderdeel 2: koppelen — protocollen en hun taken

:::quiz match
ARP -> Bepaalt het MAC-adres bij een IP-adres
DNS -> Zet hostnamen om in IP-adressen
DHCP -> Wijst automatisch IP-adressen toe aan clients
ICMP -> Wordt gebruikt door ping en traceroute
:::

:::evaluate
Onderdeel 2 controleren
:::

---

## Onderdeel 3: subnetting

:::quiz short
Hoeveel bruikbare hostadressen heeft een /30-subnet?
= 2
:::

:::quiz mc
Waarvoor gebruikt men doorgaans een /30-subnet?
- [ ] Voor grote kantoornetwerken met veel apparaten
- [ ] Als adresbereik voor DHCP-pools
- [x] Als verbindingsnetwerk tussen twee routers
- [ ] Voor wifi-toegangspunten
:::

:::quiz fill
Een /25-subnet heeft {128} adressen, waarvan er {126} bruikbaar zijn voor hosts.
:::

:::quiz match
/24 -> 254 bruikbare hostadressen
/25 -> 126 bruikbare hostadressen
/28 -> 14 bruikbare hostadressen
/30 -> 2 bruikbare hostadressen
:::

:::evaluate
Onderdeel 3 controleren
:::

## Onderdeel 4: meerkeuze en willekeurige opgaven

Bij `:::quiz multi` kunnen willekeurig veel antwoorden juist zijn — elke uitspraak wordt afzonderlijk beoordeeld:

:::quiz multi
Welke uitspraken over ARP kloppen?
- [x] ARP bepaalt bij een IP-adres het MAC-adres
- [ ] ARP bepaalt bij een naam het IP-adres
- [x] Een ARP-verzoek is een broadcast
- [ ] Een ARP-antwoord is een broadcast
:::

`:::quiz random <typ>` maakt bij elke aanroep nieuwe opgaven (`count=N` bepaalt het aantal). Typen: `bin2dec`, `dec2bin`, `cidr2mask`, `hosts`, `netbcast`, `samenet`, `subnet`.

:::quiz random dec2bin
count=2
:::

:::quiz random netbcast
Bereken voor het volgende adres:
:::

:::quiz random samenet
count=3
:::

:::quiz random subnet
:::

:::evaluate
Onderdeel 4 controleren
:::

## Onderdeel 4b: tabel om in te vullen

`:::quiz table` — een gewone Markdown-tabel, `{Antwort}`-cellen worden invoervelden (varianten scheiden met `|`):

:::quiz table
Verdeel `192.168.42.0/24` in twee subnets:
| Subnet | Netwerkadres | Broadcastadres |
|---|---|---|
| 1 | {192.168.42.0} | {192.168.42.127} |
| 2 | {192.168.42.128} | {192.168.42.255} |
:::

:::evaluate
Tabel controleren
:::

## Onderdeel 5: bits inkleuren

Voor de hoofdstukken over IP en subnetting: `[[n|…]]` = netwerkgedeelte, `[[e|…]]` = uitbreiding, `[[h|…]]` = hostgedeelte — in lopende tekst en in tabellen:

[[n|11111111.11111111.11111111]].[[e|11]][[h|000000]] = `255.255.255.192`

Gebruik voor weergaven over meerdere regels in plaats van ``` een `<pre class="bits-block">`-blok (in codeblokken worden de kleuren niet weergegeven):

<pre class="bits-block">
vorher  (/24):  [[n|NNNNNNNN.NNNNNNNN.NNNNNNNN]].[[h|HHHHHHHH]]
nachher (/26):  [[n|NNNNNNNN.NNNNNNNN.NNNNNNNN]].[[e|EE]][[h|HHHHHH]]
</pre>

## Onderdeel 6: sequentiediagram

`:::seq` tekent een diagram met twee levenslijnen. SEQ- en ACK-nummers en de tellers bij de levenslijnen worden berekend uit flags en nuttige data (`"…"`). `-x` in plaats van `->` laat een segment verloren gaan, `seq=…` overschrijft een nummer (bijv. bij een hertransmissie).

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

Met `:::quiz seq` worden `?` (vóór de flags, of `seq=?` / `ack=?`) invoervelden; `hide: counters` verbergt de tellers:

:::quiz seq
Client -> Server: SYN
Server -> Client: ? SYN, ACK ack=?
Client -> Server: ? ACK ack=?
Client -> Server: PSH, ACK "Hello World"
Server -> Client: ACK ack=?
:::

:::evaluate
Diagram controleren
:::
