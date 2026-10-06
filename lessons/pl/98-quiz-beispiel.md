# Plac zabaw — Markdown i quiz (strona testowa)

[[toc]]

Ta strona służy do testowania składni Markdown i interaktywnych typów pytań.

---

## Składnia Markdown

### Formatowanie tekstu

**Pogrubienie**, *kursywa*, ~~przekreślenie~~, `kod w tekście` oraz **_połączenie_**.

Zwykły akapit z [linkiem do innej strony](01-einfuehrung.html) i [linkiem zewnętrznym](https://www.beavertracer.eu).

### Nagłówki

Poziomy H2–H4 pojawiają się automatycznie w spisie treści (TOC).

#### To jest H4 — nie pojawia się w TOC

### Listy

Nieuporządkowana:

- Ethernet
- IP
- TCP
  - HTTP
  - SMTP

Uporządkowana:

1. Tryb edycji: budowanie topologii
2. Tryb uruchamiania: start symulacji
3. Tryb śledzenia: analiza pakietów

### Tabela

| Protokół | Warstwa | Port |
|-----------|---------|------|
| HTTP      | 7       | 80   |
| HTTPS     | 7       | 443  |
| DNS       | 7       | 53   |
| TCP       | 4       | —    |

### Kod

W tekście: `ping 192.168.0.1`

Blok:

```
$ ping 192.168.0.2
PING 192.168.0.2: 56 data bytes
64 bytes from 192.168.0.2: icmp_seq=0 ttl=64 time=0.4 ms
```

### Wyróżnienia

:::note
To jest wyróżnienie typu **note** — do neutralnych wskazówek i dodatkowych informacji.
:::

:::tip
To jest wyróżnienie typu **tip** — do przydatnych wskazówek i zaleceń.
:::

:::warning
To jest wyróżnienie typu **warning** — do ostrzeżeń, które wymagają uwagi.
:::

:::danger
To jest wyróżnienie typu **danger** — do krytycznych źródeł błędów.
:::

:::draft
:::

### Ikony

Font Awesome Solid: :fa-play: :fa-stop: :fa-desktop: :fa-shield-halved: :fa-wifi:

Font Awesome Regular: :far-file: :far-circle:

Symbole urządzeń: :router: :switch:

### Osadzona symulacja

:::sim
url=/sims/demo.btsim
:::

### Zadanie ze sprawdzeniem zachowania

:::task
title: Połącz PC 1 i PC 2
Sprawdź, czy PC 1 (id 9) ma adres IP w sieci 192.168.0.0/24 i może połączyć się z PC 2 (id 11).
check: ip(9, "192.168.0.0/24")
check: pingOk(9, 11)
:::

---

## Model referencyjny OSI: schemat kolorów

Przykład tabeli wyróżnionej kolorami tęczy (warstwa 1 na dole, tak jak w stosie) oraz „sygnalizatora" na marginesie z opływaniem tekstu.

### Kolorowa tabela

<table class="osi-table">
<thead>
<tr><th>Warstwa</th><th>Nazwa</th><th>Przykładowe protokoły</th></tr>
</thead>
<tbody>
<tr class="osi-l7"><td>7</td><td>Aplikacji</td><td>HTTP, DNS, SMTP</td></tr>
<tr class="osi-l6"><td>6</td><td>Prezentacji</td><td>TLS, JPEG, ASCII</td></tr>
<tr class="osi-l5"><td>5</td><td>Sesji</td><td>RPC, NetBIOS</td></tr>
<tr class="osi-l4"><td>4</td><td>Transportowa</td><td>TCP, UDP</td></tr>
<tr class="osi-l3"><td>3</td><td>Sieciowa</td><td>IP, ICMP</td></tr>
<tr class="osi-l2"><td>2</td><td>Łącza danych</td><td>Ethernet, ARP</td></tr>
<tr class="osi-l1"><td>1</td><td>Fizyczna</td><td>Miedź, światłowód, WLAN</td></tr>
</tbody>
</table>

### Sygnalizator z opływaniem tekstu

Sygnalizator jest tworzony za pomocą `:::osi N`, gdzie `N` to warstwa do wyróżnienia (tutaj warstwa 3). Unosi się na marginesie, a następujący po nim tekst automatycznie go opływa.

:::osi 3
:::

Lorem ipsum dolor sit amet, consetetur sadipscing elitr, sed diam nonumy eirmod tempor invidunt ut labore et dolore magna aliquyam erat, sed diam voluptua. At vero eos et accusam et justo duo dolores et ea rebum. Stet clita kasd gubergren, no sea takimata sanctus est Lorem ipsum dolor sit amet.

Lorem ipsum dolor sit amet, consetetur sadipscing elitr, sed diam nonumy eirmod tempor invidunt ut labore et dolore magna aliquyam erat, sed diam voluptua. At vero eos et accusam et justo duo dolores et ea rebum, przez co ten fragment jest merytorycznie przypisany do warstwy sieciowej (warstwa 3) — dlatego właśnie to pole w sygnalizatorze jest kolorowe, a wszystkie pozostałe pozostają szare.

---

## Sekcja 1: Podstawowe pojęcia

:::quiz short
Jaki jest zapis CIDR maski podsieci 255.255.255.0?
= /24
= 24
:::

:::quiz mc
Który z poniższych adresów jest adresem sieci dla 192.168.1.42/24?
- [ ] 192.168.1.42
- [x] 192.168.1.0
- [ ] 192.168.1.255
- [ ] 192.168.0.0
:::

:::quiz fill
Adres sieci otrzymuje się przez bitową operację {AND} na adresie IP i {masce podsieci}. Najwyższy adres w podsieci to adres {rozgłoszeniowy}.
:::

:::evaluate
Sprawdź sekcję 1
:::

---

## Sekcja 2: Dopasowywanie — protokoły i ich zadania

:::quiz match
ARP -> Ustala adres MAC dla adresu IP
DNS -> Zamienia nazwy hostów na adresy IP
DHCP -> Automatycznie przydziela adresy IP klientom
ICMP -> Jest używany przez ping i traceroute
:::

:::evaluate
Sprawdź sekcję 2
:::

---

## Sekcja 3: Podział na podsieci

:::quiz short
Ile użytecznych adresów hostów ma podsieć /30?
= 2
:::

:::quiz mc
Do czego zwykle używa się podsieci /30?
- [ ] Do dużych sieci biurowych z wieloma urządzeniami
- [ ] Jako zakresu adresów dla pul DHCP
- [x] Jako sieci łączącej dwa routery
- [ ] Dla punktów dostępu WLAN
:::

:::quiz fill
Podsieć /25 ma {128} adresów, z których {126} można wykorzystać dla hostów.
:::

:::quiz match
/24 -> 254 użyteczne adresy hostów
/25 -> 126 użytecznych adresów hostów
/28 -> 14 użytecznych adresów hostów
/30 -> 2 użyteczne adresy hostów
:::

:::evaluate
Sprawdź sekcję 3
:::

## Sekcja 4: Wielokrotny wybór i zadania losowe

W `:::quiz multi` dowolna liczba odpowiedzi może być poprawna — każde stwierdzenie jest oceniane osobno:

:::quiz multi
Które stwierdzenia o ARP są prawdziwe?
- [x] ARP ustala adres MAC dla adresu IP
- [ ] ARP ustala adres IP dla nazwy
- [x] Zapytanie ARP jest rozgłoszeniem
- [ ] Odpowiedź ARP jest rozgłoszeniem
:::

`:::quiz random <typ>` generuje przy każdym wywołaniu nowe zadania (`count=N` określa ich liczbę). Typy: `bin2dec`, `dec2bin`, `cidr2mask`, `hosts`, `netbcast`, `samenet`, `subnet`.

:::quiz random dec2bin
count=2
:::

:::quiz random netbcast
Oblicz dla następującego adresu:
:::

:::quiz random samenet
count=3
:::

:::quiz random subnet
:::

:::evaluate
Sprawdź sekcję 4
:::

## Sekcja 4b: Tabela do uzupełnienia

`:::quiz table` — zwykła tabela Markdown, komórki `{odpowiedź}` zamieniają się w pola do wpisania (warianty oddzielaj za pomocą `|`):

:::quiz table
Podziel `192.168.42.0/24` na dwie podsieci:
| Podsieć | Adres sieci | Adres rozgłoszeniowy |
|---|---|---|
| 1 | {192.168.42.0} | {192.168.42.127} |
| 2 | {192.168.42.128} | {192.168.42.255} |
:::

:::evaluate
Sprawdź tabelę
:::

## Sekcja 5: Kolorowanie bitów

Dla rozdziałów o IP i podziale na podsieci: `[[n|…]]` = część sieciowa, `[[e|…]]` = rozszerzenie, `[[h|…]]` = część hosta — w tekście i w tabelach:

[[n|11111111.11111111.11111111]].[[e|11]][[h|000000]] = `255.255.255.192`

Do wielowierszowych przedstawień zamiast ``` użyj bloku `<pre class="bits-block">` (w blokach kodu kolory nie byłyby wyświetlane):

<pre class="bits-block">
przed   (/24):  [[n|NNNNNNNN.NNNNNNNN.NNNNNNNN]].[[h|HHHHHHHH]]
po      (/26):  [[n|NNNNNNNN.NNNNNNNN.NNNNNNNN]].[[e|EE]][[h|HHHHHH]]
</pre>

## Sekcja 6: Diagram komunikacji

`:::seq` rysuje diagram z dwiema liniami życia. Numery SEQ i ACK oraz liczniki przy liniach życia są obliczane na podstawie flag i danych użytkowych (`"…"`). `-x` zamiast `->` powoduje utratę segmentu, a `seq=…` nadpisuje numer (np. przy retransmisji).

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

W `:::quiz seq` znaki `?` (przed flagami lub `seq=?` / `ack=?`) zamieniają się w pola do wpisania; `hide: counters` ukrywa liczniki:

:::quiz seq
Client -> Server: SYN
Server -> Client: ? SYN, ACK ack=?
Client -> Server: ? ACK ack=?
Client -> Server: PSH, ACK "Hello World"
Server -> Client: ACK ack=?
:::

:::evaluate
Sprawdź diagram
:::
