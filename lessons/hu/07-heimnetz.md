# Az otthoni hálózat: router és NAT

:::goal
**Tanulási cél:** Meg tudod nevezni az otthoni router feladatait, be tudsz állítani egy otthoni routert, el tudod magyarázni, hogyan juttatja a NAT sok eszköz forgalmát az internetre egyetlen nyilvános címen keresztül, és be tudsz állítani, majd ellenőrizni egy porttovábbítást.
:::

:::osi 3
:::

:::sim
url=/sims/lesson-7.1.btsim
:::

Otthon gyorsan összejön tíz vagy több eszköz a hálózaton: telefonok, laptopok, tévé, játékkonzol, hangszórók. Mindegyik olyan címet kap, mint a `192.168.178.20` — egy **privát** tartományból, amelyet az interneten egyáltalán nem továbbítanak (4.2.2. fejezet). Ennek ellenére ezek az eszközök mind eljutnak az internetre.

Ezt egy jelentéktelen kis doboz teszi lehetővé: az **otthoni router**. A munkaterületen bal oldalon egy otthoni hálózatot látsz egy PC-vel és egy tablettel, jobb oldalon pedig „az internetet" — egy szolgáltató routereit, egy DNS-szervert és a `www.beispiel.de` webszervert.

:::note
A fejezetben szereplő nyilvános címek (`203.0.113.…`, `198.51.100.…`, `192.0.2.…`) példák és oktatási anyagok számára vannak fenntartva — ahogyan a `2001:db8::` is az IPv6-nál.
:::
