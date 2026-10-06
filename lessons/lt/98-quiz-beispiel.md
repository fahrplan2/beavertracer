# Žaidimų aikštelė — Markdown ir viktorinos (bandomasis puslapis)

[[toc]]

Šis puslapis skirtas Markdown sintaksei ir interaktyviems klausimų tipams išbandyti.

---

## Markdown sintaksė

### Teksto formatavimas

**Paryškintas**, *kursyvas*, ~~perbrauktas~~, `Inline-Code`, ir **_derinys_**.

Įprasta pastraipa su [nuoroda į kitą puslapį](01-einfuehrung.html) ir [išorine nuoroda](https://www.beavertracer.eu).

### Antraštės

H2–H4 lygiai automatiškai rodomi turinyje (TOC).

#### Tai H4 — turinyje nerodoma

### Sąrašai

Nenumeruotas:

- Ethernet
- IP
- TCP
  - HTTP
  - SMTP

Numeruotas:

1. Redagavimo režimas: sukurti topologiją
2. Vykdymo režimas: paleisti simuliaciją
3. Sekimo režimas: analizuoti paketus

### Lentelė

| Protokolas | Lygmuo | Prievadas |
|-----------|---------|------|
| HTTP      | 7       | 80   |
| HTTPS     | 7       | 443  |
| DNS       | 7       | 53   |
| TCP       | 4       | —    |

### Kodas

Eilutėje: `ping 192.168.0.1`

Blokas:

```
$ ping 192.168.0.2
PING 192.168.0.2: 56 data bytes
64 bytes from 192.168.0.2: icmp_seq=0 ttl=64 time=0.4 ms
```

### Pastabų blokai

:::note
Tai **note** blokas — neutralioms pastaboms ir papildomai informacijai.
:::

:::tip
Tai **tip** blokas — naudingiems patarimams ir rekomendacijoms.
:::

:::warning
Tai **warning** blokas — įspėjimams, kuriems reikia dėmesio.
:::

:::danger
Tai **danger** blokas — kritiniams klaidų šaltiniams.
:::

:::draft
:::

### Piktogramos

Font Awesome Solid: :fa-play: :fa-stop: :fa-desktop: :fa-shield-halved: :fa-wifi:

Font Awesome Regular: :far-file: :far-circle:

Įrenginių simboliai: :router: :switch:

### Įterpta simuliacija

:::sim
url=/sims/demo.btsim
:::

### Užduotis su elgsenos patikra

:::task
title: Sujungti PC 1 ir PC 2
Patikrink, ar PC 1 (id 9) turi IP tinkle 192.168.0.0/24 ir gali pasiekti PC 2 (id 11).
check: ip(9, "192.168.0.0/24")
check: pingOk(9, 11)
:::

---

## OSI atskaitos modelis: spalvų schema

Vaivorykštės spalvomis paryškintos lentelės pavyzdys (1 lygmuo apačioje, kaip steke) ir „šviesoforas" puslapio krašte su teksto apvyniojimu.

### Spalvota lentelė

<table class="osi-table">
<thead>
<tr><th>Lygmuo</th><th>Pavadinimas</th><th>Protokolų pavyzdžiai</th></tr>
</thead>
<tbody>
<tr class="osi-l7"><td>7</td><td>Taikomųjų programų</td><td>HTTP, DNS, SMTP</td></tr>
<tr class="osi-l6"><td>6</td><td>Pateikimo</td><td>TLS, JPEG, ASCII</td></tr>
<tr class="osi-l5"><td>5</td><td>Seanso</td><td>RPC, NetBIOS</td></tr>
<tr class="osi-l4"><td>4</td><td>Transporto</td><td>TCP, UDP</td></tr>
<tr class="osi-l3"><td>3</td><td>Tinklo</td><td>IP, ICMP</td></tr>
<tr class="osi-l2"><td>2</td><td>Kanalo</td><td>Ethernet, ARP</td></tr>
<tr class="osi-l1"><td>1</td><td>Fizinis</td><td>Varis, optinis kabelis, WLAN</td></tr>
</tbody>
</table>

### Šviesoforas su teksto apvyniojimu

Šviesoforas sukuriamas naudojant `:::osi N`, kur `N` yra paryškintinas lygmuo (čia 3 lygmuo). Jis plūduriuoja krašte, o tolesnis tekstas automatiškai teka aplink jį.

:::osi 3
:::

Lorem ipsum dolor sit amet, consetetur sadipscing elitr, sed diam nonumy eirmod tempor invidunt ut labore et dolore magna aliquyam erat, sed diam voluptua. At vero eos et accusam et justo duo dolores et ea rebum. Stet clita kasd gubergren, no sea takimata sanctus est Lorem ipsum dolor sit amet.

Lorem ipsum dolor sit amet, consetetur sadipscing elitr, sed diam nonumy eirmod tempor invidunt ut labore et dolore magna aliquyam erat, sed diam voluptua. At vero eos et accusam et justo duo dolores et ea rebum, todėl šis skyrius pagal turinį priskiriamas Tinklo lygmeniui (Layer 3) — būtent todėl šviesoforo langelis yra spalvotas, o visi kiti lieka pilki.

---

## 1 skyrius: pagrindinės sąvokos

:::quiz short
Koks yra potinklio kaukės 255.255.255.0 CIDR žymėjimas?
= /24
= 24
:::

:::quiz mc
Kuris iš šių adresų yra 192.168.1.42/24 tinklo adresas?
- [ ] 192.168.1.42
- [x] 192.168.1.0
- [ ] 192.168.1.255
- [ ] 192.168.0.0
:::

:::quiz fill
Tinklo adresas gaunamas atliekant bitų {AND} operaciją tarp IP adreso ir {potinklio kaukės}. Didžiausias potinklio adresas yra {transliacijos} adresas.
:::

:::evaluate
Patikrinti 1 skyrių
:::

---

## 2 skyrius: priskyrimas — protokolai ir jų paskirtis

:::quiz match
ARP -> Nustato IP adresą atitinkantį MAC adresą
DNS -> Išsprendžia mazgų vardus į IP adresus
DHCP -> Automatiškai skiria IP adresus klientams
ICMP -> Naudojamas ping ir traceroute komandose
:::

:::evaluate
Patikrinti 2 skyrių
:::

---

## 3 skyrius: potinklių skaičiavimas

:::quiz short
Kiek naudojamų mazgų adresų turi /30 potinklis?
= 2
:::

:::quiz mc
Kam paprastai naudojamas /30 potinklis?
- [ ] Dideliems biurų tinklams su daug įrenginių
- [ ] Kaip adresų diapazonas DHCP telkiniams
- [x] Kaip jungiamasis tinklas tarp dviejų maršrutizatorių
- [ ] WLAN prieigos taškams
:::

:::quiz fill
/25 potinklis turi {128} adresų, iš kurių mazgams naudojami {126}.
:::

:::quiz match
/24 -> 254 naudojami mazgų adresai
/25 -> 126 naudojami mazgų adresai
/28 -> 14 naudojami mazgų adresai
/30 -> 2 naudojami mazgų adresai
:::

:::evaluate
Patikrinti 3 skyrių
:::

## 4 skyrius: keli teisingi atsakymai ir atsitiktinės užduotys

Naudojant `:::quiz multi`, teisingi gali būti bet kuris atsakymų skaičius — kiekvienas teiginys vertinamas atskirai:

:::quiz multi
Kurie teiginiai apie ARP yra teisingi?
- [x] ARP nustato IP adresą atitinkantį MAC adresą
- [ ] ARP nustato vardą atitinkantį IP adresą
- [x] ARP užklausa yra transliacija
- [ ] ARP atsakas yra transliacija
:::

`:::quiz random <tipas>` kiekvieną kartą sukuria naujas užduotis (`count=N` nustato jų skaičių). Tipai: `bin2dec`, `dec2bin`, `cidr2mask`, `hosts`, `netbcast`, `samenet`, `subnet`.

:::quiz random dec2bin
count=2
:::

:::quiz random netbcast
Apskaičiuok šiam adresui:
:::

:::quiz random samenet
count=3
:::

:::quiz random subnet
:::

:::evaluate
Patikrinti 4 skyrių
:::

## 4b skyrius: lentelė užpildyti

`:::quiz table` — įprasta Markdown lentelė, `{atsakymas}` langeliai tampa įvesties laukais (variantus atskirk `|`):

:::quiz table
Padalyk `192.168.42.0/24` į du potinklius:
| Potinklis | Tinklo adresas | Transliacijos adresas |
|---|---|---|
| 1 | {192.168.42.0} | {192.168.42.127} |
| 2 | {192.168.42.128} | {192.168.42.255} |
:::

:::evaluate
Patikrinti lentelę
:::

## 5 skyrius: bitų spalvinimas

IP ir potinklių skyriams: `[[n|…]]` = tinklo dalis, `[[e|…]]` = išplėtimas, `[[h|…]]` = mazgo dalis — tekste ir lentelėse:

[[n|11111111.11111111.11111111]].[[e|11]][[h|000000]] = `255.255.255.192`

Kelių eilučių vaizdavimui vietoj ``` naudok `<pre class="bits-block">` bloką (kodo blokuose spalvos nebūtų rodomos):

<pre class="bits-block">
prieš   (/24):  [[n|NNNNNNNN.NNNNNNNN.NNNNNNNN]].[[h|HHHHHHHH]]
po      (/26):  [[n|NNNNNNNN.NNNNNNNN.NNNNNNNN]].[[e|EE]][[h|HHHHHH]]
</pre>

## 6 skyrius: Komunikacijos diagrama

`:::seq` nubraižo diagramą su dviem gyvavimo linijomis. SEQ ir ACK numeriai bei skaitikliai prie gyvavimo linijų apskaičiuojami iš vėliavėlių ir naudingųjų duomenų (`"…"`). `-x` vietoj `->` reiškia, kad segmentas pasimeta, `seq=…` pakeičia numerį (pvz., pakartotinio siuntimo atveju).

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

Naudojant `:::quiz seq`, `?` (prieš vėliavėles arba `seq=?` / `ack=?`) tampa įvesties laukais; `hide: counters` paslepia skaitiklius:

:::quiz seq
Client -> Server: SYN
Server -> Client: ? SYN, ACK ack=?
Client -> Server: ? ACK ack=?
Client -> Server: PSH, ACK "Hello World"
Server -> Client: ACK ack=?
:::

:::evaluate
Patikrinti diagramą
:::
