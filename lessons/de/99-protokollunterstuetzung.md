# Protokoll- & RFC-Unterstützung

<style>
.badge{display:inline-block;padding:1px 9px;border-radius:20px;font-size:.72rem;font-weight:600;white-space:nowrap}
.badge-full   {background:color-mix(in oklch,var(--ok),     white 72%);color:oklch(30% .17 145)}
.badge-partial{background:color-mix(in oklch,var(--warning), white 72%);color:oklch(35% .17 55)}
.badge-stub   {background:color-mix(in oklch,var(--danger),  white 72%);color:oklch(32% .20 25)}
[data-theme=dark] .badge-full   {background:color-mix(in oklch,var(--ok),     black 60%);color:oklch(88% .15 145)}
[data-theme=dark] .badge-partial{background:color-mix(in oklch,var(--warning), black 60%);color:oklch(88% .15 75)}
[data-theme=dark] .badge-stub   {background:color-mix(in oklch,var(--danger),  black 60%);color:oklch(88% .15 25)}
.pt{font-size:.88rem}.pt td:last-child{color:var(--muted);font-size:.83rem}
.pt td:first-child{font-weight:600;white-space:nowrap}
.pt td:nth-child(2){font-family:"Hack","Fira Code","Consolas",monospace;font-size:.78rem;white-space:nowrap}
</style>

BeaverTracer ist ein Netzwerksimulator für den Unterricht. Er modelliert eine breite Palette von Standardprotokollen — präzise genug, um echtes Netzwerkverhalten zu lehren und zu beobachten, mit bewussten Vereinfachungen dort, wo vollständige Konformität Komplexität ohne pädagogischen Mehrwert erzeugen würde.

**Legende:** <span class="badge badge-full">Vollständig</span> alle wesentlichen Felder und Nachrichtentypen implementiert &nbsp; <span class="badge badge-partial">Teilweise</span> Kernverhalten modelliert, Grenzfälle ausgelassen &nbsp; <span class="badge badge-stub">Stub</span> Struktur vorhanden, Verhalten nicht simuliert

[[toc]]

## Sicherungsschicht

<table class="pt">
<thead><tr><th>Protokoll</th><th>Standard</th><th>Unterstützung</th><th>Anmerkungen &amp; Grenzen</th></tr></thead>
<tbody>
<tr>
  <td>Ethernet II</td><td>IEEE 802.3</td>
  <td><span class="badge badge-full">Vollständig</span></td>
  <td>Src/Dst-MAC, EtherType, Mindestrahmen-Auffüllung. Keine FCS/CRC-Prüfung, keine Jumbo Frames.</td>
</tr>
<tr>
  <td>802.1Q VLAN</td><td>IEEE 802.1Q</td>
  <td><span class="badge badge-partial">Teilweise</span></td>
  <td>PCP (3 Bit), DEI, VID (12 Bit), innerer EtherType. Nur ein einziger Tag — kein QinQ (802.1ad)-Stacking.</td>
</tr>
<tr>
  <td>Spanning Tree (STP)</td><td>IEEE 802.1D-2004</td>
  <td><span class="badge badge-partial">Teilweise</span></td>
  <td>Config-BPDU und TCN-BPDU mit Bridge-ID, Port-ID, Pfadkosten, Timern. Kein RSTP (802.1w), kein MSTP, kein BPDU Guard.</td>
</tr>
</tbody>
</table>

## Vermittlungsschicht

<table class="pt">
<thead><tr><th>Protokoll</th><th>RFC</th><th>Unterstützung</th><th>Anmerkungen &amp; Grenzen</th></tr></thead>
<tbody>
<tr>
  <td>IPv4</td><td>RFC 791</td>
  <td><span class="badge badge-partial">Teilweise</span></td>
  <td>Alle Header-Felder inkl. DSCP/ECN, Flags (DF/MF), Fragment-Offset, TTL, Prüfsumme. Options-Feld wird mitgeführt, aber nicht ausgewertet. Keine Fragmentierungs-Reassembly.</td>
