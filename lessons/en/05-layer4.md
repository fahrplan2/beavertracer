# Layer 4: Transport layer

:::goal
**Learning goal:** You can name the jobs of the transport layer, show the course of a TCP connection (setup, data, teardown) as a sequence diagram, explain ports as well as sequence and acknowledgement numbers, and explain when UDP is used instead of TCP.
:::

:::osi 4
:::

:::sim
url=/sims/lesson-5.1.btsim
:::

A short look back at chapter 4: the **Internet Protocol** on layer 3 brings a packet to the right *computer* — even across many routers. But IP doesn't promise any more than that:

- Many programs run on a computer at the same time: browser, mail program, messenger. Which of them is a packet meant for? That isn't in the IP header.
- If a packet gets lost on the way, IP doesn't notice. Packets can also arrive twice or in the wrong order. IP only delivers on a *best effort* basis.

**Layer 4**, the transport layer, closes these gaps. On the workspace you see a **Client-PC** and a **Server** — on them, in this chapter, you'll examine the two most important layer 4 protocols: **TCP** and **UDP**.

:::note
TCP has been standardised since 1981 (**RFC 793**, today **RFC 9293**), UDP even since 1980 (**RFC 768**).
:::
