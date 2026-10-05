# Area di prova — Markdown & quiz (pagina di test)

[[toc]]

Questa pagina serve a testare la sintassi Markdown e i tipi di domande interattive.

---

## Sintassi Markdown

### Formattazione del testo

**Grassetto**, *corsivo*, ~~barrato~~, `Inline-Code`, e **_combinato_**.

Paragrafo normale con un [link a un'altra pagina](01-einfuehrung.html) e un [link esterno](https://www.beavertracer.eu).

### Titoli

I livelli H2–H4 compaiono automaticamente nell'indice dei contenuti (TOC).

#### Questo è H4 — non compare nel TOC

### Elenchi

Non ordinato:

- Ethernet
- IP
- TCP
  - HTTP
  - SMTP

Ordinato:

1. Modalità di modifica: costruire la topologia
2. Modalità di esecuzione: avviare la simulazione
3. Modalità Traccia: analizzare i pacchetti

### Tabella

| Protocollo | Livello | Porta |
|-----------|---------|------|
| HTTP      | 7       | 80   |
| HTTPS     | 7       | 443  |
| DNS       | 7       | 53   |
| TCP       | 4       | —    |

### Codice

Inline: `ping 192.168.0.1`

Blocco:

```
$ ping 192.168.0.2
PING 192.168.0.2: 56 data bytes
64 bytes from 192.168.0.2: icmp_seq=0 ttl=64 time=0.4 ms
```

### Callout

:::note
Questo è un callout **note** — per indicazioni neutre e informazioni aggiuntive.
:::

:::tip
Questo è un callout **tip** — per consigli utili e raccomandazioni.
:::

:::warning
Questo è un callout **warning** — per avvertenze che richiedono attenzione.
:::

:::danger
Questo è un callout **danger** — per fonti di errore critiche.
:::

:::draft
:::

### Icone

Font Awesome Solid: :fa-play: :fa-stop: :fa-desktop: :fa-shield-halved: :fa-wifi:

Font Awesome Regular: :far-file: :far-circle:

Simboli dei dispositivi: :router: :switch:

### Simulazione incorporata

:::sim
url=/sims/demo.btsim
:::

### Attività con verifica del comportamento

:::task
title: Collegare PC 1 e PC 2
Controlla se PC 1 (id 9) ha un IP nella rete 192.168.0.0/24 e può raggiungere PC 2 (id 11).
check: ip(9, "192.168.0.0/24")
check: pingOk(9, 11)
:::

---

## Modello di riferimento OSI: schema dei colori

Esempio di una tabella evidenziata con i colori dell'arcobaleno (livello 1 in basso, come nella pila) e di un "semaforo" a margine della pagina con il testo che vi scorre attorno.

### Tabella colorata

<table class="osi-table">
<thead>
<tr><th>Livello</th><th>Nome</th><th>Protocolli di esempio</th></tr>
</thead>
<tbody>
<tr class="osi-l7"><td>7</td><td>Applicazione</td><td>HTTP, DNS, SMTP</td></tr>
<tr class="osi-l6"><td>6</td><td>Presentazione</td><td>TLS, JPEG, ASCII</td></tr>
<tr class="osi-l5"><td>5</td><td>Sessione</td><td>RPC, NetBIOS</td></tr>
<tr class="osi-l4"><td>4</td><td>Trasporto</td><td>TCP, UDP</td></tr>
<tr class="osi-l3"><td>3</td><td>Rete</td><td>IP, ICMP</td></tr>
<tr class="osi-l2"><td>2</td><td>Collegamento dati</td><td>Ethernet, ARP</td></tr>
<tr class="osi-l1"><td>1</td><td>Fisico</td><td>Rame, fibra ottica, Wi-Fi</td></tr>
</tbody>
</table>

### Semaforo con testo che scorre attorno

Il semaforo viene generato con `:::osi N`, dove `N` è il livello da evidenziare (qui il livello 3). Fluttua a margine e il testo successivo gli scorre automaticamente accanto.

:::osi 3
:::

Lorem ipsum dolor sit amet, consetetur sadipscing elitr, sed diam nonumy eirmod tempor invidunt ut labore et dolore magna aliquyam erat, sed diam voluptua. At vero eos et accusam et justo duo dolores et ea rebum. Stet clita kasd gubergren, no sea takimata sanctus est Lorem ipsum dolor sit amet.

Lorem ipsum dolor sit amet, consetetur sadipscing elitr, sed diam nonumy eirmod tempor invidunt ut labore et dolore magna aliquyam erat, sed diam voluptua. At vero eos et accusam et justo duo dolores et ea rebum, per cui questa sezione è associata per contenuto al livello di rete (layer 3) — per questo nel semaforo è colorato proprio questo riquadro, mentre tutti gli altri restano grigi.

---

## Sezione 1: Concetti di base

:::quiz short
Qual è la notazione CIDR della maschera di sottorete 255.255.255.0?
= /24
= 24
:::

:::quiz mc
Quale dei seguenti indirizzi è l'indirizzo di rete di 192.168.1.42/24?
- [ ] 192.168.1.42
- [x] 192.168.1.0
- [ ] 192.168.1.255
- [ ] 192.168.0.0
:::

:::quiz fill
L'indirizzo di rete si ottiene con un'operazione {AND} bit a bit tra indirizzo IP e {maschera di sottorete}. L'indirizzo più alto nella sottorete è l'indirizzo di {broadcast}.
:::

:::evaluate
Controlla la sezione 1
:::

---

## Sezione 2: Abbinamento — protocolli e loro compiti

:::quiz match
ARP -> Determina l'indirizzo MAC corrispondente a un indirizzo IP
DNS -> Risolve i nomi host in indirizzi IP
DHCP -> Assegna automaticamente indirizzi IP ai client
ICMP -> Viene usato da ping e traceroute
:::

:::evaluate
Controlla la sezione 2
:::

---

## Sezione 3: Subnetting

:::quiz short
Quanti indirizzi host utilizzabili ha una sottorete /30?
= 2
:::

:::quiz mc
Per che cosa si usa tipicamente una sottorete /30?
- [ ] Per grandi reti d'ufficio con molti dispositivi
- [ ] Come intervallo di indirizzi per i pool DHCP
- [x] Come rete di collegamento tra due router
- [ ] Per gli access point Wi-Fi
:::

:::quiz fill
Una sottorete /25 ha {128} indirizzi, di cui {126} utilizzabili per gli host.
:::

:::quiz match
/24 -> 254 indirizzi host utilizzabili
/25 -> 126 indirizzi host utilizzabili
/28 -> 14 indirizzi host utilizzabili
/30 -> 2 indirizzi host utilizzabili
:::

:::evaluate
Controlla la sezione 3
:::

## Sezione 4: Scelta multipla ed esercizi casuali

Con `:::quiz multi` può essere corretto un numero qualsiasi di risposte — ogni affermazione viene valutata singolarmente:

:::quiz multi
Quali affermazioni su ARP sono corrette?
- [x] ARP determina l'indirizzo MAC corrispondente a un indirizzo IP
- [ ] ARP determina l'indirizzo IP corrispondente a un nome
- [x] Una richiesta ARP è un broadcast
- [ ] Una risposta ARP è un broadcast
:::

`:::quiz random <typ>` genera nuovi esercizi a ogni apertura (`count=N` ne stabilisce il numero). Tipi: `bin2dec`, `dec2bin`, `cidr2mask`, `hosts`, `netbcast`, `samenet`, `subnet`.

:::quiz random dec2bin
count=2
:::

:::quiz random netbcast
Calcola per il seguente indirizzo:
:::

:::quiz random samenet
count=3
:::

:::quiz random subnet
:::

:::evaluate
Controlla la sezione 4
:::

## Sezione 4b: Tabella da compilare

`:::quiz table` — una normale tabella Markdown; le celle `{Antwort}` diventano campi di inserimento (separa le varianti con `|`):

:::quiz table
Dividi `192.168.42.0/24` in due sottoreti:
| Sottorete | Indirizzo di rete | Indirizzo di broadcast |
|---|---|---|
| 1 | {192.168.42.0} | {192.168.42.127} |
| 2 | {192.168.42.128} | {192.168.42.255} |
:::

:::evaluate
Controlla la tabella
:::

## Sezione 5: Colorare i bit

Per i capitoli su IP e subnetting: `[[n|…]]` = parte di rete, `[[e|…]]` = estensione, `[[h|…]]` = parte host — nel testo corrente e nelle tabelle:

[[n|11111111.11111111.11111111]].[[e|11]][[h|000000]] = `255.255.255.192`

Per rappresentazioni su più righe usa un blocco `<pre class="bits-block">` invece di ``` (nei blocchi di codice i colori non verrebbero visualizzati):

<pre class="bits-block">
prima (/24):  [[n|NNNNNNNN.NNNNNNNN.NNNNNNNN]].[[h|HHHHHHHH]]
dopo  (/26):  [[n|NNNNNNNN.NNNNNNNN.NNNNNNNN]].[[e|EE]][[h|HHHHHH]]
</pre>

## Sezione 6: Diagramma di sequenza

`:::seq` disegna un diagramma con due linee di vita. I numeri SEQ e ACK e i contatori sulle linee di vita vengono calcolati dai flag e dai dati utili (`"…"`). `-x` invece di `->` fa andare perso un segmento, `seq=…` sovrascrive un numero (ad es. in caso di ritrasmissione).

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

Con `:::quiz seq`, i `?` (prima dei flag, oppure `seq=?` / `ack=?`) diventano campi di inserimento; `hide: counters` nasconde i contatori:

:::quiz seq
Client -> Server: SYN
Server -> Client: ? SYN, ACK ack=?
Client -> Server: ? ACK ack=?
Client -> Server: PSH, ACK "Hello World"
Server -> Client: ACK ack=?
:::

:::evaluate
Controlla il diagramma
:::