</tr>
<tr>
  <td>IPv6</td><td>RFC 2460</td>
  <td><span class="badge badge-partial">Teilweise</span></td>
  <td>Version, Traffic Class (DSCP/ECN), Flow Label, Payload Length, Next Header, Hop Limit, 128-Bit-Adressen. Extension Headers werden nicht geparst — sie bleiben als undurchsichtiger Payload.</td>
</tr>
<tr>
  <td>ARP</td><td>RFC 826</td>
  <td><span class="badge badge-full">Vollständig</span></td>
  <td>HTYPE, PTYPE, SHA/SPA/THA/TPA, Request und Reply. Kein Gratuitous ARP, keine Probe/Announcement (RFC 5227).</td>
</tr>
<tr>
  <td>ICMPv4</td><td>RFC 792</td>
  <td><span class="badge badge-partial">Teilweise</span></td>
  <td>Echo Request (Typ 8) und Echo Reply (Typ 0) vollständig dekodiert mit Identifier und Sequence. Andere ICMP-Typen (Destination Unreachable, Time Exceeded, Redirect …) werden weitergeleitet, aber nicht in typisierte Felder zerlegt.</td>
</tr>
<tr>
  <td>ICMPv6 &amp; NDP</td><td>RFC 4443, RFC 4861</td>
  <td><span class="badge badge-partial">Teilweise</span></td>
  <td>Echo (128/129), Neighbor Solicitation (135), Neighbor Advertisement (136), Router Solicitation (133), Router Advertisement (134). RA-Optionen: SLLA/TLLA (Typ 1/2) und Prefix Information (Typ 3). Kein MTU-Option (Typ 5), kein Redirect Header, keine Redirect-Nachricht (Typ 137).</td>
</tr>
<tr>
  <td>GRE</td><td>RFC 2784</td>
  <td><span class="badge badge-partial">Teilweise</span></td>
  <td>Minimaler 4-Byte-Fixed-Header mit Protocol Type. Optionale Checksum/Key/Sequence-Felder werden beim Einlesen dekodiert, aber nicht erzeugt. Keine RFC-2890-Erweiterungen.</td>
</tr>
</tbody>
</table>

## Transportschicht

<table class="pt">
<thead><tr><th>Protokoll</th><th>RFC</th><th>Unterstützung</th><th>Anmerkungen &amp; Grenzen</th></tr></thead>
<tbody>
<tr>
  <td>TCP</td><td>RFC 793, RFC 3168</td>
  <td><span class="badge badge-partial">Teilweise</span></td>
  <td>Alle Header-Felder: Ports, Sequence/Ack-Nummern, Data Offset, alle 8 Flags (inkl. ECE/CWR), Window, Prüfsumme, Urgent Pointer. Options-Feld wird mitgeführt, aber nicht ausgewertet — MSS, Window Scale, SACK und Timestamps werden nicht ausgehandelt. Keine Staukontrolle.</td>
</tr>
<tr>
  <td>UDP</td><td>RFC 768</td>
  <td><span class="badge badge-full">Vollständig</span></td>
  <td>Ports, Length, Prüfsumme (optional für IPv4, Pflicht für IPv6). Keine weiteren Einschränkungen.</td>
</tr>
</tbody>
</table>

## Adresskonfiguration

<table class="pt">
<thead><tr><th>Mechanismus</th><th>RFC / Standard</th><th>Unterstützung</th><th>Anmerkungen &amp; Grenzen</th></tr></thead>
<tbody>
<tr>
  <td>APIPA</td><td>RFC 3927</td>
  <td><span class="badge badge-partial">Teilweise</span></td>
  <td>Weist automatisch eine Link-Local-Adresse aus 169.254.0.0/16 zu, wenn kein DHCP-Server erreichbar ist. Kein ARP-Probe zur Konfliktprüfung vor der Zuweisung.</td>
