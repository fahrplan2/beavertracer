# Layers 5–7: Application layer

:::goal
**Learning goal:** You can recognise the most important application layer protocols — HTTP, DNS, SMTP/POP3/IMAP and DHCP — in the tracer, explain how they work and find typical faults.
:::

:::osi 7
:::

:::sim
url=/sims/lesson-6.1.btsim
:::

In chapter 5 you saw: TCP and UDP deliver data reliably (or fast) to the right program — via the ports. *What* is in this data is defined by the protocols of the **application layer**. In the TCP/IP model this is one layer; in the ISO/OSI model it corresponds to layers 5 to 7.

Each of these protocols has its own job — and its own port:

| Protocol | Job | Port | Transport |
|---|---|---|---|
| **HTTP** | fetching web pages | 80 | TCP |
| **DNS** | translating names into IP addresses | 53 | mostly UDP |
| **SMTP** | sending e-mails | 25 | TCP |
| **POP3** / **IMAP** | collecting e-mails | 110 / 143 | TCP |
| **DHCP** | giving a device an IP address automatically | 67 / 68 | UDP |

In chapter 1.3 you still loaded a web page via its IP address. In everyday life nobody types `192.168.0.20` — and no new laptop gets its address entered by hand. How all of this works together you'll discover in this chapter, protocol by protocol.
