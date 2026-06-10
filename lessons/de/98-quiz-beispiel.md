# Quiz-Beispiele (Testseite)

[[toc]]

Diese Seite dient zum Testen der interaktiven Fragetypen. Die Inhalte stammen aus Kapitel 4 (Layer 3 — Vermittlungsschicht).

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
