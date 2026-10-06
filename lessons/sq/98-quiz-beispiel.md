# Fusha e lojës — Markdown & kuiz (faqe testimi)

[[toc]]

Kjo faqe shërben për të testuar sintaksën Markdown dhe llojet interaktive të pyetjeve.

---

## Sintaksa Markdown

### Formatimi i tekstit

**I theksuar**, *kursiv*, ~~i hequr me vijë~~, `Inline-Code`, dhe **_i kombinuar_**.

Paragraf normal me një [lidhje te një faqe tjetër](01-einfuehrung.html) dhe një [lidhje të jashtme](https://www.beavertracer.eu).

### Titujt

Nivelet H2–H4 shfaqen automatikisht në përmbajtjen (TOC).

#### Ky është H4 — nuk shfaqet në TOC

### Listat

Pa renditje:

- Ethernet
- IP
- TCP
  - HTTP
  - SMTP

Me renditje:

1. Modaliteti i redaktimit: ndërto topologjinë
2. Modaliteti i ekzekutimit: nis simulimin
3. Modaliteti i gjurmimit: analizo paketat

### Tabela

| Protokolli | Shtresa | Porta |
|-----------|---------|------|
| HTTP      | 7       | 80   |
| HTTPS     | 7       | 443  |
| DNS       | 7       | 53   |
| TCP       | 4       | —    |

### Kodi

Inline: `ping 192.168.0.1`

Bllok:

```
$ ping 192.168.0.2
PING 192.168.0.2: 56 data bytes
64 bytes from 192.168.0.2: icmp_seq=0 ttl=64 time=0.4 ms
```

### Callout-et

:::note
Ky është një callout **note** — për shënime neutrale dhe informacione plotësuese.
:::

:::tip
Ky është një callout **tip** — për këshilla të dobishme dhe rekomandime.
:::

:::warning
Ky është një callout **warning** — për paralajmërime që kërkojnë vëmendje.
:::

:::danger
Ky është një callout **danger** — për burime kritike gabimesh.
:::

:::draft
:::

### Ikonat

Font Awesome Solid: :fa-play: :fa-stop: :fa-desktop: :fa-shield-halved: :fa-wifi:

Font Awesome Regular: :far-file: :far-circle:

Simbolet e pajisjeve: :router: :switch:

### Simulim i integruar

:::sim
url=/sims/demo.btsim
:::

### Detyrë me kontroll të sjelljes

:::task
title: Lidh PC 1 dhe PC 2
Kontrollo nëse PC 1 (id 9) ka një IP në rrjetin 192.168.0.0/24 dhe mund të arrijë PC 2 (id 11).
check: ip(9, "192.168.0.0/24")
check: pingOk(9, 11)
:::

---

## Modeli referues OSI: skema e ngjyrave

Shembull i një tabele të theksuar me ngjyrat e ylberit (shtresa 1 poshtë, si në stek) si dhe një "semafor" në anë të faqes me rrjedhje të tekstit përreth.

### Tabelë me ngjyra

<table class="osi-table">
<thead>
<tr><th>Shtresa</th><th>Emri</th><th>Protokolle shembull</th></tr>
</thead>
<tbody>
<tr class="osi-l7"><td>7</td><td>Aplikacioni</td><td>HTTP, DNS, SMTP</td></tr>
<tr class="osi-l6"><td>6</td><td>Prezantimi</td><td>TLS, JPEG, ASCII</td></tr>
<tr class="osi-l5"><td>5</td><td>Sesioni</td><td>RPC, NetBIOS</td></tr>
<tr class="osi-l4"><td>4</td><td>Transporti</td><td>TCP, UDP</td></tr>
<tr class="osi-l3"><td>3</td><td>Rrjeti</td><td>IP, ICMP</td></tr>
<tr class="osi-l2"><td>2</td><td>Lidhja e të dhënave</td><td>Ethernet, ARP</td></tr>
<tr class="osi-l1"><td>1</td><td>Shtresa fizike</td><td>Bakër, fibër optike, WLAN</td></tr>
</tbody>
</table>

### Semafori me rrjedhje të tekstit

Semafori krijohet me `:::osi N`, ku `N` është shtresa që duhet theksuar (këtu shtresa 3). Ai noton në anë, ndërsa teksti që vijon rrjedh automatikisht pranë tij.

:::osi 3
:::

Lorem ipsum dolor sit amet, consetetur sadipscing elitr, sed diam nonumy eirmod tempor invidunt ut labore et dolore magna aliquyam erat, sed diam voluptua. At vero eos et accusam et justo duo dolores et ea rebum. Stet clita kasd gubergren, no sea takimata sanctus est Lorem ipsum dolor sit amet.

Lorem ipsum dolor sit amet, consetetur sadipscing elitr, sed diam nonumy eirmod tempor invidunt ut labore et dolore magna aliquyam erat, sed diam voluptua. At vero eos et accusam et justo duo dolores et ea rebum, ku ky seksion i përket nga përmbajtja shtresës së rrjetit (Layer 3) — prandaj pikërisht ky kuti në semafor është me ngjyrë, ndërsa të gjitha të tjerat mbeten gri.

---

## Seksioni 1: Konceptet bazë

:::quiz short
Cili është shënimi CIDR i maskës së nënrrjetit 255.255.255.0?
= /24
= 24
:::

:::quiz mc
Cila nga adresat e mëposhtme është adresa e rrjetit e 192.168.1.42/24?
- [ ] 192.168.1.42
- [x] 192.168.1.0
- [ ] 192.168.1.255
- [ ] 192.168.0.0
:::

:::quiz fill
Adresa e rrjetit merret me një lidhje bit-pas-biti {AND} të adresës IP dhe {maskës së nënrrjetit}. Adresa më e lartë në nënrrjet është adresa {broadcast}.
:::

:::evaluate
Kontrollo seksionin 1
:::

---

## Seksioni 2: Përshtatja — protokollet dhe detyrat e tyre

:::quiz match
ARP -> Gjen adresën MAC për një adresë IP
DNS -> Zgjidh emrat e hosteve në adresa IP
DHCP -> Cakton automatikisht adresa IP për klientët
ICMP -> Përdoret nga ping dhe traceroute
:::

:::evaluate
Kontrollo seksionin 2
:::

---

## Seksioni 3: Nënrrjetëzimi

:::quiz short
Sa adresa hosti të përdorshme ka një nënrrjet /30?
= 2
:::

:::quiz mc
Për çfarë përdoret zakonisht një nënrrjet /30?
- [ ] Për rrjete të mëdha zyrash me shumë pajisje
- [ ] Si diapazon adresash për grupet DHCP
- [x] Si rrjet lidhës mes dy router-ave
- [ ] Për pikat e qasjes WLAN
:::

:::quiz fill
Një nënrrjet /25 ka {128} adresa, nga të cilat {126} janë të përdorshme për hostet.
:::

:::quiz match
/24 -> 254 adresa hosti të përdorshme
/25 -> 126 adresa hosti të përdorshme
/28 -> 14 adresa hosti të përdorshme
/30 -> 2 adresa hosti të përdorshme
:::

:::evaluate
Kontrollo seksionin 3
:::

## Seksioni 4: Zgjedhje e shumëfishtë dhe detyra të rastësishme

Te `:::quiz multi` çdo numër përgjigjesh mund të jetë i saktë — çdo pohim vlerësohet veçmas:

:::quiz multi
Cilat pohime për ARP janë të sakta?
- [x] ARP gjen adresën MAC për një adresë IP
- [ ] ARP gjen adresën IP për një emër
- [x] Një kërkesë ARP është broadcast
- [ ] Një përgjigje ARP është broadcast
:::

`:::quiz random <typ>` krijon detyra të reja çdo herë që thirret (`count=N` përcakton numrin). Llojet: `bin2dec`, `dec2bin`, `cidr2mask`, `hosts`, `netbcast`, `samenet`, `subnet`.

:::quiz random dec2bin
count=2
:::

:::quiz random netbcast
Llogarit për adresën e mëposhtme:
:::

:::quiz random samenet
count=3
:::

:::quiz random subnet
:::

:::evaluate
Kontrollo seksionin 4
:::

## Seksioni 4b: Tabelë për plotësim

`:::quiz table` — një tabelë normale Markdown, qelizat `{Antwort}` bëhen fusha hyrjeje (variantet ndaji me `|`):

:::quiz table
Ndaje `192.168.42.0/24` në dy nënrrjete:
| Nënrrjeti | Adresa e rrjetit | Adresa e transmetimit (broadcast) |
|---|---|---|
| 1 | {192.168.42.0} | {192.168.42.127} |
| 2 | {192.168.42.128} | {192.168.42.255} |
:::

:::evaluate
Kontrollo tabelën
:::

## Seksioni 5: Ngjyrosja e biteve

Për kapitujt e IP-së dhe të nënrrjetëzimit: `[[n|…]]` = Pjesa e rrjetit, `[[e|…]]` = zgjerimi, `[[h|…]]` = Pjesa e hostit — në tekstin e vazhdueshëm dhe në tabela:

[[n|11111111.11111111.11111111]].[[e|11]][[h|000000]] = `255.255.255.192`

Për paraqitje shumërreshtore, në vend të ``` përdor një bllok `<pre class="bits-block">` (në blloqet e kodit ngjyrat nuk do të shfaqeshin):

<pre class="bits-block">
vorher  (/24):  [[n|NNNNNNNN.NNNNNNNN.NNNNNNNN]].[[h|HHHHHHHH]]
nachher (/26):  [[n|NNNNNNNN.NNNNNNNN.NNNNNNNN]].[[e|EE]][[h|HHHHHH]]
</pre>

## Seksioni 6: Diagrami i komunikimit

`:::seq` vizaton një diagram me dy vija jete. Numrat SEQ dhe ACK si dhe numëruesit te vijat e jetës llogariten nga flamujt dhe të dhënat e dobishme (`"…"`). `-x` në vend të `->` bën që një segment të humbasë, `seq=…` mbishkruan një numër (p.sh. gjatë një ritransmetimi).

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

Me `:::quiz seq` simbolet `?` (para flamujve, ose `seq=?` / `ack=?`) bëhen fusha hyrjeje; `hide: counters` fsheh numëruesit:

:::quiz seq
Client -> Server: SYN
Server -> Client: ? SYN, ACK ack=?
Client -> Server: ? ACK ack=?
Client -> Server: PSH, ACK "Hello World"
Server -> Client: ACK ack=?
:::

:::evaluate
Kontrollo diagramin
:::
