# Firewall: Who Gets In, Who Gets Out?

:::goal
**Learning goal:** You can explain how a packet filter works with rules, set up rules yourself and put them in the right order, tell drop and reject apart, explain the difference between a stateless and a stateful firewall, build a DMZ and find mistakes in firewall rules.
:::

:::osi 4
:::

:::sim
url=/sims/lesson-9.btsim
:::

The Beaver school has its own public addresses (`198.51.100.…`): its **Schulserver** (school server) can be reached directly from the internet — without NAT, as it will soon be everywhere with IPv6 (chapter 7.3). Between the internet and the **Schulrouter** (school router) sits a **firewall**, which currently lets everything through.

On the left you see "the internet": an **Internet-PC** and the web server `www.beispiel.de`. On the right the school network with the **Schulserver** and the **Lehrer-PC** (teacher PC).

## What does an attacker see?

Anyone who wants to attack a server first looks for **open ports** — services waiting for connections. The tool for this is called a **port scanner**; the best known is `nmap`.

Switch to :fa-play: **Run** mode, open the :fa-terminal: **Terminal** on the **Internet-PC** and enter:

```
$ nmap 198.51.100.10
```

`nmap` tries to open a TCP connection to the 20 most common ports and reports which ones are open.

:::quiz multi
Which ports on the school server are open from the internet?
- [x] 22 (SSH, remote administration)
- [x] 25 (SMTP)
- [x] 80 (HTTP)
- [x] 110 (POP3)
- [x] 143 (IMAP)
- [ ] 443 (HTTPS)
:::

:::evaluate
Check answer
:::

The website (80) and receiving e-mail (25) are meant to be reachable from the internet. But **remote administration** (22) and fetching mail (110, 143) are only needed inside the school network. Every open port is a possible attack surface: if the service has a security hole or a weak password, an attacker can exploit it from anywhere in the world — and automated scanners on the internet try exactly that around the clock.

:::tip Key point
A **firewall** controls the traffic at the border between two networks and lets through only what is explicitly allowed. This keeps services that are only needed internally invisible to the internet.
:::
