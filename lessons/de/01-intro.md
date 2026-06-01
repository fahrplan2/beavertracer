# Einführung in den BeaverTracer

[[toc]]

## Was ist der BeaverTracer?

Der BeaverTracer ist ein visueller Netzwerksimulator, der direkt im Browser läuft. Du kannst damit Netzwerke aus echten Protokollen aufbauen, Verbindungen konfigurieren und beobachten, wie Datenpakete von Gerät zu Gerät wandern — alles ohne physische Hardware oder Administratorrechte.

Biber warten nicht darauf, dass etwas passiert — sie fangen einfach an. Ast für Ast bauen sie, bis dort ein Damm steht, wo vorher nur ein Bach war. Genau das machst du hier: Paket für Paket, Verbindung für Verbindung — bis ein ganzes Netzwerk Sinn ergibt.

Der eingebaute **Paket-Tracer** macht den Datenverkehr sichtbar und analysierbar — auf Basis von Wireshark-Technologie, aber direkt integriert in eine freundlichere Lernumgebung.

:::tip
Der BeaverTracer verwendet echte Protokollimplementierungen. Was du hier siehst, verhält sich wie in einem realen Netzwerk — ARP, DHCP, TCP-Handshakes, Routing-Updates und vieles mehr laufen als echte Pakete ab und sind im Tracer sichtbar.
:::

## Die Oberfläche

Die Oberfläche besteht aus vier Hauptbereichen:

**Arbeitsfläche (Mitte):** Hier baust du dein Netzwerk. Geräte lassen sich per Drag & Drop aus der Palette links platzieren, verschieben und durch Klicken auf Ports miteinander verbinden.

**Gerätepalette (links):** Enthält alle verfügbaren Gerätetypen, die du in die Arbeitsfläche ziehen kannst.

**Steuerleiste (oben):** Mit :fa-play: **Start**, :fa-stop: **Stop** und dem Reset-Button steuerst du die Simulation. Daneben findest du Schnellzugriffe auf den Tracer und die Einstellungen.

**Paket-Tracer (unten / separates Fenster):** Zeigt alle aufgezeichneten Pakete mit Protokollbaum, Hex-Dump und Filterzeile. Er öffnet sich über die Steuerleiste.

## Gerätetypen

| Gerät | Symbol | Beschreibung |
|-------|--------|--------------|
| **Computer** | :fa-desktop: | Endgerät mit Netzwerkstack, Terminal und installierbaren Apps. Der häufigste Knotentyp. |
| **Router** | :router: | Leitet Pakete zwischen Netzwerken weiter. Unterstützt statische Routen und Routing-Protokolle (RIP, OSPF, BGP). |
| **Switch** | :switch: | Verbindet mehrere Geräte im selben Segment. Lernt MAC-Adressen und leitet gezielt weiter. |
| **HomeRouter** | :fa-house-signal: | Kombination aus Router, Switch und DHCP-Server — typischer DSL/Kabelrouter mit WAN- und LAN-Seite, NAT und optionalem DHCPv6-PD-Client. |
| **Firewall** | :fa-shield-halved: | Filtert Pakete nach konfigurierbaren Regeln (Richtung, IP-Version, Protokoll, Port). |
| **Access Point** | :fa-wifi: | Verbindet WLAN-Geräte (Tablets) mit einem kabelgebundenen Netzwerk. |
| **Tablet** | :fa-tablet-screen-button: | Endgerät mit WLAN-Anbindung und Browser (Sparktail). |

Daneben gibt es **Textfelder** und **Rechteck-Overlays** zur Beschriftung und Strukturierung der Arbeitsfläche.

## Grundlegende Bedienung

### Netzwerk aufbauen

1. Ziehe ein Gerät aus der Palette auf die Arbeitsfläche.
2. Klicke auf einen **Port** (kleiner Kreis am Gerät) und dann auf einen Port eines anderen Geräts — das zieht ein Kabel.
3. Doppelklicke auf ein Gerät, um seine Konfiguration zu öffnen.

