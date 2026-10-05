# Livello 3: router, indirizzi IP e subnetting

:::goal
**Obiettivo di apprendimento:** Sai leggere gli indirizzi IP in binario, calcolare indirizzi di rete e indirizzi di broadcast, suddividere una rete in sottoreti di uguale dimensione e collegare reti tramite router con tabelle di routing.
:::

:::osi 3
:::

:::sim
url=/sims/lesson-4.1.btsim
:::

Finora tutti i dispositivi si trovavano in *un'unica* rete locale, collegati tramite switch e access point. Internet, però, è composto da milioni di reti di questo tipo: la tua rete domestica, la rete della scuola, la rete del tuo operatore di telefonia mobile, le reti dei grandi data center.

Come fa un pacchetto a trovare la strada da una rete a un'altra? Se ne occupa il **livello 3**, il livello di rete, con l'**Internet Protocol (IP)**, gli indirizzi IP e i dispositivi che collegano le reti tra loro: i **router**.

:::note
IP è definito in uno standard dal 1981, la **RFC 791**. La versione di cui si parla principalmente in questo capitolo si chiama **IPv4**. La versione più recente, **IPv6**, la conoscerai alla fine del capitolo.
:::
