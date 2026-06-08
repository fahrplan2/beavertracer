# Protocol & RFC Support

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

BeaverTracer is an educational network simulator. It models a wide range of standard protocols — faithfully enough to teach and observe real network behaviour, with deliberate simplifications where full compliance would add complexity without pedagogical value.

**Legend:** <span class="badge badge-full">Full</span> all essential fields and message types implemented &nbsp; <span class="badge badge-partial">Partial</span> core behaviour modelled, edge cases omitted &nbsp; <span class="badge badge-stub">Stub</span> structure present, behaviour not simulated

[[toc]]

## Link Layer

<table class="pt">
<thead><tr><th>Protocol</th><th>Standard</th><th>Support</th><th>Notes &amp; Limitations</th></tr></thead>
<tbody>
<tr>
  <td>Ethernet II</td><td>IEEE 802.3</td>
  <td><span class="badge badge-full">Full</span></td>
  <td>Src/Dst MAC, EtherType, minimum frame padding. No FCS/CRC validation, no jumbo frames.</td>
</tr>
<tr>
  <td>802.1Q VLAN</td><td>IEEE 802.1Q</td>
  <td><span class="badge badge-partial">Partial</span></td>
  <td>PCP (3 bit), DEI, VID (12 bit), inner EtherType. Single tag only — no QinQ (802.1ad) stacking.</td>
</tr>
<tr>
  <td>Spanning Tree (STP)</td><td>IEEE 802.1D-2004</td>
  <td><span class="badge badge-partial">Partial</span></td>
  <td>Config-BPDU and TCN-BPDU with Bridge ID, Port ID, path cost, timers. No RSTP (802.1w), no MSTP, no BPDU Guard.</td>
</tr>
</tbody>
</table>

## Network Layer

<table class="pt">
<thead><tr><th>Protocol</th><th>RFC</th><th>Support</th><th>Notes &amp; Limitations</th></tr></thead>
<tbody>
<tr>
  <td>IPv4</td><td>RFC 791</td>
  <td><span class="badge badge-partial">Partial</span></td>
  <td>All header fields including DSCP/ECN, flags (DF/MF), fragment offset, TTL, checksum. Options field carried but not interpreted. No fragmentation reassembly.</td>
</tr>
<tr>
  <td>IPv6</td><td>RFC 2460</td>
  <td><span class="badge badge-partial">Partial</span></td>
  <td>Version, Traffic Class (DSCP/ECN), Flow Label, Payload Length, Next Header, Hop Limit, 128-bit addresses. Extension headers are not parsed — they remain opaque in the payload.</td>
</tr>
<tr>
  <td>ARP</td><td>RFC 826</td>
  <td><span class="badge badge-full">Full</span></td>
  <td>HTYPE, PTYPE, SHA/SPA/THA/TPA, Request and Reply operations. No Gratuitous ARP or Probe/Announcement (RFC 5227).</td>
</tr>
<tr>
  <td>ICMPv4</td><td>RFC 792</td>
  <td><span class="badge badge-partial">Partial</span></td>
  <td>Echo Request (type 8) and Echo Reply (type 0) fully decoded with Identifier and Sequence. Other types (Destination Unreachable, Time Exceeded, Redirect …) are forwarded but not decoded into typed fields.</td>
</tr>
<tr>
  <td>ICMPv6 &amp; NDP</td><td>RFC 4443, RFC 4861</td>
  <td><span class="badge badge-partial">Partial</span></td>
  <td>Echo (128/129), Neighbor Solicitation (135), Neighbor Advertisement (136), Router Solicitation (133), Router Advertisement (134). RA options: SLLA/TLLA (type 1/2) and Prefix Information (type 3). No MTU option (type 5), no Redirect Header, no Redirect message (type 137).</td>
</tr>
<tr>
  <td>GRE</td><td>RFC 2784</td>
  <td><span class="badge badge-partial">Partial</span></td>
  <td>Minimal 4-byte fixed header with Protocol Type. Optional Checksum/Key/Sequence fields are decoded on input but not generated. No RFC 2890 extensions.</td>
</tr>
</tbody>
</table>

## Transport Layer

<table class="pt">
<thead><tr><th>Protocol</th><th>RFC</th><th>Support</th><th>Notes &amp; Limitations</th></tr></thead>
<tbody>
<tr>
  <td>TCP</td><td>RFC 793, RFC 3168</td>
  <td><span class="badge badge-partial">Partial</span></td>
  <td>All header fields: ports, sequence/ack numbers, data offset, all 8 flags (incl. ECE/CWR), window, checksum, urgent pointer. MSS is negotiated during the SYN handshake (sent and parsed). Window Scale, SACK, and Timestamps are not negotiated; window sizes are fixed. No congestion control.</td>