</tr>
<tr>
  <td>DAD (Duplicate Address Detection)</td><td>RFC 4862</td>
  <td><span class="badge badge-partial">Teilweise</span></td>
  <td>Sendet einen Neighbor Solicitation von <code>::</code> an die Solicited-Node-Multicast-Adresse und wartet eine konfigurierte Zeitspanne. Konflikt wird erkannt und die Adresse verworfen. Läuft bei statischen IPv6-Adressen und SLAAC. Nur eine NS-Probe (kein mehrfaches Retry per RFC).</td>
</tr>
</tbody>
</table>

## Anwendungsschicht

### DNS & DHCP

<table class="pt">
<thead><tr><th>Protokoll</th><th>RFC</th><th>Unterstützung</th><th>Anmerkungen &amp; Grenzen</th></tr></thead>
<tbody>
<tr>
  <td>DNS</td><td>RFC 1035, RFC 1123, RFC 3596</td>
  <td><span class="badge badge-partial">Teilweise</span></td>
  <td><strong>Record-Typen:</strong> A, AAAA, CNAME, MX, NS, PTR, SOA, TXT. <strong>Modi:</strong> Autoritativ (Zonendaten) und Rekursiv (Forwarder). Name-Compression beim Parsen; keine Compression beim Packen von Antworten. Kein DNSSEC, kein EDNS0, kein AXFR/IXFR, kein SRV/CAA/TLSA, kein Caching.</td>
</tr>
<tr>
  <td>DHCP (v4)</td><td>RFC 2131, RFC 2132</td>
  <td><span class="badge badge-partial">Teilweise</span></td>
  <td>Vollständiger DISCOVER → OFFER → REQUEST → ACK/NAK-Ablauf plus RELEASE. Optionen: Subnet Mask (1), Router (3), DNS (6), Hostname (12), Requested IP (50), Lease Time (51), Server ID (54), T1/T2 (58/59), Client ID (61). Kein Relay Agent (Option 82), kein Vendor-Specific (Option 43), kein INFORM.</td>
</tr>
<tr>
  <td>DHCPv6</td><td>RFC 3315, RFC 8415, RFC 3633</td>
  <td><span class="badge badge-partial">Teilweise</span></td>
  <td>Nachrichten: SOLICIT, ADVERTISE, REQUEST, CONFIRM, RENEW, REBIND, REPLY, RELEASE, DECLINE, INFORMATION-REQUEST. Optionen: Client/Server-ID (DUID-LL), IA_NA, IAADDR, ORO, Preference, Elapsed Time, Status Code, DNS-Server, Domain List. <strong>Prefix Delegation (IA_PD/IAPREFIX, RFC 3633):</strong> als Client vollständig implementiert (HomeRouter bezieht delegiertes Präfix inkl. T1-Renewal). Der konfigurierbare DHCPv6-Serverapp vergibt jedoch nur IA_NA — er kann keine Präfixe delegieren. Kein IA_TA, kein Relay, kein statusloses DHCPv6.</td>
</tr>
</tbody>
</table>

### HTTP / HTTPS / TLS

<table class="pt">
<thead><tr><th>Protokoll</th><th>RFC</th><th>Unterstützung</th><th>Anmerkungen &amp; Grenzen</th></tr></thead>
<tbody>
<tr>
  <td>HTTP/1.1</td><td>RFC 7230–7235</td>
  <td><span class="badge badge-partial">Teilweise</span></td>
  <td><strong>Server:</strong> GET und HEAD, statisches Dateiserving mit MIME-Erkennung, Verzeichnis-Index, konfigurierbarer Dokumentroot und Port, Dual-Stack (IPv4/IPv6). <strong>Client (Sparktail):</strong> GET mit DNS-Auflösung, IPv6-Bracket-Notation, Adressleiste mit History, Tabs (Vorschau/Quelltext/Header/Log), CSS- und Bild-Ressourcen inline eingebettet, Content-Length und Chunked-Transfer-Dekodierung. Kein POST/PUT/DELETE, keine persistenten Verbindungen, keine Authentifizierung, keine Cache-Header.</td>
