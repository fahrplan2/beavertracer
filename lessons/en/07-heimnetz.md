# The home network: router and NAT

:::goal
**Learning goal:** You can name the jobs of a home router, set up a home router, explain how NAT brings many devices onto the internet via one public address, and set up and test a port forward.
:::

:::osi 3
:::

:::sim
url=/sims/lesson-7.1.btsim
:::

At home there are quickly ten or more devices in the network: phones, laptops, TV, games console, speakers. They all get addresses like `192.168.178.20` — from a **private** range that isn't forwarded on the internet at all (chapter 4.2.2). And still every one of these devices gets onto the internet.

An inconspicuous little box makes this possible: the **home router**. On the workspace you see a home network with a PC and a tablet on the left, "the internet" on the right — a provider's routers, a DNS server and the web server `www.beispiel.de`.

:::note
The public addresses in this chapter (`203.0.113.…`, `198.51.100.…`, `192.0.2.…`) are reserved for examples and teaching material — just like `2001:db8::` with IPv6.
:::
