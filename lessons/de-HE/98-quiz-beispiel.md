# Spielwiese — Markdown & Quiz (Testseite)

[[toc]]

Die Seit is zum Teste vun der Markdown-Syntax un vun de interaktive Fragetype da.

---

## Markdown-Syntax

### Textformatierung

**Fett**, *kursiv*, ~~durchgestrichen~~, `Inline-Code`, un **_kombiniert_**.

Ganz normaler Absatz mit eme [Link uff e annern Seit](01-einfuehrung.html) un eme [externe Link](https://www.beavertracer.eu).

### Überschriften

Die Ebene H2–H4 erscheine ganz vun alleen im Inhaltsverzeichnis (TOC).

#### Des is H4 — der taucht net im TOC uff

### Listen

Ungeordnet:

- Ethernet
- IP
- TCP
  - HTTP
  - SMTP

Geordnet:

1. Edit-Modus: Topologie uffbaue
2. Run-Modus: Simulation starte
3. Trace-Modus: Pakete analysiere

### Tabelle

| Protokoll | Schicht | Port |
|-----------|---------|------|
| HTTP      | 7       | 80   |
| HTTPS     | 7       | 443  |
| DNS       | 7       | 53   |
| TCP       | 4       | —    |

### Code

Inline: `ping 192.168.0.1`

Block:

```
$ ping 192.168.0.2
PING 192.168.0.2: 56 data bytes
64 bytes from 192.168.0.2: icmp_seq=0 ttl=64 time=0.4 ms
```

### Callouts

:::note
Des is e **note**-Callout — für neutrale Hinweise un zusätzliche Infos.
:::

:::tip
Des is e **tip**-Callout — für nützliche Tipps un Empfehlunge.
:::

:::warning
Des is e **warning**-Callout — für Warnunge, wo mer druff uffbasse muss.
:::

:::danger
Des is e **danger**-Callout — für kritische Fehlerquelle.
:::

:::draft
:::

### Icons

Font Awesome Solid: :fa-play: :fa-stop: :fa-desktop: :fa-shield-halved: :fa-wifi:

Font Awesome Regular: :far-file: :far-circle:

Gerätesymbole: :router: :switch:

### Eingebettete Simulation

:::sim
url=/sims/demo.btsim
:::

### Aufgab mit Verhaltenscheck

:::task
title: PC 1 un PC 2 verbinde
Guck emol, ob PC 1 (id 9) e IP im Netz 192.168.0.0/24 hat un PC 2 (id 11) erreiche kann.
check: ip(9, "192.168.0.0/24")
check: pingOk(9, 11)
:::

---

## OSI-Referenzmodell: Farbschema

Beispiel für e regebogefarbisch hervorgehobene Tabelle (Schicht 1 unne, wie im Stapel) sowie e "Ampel" am Seiterand mit Textumlauf.

### Farbige Tabelle

<table class="osi-table">
<thead>
<tr><th>Schicht</th><th>Name</th><th>Beispielprotokolle</th></tr>
</thead>
<tbody>
<tr class="osi-l7"><td>7</td><td>Anwendung</td><td>HTTP, DNS, SMTP</td></tr>
<tr class="osi-l6"><td>6</td><td>Darstellung</td><td>TLS, JPEG, ASCII</td></tr>
<tr class="osi-l5"><td>5</td><td>Sitzung</td><td>RPC, NetBIOS</td></tr>
<tr class="osi-l4"><td>4</td><td>Transport</td><td>TCP, UDP</td></tr>
<tr class="osi-l3"><td>3</td><td>Vermittlung</td><td>IP, ICMP</td></tr>
<tr class="osi-l2"><td>2</td><td>Sicherung</td><td>Ethernet, ARP</td></tr>
<tr class="osi-l1"><td>1</td><td>Bitübertragung</td><td>Kupfer, Glasfaser, WLAN</td></tr>
</tbody>
</table>

### Ampel mit Textumlauf

Die Ampel werd mit `:::osi N` erzeugt, wobei `N` die Schicht is, wo hervorgehobe werde soll (hier Schicht 3). Sie schwebt am Rand, un der Text danoh fließt ganz vun alleen dran vorbei.

:::osi 3
:::

Lorem ipsum dolor sit amet, consetetur sadipscing elitr, sed diam nonumy eirmod tempor invidunt ut labore et dolore magna aliquyam erat, sed diam voluptua. At vero eos et accusam et justo duo dolores et ea rebum. Stet clita kasd gubergren, no sea takimata sanctus est Lorem ipsum dolor sit amet.

Lorem ipsum dolor sit amet, consetetur sadipscing elitr, sed diam nonumy eirmod tempor invidunt ut labore et dolore magna aliquyam erat, sed diam voluptua. At vero eos et accusam et justo duo dolores et ea rebum, wodurch dieser Abschnitt inhaltlich der Vermittlungsschicht (Layer 3) zugeordnet ist — deshalb ist genau diese Box in der Ampel farbig, alle anderen bleiben grau.

---

## Abschnitt 1: Grundbegriffe

:::quiz short
Was is die CIDR-Notation vun der Subnetzmaske 255.255.255.0?
= /24
= 24
:::

:::quiz mc
Welche vun dene Adresse is die Netzadresse vun 192.168.1.42/24?
- [ ] 192.168.1.42
- [x] 192.168.1.0
- [ ] 192.168.1.255
- [ ] 192.168.0.0
:::

:::quiz fill
Die Netzadresse kriggt mer dorch e bitweise {AND}-Verknüpfung vun IP-Adresse un {Subnetzmaske}. Die högschte Adress im Subnetz is die {Broadcast}-Adresse.
:::

:::evaluate
Abschnitt 1 prüfe
:::

---

## Abschnitt 2: Zuordnung — Protokolle un ihre Uffgabe

:::quiz match
ARP -> Ermittelt die MAC-Adresse zu einer IP-Adresse
DNS -> Löst Hostnamen in IP-Adressen auf
DHCP -> Vergibt IP-Adressen automatisch an Clients
ICMP -> Wird von ping und traceroute verwendet
:::

:::evaluate
Abschnitt 2 prüfe
:::

---

## Abschnitt 3: Subnetting

:::quiz short
Wie viel nutzbare Hostadresse hat e /30-Subnetz?
= 2
:::

:::quiz mc
Wofür nimmt mer typischerweis e /30-Subnetz?
- [ ] Für große Büronetzwerke mit ganz viele Geräte
- [ ] Als Adressbereich für DHCP-Pools
- [x] Als Verbindungsnetz zwische zwei Router
- [ ] Für WLAN-Accesspoints
:::

:::quiz fill
E /25-Subnetz hat {128} Adresse, devun sin {126} für Hosts nutzbar.
:::

:::quiz match
/24 -> 254 nutzbare Hostadressen
/25 -> 126 nutzbare Hostadressen
/28 -> 14 nutzbare Hostadressen
/30 -> 2 nutzbare Hostadressen
:::

:::evaluate
Abschnitt 3 prüfe
:::

## Abschnitt 4: Mehrfachauswahl un Zufallsaufgabe

Bei `:::quiz multi` kenne beliebig viele Antworte richtig sei — jede Aussag werd einzeln bewertet:

:::quiz multi
Welche Aussage iwwer ARP stimme?
- [x] ARP ermittelt zu einer IP-Adresse die MAC-Adresse
- [ ] ARP ermittelt zu einem Namen die IP-Adresse
- [x] Eine ARP-Anfrage ist ein Broadcast
- [ ] Eine ARP-Antwort ist ein Broadcast
:::

`:::quiz random <typ>` erzeugt bei jedem Uffruf neue Uffgabe (`count=N` legt die Anzahl fest). Type: `bin2dec`, `dec2bin`, `cidr2mask`, `hosts`, `netbcast`, `samenet`, `subnet`.

:::quiz random dec2bin
count=2
:::

:::quiz random netbcast
Berechne für die folgende Adress:
:::

:::quiz random samenet
count=3
:::

:::quiz random subnet
:::

:::evaluate
Abschnitt 4 prüfe
:::

## Abschnitt 4b: Tabelle zum Ausfülle

`:::quiz table` — e ganz normale Markdown-Tabelle, `{Antwort}`-Zelle werde zu Eingabefelder (Variante mit `|` trenne):

:::quiz table
Teil `192.168.42.0/24` in zwei Teilnetze:
| Teilnetz | Netzadresse | Broadcastadresse |
|---|---|---|
| 1 | {192.168.42.0} | {192.168.42.127} |
| 2 | {192.168.42.128} | {192.168.42.255} |
:::

:::evaluate
Tabelle prüfe
:::

## Abschnitt 5: Bits einfärbe

Für die IP- un Subnetting-Kapitel: `[[n|…]]` = Netzteil, `[[e|…]]` = Erweiterung, `[[h|…]]` = Hostteil — im Fließtext un in Tabelle:

[[n|11111111.11111111.11111111]].[[e|11]][[h|000000]] = `255.255.255.192`

Für mehrzeilige Darstellunge nimmst du statt ``` en `<pre class="bits-block">`-Block (in Code-Blöck würde die Farbe net dargestellt):

<pre class="bits-block">
vorher  (/24):  [[n|NNNNNNNN.NNNNNNNN.NNNNNNNN]].[[h|HHHHHHHH]]
nachher (/26):  [[n|NNNNNNNN.NNNNNNNN.NNNNNNNN]].[[e|EE]][[h|HHHHHH]]
</pre>

## Abschnitt 6: Kommunikationsdiagramm

`:::seq` zeichnet e Diagramm mit zwei Lebenslinie. SEQ- un ACK-Nummern sowie die Zähler an de Lebenslinie werde aus Flags un Nutzdate (`"…"`) berechnet. `-x` statt `->` lässt e Segment verlore gehe, `seq=…` iwwerschreibt e Nummer (z.B. bei ere Neuübertragung).

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

Mit `:::quiz seq` werde `?` (vor de Flags, oder `seq=?` / `ack=?`) zu Eingabefelder; `hide: counters` blendet die Zähler aus:

:::quiz seq
Client -> Server: SYN
Server -> Client: ? SYN, ACK ack=?
Client -> Server: ? ACK ack=?
Client -> Server: PSH, ACK "Hello World"
Server -> Client: ACK ack=?
:::

:::evaluate
Diagramm prüfe
:::
