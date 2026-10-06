# Vrstva 3: smerovače, IP adresy a subnetting

:::goal
**Cieľ učenia:** Vieš čítať IP adresy v dvojkovej sústave, vypočítať adresu siete a broadcastovú adresu, rozdeliť sieť na rovnako veľké podsiete a prepájať siete pomocou smerovačov so smerovacími tabuľkami.
:::

:::osi 3
:::

:::sim
url=/sims/lesson-4.1.btsim
:::

Doteraz sa všetky zariadenia nachádzali v *jednej* lokálnej sieti — prepojené cez switche a prístupové body. Internet sa však skladá z miliónov takýchto sietí: tvoja domáca sieť, školská sieť, sieť tvojho mobilného operátora, siete veľkých dátových centier.

Ako nájde paket cestu z jednej siete do druhej? Stará sa o to **vrstva 3**, teda sieťová vrstva — s **Internet Protocol (IP)**, IP adresami a zariadeniami, ktoré navzájom prepájajú siete: **smerovačmi**.

:::note
IP je od roku 1981 definovaný v štandarde **RFC 791**. Verzia, ktorej sa v tejto kapitole venujeme hlavne, sa volá **IPv4**. Novšiu verziu **IPv6** spoznáš na konci kapitoly.
:::