</tr>
<tr>
  <td>UDP</td><td>RFC 768</td>
  <td><span class="badge badge-full">Full</span></td>
  <td>Ports, length, checksum (optional for IPv4, required for IPv6). No further limitations.</td>
</tr>
</tbody>
</table>

## Address Configuration

<table class="pt">
<thead><tr><th>Mechanism</th><th>RFC / Standard</th><th>Support</th><th>Notes &amp; Limitations</th></tr></thead>
<tbody>
<tr>
  <td>APIPA</td><td>RFC 3927</td>
  <td><span class="badge badge-partial">Partial</span></td>
  <td>Automatically assigns a link-local address from 169.254.0.0/16 when no DHCP server is reachable. No ARP probe for conflict detection before assignment.</td>
</tr>
<tr>
  <td>DAD (Duplicate Address Detection)</td><td>RFC 4862</td>
  <td><span class="badge badge-partial">Partial</span></td>
  <td>Sends a Neighbor Solicitation from <code>::</code> to the solicited-node multicast address and waits a configured interval. Conflicts are detected and the address is discarded. Runs for static IPv6 addresses and SLAAC. Only one NS probe — no multiple retries as specified by RFC.</td>
</tr>
</tbody>
</table>

## Application Layer

### DNS & DHCP

<table class="pt">
<thead><tr><th>Protocol</th><th>RFC</th><th>Support</th><th>Notes &amp; Limitations</th></tr></thead>
<tbody>
<tr>
  <td>DNS</td><td>RFC 1035, RFC 1123, RFC 3596</td>
  <td><span class="badge badge-partial">Partial</span></td>
  <td><strong>Record types:</strong> A, AAAA, CNAME, MX, NS, PTR, SOA, TXT. <strong>Modes:</strong> Authoritative (zone data) and Recursive (forwarder). Name compression on parse; no compression when packing responses. No DNSSEC, no EDNS0, no AXFR/IXFR, no SRV/CAA/TLSA, no caching.</td>
</tr>
<tr>
  <td>DHCP (v4)</td><td>RFC 2131, RFC 2132</td>
  <td><span class="badge badge-partial">Partial</span></td>
  <td>Full DISCOVER → OFFER → REQUEST → ACK/NAK lifecycle plus RELEASE. Options: Subnet Mask (1), Router (3), DNS (6), Hostname (12), Requested IP (50), Lease Time (51), Server ID (54), T1/T2 (58/59), Client ID (61). No relay agent (option 82), no vendor-specific (option 43), no INFORM.</td>
</tr>
<tr>
  <td>DHCPv6</td><td>RFC 3315, RFC 8415, RFC 3633</td>
  <td><span class="badge badge-partial">Partial</span></td>
  <td>Messages: SOLICIT, ADVERTISE, REQUEST, CONFIRM, RENEW, REBIND, REPLY, RELEASE, DECLINE, INFORMATION-REQUEST. Options: Client/Server ID (DUID-LL), IA_NA, IAADDR, ORO, Preference, Elapsed Time, Status Code, DNS Servers, Domain List. <strong>Prefix Delegation (IA_PD/IAPREFIX, RFC 3633):</strong> fully implemented on the client side — the HomeRouter acquires a delegated prefix including T1 renewal. The configurable DHCPv6 server app only hands out IA_NA addresses and cannot delegate prefixes. No IA_TA, no relay, no stateless DHCPv6.</td>
</tr>
</tbody>
</table>

### HTTP / HTTPS / TLS

<table class="pt">
<thead><tr><th>Protocol</th><th>RFC</th><th>Support</th><th>Notes &amp; Limitations</th></tr></thead>
<tbody>
<tr>
  <td>HTTP/1.1</td><td>RFC 7230–7235</td>
  <td><span class="badge badge-partial">Partial</span></td>
  <td><strong>Server:</strong> GET and HEAD methods, static file serving with MIME detection, directory index, configurable document root and port, dual-stack (IPv4/IPv6). <strong>Client (Sparktail):</strong> GET with DNS resolution, IPv6 bracket notation, address bar with history, Preview/Source/Headers/Log tabs, inline CSS and image resources, Content-Length and chunked transfer decoding. No POST/PUT/DELETE, no persistent connections, no authentication, no cache headers.</td>
