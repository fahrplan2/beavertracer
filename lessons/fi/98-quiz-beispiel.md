# Leikkikenttä — Markdown ja tietovisa (testisivu)

[[toc]]

Tämä sivu on tarkoitettu Markdown-syntaksin ja interaktiivisten kysymystyyppien testaamiseen.

---

## Markdown-syntaksi

### Tekstin muotoilu

**Lihavoitu**, *kursivoitu*, ~~yliviivattu~~, `Inline-Code`, ja **_yhdistettynä_**.

Tavallinen kappale, jossa on [linkki toiselle sivulle](01-einfuehrung.html) ja [ulkoinen linkki](https://www.beavertracer.eu).

### Otsikot

Tasot H2–H4 näkyvät automaattisesti sisällysluettelossa (TOC).

#### Tämä on H4 — se ei näy sisällysluettelossa

### Luettelot

Järjestämätön:

- Ethernet
- IP
- TCP
  - HTTP
  - SMTP

Järjestetty:

1. Muokkaustila: rakenna topologia
2. Suoritustila: käynnistä simulaatio
3. Jäljitystila: analysoi paketteja

### Taulukko

| Protokolla | Kerros | Portti |
|-----------|---------|------|
| HTTP      | 7       | 80   |
| HTTPS     | 7       | 443  |
| DNS       | 7       | 53   |
| TCP       | 4       | —    |

### Koodi

Rivinsisäinen: `ping 192.168.0.1`

Lohko:

```
$ ping 192.168.0.2
PING 192.168.0.2: 56 data bytes
64 bytes from 192.168.0.2: icmp_seq=0 ttl=64 time=0.4 ms
```

### Huomautuslaatikot

:::note
Tämä on **note**-huomautus — neutraaleja vihjeitä ja lisätietoja varten.
:::

:::tip
Tämä on **tip**-huomautus — hyödyllisiä vinkkejä ja suosituksia varten.
:::

:::warning
Tämä on **warning**-huomautus — varoituksia varten, jotka vaativat huomiota.
:::

:::danger
Tämä on **danger**-huomautus — kriittisiä virhelähteitä varten.
:::

:::draft
:::

### Kuvakkeet

Font Awesome Solid: :fa-play: :fa-stop: :fa-desktop: :fa-shield-halved: :fa-wifi:

Font Awesome Regular: :far-file: :far-circle:

Laitekuvakkeet: :router: :switch:

### Upotettu simulaatio

:::sim
url=/sims/demo.btsim
:::

### Tehtävä käyttäytymistarkistuksella

:::task
title: Yhdistä PC 1 ja PC 2
Tarkista, onko PC 1:llä (id 9) IP-osoite verkossa 192.168.0.0/24 ja tavoittaako se PC 2:n (id 11).
check: ip(9, "192.168.0.0/24")
check: pingOk(9, 11)
:::

---

## OSI-vertailumalli: värimaailma

Esimerkki sateenkaaren väreillä korostetusta taulukosta (kerros 1 alimpana, kuten pinossa) sekä sivureunan "liikennevalo", jonka ympärillä teksti kiertää.

### Värillinen taulukko

<table class="osi-table">
<thead>
<tr><th>Kerros</th><th>Nimi</th><th>Esimerkkiprotokollat</th></tr>
</thead>
<tbody>
<tr class="osi-l7"><td>7</td><td>Sovellus</td><td>HTTP, DNS, SMTP</td></tr>
<tr class="osi-l6"><td>6</td><td>Esitys</td><td>TLS, JPEG, ASCII</td></tr>
<tr class="osi-l5"><td>5</td><td>Istunto</td><td>RPC, NetBIOS</td></tr>
<tr class="osi-l4"><td>4</td><td>Kuljetus</td><td>TCP, UDP</td></tr>
<tr class="osi-l3"><td>3</td><td>Verkko</td><td>IP, ICMP</td></tr>
<tr class="osi-l2"><td>2</td><td>Siirto</td><td>Ethernet, ARP</td></tr>
<tr class="osi-l1"><td>1</td><td>Bittien siirto</td><td>Kupari, valokuitu, WLAN</td></tr>
</tbody>
</table>

### Liikennevalo ja tekstin kierto

Liikennevalo luodaan komennolla `:::osi N`, jossa `N` on korostettava kerros (tässä kerros 3). Se kelluu reunassa, ja sitä seuraava teksti kiertää sen automaattisesti.

:::osi 3
:::

Lorem ipsum dolor sit amet, consetetur sadipscing elitr, sed diam nonumy eirmod tempor invidunt ut labore et dolore magna aliquyam erat, sed diam voluptua. At vero eos et accusam et justo duo dolores et ea rebum. Stet clita kasd gubergren, no sea takimata sanctus est Lorem ipsum dolor sit amet.

Lorem ipsum dolor sit amet, consetetur sadipscing elitr, sed diam nonumy eirmod tempor invidunt ut labore et dolore magna aliquyam erat, sed diam voluptua. At vero eos et accusam et justo duo dolores et ea rebum, minkä vuoksi tämä kappale kuuluu sisällöltään verkkokerrokseen (kerros 3) — siksi juuri tämä ruutu liikennevalossa on värillinen, ja kaikki muut pysyvät harmaina.

---

## Osio 1: Peruskäsitteet

:::quiz short
Mikä on aliverkon maskin 255.255.255.0 CIDR-merkintä?
= /24
= 24
:::

:::quiz mc
Mikä seuraavista osoitteista on osoitteen 192.168.1.42/24 verkko-osoite?
- [ ] 192.168.1.42
- [x] 192.168.1.0
- [ ] 192.168.1.255
- [ ] 192.168.0.0
:::

:::quiz fill
Verkko-osoite saadaan tekemällä IP-osoitteelle ja {aliverkon maskille} bittikohtainen {AND}-operaatio. Aliverkon korkein osoite on {yleislähetys}osoite.
:::

:::evaluate
Tarkista osio 1
:::

---

## Osio 2: Yhdistäminen — protokollat ja niiden tehtävät

:::quiz match
ARP -> Selvittää IP-osoitetta vastaavan MAC-osoitteen
DNS -> Muuntaa isäntänimet IP-osoitteiksi
DHCP -> Jakaa IP-osoitteet asiakkaille automaattisesti
ICMP -> Käyttävät ping ja traceroute
:::

:::evaluate
Tarkista osio 2
:::

---

## Osio 3: Aliverkotus

:::quiz short
Montako käytettävää isäntäosoitetta /30-aliverkossa on?
= 2
:::

:::quiz mc
Mihin /30-aliverkkoa tyypillisesti käytetään?
- [ ] Suuriin toimistoverkkoihin, joissa on paljon laitteita
- [ ] DHCP-poolien osoitealueena
- [x] Yhdysverkkona kahden reitittimen välillä
- [ ] WLAN-tukiasemille
:::

:::quiz fill
/25-aliverkossa on {128} osoitetta, joista {126} on käytettävissä isännille.
:::

:::quiz match
/24 -> 254 käytettävää isäntäosoitetta
/25 -> 126 käytettävää isäntäosoitetta
/28 -> 14 käytettävää isäntäosoitetta
/30 -> 2 käytettävää isäntäosoitetta
:::

:::evaluate
Tarkista osio 3
:::

## Osio 4: Monivalinta ja satunnaistehtävät

Komennolla `:::quiz multi` mikä tahansa määrä vastauksia voi olla oikein — jokainen väite arvioidaan erikseen:

:::quiz multi
Mitkä väitteet ARPista pitävät paikkansa?
- [x] ARP selvittää IP-osoitetta vastaavan MAC-osoitteen
- [ ] ARP selvittää nimeä vastaavan IP-osoitteen
- [x] ARP-kysely on yleislähetys
- [ ] ARP-vastaus on yleislähetys
:::

`:::quiz random <typ>` luo joka kerta uusia tehtäviä (`count=N` määrää lukumäärän). Tyypit: `bin2dec`, `dec2bin`, `cidr2mask`, `hosts`, `netbcast`, `samenet`, `subnet`.

:::quiz random dec2bin
count=2
:::

:::quiz random netbcast
Laske seuraavalle osoitteelle:
:::

:::quiz random samenet
count=3
:::

:::quiz random subnet
:::

:::evaluate
Tarkista osio 4
:::

## Osio 4b: Täytettävä taulukko

`:::quiz table` — tavallinen Markdown-taulukko, `{vastaus}`-solut muuttuvat syöttökentiksi (erota vaihtoehdot merkillä `|`):

:::quiz table
Jaa `192.168.42.0/24` kahteen aliverkkoon:
| Aliverkko | Verkko-osoite | Yleislähetysosoite |
|---|---|---|
| 1 | {192.168.42.0} | {192.168.42.127} |
| 2 | {192.168.42.128} | {192.168.42.255} |
:::

:::evaluate
Tarkista taulukko
:::

## Osio 5: Bittien värjäys

IP- ja aliverkotuslukuja varten: `[[n|…]]` = verkko-osa, `[[e|…]]` = laajennus, `[[h|…]]` = isäntäosa — leipätekstissä ja taulukoissa:

[[n|11111111.11111111.11111111]].[[e|11]][[h|000000]] = `255.255.255.192`

Monirivisiin esityksiin käytetään ``` -merkinnän sijaan `<pre class="bits-block">`-lohkoa (koodilohkoissa värejä ei näytettäisi):

<pre class="bits-block">
ennen   (/24):  [[n|NNNNNNNN.NNNNNNNN.NNNNNNNN]].[[h|HHHHHHHH]]
jälkeen (/26):  [[n|NNNNNNNN.NNNNNNNN.NNNNNNNN]].[[e|EE]][[h|HHHHHH]]
</pre>

## Osio 6: Sekvenssikaavio

`:::seq` piirtää kaavion, jossa on kaksi elinviivaa. SEQ- ja ACK-numerot sekä elinviivojen laskurit lasketaan lipuista ja hyötykuormasta (`"…"`). `-x` merkinnän `->` sijaan saa segmentin katoamaan, `seq=…` ohittaa numeron (esim. uudelleenlähetyksessä).

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

Komennolla `:::quiz seq` merkit `?` (ennen lippuja tai `seq=?` / `ack=?`) muuttuvat syöttökentiksi; `hide: counters` piilottaa laskurit:

:::quiz seq
Client -> Server: SYN
Server -> Client: ? SYN, ACK ack=?
Client -> Server: ? ACK ack=?
Client -> Server: PSH, ACK "Hello World"
Server -> Client: ACK ack=?
:::

:::evaluate
Tarkista kaavio
:::
