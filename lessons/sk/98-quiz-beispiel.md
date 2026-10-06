# Ihrisko — Markdown a kvíz (testovacia stránka)

[[toc]]

Táto stránka slúži na testovanie syntaxe Markdown a interaktívnych typov otázok.

---

## Syntax Markdown

### Formátovanie textu

**Tučné**, *kurzíva*, ~~prečiarknuté~~, `Inline-Code` a **_kombinované_**.

Normálny odsek s [odkazom na inú stránku](01-einfuehrung.html) a [externým odkazom](https://www.beavertracer.eu).

### Nadpisy

Úrovne H2–H4 sa automaticky zobrazujú v obsahu (TOC).

#### Toto je H4 — v TOC sa nezobrazí

### Zoznamy

Neusporiadaný:

- Ethernet
- IP
- TCP
  - HTTP
  - SMTP

Usporiadaný:

1. Režim úprav: vytvoriť topológiu
2. Režim spustenia: spustiť simuláciu
3. Režim stopy: analyzovať pakety

### Tabuľka

| Protokol | Vrstva | Port |
|-----------|---------|------|
| HTTP      | 7       | 80   |
| HTTPS     | 7       | 443  |
| DNS       | 7       | 53   |
| TCP       | 4       | —    |

### Kód

Inline: `ping 192.168.0.1`

Blok:

```
$ ping 192.168.0.2
PING 192.168.0.2: 56 data bytes
64 bytes from 192.168.0.2: icmp_seq=0 ttl=64 time=0.4 ms
```

### Callouty

:::note
Toto je callout **note** — pre neutrálne poznámky a doplňujúce informácie.
:::

:::tip
Toto je callout **tip** — pre užitočné tipy a odporúčania.
:::

:::warning
Toto je callout **warning** — pre upozornenia, ktoré si vyžadujú pozornosť.
:::

:::danger
Toto je callout **danger** — pre kritické zdroje chýb.
:::

:::draft
:::

### Ikony

Font Awesome Solid: :fa-play: :fa-stop: :fa-desktop: :fa-shield-halved: :fa-wifi:

Font Awesome Regular: :far-file: :far-circle:

Symboly zariadení: :router: :switch:

### Vložená simulácia

:::sim
url=/sims/demo.btsim
:::

### Úloha s kontrolou správania

:::task
title: Prepojiť PC 1 a PC 2
Skontroluj, či má PC 1 (id 9) IP adresu v sieti 192.168.0.0/24 a či dokáže dosiahnuť PC 2 (id 11).
check: ip(9, "192.168.0.0/24")
check: pingOk(9, 11)
:::

---

## Referenčný model OSI: farebná schéma

Príklad dúhovo zvýrazneej tabuľky (vrstva 1 dole, ako v zásobníku) a „semafora" na okraji stránky s obtekaním textu.

### Farebná tabuľka

<table class="osi-table">
<thead>
<tr><th>Vrstva</th><th>Názov</th><th>Príklady protokolov</th></tr>
</thead>
<tbody>
<tr class="osi-l7"><td>7</td><td>Aplikačná</td><td>HTTP, DNS, SMTP</td></tr>
<tr class="osi-l6"><td>6</td><td>Prezentačná</td><td>TLS, JPEG, ASCII</td></tr>
<tr class="osi-l5"><td>5</td><td>Relačná</td><td>RPC, NetBIOS</td></tr>
<tr class="osi-l4"><td>4</td><td>Transportná</td><td>TCP, UDP</td></tr>
<tr class="osi-l3"><td>3</td><td>Sieťová</td><td>IP, ICMP</td></tr>
<tr class="osi-l2"><td>2</td><td>Linková</td><td>Ethernet, ARP</td></tr>
<tr class="osi-l1"><td>1</td><td>Fyzická</td><td>Meď, optické vlákno, WLAN</td></tr>
</tbody>
</table>

### Semafor s obtekaním textu

Semafor sa vytvára pomocou `:::osi N`, kde `N` je vrstva, ktorá sa má zvýrazniť (tu vrstva 3). Pláva na okraji a nasledujúci text ho automaticky obteká.

:::osi 3
:::

Lorem ipsum dolor sit amet, consetetur sadipscing elitr, sed diam nonumy eirmod tempor invidunt ut labore et dolore magna aliquyam erat, sed diam voluptua. At vero eos et accusam et justo duo dolores et ea rebum. Stet clita kasd gubergren, no sea takimata sanctus est Lorem ipsum dolor sit amet.

Lorem ipsum dolor sit amet, consetetur sadipscing elitr, sed diam nonumy eirmod tempor invidunt ut labore et dolore magna aliquyam erat, sed diam voluptua. At vero eos et accusam et justo duo dolores et ea rebum, vďaka čomu je tento odsek obsahovo priradený k sieťovej vrstve (vrstva 3) — preto je v semafore farebne zvýraznený práve tento box, všetky ostatné zostávajú sivé.

---

## Časť 1: Základné pojmy

:::quiz short
Aký je zápis masky podsiete 255.255.255.0 v notácii CIDR?
= /24
= 24
:::

:::quiz mc
Ktorá z nasledujúcich adries je adresa siete pre 192.168.1.42/24?
- [ ] 192.168.1.42
- [x] 192.168.1.0
- [ ] 192.168.1.255
- [ ] 192.168.0.0
:::

:::quiz fill
Adresu siete získame bitovou operáciou {AND} medzi IP adresou a {maskou podsiete}. Najvyššia adresa v podsieti je {broadcastová} adresa.
:::

:::evaluate
Skontrolovať časť 1
:::

---

## Časť 2: Priradenie — protokoly a ich úlohy

:::quiz match
ARP -> Zisťuje MAC adresu k IP adrese
DNS -> Prekladá názvy hostiteľov na IP adresy
DHCP -> Automaticky prideľuje IP adresy klientom
ICMP -> Používa ho ping a traceroute
:::

:::evaluate
Skontrolovať časť 2
:::

---

## Časť 3: Subnetting

:::quiz short
Koľko použiteľných adries hostiteľov má podsieť /30?
= 2
:::

:::quiz mc
Na čo sa typicky používa podsieť /30?
- [ ] Pre veľké kancelárske siete s mnohými zariadeniami
- [ ] Ako rozsah adries pre DHCP pooly
- [x] Ako prepojovacia sieť medzi dvoma smerovačmi
- [ ] Pre WLAN prístupové body
:::

:::quiz fill
Podsieť /25 má {128} adries, z toho {126} je použiteľných pre hostiteľov.
:::

:::quiz match
/24 -> 254 použiteľných adries hostiteľov
/25 -> 126 použiteľných adries hostiteľov
/28 -> 14 použiteľných adries hostiteľov
/30 -> 2 použiteľné adresy hostiteľov
:::

:::evaluate
Skontrolovať časť 3
:::

## Časť 4: Viacnásobný výber a náhodné úlohy

Pri `:::quiz multi` môže byť správnych ľubovoľne veľa odpovedí — každé tvrdenie sa hodnotí samostatne:

:::quiz multi
Ktoré tvrdenia o ARP sú pravdivé?
- [x] ARP zisťuje k IP adrese MAC adresu
- [ ] ARP zisťuje k názvu IP adresu
- [x] ARP požiadavka je broadcast
- [ ] ARP odpoveď je broadcast
:::

`:::quiz random <typ>` vytvára pri každom zobrazení nové úlohy (`count=N` určuje počet). Typy: `bin2dec`, `dec2bin`, `cidr2mask`, `hosts`, `netbcast`, `samenet`, `subnet`.

:::quiz random dec2bin
count=2
:::

:::quiz random netbcast
Vypočítaj pre nasledujúcu adresu:
:::

:::quiz random samenet
count=3
:::

:::quiz random subnet
:::

:::evaluate
Skontrolovať časť 4
:::

## Časť 4b: Tabuľka na vyplnenie

`:::quiz table` — bežná tabuľka Markdown, bunky `{odpoveď}` sa menia na vstupné polia (varianty oddeľ znakom `|`):

:::quiz table
Rozdeľ `192.168.42.0/24` na dve podsiete:
| Podsieť | Adresa siete | Broadcastová adresa |
|---|---|---|
| 1 | {192.168.42.0} | {192.168.42.127} |
| 2 | {192.168.42.128} | {192.168.42.255} |
:::

:::evaluate
Skontrolovať tabuľku
:::

## Časť 5: Farebné označenie bitov

Pre kapitoly o IP a subnettingu: `[[n|…]]` = sieťová časť, `[[e|…]]` = rozšírenie, `[[h|…]]` = hostiteľská časť — v plynulom texte aj v tabuľkách:

[[n|11111111.11111111.11111111]].[[e|11]][[h|000000]] = `255.255.255.192`

Pre viacriadkové zobrazenia použi namiesto ``` blok `<pre class="bits-block">` (v blokoch kódu by sa farby nezobrazili):

<pre class="bits-block">
predtým (/24):  [[n|NNNNNNNN.NNNNNNNN.NNNNNNNN]].[[h|HHHHHHHH]]
potom   (/26):  [[n|NNNNNNNN.NNNNNNNN.NNNNNNNN]].[[e|EE]][[h|HHHHHH]]
</pre>

## Časť 6: Diagram komunikácie

`:::seq` nakreslí diagram s dvoma čiarami života. Čísla SEQ a ACK, ako aj počítadlá na čiarach života sa vypočítajú z príznakov a užitočných dát (`"…"`). `-x` namiesto `->` spôsobí stratu segmentu, `seq=…` prepíše číslo (napr. pri opakovanom prenesení).

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

Pri `:::quiz seq` sa `?` (pred príznakmi, alebo `seq=?` / `ack=?`) menia na vstupné polia; `hide: counters` skryje počítadlá:

:::quiz seq
Client -> Server: SYN
Server -> Client: ? SYN, ACK ack=?
Client -> Server: ? ACK ack=?
Client -> Server: PSH, ACK "Hello World"
Server -> Client: ACK ack=?
:::

:::evaluate
Skontrolovať diagram
:::
