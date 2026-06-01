# Introduction to BeaverTracer

[[toc]]

## What is BeaverTracer?

BeaverTracer is a visual network simulator that runs entirely in the browser. You can use it to build networks from real protocols, configure connections, and watch data packets travel from device to device — all without physical hardware or administrator privileges.

Beavers don't wait for things to happen — they get to work. They build, log by log, until a dam stands where there was only a stream. That's exactly what you do here: packet by packet, connection by connection, until a whole network makes sense.

The built-in **packet tracer** makes traffic visible and analysable — powered by Wireshark technology, but integrated into a friendlier learning environment.

:::tip
BeaverTracer uses real protocol implementations. What you see here behaves like a real network — ARP, DHCP, TCP handshakes, routing updates and much more run as genuine packets and are visible in the tracer.
:::

## The Interface

The interface consists of four main areas:

**Canvas (centre):** This is where you build your network. Devices can be dragged from the palette on the left, repositioned freely, and connected by clicking on ports.

**Device palette (left):** Contains all available device types that you can drag onto the canvas.

**Toolbar (top):** Use :fa-play: **Start**, :fa-stop: **Stop**, and the reset button to control the simulation. Quick access to the tracer and settings is also here.

**Packet tracer (bottom / separate window):** Shows all recorded packets with a protocol tree, hex dump, and filter bar. It opens from the toolbar.

## Device Types

| Device | Icon | Description |
|--------|------|-------------|
| **Computer** | :fa-desktop: | End device with a network stack, terminal, and installable apps. The most common node type. |
| **Router** | :router: | Forwards packets between networks. Supports static routes and routing protocols (RIP, OSPF, BGP). |
| **Switch** | :switch: | Connects multiple devices in the same segment. Learns MAC addresses and forwards selectively. |
| **HomeRouter** | :fa-house-signal: | Combines router, switch, and DHCP server — a typical DSL/cable router with WAN and LAN sides, NAT, and an optional DHCPv6-PD client. |
| **Firewall** | :fa-shield-halved: | Filters packets by configurable rules (direction, IP version, protocol, port). |
| **Access Point** | :fa-wifi: | Connects wireless devices (tablets) to a wired network. |
| **Tablet** | :fa-tablet-screen-button: | Wireless end device with a built-in browser (Sparktail). |

Additionally, **text boxes** and **rectangle overlays** are available for labelling and structuring the canvas.

## Basic Usage

### Building a Network

1. Drag a device from the palette onto the canvas.
2. Click a **port** (small circle on the device) and then click a port on another device — this draws a cable.
3. Double-click a device to open its configuration.

### Configuring Devices

Each device has a configuration window with tabs. Typical tabs include:

- **Network tab:** IP addresses, subnet mask, gateway, DNS — either static or via DHCP.
- **Apps tab:** Start and configure installed services (HTTP server, DNS server, DHCP server, mail server …).
- **Routing tab** (routers): Static routes and routing daemons (RIPv2, RIPng, OSPFv2, BGP).

### Controlling the Simulation

Press :fa-play: **Start** to run the simulation. Protocols immediately begin working: devices send ARP requests, DHCP clients obtain addresses, and routing protocols exchange updates. Press :fa-stop: **Stop** to freeze the simulation; all state is preserved.

:::note
The simulation runs on its own tick clock, which may be faster than real time. Protocol timeouts (e.g. OSPF Hello interval or DHCP lease time) scale accordingly.
:::

## Applications on Devices

**Applications** can be installed on computers, routers, and home routers. They run inside the simulated operating system and communicate over the real simulated network stack:

- **Sparktail** — browser with HTTP/HTTPS support and TLS certificate validation
- **HTTP/HTTPS server** — static file serving over IPv4 and IPv6
- **DNS server** — authoritative or recursive, with A, AAAA, MX, CNAME and other record types
- **DHCP server** — assigns IPv4 addresses from a configurable pool
- **DHCPv6 server** — assigns IPv6 addresses via IA_NA
- **Mail server** — handles SMTP (with STARTTLS and relay), POP3, and IMAP4 in one process
- **Mail client** — connects to a mail server to receive and send messages
- **IRC server / IRC client** — full chat operation within the network
- **Terminal** — command line with network commands (ping, traceroute, nslookup …)
- **Certificate manager** — creates and manages X.509 certificates and trust stores

## The Packet Tracer

The packet tracer is the primary analysis tool. It records all traffic internally in **libpcap format** and analyses it using **Wiregasm** — a WebAssembly port of Wireshark's *libwireshark*.

This means every packet is dissected with the same dissectors Wireshark uses — from Ethernet and IP all the way into application-layer protocol headers.

In the tracer window you can see:

- **Packet list** with timestamp, source and destination address, protocol, and a short summary
- **Protocol tree** — expands each layer and shows individual fields with their values
- **Hex dump** — the raw bytes of the packet, colour-linked to the fields above
- **Filter bar** — Wireshark display filters such as `tcp`, `ip.src == 10.0.0.1`, or `dns`

:::tip
Open the tracer before starting the simulation — that way no packets are missed. You can filter and search by protocol or address at any time.
:::

## Further Reading

- [99. Protocol & RFC Support](99-protocol-support.html) — full list of all simulated protocols with their limitations
