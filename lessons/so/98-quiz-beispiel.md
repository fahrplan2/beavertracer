# Goob tijaabo — Markdown & Quiz (bog tijaabo)

[[toc]]

Boggan waxaa loo isticmaalaa tijaabinta syntax-ka Markdown iyo noocyada su'aalaha is-dhexgalka leh.

---

## Syntax-ka Markdown

### Habaynta qoraalka

**Qalin culus**, *dheer*, ~~xarriiq la mariyay~~, `Inline-Code`, iyo **_isku dhafan_**.

Faqrad caadi ah oo leh [link ku socda bog kale](01-einfuehrung.html) iyo [link banaan](https://www.beavertracer.eu).

### Cinwaannada

Heerarka H2–H4 waxay si toos ah ugu muuqdaan tusmada nuxurka (TOC).

#### Kani waa H4 — kuma muuqdo TOC

### Liisaska

Aan kala horreyn:

- Ethernet
- IP
- TCP
  - HTTP
  - SMTP

Kala horreyn:

1. Habka Tafatirka: dhis topology-ga
2. Habka Socodsiinta: bilow simulation-ka
3. Habka Raad: falanqee packets-ka

### Shaxda

| Protokoll | Layer | Port |
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
Kani waa **note** callout — loogu talagalay tilmaamo dhexdhexaad ah iyo macluumaad dheeraad ah.
:::

:::tip
Kani waa **tip** callout — loogu talagalay talooyin faa'iido leh iyo gorfeyn.
:::

:::warning
Kani waa **warning** callout — loogu talagalay digniino u baahan feejignaan.
:::

:::danger
Kani waa **danger** callout — loogu talagalay ilaha khaladaadka halista ah.
:::

:::draft
:::

### Icons

Font Awesome Solid: :fa-play: :fa-stop: :fa-desktop: :fa-shield-halved: :fa-wifi:

Font Awesome Regular: :far-file: :far-circle:

Calaamadaha qalabka: :router: :switch:

### Simulation la dhex geliyay

:::sim
url=/sims/demo.btsim
:::

### Hawl leh hubinta hab-dhaqanka

:::task
title: Isku xidh PC 1 iyo PC 2
Hubi in PC 1 (id 9) leh IP ku jirta network-ka 192.168.0.0/24 oo uu gaari karo PC 2 (id 11).
check: ip(9, "192.168.0.0/24")
check: pingOk(9, 11)
:::

---

## OSI reference model: nidaamka midabada

Tusaale shax midabo qaansoroobaad leh oo la iftiimiyay (layer 1 hoos, sida taxanaha) iyo "iftiin taraafig" geeska ah oo qoraalku hareeraha ka wareegayo.

### Shax midabaysan

<table class="osi-table">
<thead>
<tr><th>Layer</th><th>Magac</th><th>Protocols tusaale ah</th></tr>
</thead>
<tbody>
<tr class="osi-l7"><td>7</td><td>Application</td><td>HTTP, DNS, SMTP</td></tr>
<tr class="osi-l6"><td>6</td><td>Presentation</td><td>TLS, JPEG, ASCII</td></tr>
<tr class="osi-l5"><td>5</td><td>Session</td><td>RPC, NetBIOS</td></tr>
<tr class="osi-l4"><td>4</td><td>Transport</td><td>TCP, UDP</td></tr>
<tr class="osi-l3"><td>3</td><td>Network</td><td>IP, ICMP</td></tr>
<tr class="osi-l2"><td>2</td><td>Data Link</td><td>Ethernet, ARP</td></tr>
<tr class="osi-l1"><td>1</td><td>Physical</td><td>Copper, fiber, Wi-Fi</td></tr>
</tbody>
</table>

### Iftiin taraafig oo qoraal ku wareegsan

Iftiinka taraafigga waxaa lagu abuuraa `:::osi N`, halkaas oo `N` yahay layer-ka la iftiiminayo (halkan layer 3). Wuxuu ku dhex sabbaynayaa geeska, qoraalka soo socdana si toos ah ayuu hareeraha uga socdaa.

:::osi 3
:::

Lorem ipsum dolor sit amet, consetetur sadipscing elitr, sed diam nonumy eirmod tempor invidunt ut labore et dolore magna aliquyam erat, sed diam voluptua. At vero eos et accusam et justo duo dolores et ea rebum. Stet clita kasd gubergren, no sea takimata sanctus est Lorem ipsum dolor sit amet.

Lorem ipsum dolor sit amet, consetetur sadipscing elitr, sed diam nonumy eirmod tempor invidunt ut labore et dolore magna aliquyam erat, sed diam voluptua. At vero eos et accusam et justo duo dolores et ea rebum, taasoo keenaysa in qaybtan nuxurkeeda loo xiriiriyo network layer (Layer 3) — sidaas darteed sanduuqan gaarka ah ayaa midab ku leh iftiinka taraafigga, kuwa kale oo dhan waxay ahaanayaan cawlan.

---

## Qaybta 1: Erayada aasaasiga ah

:::quiz short
Waa maxay qoritaanka CIDR ee subnet mask-ka 255.255.255.0?
= /24
= 24
:::

:::quiz mc
Midkee ka mid ah cinwaannada soo socda ayaa ah network address-ka 192.168.1.42/24?
- [ ] 192.168.1.42
- [x] 192.168.1.0
- [ ] 192.168.1.255
- [ ] 192.168.0.0
:::

:::quiz fill
Network address waxaa lagu helaa {AND} bit-bit ah oo u dhexeeya IP address iyo {subnet mask}. Cinwaanka ugu sarreeya ee subnet-ka waa {broadcast} address.
:::

:::evaluate
Hubi qaybta 1
:::

---

## Qaybta 2: Isku xidhid — protocols iyo shaqooyinkooda

:::quiz match
ARP -> Waxay helaa MAC address-ka ee IP address
DNS -> Waxay hostnames u beddelaa IP addresses
DHCP -> Si toos ah ayay clients ugu qoondaysaa IP addresses
ICMP -> Waxaa isticmaala ping iyo traceroute
:::

:::evaluate
Hubi qaybta 2
:::

---

## Qaybta 3: Subnetting

:::quiz short
Immisa host addresses oo la isticmaali karo ayuu leeyahay subnet /30?
= 2
:::

:::quiz mc
Maxaa caadi ahaan loo isticmaalaa subnet /30?
- [ ] Network-yada xafiisyada waaweyn ee leh qalab badan
- [ ] Sida xadka cinwaannada DHCP pools
- [x] Sida network isku xidha laba routers
- [ ] WLAN Access Points
:::

:::quiz fill
Subnet /25 wuxuu leeyahay {128} cinwaan, kuwaas oo {126} lagu isticmaali karo hosts.
:::

:::quiz match
/24 -> 254 host addresses oo la isticmaali karo
/25 -> 126 host addresses oo la isticmaali karo
/28 -> 14 host addresses oo la isticmaali karo
/30 -> 2 host addresses oo la isticmaali karo
:::

:::evaluate
Hubi qaybta 3
:::

## Qaybta 4: Doorasho badan iyo hawlo random ah

Marka la isticmaalo `:::quiz multi`, jawaabo kasta oo tiro ah waa sax noqon karaan — odhaah kasta si gooni ah ayaa loo qiimeeyaa:

:::quiz multi
Kuwee ka mid ah odhaahyada ku saabsan ARP ayaa sax ah?
- [x] ARP wuxuu helaa MAC address-ka ee IP address
- [ ] ARP wuxuu helaa IP address-ka ee magac
- [x] Codsiga ARP waa broadcast
- [ ] Jawaabta ARP waa broadcast
:::

`:::quiz random <typ>` wuxuu mar kasta abuuraa hawlo cusub (`count=N` wuxuu go'aamiyaa tirada). Noocyada: `bin2dec`, `dec2bin`, `cidr2mask`, `hosts`, `netbcast`, `samenet`, `subnet`.

:::quiz random dec2bin
count=2
:::

:::quiz random netbcast
Xisaabi cinwaanka soo socda:
:::

:::quiz random samenet
count=3
:::

:::quiz random subnet
:::

:::evaluate
Hubi qaybta 4
:::

## Qaybta 4b: Shax la buuxiyo

`:::quiz table` — shax Markdown caadi ah, unugyada `{Antwort}` waxay noqdaan goobo wax lagu geliyo (kala saar nooc-nooc adigoo isticmaalaya `|`):

:::quiz table
U qaybi `192.168.42.0/24` laba subnets:
| Subnet | Network address | Broadcast address |
|---|---|---|
| 1 | {192.168.42.0} | {192.168.42.127} |
| 2 | {192.168.42.128} | {192.168.42.255} |
:::

:::evaluate
Hubi shaxda
:::

## Qaybta 5: Bits midabaynta

Cutubyada IP iyo subnetting: `[[n|…]]` = network part, `[[e|…]]` = kordhin, `[[h|…]]` = host part — qoraalka caadiga ah iyo shaxdaha labadaba:

[[n|11111111.11111111.11111111]].[[e|11]][[h|000000]] = `255.255.255.192`

Muuqaallada dhowr-sadar ah, halkii aad isticmaali lahayd ``` isticmaal block `<pre class="bits-block">` (code blocks-ka dhexdooda midabadu ma muuqdaan):

<pre class="bits-block">
hore  (/24):  [[n|NNNNNNNN.NNNNNNNN.NNNNNNNN]].[[h|HHHHHHHH]]
kadib (/26):  [[n|NNNNNNNN.NNNNNNNN.NNNNNNNN]].[[e|EE]][[h|HHHHHH]]
</pre>

## Qaybta 6: Sequence diagram

`:::seq` wuxuu sawiraa diagram leh laba lifelines. Lambarrada SEQ iyo ACK iyo tirooyinka ku yaal lifelines waxaa laga xisaabiyaa flags iyo xogta la qaadayo (`"…"`). `-x` halkii `->` wuxuu keenaa in segment lumo, `seq=…` wuxuu beddelaa lambar (tusaale ahaan marka retransmission jiro).

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

Marka la isticmaalo `:::quiz seq`, calaamadaha `?` (ka hor flags, ama `seq=?` / `ack=?`) waxay noqdaan goobo wax lagu geliyo; `hide: counters` wuxuu qariyaa tirooyinka:

:::quiz seq
Client -> Server: SYN
Server -> Client: ? SYN, ACK ack=?
Client -> Server: ? ACK ack=?
Client -> Server: PSH, ACK "Hello World"
Server -> Client: ACK ack=?
:::

:::evaluate
Hubi diagram-ka
:::
