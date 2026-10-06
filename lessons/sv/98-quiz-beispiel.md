# Lekplats — Markdown & quiz (testsida)

[[toc]]

Den här sidan används för att testa Markdown-syntax och interaktiva frågetyper.

---

## Markdown-syntax

### Textformatering

**Fet**, *kursiv*, ~~genomstruken~~, `Inline-Code`, och **_kombinerad_**.

Vanligt stycke med en [länk till en annan sida](01-einfuehrung.html) och en [extern länk](https://www.beavertracer.eu).

### Rubriker

Nivåerna H2–H4 visas automatiskt i innehållsförteckningen (TOC).

#### Det här är H4 — syns inte i TOC

### Listor

Osorterad:

- Ethernet
- IP
- TCP
  - HTTP
  - SMTP

Sorterad:

1. Redigeringsläge: bygga upp topologin
2. Körläge: starta simuleringen
3. Spårningsläge: analysera paket

### Tabell

| Protokoll | Lager | Port |
|-----------|---------|------|
| HTTP      | 7       | 80   |
| HTTPS     | 7       | 443  |
| DNS       | 7       | 53   |
| TCP       | 4       | —    |

### Kod

Inline: `ping 192.168.0.1`

Block:

```
$ ping 192.168.0.2
PING 192.168.0.2: 56 data bytes
64 bytes from 192.168.0.2: icmp_seq=0 ttl=64 time=0.4 ms
```

### Callouts

:::note
Det här är en **note**-callout — för neutrala anmärkningar och kompletterande information.
:::

:::tip
Det här är en **tip**-callout — för användbara tips och rekommendationer.
:::

:::warning
Det här är en **warning**-callout — för varningar som kräver uppmärksamhet.
:::

:::danger
Det här är en **danger**-callout — för kritiska felkällor.
:::

:::draft
:::

### Ikoner

Font Awesome Solid: :fa-play: :fa-stop: :fa-desktop: :fa-shield-halved: :fa-wifi:

Font Awesome Regular: :far-file: :far-circle:

Enhetssymboler: :router: :switch:

### Inbäddad simulering

:::sim
url=/sims/demo.btsim
:::

### Uppgift med beteendekontroll

:::task
title: Anslut PC 1 och PC 2
Kontrollera att PC 1 (id 9) har en IP-adress i nätverket 192.168.0.0/24 och kan nå PC 2 (id 11).
check: ip(9, "192.168.0.0/24")
check: pingOk(9, 11)
:::

---

## OSI-referensmodellen: färgschema

Exempel på en tabell med regnbågsfärgad markering (lager 1 längst ned, som i stacken) samt en "trafikljus" i marginalen med textflöde runt.

### Färgad tabell

<table class="osi-table">
<thead>
<tr><th>Lager</th><th>Namn</th><th>Exempelprotokoll</th></tr>
</thead>
<tbody>
<tr class="osi-l7"><td>7</td><td>Applikation</td><td>HTTP, DNS, SMTP</td></tr>
<tr class="osi-l6"><td>6</td><td>Presentation</td><td>TLS, JPEG, ASCII</td></tr>
<tr class="osi-l5"><td>5</td><td>Session</td><td>RPC, NetBIOS</td></tr>
<tr class="osi-l4"><td>4</td><td>Transport</td><td>TCP, UDP</td></tr>
<tr class="osi-l3"><td>3</td><td>Nätverk</td><td>IP, ICMP</td></tr>
<tr class="osi-l2"><td>2</td><td>Länk</td><td>Ethernet, ARP</td></tr>
<tr class="osi-l1"><td>1</td><td>Bitöverföring</td><td>Koppar, fiber, WLAN</td></tr>
</tbody>
</table>

### Trafikljus med textflöde

Trafikljuset skapas med `:::osi N`, där `N` är det lager som ska markeras (här lager 3). Det flyter i marginalen och den efterföljande texten flödar automatiskt förbi.

:::osi 3
:::

Lorem ipsum dolor sit amet, consetetur sadipscing elitr, sed diam nonumy eirmod tempor invidunt ut labore et dolore magna aliquyam erat, sed diam voluptua. At vero eos et accusam et justo duo dolores et ea rebum. Stet clita kasd gubergren, no sea takimata sanctus est Lorem ipsum dolor sit amet.

Lorem ipsum dolor sit amet, consetetur sadipscing elitr, sed diam nonumy eirmod tempor invidunt ut labore et dolore magna aliquyam erat, sed diam voluptua. At vero eos et accusam et justo duo dolores et ea rebum, varför det här avsnittet innehållsmässigt hör till nätverkslagret (lager 3) — därför är just den här rutan i trafikljuset färgad, medan alla andra förblir grå.

---

## Avsnitt 1: Grundbegrepp

:::quiz short
Vad är CIDR-notationen för subnätmasken 255.255.255.0?
= /24
= 24
:::

:::quiz mc
Vilken av följande adresser är nätverksadressen för 192.168.1.42/24?
- [ ] 192.168.1.42
- [x] 192.168.1.0
- [ ] 192.168.1.255
- [ ] 192.168.0.0
:::

:::quiz fill
Nätverksadressen får man genom en bitvis {AND}-operation mellan IP-adressen och {nätmasken}. Den högsta adressen i delnätet är {broadcast}-adressen.
:::

:::evaluate
Kontrollera avsnitt 1
:::

---

## Avsnitt 2: Koppling — protokoll och deras uppgifter

:::quiz match
ARP -> Tar reda på MAC-adressen för en IP-adress
DNS -> Översätter värdnamn till IP-adresser
DHCP -> Tilldelar klienter IP-adresser automatiskt
ICMP -> Används av ping och traceroute
:::

:::evaluate
Kontrollera avsnitt 2
:::

---

## Avsnitt 3: Delnätsindelning

:::quiz short
Hur många användbara värdadresser har ett /30-delnät?
= 2
:::

:::quiz mc
Vad används ett /30-delnät vanligtvis till?
- [ ] För stora kontorsnätverk med många enheter
- [ ] Som adressintervall för DHCP-pooler
- [x] Som förbindelsenät mellan två routrar
- [ ] För WLAN-åtkomstpunkter
:::

:::quiz fill
Ett /25-delnät har {128} adresser, varav {126} kan användas för värdar.
:::

:::quiz match
/24 -> 254 användbara värdadresser
/25 -> 126 användbara värdadresser
/28 -> 14 användbara värdadresser
/30 -> 2 användbara värdadresser
:::

:::evaluate
Kontrollera avsnitt 3
:::

## Avsnitt 4: Flerval och slumpmässiga uppgifter

Med `:::quiz multi` kan hur många svar som helst vara rätta — varje påstående bedöms för sig:

:::quiz multi
Vilka påståenden om ARP stämmer?
- [x] ARP tar reda på MAC-adressen för en IP-adress
- [ ] ARP tar reda på IP-adressen för ett namn
- [x] En ARP-förfrågan är en broadcast
- [ ] Ett ARP-svar är en broadcast
:::

`:::quiz random <typ>` skapar nya uppgifter vid varje anrop (`count=N` anger antalet). Typer: `bin2dec`, `dec2bin`, `cidr2mask`, `hosts`, `netbcast`, `samenet`, `subnet`.

:::quiz random dec2bin
count=2
:::

:::quiz random netbcast
Beräkna för följande adress:
:::

:::quiz random samenet
count=3
:::

:::quiz random subnet
:::

:::evaluate
Kontrollera avsnitt 4
:::

## Avsnitt 4b: Tabell att fylla i

`:::quiz table` — en vanlig Markdown-tabell, `{Antwort}`-celler blir inmatningsfält (separera varianter med `|`):

:::quiz table
Dela upp `192.168.42.0/24` i två delnät:
| Delnät | Nätverksadress | Broadcastadress |
|---|---|---|
| 1 | {192.168.42.0} | {192.168.42.127} |
| 2 | {192.168.42.128} | {192.168.42.255} |
:::

:::evaluate
Kontrollera tabellen
:::

## Avsnitt 5: Färgmarkera bitar

För kapitlen om IP och delnätsindelning: `[[n|…]]` = nätverksdel, `[[e|…]]` = utökning, `[[h|…]]` = värddel — i löptext och i tabeller:

[[n|11111111.11111111.11111111]].[[e|11]][[h|000000]] = `255.255.255.192`

För flerradiga visningar används ett `<pre class="bits-block">`-block i stället för ``` (i kodblock skulle färgerna inte visas):

<pre class="bits-block">
vorher  (/24):  [[n|NNNNNNNN.NNNNNNNN.NNNNNNNN]].[[h|HHHHHHHH]]
nachher (/26):  [[n|NNNNNNNN.NNNNNNNN.NNNNNNNN]].[[e|EE]][[h|HHHHHH]]
</pre>

## Avsnitt 6: Sekvensdiagram

`:::seq` ritar ett diagram med två livslinjer. SEQ- och ACK-nummer samt räknarna vid livslinjerna beräknas utifrån flaggor och nyttolast (`"…"`). `-x` i stället för `->` gör att ett segment går förlorat, `seq=…` skriver över ett nummer (t.ex. vid en omsändning).

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

Med `:::quiz seq` blir `?` (före flaggorna, eller `seq=?` / `ack=?`) inmatningsfält; `hide: counters` döljer räknarna:

:::quiz seq
Client -> Server: SYN
Server -> Client: ? SYN, ACK ack=?
Client -> Server: ? ACK ack=?
Client -> Server: PSH, ACK "Hello World"
Server -> Client: ACK ack=?
:::

:::evaluate
Kontrollera diagrammet
:::
