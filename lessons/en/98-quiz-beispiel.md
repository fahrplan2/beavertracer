# Playground — Markdown & quiz (test page)

[[toc]]

This page is for testing Markdown syntax and interactive question types.

---

## Markdown syntax

### Text formatting

**Bold**, *italic*, ~~strikethrough~~, `inline code`, and **_combined_**.

A normal paragraph with a [link to another page](01-einfuehrung.html) and an [external link](https://www.beavertracer.eu).

### Headings

Levels H2–H4 automatically appear in the table of contents (TOC).

#### This is H4 — it doesn't show up in the TOC

### Lists

Unordered:

- Ethernet
- IP
- TCP
  - HTTP
  - SMTP

Ordered:

1. Edit mode: build the topology
2. Run mode: start the simulation
3. Trace mode: analyse packets

### Table

| Protocol | Layer | Port |
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
This is a **note** callout — for neutral hints and additional information.
:::

:::tip
This is a **tip** callout — for useful tips and recommendations.
:::

:::warning
This is a **warning** callout — for warnings that need attention.
:::

:::danger
This is a **danger** callout — for critical sources of error.
:::

:::draft
:::

### Icons

Font Awesome Solid: :fa-play: :fa-stop: :fa-desktop: :fa-shield-halved: :fa-wifi:

Font Awesome Regular: :far-file: :far-circle:

Device icons: :router: :switch:

### Embedded simulation

:::sim
url=/sims/demo.btsim
:::

### Task with behaviour check

:::task
title: Connect PC 1 and PC 2
Check whether PC 1 (id 9) has an IP in the network 192.168.0.0/24 and can reach PC 2 (id 11).
check: ip(9, "192.168.0.0/24")
check: pingOk(9, 11)
:::

---

## OSI reference model: colour scheme

Example of a rainbow-highlighted table (layer 1 at the bottom, as in the stack) and a "traffic light" in the margin with text wrapping.

### Coloured table

<table class="osi-table">
<thead>
<tr><th>Layer</th><th>Name</th><th>Example protocols</th></tr>
</thead>
<tbody>
<tr class="osi-l7"><td>7</td><td>Application</td><td>HTTP, DNS, SMTP</td></tr>
<tr class="osi-l6"><td>6</td><td>Presentation</td><td>TLS, JPEG, ASCII</td></tr>
<tr class="osi-l5"><td>5</td><td>Session</td><td>RPC, NetBIOS</td></tr>
<tr class="osi-l4"><td>4</td><td>Transport</td><td>TCP, UDP</td></tr>
<tr class="osi-l3"><td>3</td><td>Network</td><td>IP, ICMP</td></tr>
<tr class="osi-l2"><td>2</td><td>Data Link</td><td>Ethernet, ARP</td></tr>
<tr class="osi-l1"><td>1</td><td>Physical</td><td>Copper, fibre, Wi-Fi</td></tr>
</tbody>
</table>

### Traffic light with text wrapping

The traffic light is created with `:::osi N`, where `N` is the layer to highlight (here layer 3). It floats at the edge, and the following text automatically flows past it.

:::osi 3
:::

Lorem ipsum dolor sit amet, consetetur sadipscing elitr, sed diam nonumy eirmod tempor invidunt ut labore et dolore magna aliquyam erat, sed diam voluptua. At vero eos et accusam et justo duo dolores et ea rebum. Stet clita kasd gubergren, no sea takimata sanctus est Lorem ipsum dolor sit amet.

Lorem ipsum dolor sit amet, consetetur sadipscing elitr, sed diam nonumy eirmod tempor invidunt ut labore et dolore magna aliquyam erat, sed diam voluptua. At vero eos et accusam et justo duo dolores et ea rebum, which is why this section belongs to the network layer (layer 3) — that's why exactly this box in the traffic light is coloured, while all others stay grey.

---

## Section 1: Basic terms

:::quiz short
What is the CIDR notation of the subnet mask 255.255.255.0?
= /24
= 24
:::

:::quiz mc
Which of the following addresses is the network address of 192.168.1.42/24?
- [ ] 192.168.1.42
- [x] 192.168.1.0
- [ ] 192.168.1.255
- [ ] 192.168.0.0
:::

:::quiz fill
You get the network address with a bitwise {AND} of the IP address and the {subnet mask}. The highest address in the subnet is the {broadcast} address.
:::

:::evaluate
Check section 1
:::

---

## Section 2: Matching — protocols and their jobs

:::quiz match
ARP -> Finds the MAC address for an IP address
DNS -> Resolves host names into IP addresses
DHCP -> Assigns IP addresses to clients automatically
ICMP -> Is used by ping and traceroute
:::

:::evaluate
Check section 2
:::

---

## Section 3: Subnetting

:::quiz short
How many usable host addresses does a /30 subnet have?
= 2
:::

:::quiz mc
What is a /30 subnet typically used for?
- [ ] For large office networks with many devices
- [ ] As an address range for DHCP pools
- [x] As a link network between two routers
- [ ] For Wi-Fi access points
:::

:::quiz fill
A /25 subnet has {128} addresses, {126} of which can be used for hosts.
:::

:::quiz match
/24 -> 254 usable host addresses
/25 -> 126 usable host addresses
/28 -> 14 usable host addresses
/30 -> 2 usable host addresses
:::

:::evaluate
Check section 3
:::

## Section 4: Multiple choice and random tasks

With `:::quiz multi` any number of answers can be correct — every statement is assessed individually:

:::quiz multi
Which statements about ARP are true?
- [x] ARP finds the MAC address for an IP address
- [ ] ARP finds the IP address for a name
- [x] An ARP request is a broadcast
- [ ] An ARP reply is a broadcast
:::

`:::quiz random <type>` generates new tasks every time (`count=N` sets the number). Types: `bin2dec`, `dec2bin`, `cidr2mask`, `hosts`, `netbcast`, `samenet`, `subnet`.

:::quiz random dec2bin
count=2
:::

:::quiz random netbcast
Calculate for the following address:
:::

:::quiz random samenet
count=3
:::

:::quiz random subnet
:::

:::evaluate
Check section 4
:::

## Section 4b: Table to fill in

`:::quiz table` — a normal Markdown table; `{answer}` cells become input fields (separate variants with `|`):

:::quiz table
Divide `192.168.42.0/24` into two subnets:
| Subnet | Network address | Broadcast address |
|---|---|---|
| 1 | {192.168.42.0} | {192.168.42.127} |
| 2 | {192.168.42.128} | {192.168.42.255} |
:::

:::evaluate
Check table
:::

## Section 5: Colouring bits

For the IP and subnetting chapters: `[[n|…]]` = network part, `[[e|…]]` = extension, `[[h|…]]` = host part — in running text and in tables:

[[n|11111111.11111111.11111111]].[[e|11]][[h|000000]] = `255.255.255.192`

For multi-line displays, use a `<pre class="bits-block">` block instead of ``` (the colours wouldn't be displayed in code blocks):

<pre class="bits-block">
before (/24):  [[n|NNNNNNNN.NNNNNNNN.NNNNNNNN]].[[h|HHHHHHHH]]
after  (/26):  [[n|NNNNNNNN.NNNNNNNN.NNNNNNNN]].[[e|EE]][[h|HHHHHH]]
</pre>