### Geräte konfigurieren

Jedes Gerät hat ein Konfigurationsfenster mit Tabs. Typisch sind:

- **Netzwerk-Tab:** IP-Adressen, Subnetzmaske, Gateway, DNS — statisch oder per DHCP.
- **Apps-Tab:** Installierte Dienste (HTTP-Server, DNS-Server, DHCP-Server, Mailserver …) starten und konfigurieren.
- **Routing-Tab** (Router): Statische Routen und Routing-Daemons (RIPv2, RIPng, OSPFv2, BGP).

### Simulation steuern

Drücke :fa-play: **Start**, um die Simulation zu starten. Sofort beginnen Protokolle zu arbeiten: Geräte senden ARP-Anfragen, DHCP-Clients beziehen Adressen, Routing-Protokolle tauschen Updates aus. Mit :fa-stop: **Stop** frierst du die Simulation ein; der bisherige Zustand bleibt erhalten.

:::note
Die Simulation läuft auf einer eigenen Takt-Uhr, die schneller als Echtzeit sein kann. Protokoll-Timeouts (z. B. OSPF-Hello-Intervall oder DHCP-Lease-Zeit) skalieren entsprechend.
:::

## Anwendungen auf Geräten

Auf Computern, Routern und HomeRoutern können **Anwendungen** installiert werden. Sie laufen innerhalb des simulierten Betriebssystems und kommunizieren über den echten simulierten Netzwerkstack:

- **Sparktail** — Browser mit HTTP/HTTPS-Unterstützung und TLS-Zertifikatsvalidierung
- **HTTP/HTTPS-Server** — statisches Dateiserving über IPv4 und IPv6
- **DNS-Server** — autoritativ oder rekursiv mit A, AAAA, MX, CNAME und weiteren Record-Typen
- **DHCP-Server** — vergibt IPv4-Adressen aus einem konfigurierbaren Pool
- **DHCPv6-Server** — vergibt IPv6-Adressen über IA_NA
- **Mailserver** — bedient SMTP (mit STARTTLS und Relay), POP3 und IMAP4 in einem Prozess
- **Mailclient** — verbindet sich mit einem Mailserver zum Empfangen und Senden
- **IRC-Server / IRC-Client** — vollständiger Chat-Betrieb im Netzwerk
- **Terminal** — Kommandozeile mit Netzwerkbefehlen (ping, traceroute, nslookup …)
- **Zertifikatsmanager** — erstellt und verwaltet X.509-Zertifikate und Trust Stores

## Der Paket-Tracer

Der Paket-Tracer ist das wichtigste Analysewerkzeug. Er zeichnet intern den gesamten Datenverkehr im **libpcap-Format** auf und analysiert ihn mithilfe von **Wiregasm** — einem WebAssembly-Port von Wiresharks *libwireshark*.

Das bedeutet: Jedes Paket wird mit denselben Dissektoren aufgeschlüsselt, die auch Wireshark verwendet — von Ethernet über IP bis hinein in Anwendungsprotokoll-Header.

Im Tracer-Fenster siehst du:

- **Paketliste** mit Zeitstempel, Quell- und Zieladresse, Protokoll und Kurzinfo
- **Protokollbaum** — klappt jede Schicht auf und zeigt einzelne Felder mit ihren Werten
- **Hex-Dump** — die rohen Bytes des Pakets, mit Feldern farbig verknüpft
- **Filterzeile** — Wireshark-Display-Filter wie `tcp`, `ip.src == 10.0.0.1` oder `dns`

:::tip
Öffne den Tracer, bevor du die Simulation startest — so geht kein Paket verloren. Du kannst ihn jederzeit filtern und nach Protokollen oder Adressen suchen.
:::

## Weiterlesen

- [99. Protokoll- & RFC-Unterstützung](99-protokollunterstuetzung.html) — vollständige Liste aller simulierten Protokolle mit Einschränkungen
