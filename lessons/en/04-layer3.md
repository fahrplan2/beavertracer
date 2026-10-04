# Layer 3: Routers, IP addresses and subnetting

:::goal
**Learning goal:** You can read IP addresses in binary, calculate network and broadcast addresses, divide a network into equal-sized subnets and connect networks via routers with routing tables.
:::

:::osi 3
:::

:::sim
url=/sims/lesson-4.1.btsim
:::

So far all devices were in *one* local network — connected via switches and access points. But the internet consists of millions of such networks: your home network, the school network, your mobile provider's network, the networks of large data centres.

How does a packet find its way from one network into another? That's the job of **layer 3**, the network layer — with the **Internet Protocol (IP)**, IP addresses and the devices that connect networks with each other: **routers**.

:::note
IP has been defined in a standard since 1981, **RFC 791**. The version this chapter is mainly about is called **IPv4**. You'll get to know the newer version **IPv6** at the end of the chapter.
:::