</tr>
<tr>
  <td>TLS 1.2</td><td>RFC 5246</td>
  <td><span class="badge badge-partial">Teilweise</span></td>
  <td><strong>Vollständiger Handshake simuliert:</strong> ClientHello → ServerHello → Certificate → ServerKeyExchange → ServerHelloDone → ClientKeyExchange → ChangeCipherSpec → Finished. <strong>Cipher Suite:</strong> TLS_ECDHE_ECDSA_WITH_AES_128_GCM_SHA256 (0xC02B). <strong>Schlüsselaustausch:</strong> ECDHE mit secp256r1, Server signiert mit ECDSA. <strong>Zertifikate:</strong> Selbstsignierte und CA-signierte X.509-Zertifikate; Trust-Store-Validierung mit Überbrückungsoption. Kein Session-Resumption, keine Client-Zertifikatsauthentifizierung, keine SNI-Durchsetzung serverseitig, kein OCSP/CRL, kein TLS 1.3.</td>
</tr>
</tbody>
</table>

### E-Mail — SMTP, POP3, IMAP

Der Mailserver bedient alle drei Protokolle in einem Prozess. Der Mailclient unterstützt POP3 oder IMAP zum Empfangen und SMTP zum Senden.

<table class="pt">
<thead><tr><th>Protokoll</th><th>RFC</th><th>Unterstützung</th><th>Anmerkungen &amp; Grenzen</th></tr></thead>
<tbody>
<tr>
  <td>SMTP</td><td>RFC 5321, RFC 3207, RFC 4954</td>
  <td><span class="badge badge-partial">Teilweise</span></td>
  <td>EHLO/HELO, MAIL FROM, RCPT TO, DATA (Dot-Stuffing), QUIT. STARTTLS für opportunistische Verschlüsselung. AUTH PLAIN und AUTH LOGIN. Automatischer MX-Lookup und Relay zu entfernten SMTP-Servern; lokale Zustellung bei übereinstimmender Domain. Bounce-Erzeugung bei nicht zustellbarer Mail. Kein DKIM, kein SPF, kein SMTP-Pipelining.</td>
</tr>
<tr>
  <td>POP3</td><td>RFC 1939</td>
  <td><span class="badge badge-partial">Teilweise</span></td>
  <td>USER/PASS-Authentifizierung, STAT, LIST, RETR, DELE, NOOP, RSET, QUIT. Implizites TLS (POP3S) unterstützt. Löschungen werden erst beim QUIT persistiert. Kein UIDL, kein APOP, kein TOP-Kommando.</td>
</tr>
<tr>
  <td>IMAP4</td><td>RFC 3501</td>
  <td><span class="badge badge-partial">Teilweise</span></td>
  <td>LOGIN, SELECT INBOX, SEARCH ALL, FETCH BODY[], STORE \Seen-Flags, LOGOUT. Nur der INBOX-Ordner wird unterstützt. Kein Ordnermanagement (CREATE, DELETE, RENAME), kein COPY, kein APPEND, kein IDLE-Push.</td>
</tr>
</tbody>
</table>

### IRC

<table class="pt">
<thead><tr><th>Protokoll</th><th>RFC</th><th>Unterstützung</th><th>Anmerkungen &amp; Grenzen</th></tr></thead>
<tbody>
<tr>
  <td>IRC</td><td>RFC 1459</td>
  <td><span class="badge badge-partial">Teilweise</span></td>
  <td><strong>Server:</strong> NICK, USER, JOIN, PART, PRIVMSG, NOTICE, TOPIC, LIST, NAMES, WHO, WHOIS, MODE (Basis), PING/PONG, CAP, QUIT. <strong>Client:</strong> /join, /part, /nick, /msg, /me (CTCP ACTION), /list, /names, /topic, /whois, /quit. Channel-Unread-Count, DM-Tabs. Keine Mode-Durchsetzung, kein KICK/BAN/OPER, kein DCC, kein Server-Verbund.</td>
</tr>
</tbody>
</table>

### Weitere Anwendungen

