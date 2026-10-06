# La xarxa domèstica: encaminador i NAT

:::goal
**Objectiu d'aprenentatge:** Saps anomenar les tasques d'un encaminador domèstic, configurar un encaminador domèstic, explicar com el NAT connecta molts dispositius a Internet amb una sola adreça pública, i configurar i comprovar una redirecció de ports.
:::

:::osi 3
:::

:::sim
url=/sims/lesson-7.1.btsim
:::

A casa, deseguida hi ha deu dispositius o més a la xarxa: mòbils, portàtils, televisors, consola de videojocs, altaveus. Tots reben adreces com `192.168.178.20`, d'un rang **privat** que a Internet no s'encamina en absolut (capítol 4.2.2). I tot i així, cadascun d'aquests dispositius arriba a Internet.

Ho fa possible una capseta discreta: l'**encaminador domèstic**. A l'espai de treball veus a l'esquerra una xarxa domèstica amb un PC i una tauleta, i a la dreta «Internet»: els encaminadors d'un proveïdor, un servidor DNS i el servidor web `www.beispiel.de`.

:::note
Les adreces públiques d'aquest capítol (`203.0.113.…`, `198.51.100.…`, `192.0.2.…`) estan reservades per a exemples i material didàctic, igual que `2001:db8::` a IPv6.
:::