</tr>
<tr>
  <td>TLS 1.2</td><td>RFC 5246</td>
  <td><span class="badge badge-partial">Partial</span></td>
  <td><strong>Full handshake simulated:</strong> ClientHello → ServerHello → Certificate → ServerKeyExchange → ServerHelloDone → ClientKeyExchange → ChangeCipherSpec → Finished. <strong>Cipher suite:</strong> TLS_ECDHE_ECDSA_WITH_AES_128_GCM_SHA256 (0xC02B). <strong>Key exchange:</strong> ECDHE with secp256r1; server signs with ECDSA. <strong>Certificates:</strong> Self-signed and CA-signed X.509; trust store validation with opt-out. No session resumption, no client certificate auth, no SNI enforcement on server, no OCSP/CRL, no TLS 1.3.</td>
</tr>
</tbody>
</table>

### E-Mail — SMTP, POP3, IMAP

The mail server handles all three protocols in one process. The mail client supports POP3 or IMAP for receiving and SMTP for sending.

<table class="pt">
<thead><tr><th>Protocol</th><th>RFC</th><th>Support</th><th>Notes &amp; Limitations</th></tr></thead>
<tbody>
<tr>
  <td>SMTP</td><td>RFC 5321, RFC 3207, RFC 4954</td>
  <td><span class="badge badge-partial">Partial</span></td>
  <td>EHLO/HELO, MAIL FROM, RCPT TO, DATA (dot-stuffing), QUIT. STARTTLS for opportunistic encryption. AUTH PLAIN and AUTH LOGIN. Automatic MX lookup and relay to remote SMTP servers; local delivery when domain matches. Bounce generation for undeliverable mail. No DKIM, no SPF, no SMTP pipelining.</td>
</tr>
<tr>
  <td>POP3</td><td>RFC 1939</td>
  <td><span class="badge badge-partial">Partial</span></td>
  <td>USER/PASS authentication, STAT, LIST, RETR, DELE, NOOP, RSET, QUIT. Implicit TLS (POP3S) supported. Deletions persist only on QUIT. No UIDL, no APOP, no TOP command.</td>
</tr>
<tr>
  <td>IMAP4</td><td>RFC 3501</td>
  <td><span class="badge badge-partial">Partial</span></td>
  <td>LOGIN, SELECT INBOX, SEARCH ALL, FETCH BODY[], STORE \Seen flags, LOGOUT. Only the INBOX folder is supported. No folder management (CREATE, DELETE, RENAME), no COPY, no APPEND, no IDLE push.</td>
</tr>
</tbody>
</table>

### IRC

<table class="pt">
<thead><tr><th>Protocol</th><th>RFC</th><th>Support</th><th>Notes &amp; Limitations</th></tr></thead>
<tbody>
<tr>
  <td>IRC</td><td>RFC 1459</td>
  <td><span class="badge badge-partial">Partial</span></td>
  <td><strong>Server:</strong> NICK, USER, JOIN, PART, PRIVMSG, NOTICE, TOPIC, LIST, NAMES, WHO, WHOIS, MODE (basic), PING/PONG, CAP, QUIT. <strong>Client:</strong> /join, /part, /nick, /msg, /me (CTCP ACTION), /list, /names, /topic, /whois, /quit. Channel unread count, DM tabs. No mode enforcement, no KICK/BAN/OPER, no DCC, no server federation.</td>
</tr>
</tbody>
</table>

### Other Applications

<table class="pt">
<thead><tr><th>Application</th><th>Protocol / RFC</th><th>Support</th><th>Notes &amp; Limitations</th></tr></thead>
<tbody>
<tr>
  <td>TCP Echo Server</td><td>RFC 862</td>
  <td><span class="badge badge-full">Full</span></td>
  <td>Listens on configurable port (default 7), echoes all received bytes. Concurrent connections logged.</td>
</tr>
<tr>
  <td>UDP Echo Server</td><td>RFC 862</td>
  <td><span class="badge badge-partial">Partial</span></td>
  <td>Echoes UDP datagrams on configurable port (default 7). IPv4 only — IPv6 source addresses not echoed correctly due to API limitations.</td>
</tr>
<tr>
  <td>Raw TCP Client</td><td>—</td>
  <td><span class="badge badge-full">Full</span></td>
  <td>Connect to any host:port, send/receive UTF-8 text with hex preview. Useful for manual protocol exploration.</td>
</tr>
<tr>
  <td>Bitcoin Node</td><td>Bitcoin P2P (v70015)</td>
  <td><span class="badge badge-stub">Stub</span></td>
  <td>Version/Verack handshake, INV/GETDATA dissemination, mempool, simple blockchain with longest-chain selection, orphan handling, basic wallet. Mining produces blocks instantly — no real proof-of-work. Transactions are not cryptographically signed or validated. UTXO model replaced by a simple from/to/amount ledger.</td>
