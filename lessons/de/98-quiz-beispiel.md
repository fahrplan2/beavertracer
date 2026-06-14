# Spielwiese — Markdown & Quiz (Testseite)

[[toc]]

Diese Seite dient zum Testen von Markdown-Syntax und interaktiven Fragetypen.

---

## Markdown-Syntax

### Textformatierung

**Fett**, *kursiv*, ~~durchgestrichen~~, `Inline-Code`, und **_kombiniert_**.

Normaler Absatz mit einem [Link auf eine andere Seite](01-einfuehrung.html) und einem [externen Link](https://www.beavertracer.eu).

### Überschriften

Die Ebenen H2–H4 erscheinen automatisch im Inhaltsverzeichnis (TOC).

#### Das ist H4 — taucht nicht im TOC auf

### Listen

Ungeordnet:

- Ethernet
- IP
- TCP
  - HTTP
  - SMTP

Geordnet:

1. Edit-Modus: Topologie aufbauen
2. Run-Modus: Simulation starten
3. Trace-Modus: Pakete analysieren

### Tabelle

| Protokoll | Schicht | Port |
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
Das ist ein **note**-Callout — für neutrale Hinweise und ergänzende Informationen.
:::

:::tip
Das ist ein **tip**-Callout — für nützliche Tipps und Empfehlungen.
:::

:::warning
Das ist ein **warning**-Callout — für Warnungen, die Aufmerksamkeit erfordern.
:::

:::danger
Das ist ein **danger**-Callout — für kritische Fehlerquellen.
:::

### Icons

Font Awesome Solid: :fa-play: :fa-stop: :fa-desktop: :fa-shield-halved: :fa-wifi:

Font Awesome Regular: :far-file: :far-circle:

Gerätesymbole: :router: :switch:

---

## Abschnitt 1: Grundbegriffe

:::quiz short
Was ist die CIDR-Notation der Subnetzmaske 255.255.255.0?
= /24
= 24
:::

:::quiz mc
Welche der folgenden Adressen ist die Netzadresse von 192.168.1.42/24?
- [ ] 192.168.1.42
- [x] 192.168.1.0
- [ ] 192.168.1.255
- [ ] 192.168.0.0
:::

:::quiz fill
Die Netzadresse erhält man durch eine bitweise {AND}-Verknüpfung von IP-Adresse und {Subnetzmaske}. Die höchste Adresse im Subnetz ist die {Broadcast}-Adresse.
:::

:::evaluate
Abschnitt 1 prüfen
:::

---

## Abschnitt 2: Zuordnung — Protokolle und ihre Aufgaben

:::quiz match
ARP -> Ermittelt die MAC-Adresse zu einer IP-Adresse
DNS -> Löst Hostnamen in IP-Adressen auf
DHCP -> Vergibt IP-Adressen automatisch an Clients
ICMP -> Wird von ping und traceroute verwendet
:::

:::evaluate
Abschnitt 2 prüfen
:::

---

## Abschnitt 3: Subnetting

:::quiz short
Wie viele nutzbare Hostadressen hat ein /30-Subnetz?
= 2
:::

:::quiz mc
Wozu verwendet man typischerweise ein /30-Subnetz?
- [ ] Für große Bürounetzwerke mit vielen Geräten
- [ ] Als Adressbereich für DHCP-Pools
- [x] Als Verbindungsnetz zwischen zwei Routern
- [ ] Für WLAN-Accesspoints
:::

:::quiz fill
Ein /25-Subnetz hat {128} Adressen, davon sind {126} für Hosts nutzbar.
:::

:::quiz match
/24 -> 254 nutzbare Hostadressen
/25 -> 126 nutzbare Hostadressen
/28 -> 14 nutzbare Hostadressen
/30 -> 2 nutzbare Hostadressen
:::

:::evaluate
Abschnitt 3 prüfen
:::
