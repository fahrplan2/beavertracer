# Zona de proves — Markdown i qüestionaris (pàgina de prova)

[[toc]]

Aquesta pàgina serveix per provar la sintaxi Markdown i els tipus de preguntes interactives.

---

## Sintaxi Markdown

### Format del text

**Negreta**, *cursiva*, ~~ratllat~~, `Inline-Code`, i **_combinat_**.

Paràgraf normal amb un [enllaç a una altra pàgina](01-einfuehrung.html) i un [enllaç extern](https://www.beavertracer.eu).

### Títols

Els nivells H2–H4 apareixen automàticament a l'índex de continguts (TOC).

#### Això és un H4 — no apareix al TOC

### Llistes

Sense ordre:

- Ethernet
- IP
- TCP
  - HTTP
  - SMTP

Amb ordre:

1. Mode d'edició: construir la topologia
2. Mode d'execució: iniciar la simulació
3. Mode de traça: analitzar paquets

### Taula

| Protocol | Capa | Port |
|-----------|---------|------|
| HTTP      | 7       | 80   |
| HTTPS     | 7       | 443  |
| DNS       | 7       | 53   |
| TCP       | 4       | —    |

### Codi

En línia: `ping 192.168.0.1`

Bloc:

```
$ ping 192.168.0.2
PING 192.168.0.2: 56 data bytes
64 bytes from 192.168.0.2: icmp_seq=0 ttl=64 time=0.4 ms
```

### Quadres destacats

:::note
Aquest és un quadre **note** — per a indicacions neutres i informació complementària.
:::

:::tip
Aquest és un quadre **tip** — per a consells i recomanacions útils.
:::

:::warning
Aquest és un quadre **warning** — per a advertències que requereixen atenció.
:::

:::danger
Aquest és un quadre **danger** — per a fonts d'error crítiques.
:::

:::draft
:::

### Icones

Font Awesome Solid: :fa-play: :fa-stop: :fa-desktop: :fa-shield-halved: :fa-wifi:

Font Awesome Regular: :far-file: :far-circle:

Símbols de dispositius: :router: :switch:

### Simulació incrustada

:::sim
url=/sims/demo.btsim
:::

### Tasca amb comprovació de comportament

:::task
title: Connectar el PC 1 i el PC 2
Comprova si el PC 1 (id 9) té una IP a la xarxa 192.168.0.0/24 i pot arribar al PC 2 (id 11).
check: ip(9, "192.168.0.0/24")
check: pingOk(9, 11)
:::

---

## Model de referència OSI: esquema de colors

Exemple d'una taula ressaltada amb els colors de l'arc de Sant Martí (capa 1 a baix, com a la pila) i d'un «semàfor» al marge amb el text ajustat al voltant.

### Taula de colors

<table class="osi-table">
<thead>
<tr><th>Capa</th><th>Nom</th><th>Protocols d'exemple</th></tr>
</thead>
<tbody>
<tr class="osi-l7"><td>7</td><td>Aplicació</td><td>HTTP, DNS, SMTP</td></tr>
<tr class="osi-l6"><td>6</td><td>Presentació</td><td>TLS, JPEG, ASCII</td></tr>
<tr class="osi-l5"><td>5</td><td>Sessió</td><td>RPC, NetBIOS</td></tr>
<tr class="osi-l4"><td>4</td><td>Transport</td><td>TCP, UDP</td></tr>
<tr class="osi-l3"><td>3</td><td>Xarxa</td><td>IP, ICMP</td></tr>
<tr class="osi-l2"><td>2</td><td>Enllaç de dades</td><td>Ethernet, ARP</td></tr>
<tr class="osi-l1"><td>1</td><td>Física</td><td>Coure, fibra òptica, WLAN</td></tr>
</tbody>
</table>

### Semàfor amb el text ajustat al voltant

El semàfor es genera amb `:::osi N`, on `N` és la capa que s'ha de ressaltar (aquí la capa 3). Flota al marge i el text següent flueix automàticament al seu voltant.

:::osi 3
:::

Lorem ipsum dolor sit amet, consetetur sadipscing elitr, sed diam nonumy eirmod tempor invidunt ut labore et dolore magna aliquyam erat, sed diam voluptua. At vero eos et accusam et justo duo dolores et ea rebum. Stet clita kasd gubergren, no sea takimata sanctus est Lorem ipsum dolor sit amet.

Lorem ipsum dolor sit amet, consetetur sadipscing elitr, sed diam nonumy eirmod tempor invidunt ut labore et dolore magna aliquyam erat, sed diam voluptua. At vero eos et accusam et justo duo dolores et ea rebum, per la qual cosa aquest apartat s'assigna quant al contingut a la capa de xarxa (layer 3) — per això exactament aquesta caixa del semàfor és de color, mentre que totes les altres romanen grises.

---

## Apartat 1: conceptes bàsics

:::quiz short
Quina és la notació CIDR de la màscara de subxarxa 255.255.255.0?
= /24
= 24
:::

:::quiz mc
Quina de les adreces següents és l'adreça de xarxa de 192.168.1.42/24?
- [ ] 192.168.1.42
- [x] 192.168.1.0
- [ ] 192.168.1.255
- [ ] 192.168.0.0
:::

:::quiz fill
L'adreça de xarxa s'obté mitjançant una operació {AND} bit a bit entre l'adreça IP i la {màscara de subxarxa}. L'adreça més alta de la subxarxa és l'adreça de {difusió}.
:::

:::evaluate
Comprova l'apartat 1
:::

---

## Apartat 2: associació — protocols i les seves funcions

:::quiz match
ARP -> Determina l'adreça MAC corresponent a una adreça IP
DNS -> Resol noms de host en adreces IP
DHCP -> Assigna automàticament adreces IP als clients
ICMP -> L'utilitzen ping i traceroute
:::

:::evaluate
Comprova l'apartat 2
:::

---

## Apartat 3: subnetting

:::quiz short
Quantes adreces de host utilitzables té una subxarxa /30?
= 2
:::

:::quiz mc
Per a què s'utilitza normalment una subxarxa /30?
- [ ] Per a xarxes d'oficina grans amb molts dispositius
- [ ] Com a rang d'adreces per a pools DHCP
- [x] Com a xarxa d'enllaç entre dos encaminadors
- [ ] Per a punts d'accés WLAN
:::

:::quiz fill
Una subxarxa /25 té {128} adreces, de les quals {126} són utilitzables per a hosts.
:::

:::quiz match
/24 -> 254 adreces de host utilitzables
/25 -> 126 adreces de host utilitzables
/28 -> 14 adreces de host utilitzables
/30 -> 2 adreces de host utilitzables
:::

:::evaluate
Comprova l'apartat 3
:::

## Apartat 4: selecció múltiple i tasques aleatòries

Amb `:::quiz multi` poden ser correctes qualsevol nombre de respostes — cada afirmació s'avalua per separat:

:::quiz multi
Quines afirmacions sobre ARP són correctes?
- [x] ARP determina l'adreça MAC corresponent a una adreça IP
- [ ] ARP determina l'adreça IP corresponent a un nom
- [x] Una sol·licitud ARP és una difusió (broadcast)
- [ ] Una resposta ARP és una difusió (broadcast)
:::

`:::quiz random <typ>` genera tasques noves cada vegada que s'obre (`count=N` fixa el nombre). Tipus: `bin2dec`, `dec2bin`, `cidr2mask`, `hosts`, `netbcast`, `samenet`, `subnet`.

:::quiz random dec2bin
count=2
:::

:::quiz random netbcast
Calcula per a l'adreça següent:
:::

:::quiz random samenet
count=3
:::

:::quiz random subnet
:::

:::evaluate
Comprova l'apartat 4
:::

## Apartat 4b: taula per omplir

`:::quiz table` — una taula Markdown normal; les cel·les `{Antwort}` esdevenen camps d'entrada (separa les variants amb `|`):

:::quiz table
Divideix `192.168.42.0/24` en dues subxarxes:
| Subxarxa | Adreça de xarxa | Adreça de difusió |
|---|---|---|
| 1 | {192.168.42.0} | {192.168.42.127} |
| 2 | {192.168.42.128} | {192.168.42.255} |
:::

:::evaluate
Comprova la taula
:::

## Apartat 5: acolorir bits

Per als capítols d'IP i de subnetting: `[[n|…]]` = part de xarxa, `[[e|…]]` = extensió, `[[h|…]]` = part de host — en el text corregut i en taules:

[[n|11111111.11111111.11111111]].[[e|11]][[h|000000]] = `255.255.255.192`

Per a representacions de diverses línies, en lloc de ``` utilitza un bloc `<pre class="bits-block">` (en els blocs de codi els colors no es mostrarien):

<pre class="bits-block">
vorher  (/24):  [[n|NNNNNNNN.NNNNNNNN.NNNNNNNN]].[[h|HHHHHHHH]]
nachher (/26):  [[n|NNNNNNNN.NNNNNNNN.NNNNNNNN]].[[e|EE]][[h|HHHHHH]]
</pre>

## Apartat 6: diagrama de seqüència

`:::seq` dibuixa un diagrama amb dues línies de vida. Els números SEQ i ACK, així com els comptadors de les línies de vida, es calculen a partir dels indicadors (flags) i de les dades útils (`"…"`). `-x` en lloc de `->` fa que un segment es perdi, `seq=…` sobreescriu un número (p. ex. en una retransmissió).

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

Amb `:::quiz seq`, els `?` (abans dels indicadors, o `seq=?` / `ack=?`) esdevenen camps d'entrada; `hide: counters` amaga els comptadors:

:::quiz seq
Client -> Server: SYN
Server -> Client: ? SYN, ACK ack=?
Client -> Server: ? ACK ack=?
Client -> Server: PSH, ACK "Hello World"
Server -> Client: ACK ack=?
:::

:::evaluate
Comprova el diagrama
:::
