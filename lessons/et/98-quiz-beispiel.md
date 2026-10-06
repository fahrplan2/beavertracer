# Mänguväljak — Markdown ja viktoriin (testleht)

[[toc]]

See leht on mõeldud Markdowni süntaksi ja interaktiivsete küsimuste tüüpide testimiseks.

---

## Markdowni süntaks

### Teksti vormindamine

**Rasvane**, *kursiiv*, ~~läbikriipsutatud~~, `Inline-Code`, ja **_kombineeritud_**.

Tavaline lõik koos [lingiga teisele lehele](01-einfuehrung.html) ja [välise lingiga](https://www.beavertracer.eu).

### Pealkirjad

Tasemed H2–H4 ilmuvad automaatselt sisukorda (TOC).

#### See on H4 — sisukorras ei kuvata

### Loendid

Järjestamata:

- Ethernet
- IP
- TCP
  - HTTP
  - SMTP

Järjestatud:

1. Redigeerimisrežiim: topoloogia ehitamine
2. Käivitusrežiim: simulatsiooni käivitamine
3. Jälgimisrežiim: pakettide analüüsimine

### Tabel

| Protokoll | Kiht | Port |
|-----------|---------|------|
| HTTP      | 7       | 80   |
| HTTPS     | 7       | 443  |
| DNS       | 7       | 53   |
| TCP       | 4       | —    |

### Kood

Inline: `ping 192.168.0.1`

Plokk:

```
$ ping 192.168.0.2
PING 192.168.0.2: 56 data bytes
64 bytes from 192.168.0.2: icmp_seq=0 ttl=64 time=0.4 ms
```

### Märkuseplokid

:::note
See on **note**-plokk — neutraalsete märkuste ja täiendava teabe jaoks.
:::

:::tip
See on **tip**-plokk — kasulike näpunäidete ja soovituste jaoks.
:::

:::warning
See on **warning**-plokk — hoiatuste jaoks, mis nõuavad tähelepanu.
:::

:::danger
See on **danger**-plokk — kriitiliste veaallikate jaoks.
:::

:::draft
:::

### Ikoonid

Font Awesome Solid: :fa-play: :fa-stop: :fa-desktop: :fa-shield-halved: :fa-wifi:

Font Awesome Regular: :far-file: :far-circle:

Seadmesümbolid: :router: :switch:

### Põimitud simulatsioon

:::sim
url=/sims/demo.btsim
:::

### Ülesanne käitumiskontrolliga

:::task
title: Ühenda PC 1 ja PC 2
Kontrolli, kas PC 1 (id 9) -l on IP võrgus 192.168.0.0/24 ja kas see ulatub PC 2 (id 11) -ni.
check: ip(9, "192.168.0.0/24")
check: pingOk(9, 11)
:::

---

## OSI võrdlusmudel: värviskeem

Näide vikerkaarevärvides esiletõstetud tabelist (kiht 1 all, nagu virnas) ning "valgusfoorist" lehe veerises koos teksti ümbervooluga.

### Värviline tabel

<table class="osi-table">
<thead>
<tr><th>Kiht</th><th>Nimi</th><th>Näidisprotokollid</th></tr>
</thead>
<tbody>
<tr class="osi-l7"><td>7</td><td>Rakendus</td><td>HTTP, DNS, SMTP</td></tr>
<tr class="osi-l6"><td>6</td><td>Esitus</td><td>TLS, JPEG, ASCII</td></tr>
<tr class="osi-l5"><td>5</td><td>Seanss</td><td>RPC, NetBIOS</td></tr>
<tr class="osi-l4"><td>4</td><td>Transport</td><td>TCP, UDP</td></tr>
<tr class="osi-l3"><td>3</td><td>Võrk</td><td>IP, ICMP</td></tr>
<tr class="osi-l2"><td>2</td><td>Lüli</td><td>Ethernet, ARP</td></tr>
<tr class="osi-l1"><td>1</td><td>Füüsiline</td><td>Vask, klaaskiud, WLAN</td></tr>
</tbody>
</table>

### Valgusfoor teksti ümbervooluga

Valgusfoor luuakse käsuga `:::osi N`, kus `N` on esiletõstetav kiht (siin kiht 3). See hõljub serva ääres ja järgnev tekst voolab sellest automaatselt mööda.

:::osi 3
:::

Lorem ipsum dolor sit amet, consetetur sadipscing elitr, sed diam nonumy eirmod tempor invidunt ut labore et dolore magna aliquyam erat, sed diam voluptua. At vero eos et accusam et justo duo dolores et ea rebum. Stet clita kasd gubergren, no sea takimata sanctus est Lorem ipsum dolor sit amet.

Lorem ipsum dolor sit amet, consetetur sadipscing elitr, sed diam nonumy eirmod tempor invidunt ut labore et dolore magna aliquyam erat, sed diam voluptua. At vero eos et accusam et justo duo dolores et ea rebum, mistõttu kuulub see lõik sisuliselt võrgukihti (kiht 3) — seepärast on valgusfooris värviline just see kast, kõik teised jäävad halliks.

---

## Jaotis 1: Põhimõisted

:::quiz short
Mis on alamvõrgumaski 255.255.255.0 CIDR-kirjaviis?
= /24
= 24
:::

:::quiz mc
Milline järgmistest aadressidest on aadressi 192.168.1.42/24 võrguaadress?
- [ ] 192.168.1.42
- [x] 192.168.1.0
- [ ] 192.168.1.255
- [ ] 192.168.0.0
:::

:::quiz fill
Võrguaadressi saab IP-aadressi ja {alamvõrgumaski} bitipõhise {AND}-tehtega. Alamvõrgu kõrgeim aadress on {leviaadress}.
:::

:::evaluate
Kontrolli jaotist 1
:::

---

## Jaotis 2: Sobitamine — protokollid ja nende ülesanded

:::quiz match
ARP -> Leiab IP-aadressile vastava MAC-aadressi
DNS -> Lahendab hostinimed IP-aadressideks
DHCP -> Annab klientidele IP-aadressid automaatselt
ICMP -> Kasutavad ping ja traceroute
:::

:::evaluate
Kontrolli jaotist 2
:::

---

## Jaotis 3: Alamvõrkudeks jagamine

:::quiz short
Mitu kasutatavat hostiaadressi on /30-alamvõrgul?
= 2
:::

:::quiz mc
Milleks kasutatakse tavaliselt /30-alamvõrku?
- [ ] Suurte kontorivõrkude jaoks, kus on palju seadmeid
- [ ] DHCP-vahemike aadressivahemikuna
- [x] Ühendusvõrguna kahe ruuteri vahel
- [ ] WLAN-juurdepääsupunktide jaoks
:::

:::quiz fill
/25-alamvõrgul on {128} aadressi, neist {126} on hostidele kasutatavad.
:::

:::quiz match
/24 -> 254 kasutatavat hostiaadressi
/25 -> 126 kasutatavat hostiaadressi
/28 -> 14 kasutatavat hostiaadressi
/30 -> 2 kasutatavat hostiaadressi
:::

:::evaluate
Kontrolli jaotist 3
:::

## Jaotis 4: Mitmikvalik ja juhuülesanded

`:::quiz multi` puhul võib õigeid vastuseid olla suvaline arv — iga väidet hinnatakse eraldi:

:::quiz multi
Millised väited ARP kohta on õiged?
- [x] ARP leiab IP-aadressile vastava MAC-aadressi
- [ ] ARP leiab nimele vastava IP-aadressi
- [x] ARP-päring on leviedastus
- [ ] ARP-vastus on leviedastus
:::

`:::quiz random <typ>` loob iga avamisega uued ülesanded (`count=N` määrab arvu). Tüübid: `bin2dec`, `dec2bin`, `cidr2mask`, `hosts`, `netbcast`, `samenet`, `subnet`.

:::quiz random dec2bin
count=2
:::

:::quiz random netbcast
Arvuta järgmise aadressi jaoks:
:::

:::quiz random samenet
count=3
:::

:::quiz random subnet
:::

:::evaluate
Kontrolli jaotist 4
:::

## Jaotis 4b: Täitmiseks mõeldud tabel

`:::quiz table` — tavaline Markdowni tabel, `{Antwort}`-lahtritest saavad sisestusväljad (variandid eralda märgiga `|`):

:::quiz table
Jaga `192.168.42.0/24` kaheks alamvõrguks:
| Alamvõrk | Võrguaadress | Leviaadress |
|---|---|---|
| 1 | {192.168.42.0} | {192.168.42.127} |
| 2 | {192.168.42.128} | {192.168.42.255} |
:::

:::evaluate
Kontrolli tabelit
:::

## Jaotis 5: Bittide värvimine

IP- ja alamvõrgustamise peatükkide jaoks: `[[n|…]]` = võrguosa, `[[e|…]]` = laiendus, `[[h|…]]` = hostiosa — jooksvas tekstis ja tabelites:

[[n|11111111.11111111.11111111]].[[e|11]][[h|000000]] = `255.255.255.192`

Mitmerealiste kujutiste jaoks kasuta ``` asemel `<pre class="bits-block">`-plokki (koodiplokkides värve ei kuvata):

<pre class="bits-block">
vorher  (/24):  [[n|NNNNNNNN.NNNNNNNN.NNNNNNNN]].[[h|HHHHHHHH]]
nachher (/26):  [[n|NNNNNNNN.NNNNNNNN.NNNNNNNN]].[[e|EE]][[h|HHHHHH]]
</pre>

## Jaotis 6: Järjestusdiagramm

`:::seq` joonistab diagrammi kahe elujoonega. SEQ- ja ACK-numbrid ning elujoonte loendurid arvutatakse lippudest ja kasuliku koormuse andmetest (`"…"`). `-x` märgi `->` asemel laseb segmendi kaduda, `seq=…` kirjutab numbri üle (nt uuesti edastamise korral).

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

`:::quiz seq` puhul muutuvad `?` (lippude ees või `seq=?` / `ack=?`) sisestusväljadeks; `hide: counters` peidab loendurid:

:::quiz seq
Client -> Server: SYN
Server -> Client: ? SYN, ACK ack=?
Client -> Server: ? ACK ack=?
Client -> Server: PSH, ACK "Hello World"
Server -> Client: ACK ack=?
:::

:::evaluate
Kontrolli diagrammi
:::