<table class="pt">
<thead><tr><th>Anwendung</th><th>Protokoll / RFC</th><th>Unterstützung</th><th>Anmerkungen &amp; Grenzen</th></tr></thead>
<tbody>
<tr>
  <td>TCP-Echo-Server</td><td>RFC 862</td>
  <td><span class="badge badge-full">Vollständig</span></td>
  <td>Lauscht auf konfigurierbarem Port (Standard 7), spiegelt alle empfangenen Bytes. Parallele Verbindungen werden geloggt.</td>
</tr>
<tr>
  <td>UDP-Echo-Server</td><td>RFC 862</td>
  <td><span class="badge badge-partial">Teilweise</span></td>
  <td>Spiegelt UDP-Datagramme auf konfigurierbarem Port (Standard 7). Nur IPv4 — IPv6-Quelladressen werden aufgrund von API-Einschränkungen nicht korrekt zurückgesendet.</td>
</tr>
<tr>
  <td>Raw-TCP-Client</td><td>—</td>
  <td><span class="badge badge-full">Vollständig</span></td>
  <td>Verbindung zu beliebigem Host:Port, Senden/Empfangen von UTF-8-Text mit Hex-Vorschau. Nützlich zur manuellen Protokollerkundung.</td>
</tr>
<tr>
  <td>Bitcoin-Knoten</td><td>Bitcoin P2P (v70015)</td>
  <td><span class="badge badge-stub">Stub</span></td>
  <td>Version/Verack-Handshake, INV/GETDATA-Dissemination, Mempool, einfache Blockchain mit Longest-Chain-Auswahl, Orphan-Block-Behandlung, einfaches Wallet. Mining erzeugt Blöcke sofort — kein echtes Proof-of-Work. Transaktionen werden weder kryptographisch signiert noch validiert. Das UTXO-Modell ist durch ein einfaches Absender/Empfänger/Betrag-Ledger ersetzt.</td>
</tr>
<tr>
  <td>Zertifikatsmanager</td><td>X.509 (RFC 5280)</td>
  <td><span class="badge badge-partial">Teilweise</span></td>
  <td>Selbstsignierte und CA-signierte Zertifikate erzeugen; Gültigkeitsdauer und CA-Flag konfigurieren; Trust-Store verwalten; Zertifikate mit einer CA signieren. Kein CRL, kein OCSP, keine Key-Usage-Extensions jenseits isCA.</td>
</tr>
</tbody>
</table>

## Routingprotokolle

Dynamische Routing-Daemons laufen innerhalb von Router- und HomeRouter-Knoten.

<table class="pt">
<thead><tr><th>Protokoll</th><th>RFC</th><th>Unterstützung</th><th>Anmerkungen &amp; Grenzen</th></tr></thead>
<tbody>
<tr>
  <td>RIPv2</td><td>RFC 2453</td>
  <td><span class="badge badge-partial">Teilweise</span></td>
  <td>Request/Response-Nachrichten, AFI, Metrik (0–16, 16 = Unendlich), Subnetzmaske, Next Hop, Route Tag. Keine MD5-Authentifizierung, kein RIPv1-Modus, vereinfachtes Split Horizon.</td>
</tr>
<tr>
  <td>RIPng</td><td>RFC 2080</td>
  <td><span class="badge badge-partial">Teilweise</span></td>
  <td>IPv6-Prefix-Einträge (128 Bit), Prefix-Länge, Metrik, Next-Hop-Marker (0xFF). Vereinfachter Daemon — kein Split Horizon with Poison Reverse.</td>
</tr>
<tr>
  <td>OSPFv2</td><td>RFC 2328</td>
  <td><span class="badge badge-partial">Teilweise</span></td>
  <td>Alle fünf Nachrichtentypen: Hello, DBD, LSR, LSU, LSAck. LSA-Typen: Router (1), Network (2), Summary (3). Hello: DR/BDR-Wahl, Nachbarliste, Dead Interval. DBD: Sequenznummer, Flags (MS/M/I). Fletcher-Prüfsumme für LSA-Bodies. Keine Authentifizierung (Felder vorhanden, aber ignoriert), keine virtuellen Links, kein NSSA, kein External LSA (Typ 5), vereinfachte SPF-State-Machine.</td>
