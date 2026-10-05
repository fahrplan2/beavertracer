# La rete domestica: router e NAT

:::goal
**Obiettivo di apprendimento:** Sai elencare i compiti di un router domestico e configurarne uno. Sai spiegare come il NAT permette a molti dispositivi di accedere a Internet tramite un unico indirizzo pubblico. Sai anche configurare e verificare un port forwarding.
:::

:::osi 3
:::

:::sim
url=/sims/lesson-7.1.btsim
:::

A casa si arriva presto a dieci o più dispositivi in rete: smartphone, portatili, televisori, console di gioco, altoparlanti. Tutti ricevono indirizzi come `192.168.178.20`, presi da un intervallo **privato** che su Internet non viene inoltrato affatto (capitolo 4.2.2). Eppure ognuno di questi dispositivi riesce ad accedere a Internet.

A renderlo possibile è una scatoletta poco appariscente: il **router domestico**. Nell'area di lavoro vedi a sinistra una rete domestica con un PC e un tablet. A destra c'è «Internet», con i router di un provider, un server DNS e il server web `www.beispiel.de`.

:::note
Gli indirizzi pubblici di questo capitolo (`203.0.113.…`, `198.51.100.…`, `192.0.2.…`) sono riservati a esempi e materiale didattico, proprio come `2001:db8::` per IPv6.
:::