</tr>
<tr>
  <td>Certificate Manager</td><td>X.509 (RFC 5280)</td>
  <td><span class="badge badge-partial">Partial</span></td>
  <td>Generate self-signed and CA-signed certificates; configure validity period and CA flag; manage trust store; sign certificates with an existing CA. No CRL, no OCSP, no key usage extensions beyond isCA.</td>
</tr>
</tbody>
</table>

## Routing Protocols

Dynamic routing daemons run inside Router and HomeRouter nodes.

<table class="pt">
<thead><tr><th>Protocol</th><th>RFC</th><th>Support</th><th>Notes &amp; Limitations</th></tr></thead>
<tbody>
<tr>
  <td>RIPv2</td><td>RFC 2453</td>
  <td><span class="badge badge-partial">Partial</span></td>
  <td>Request/Response messages, AFI, metric (0–16, 16 = infinity), subnet mask, next hop, route tag. No MD5 authentication, no RIPv1 mode, simplified split horizon.</td>
</tr>
<tr>
  <td>RIPng</td><td>RFC 2080</td>
  <td><span class="badge badge-partial">Partial</span></td>
  <td>IPv6 prefix entries (128-bit), prefix length, metric, next-hop marker (0xFF). Simplified daemon — no split horizon with poison reverse.</td>
</tr>
<tr>
  <td>OSPFv2</td><td>RFC 2328</td>
  <td><span class="badge badge-partial">Partial</span></td>
  <td>All five message types: Hello, DBD, LSR, LSU, LSAck. LSA types: Router (1), Network (2), Summary (3). Hello: DR/BDR election, neighbour list, dead interval. DBD: sequence, flags (MS/M/I). Fletcher checksum on LSA bodies. No authentication (fields present but ignored), no virtual links, no NSSA, no External LSA (type 5), simplified SPF state machine.</td>
</tr>
<tr>
  <td>BGPv4</td><td>RFC 4271, RFC 4760, RFC 5492</td>
  <td><span class="badge badge-partial">Partial</span></td>
  <td>OPEN, UPDATE, NOTIFICATION, KEEPALIVE. Path attributes: ORIGIN, AS_PATH, NEXT_HOP, MED, LOCAL_PREF, MP_REACH_NLRI, MP_UNREACH_NLRI. Multiprotocol extensions for IPv6 (AFI 2). No route policies or filters, no community attributes, no MD5 authentication, no route reflection, simplified FSM.</td>
</tr>
</tbody>
</table>

## Packet Capture & Analysis

BeaverTracer records all simulated traffic internally in standard **libpcap format** (magic `0xa1b2c3d4`, link type 1 = Ethernet). The capture is available directly in the browser for analysis; downloading the `.pcap` file is not currently supported.

In-browser analysis is powered by **Wiregasm** — a WebAssembly build of Wireshark's *libwireshark* — which provides full protocol dissection, a packet detail tree, hex dump, and display-filter support for over 1,000 protocols.

<table class="pt">
<thead><tr><th>Component</th><th>Format / Standard</th><th>Support</th><th>Notes</th></tr></thead>
<tbody>
<tr>
  <td>PCAP recording</td><td>libpcap (pcap, not pcapng)</td>
  <td><span class="badge badge-full">Full</span></td>
  <td>Global header + per-packet records, Ethernet link type. Internal only — no file download, no live capture interface.</td>
</tr>
<tr>
  <td>In-browser dissection</td><td>Wiregasm / Wireshark</td>
  <td><span class="badge badge-full">Full</span></td>
  <td>1,000+ protocol dissectors, display filters, packet tree, hex view. Read-only — packets cannot be modified in the tracer UI.</td>
</tr>
</tbody>
</table>

## Global Simulation Limits

Some constraints apply across the entire simulator regardless of protocol:

- **No IPv4 fragmentation.** Packets that would exceed an MTU are sent as-is; there is no reassembly at the destination.
- **No IPv6 extension headers.** Hop-by-Hop, Routing, Fragment, and Destination Options headers are not generated or parsed.
- **Partial TCP options.** MSS is negotiated during the SYN handshake. Window scaling, SACK, and TCP Timestamps are not implemented; window sizes are fixed (no scaling).
- **No multicast management.** IGMP (IPv4) and MLD (IPv6) are absent; multicast forwarding relies on flooding within the simulation.
- **No routing protocol authentication.** MD5/SHA keychains for OSPF, BGP, and RIPv2 are structurally present but not enforced.
- **No real cryptography beyond TLS.** Bitcoin signatures, DNSSEC records, and similar cryptographic constructs are faked or omitted.
- **Single VLAN tag only.** Double-tagged (QinQ) frames are not supported.
- **Simplified timers.** Protocol timers (OSPF Hello, BGP hold time, DHCP lease expiry) run on a simulated tick clock that is faster than wall time by default.