</tr>
<tr>
  <td>BGPv4</td><td>RFC 4271, RFC 4760, RFC 5492</td>
  <td><span class="badge badge-partial">Teilweise</span></td>
  <td>OPEN, UPDATE, NOTIFICATION, KEEPALIVE. Pfadattribute: ORIGIN, AS_PATH, NEXT_HOP, MED, LOCAL_PREF, MP_REACH_NLRI, MP_UNREACH_NLRI. Multiprotokoll-Erweiterungen für IPv6 (AFI 2). Keine Routing-Policies, keine Community-Attribute, keine MD5-Authentifizierung, kein Route Reflection, vereinfachte FSM.</td>
</tr>
</tbody>
</table>

## Paketaufzeichnung & Analyse

BeaverTracer zeichnet den gesamten simulierten Datenverkehr intern im standardmäßigen **libpcap-Format** auf (Magic `0xa1b2c3d4`, Link Type 1 = Ethernet). Die Aufzeichnung steht direkt im Browser zur Analyse bereit; ein Download der `.pcap`-Datei ist derzeit nicht vorgesehen.

Die Analyse wird von **Wiregasm** übernommen — einem WebAssembly-Build von Wiresharks *libwireshark* — der vollständige Protokolldissection, einen Paket-Detail-Baum, Hex-Dump und Display-Filter-Unterstützung für über 1.000 Protokolle bietet.

<table class="pt">
<thead><tr><th>Komponente</th><th>Format / Standard</th><th>Unterstützung</th><th>Anmerkungen</th></tr></thead>
<tbody>
<tr>
  <td>PCAP-Aufzeichnung</td><td>libpcap (pcap, nicht pcapng)</td>
  <td><span class="badge badge-full">Vollständig</span></td>
  <td>Global-Header + pro-Paket-Records, Ethernet Link Type. Rein intern — kein Datei-Download, keine Live-Capture-Schnittstelle.</td>
</tr>
<tr>
  <td>Browser-Dissection</td><td>Wiregasm / Wireshark</td>
  <td><span class="badge badge-full">Vollständig</span></td>
  <td>Über 1.000 Protokoll-Dissektor, Display-Filter, Paketbaum, Hex-Ansicht. Nur lesend — Pakete können in der Tracer-Oberfläche nicht verändert werden.</td>
</tr>
</tbody>
</table>

## Globale Simulationsgrenzen

Einige Einschränkungen gelten simulatorweit, unabhängig vom Protokoll:

- **Keine IPv4-Fragmentierung.** Pakete, die eine MTU überschreiten würden, werden ungeteilt gesendet; am Zielknoten findet keine Reassembly statt.
- **Keine IPv6-Extension-Headers.** Hop-by-Hop-, Routing-, Fragment- und Destination-Options-Header werden weder erzeugt noch geparst.
- **Keine TCP-Options.** MSS-Aushandlung, Window Scaling, SACK und TCP Timestamps sind nicht implementiert; Fenstergrößen sind fest.
- **Kein Multicast-Management.** IGMP (IPv4) und MLD (IPv6) fehlen; Multicast-Weiterleitung basiert auf Flooding innerhalb der Simulation.
- **Keine Routing-Protokoll-Authentifizierung.** MD5/SHA-Schlüsselketten für OSPF, BGP und RIPv2 sind strukturell vorhanden, werden aber nicht durchgesetzt.
- **Keine echte Kryptographie außer bei TLS.** Bitcoin-Signaturen, DNSSEC-Records und ähnliche kryptographische Konstrukte werden gefälscht oder weggelassen.
- **Nur ein VLAN-Tag.** Double-Tagged (QinQ) Frames werden nicht unterstützt.
- **Vereinfachte Timer.** Protokoll-Timer (OSPF Hello, BGP Hold Time, DHCP-Lease-Ablauf) laufen auf einer simulierten Tick-Uhr, die standardmäßig schneller als die Echtzeit läuft.
