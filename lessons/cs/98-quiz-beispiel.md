# Hřiště — Markdown a kvízy (testovací stránka)

[[toc]]

Tato stránka slouží k testování syntaxe Markdownu a interaktivních typů otázek.

---

## Syntaxe Markdownu

### Formátování textu

**Tučně**, *kurzívou*, ~~přeškrtnuté~~, `Inline-Code`, a **_kombinované_**.

Normální odstavec s [odkazem na jinou stránku](01-einfuehrung.html) a [externím odkazem](https://www.beavertracer.eu).

### Nadpisy

Úrovně H2–H4 se automaticky zobrazují v obsahu (TOC).

#### Toto je H4 — v obsahu se neobjeví

### Seznamy

Neuspořádaný:

- Ethernet
- IP
- TCP
  - HTTP
  - SMTP

Uspořádaný:

1. Režim úprav: sestavit topologii
2. Režim spuštění: spustit simulaci
3. Režim trasování: analyzovat pakety

### Tabulka

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
Toto je callout typu **note** — pro neutrální poznámky a doplňující informace.
:::

:::tip
Toto je callout typu **tip** — pro užitečné tipy a doporučení.
:::

:::warning
Toto je callout typu **warning** — pro varování, která vyžadují pozornost.
:::

:::danger
Toto je callout typu **danger** — pro kritické zdroje chyb.
:::

:::draft
:::

### Ikony

Font Awesome Solid: :fa-play: :fa-stop: :fa-desktop: :fa-shield-halved: :fa-wifi:

Font Awesome Regular: :far-file: :far-circle:

Symboly zařízení: :router: :switch:

### Vložená simulace

:::sim
url=/sims/demo.btsim
:::

### Úkol s kontrolou chování

:::task
title: Propojit PC 1 a PC 2
Zkontroluj, zda má PC 1 (id 9) IP adresu v síti 192.168.0.0/24 a zda dosáhne na PC 2 (id 11).
check: ip(9, "192.168.0.0/24")
check: pingOk(9, 11)
:::

---

## Referenční model OSI: barevné schéma

Příklad duhově zvýrazněné tabulky (vrstva 1 dole, jako v zásobníku) a „semaforu“ na okraji stránky s obtékáním textu.

### Barevná tabulka

<table class="osi-table">
<thead>
<tr><th>Vrstva</th><th>Název</th><th>Příklady protokolů</th></tr>
</thead>
<tbody>
<tr class="osi-l7"><td>7</td><td>Aplikační</td><td>HTTP, DNS, SMTP</td></tr>
<tr class="osi-l6"><td>6</td><td>Prezentační</td><td>TLS, JPEG, ASCII</td></tr>
<tr class="osi-l5"><td>5</td><td>Relační</td><td>RPC, NetBIOS</td></tr>
<tr class="osi-l4"><td>4</td><td>Transportní</td><td>TCP, UDP</td></tr>
<tr class="osi-l3"><td>3</td><td>Síťová</td><td>IP, ICMP</td></tr>
<tr class="osi-l2"><td>2</td><td>Linková</td><td>Ethernet, ARP</td></tr>
<tr class="osi-l1"><td>1</td><td>Fyzická</td><td>Měď, optické vlákno, WLAN</td></tr>
</tbody>
</table>

### Semafor s obtékáním textu

Semafor se vytvoří pomocí `:::osi N`, kde `N` je vrstva, která se má zvýraznit (zde vrstva 3). Vznáší se na okraji a následující text jej automaticky obtéká.

:::osi 3
:::

Lorem ipsum dolor sit amet, consetetur sadipscing elitr, sed diam nonumy eirmod tempor invidunt ut labore et dolore magna aliquyam erat, sed diam voluptua. At vero eos et accusam et justo duo dolores et ea rebum. Stet clita kasd gubergren, no sea takimata sanctus est Lorem ipsum dolor sit amet.

Lorem ipsum dolor sit amet, consetetur sadipscing elitr, sed diam nonumy eirmod tempor invidunt ut labore et dolore magna aliquyam erat, sed diam voluptua. At vero eos et accusam et justo duo dolores et ea rebum, čímž je tento odstavec obsahově přiřazen k síťové vrstvě (vrstva 3) — proto je v semaforu barevně zvýrazněn právě tento rámeček, všechny ostatní zůstávají šedé.

---

## Oddíl 1: Základní pojmy

:::quiz short
Jaký je zápis CIDR pro masku podsítě 255.255.255.0?
= /24
= 24
:::

:::quiz mc
Která z následujících adres je adresa sítě pro 192.168.1.42/24?
- [ ] 192.168.1.42
- [x] 192.168.1.0
- [ ] 192.168.1.255
- [ ] 192.168.0.0
:::

:::quiz fill
Adresu sítě získáme bitovou operací {AND} z IP adresy a {masky sítě}. Nejvyšší adresa v podsíti je {broadcastová} adresa.
:::

:::evaluate
Zkontrolovat oddíl 1
:::

---

## Oddíl 2: Přiřazení — protokoly a jejich úlohy

:::quiz match
ARP -> Zjišťuje MAC adresu k IP adrese
DNS -> Překládá názvy hostitelů na IP adresy
DHCP -> Automaticky přiděluje IP adresy klientům
ICMP -> Používají ho ping a traceroute
:::

:::evaluate
Zkontrolovat oddíl 2
:::

---

## Oddíl 3: Dělení na podsítě

:::quiz short
Kolik použitelných adres hostitelů má podsíť /30?
= 2
:::

:::quiz mc
K čemu se typicky používá podsíť /30?
- [ ] Pro velké kancelářské sítě s mnoha zařízeními
- [ ] Jako rozsah adres pro fondy DHCP
- [x] Jako spojovací síť mezi dvěma routery
- [ ] Pro WLAN přístupové body
:::

:::quiz fill
Podsíť /25 má {128} adres, z nichž {126} je použitelných pro hostitele.
:::

:::quiz match
/24 -> 254 použitelných adres hostitelů
/25 -> 126 použitelných adres hostitelů
/28 -> 14 použitelných adres hostitelů
/30 -> 2 použitelné adresy hostitelů
:::

:::evaluate
Zkontrolovat oddíl 3
:::

## Oddíl 4: Výběr více odpovědí a náhodné úlohy

U `:::quiz multi` může být správných libovolně mnoho odpovědí — každé tvrzení se hodnotí zvlášť:

:::quiz multi
Která tvrzení o ARP jsou pravdivá?
- [x] ARP zjišťuje k IP adrese MAC adresu
- [ ] ARP zjišťuje k názvu IP adresu
- [x] Požadavek ARP je broadcast
- [ ] Odpověď ARP je broadcast
:::

`:::quiz random <typ>` vytvoří při každém zobrazení nové úlohy (`count=N` určuje jejich počet). Typy: `bin2dec`, `dec2bin`, `cidr2mask`, `hosts`, `netbcast`, `samenet`, `subnet`.

:::quiz random dec2bin
count=2
:::

:::quiz random netbcast
Vypočítej pro následující adresu:
:::

:::quiz random samenet
count=3
:::

:::quiz random subnet
:::

:::evaluate
Zkontrolovat oddíl 4
:::

## Oddíl 4b: Tabulka k vyplnění

`:::quiz table` — běžná tabulka v Markdownu, buňky `{odpověď}` se změní na vstupní pole (varianty odděl znakem `|`):

:::quiz table
Rozděl `192.168.42.0/24` na dvě podsítě:
| Podsíť | Adresa sítě | Broadcastová adresa |
|---|---|---|
| 1 | {192.168.42.0} | {192.168.42.127} |
| 2 | {192.168.42.128} | {192.168.42.255} |
:::

:::evaluate
Zkontrolovat tabulku
:::

## Oddíl 5: Barevné zvýraznění bitů

Pro kapitoly o IP a dělení na podsítě: `[[n|…]]` = síťová část adresy, `[[e|…]]` = rozšíření, `[[h|…]]` = hostitelská část adresy — v plynulém textu i v tabulkách:

[[n|11111111.11111111.11111111]].[[e|11]][[h|000000]] = `255.255.255.192`

Pro víceřádkové zobrazení použij místo ``` blok `<pre class="bits-block">` (v blocích kódu by se barvy nezobrazily):

<pre class="bits-block">
dříve   (/24):  [[n|NNNNNNNN.NNNNNNNN.NNNNNNNN]].[[h|HHHHHHHH]]
potom   (/26):  [[n|NNNNNNNN.NNNNNNNN.NNNNNNNN]].[[e|EE]][[h|HHHHHH]]
</pre>

## Oddíl 6: Sekvenční diagram

`:::seq` nakreslí diagram se dvěma čarami života. Čísla SEQ a ACK i čítače na čarách života se vypočítají z příznaků a přenášených dat (`"…"`). `-x` místo `->` způsobí ztrátu segmentu, `seq=…` přepíše číslo (např. při opakovaném odeslání).

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

U `:::quiz seq` se `?` (před příznaky, nebo `seq=?` / `ack=?`) změní na vstupní pole; `hide: counters` skryje čítače:

:::quiz seq
Client -> Server: SYN
Server -> Client: ? SYN, ACK ack=?
Client -> Server: ? ACK ack=?
Client -> Server: PSH, ACK "Hello World"
Server -> Client: ACK ack=?
:::

:::evaluate
Zkontrolovat diagram
:::
