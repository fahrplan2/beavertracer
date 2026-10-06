# Vrstva 3: routery, IP adresy a podsítě

:::goal
**Cíl výuky:** Umíš číst IP adresy ve dvojkové soustavě, vypočítat adresu sítě a broadcastovou adresu, rozdělit síť na stejně velké podsítě a propojit sítě pomocí routerů se směrovacími tabulkami.
:::

:::osi 3
:::

:::sim
url=/sims/lesson-4.1.btsim
:::

Dosud se všechna zařízení nacházela v *jedné* lokální síti — propojená pomocí switchů a přístupových bodů. Internet se ale skládá z milionů takových sítí: tvoje domácí síť, školní síť, síť tvého mobilního operátora, sítě velkých datových center.

Jak paket najde cestu z jedné sítě do druhé? Stará se o to **vrstva 3**, tedy síťová vrstva — s **Internet Protocolem (IP)**, s IP adresami a se zařízeními, která sítě navzájem propojují: s **routery**.

:::note
IP je od roku 1981 definován standardem **RFC 791**. Verze, o které bude v této kapitole řeč především, se nazývá **IPv4**. S novější verzí **IPv6** se seznámíš na konci kapitoly.
:::
