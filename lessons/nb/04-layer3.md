# Lag 3: Rutere, IP-adresser og subnetting

:::goal
**Læringsmål:** Du kan lese IP-adresser binært, beregne nettverksadresse og kringkastingsadresse, dele et nettverk inn i delnett av lik størrelse og koble sammen nettverk via rutere med rutingtabeller.
:::

:::osi 3
:::

:::sim
url=/sims/lesson-4.1.btsim
:::

Til nå lå alle enheter i *ett* lokalt nettverk — koblet sammen via svitsjer og tilgangspunkter. Internett består imidlertid av millioner av slike nettverk: hjemmenettverket ditt, skolenettverket, nettverket til mobilleverandøren din og nettverkene til store datasentre.

Hvordan finner en pakke veien fra ett nettverk til et annet? Det er **lag 3**, nettverkslaget, som tar seg av dette — med **Internet Protocol (IP)**, IP-adressene og enhetene som kobler nettverk sammen: **ruterne**.

:::note
IP har siden 1981 vært fastsatt i en standard, **RFC 791**. Versjonen som dette kapittelet hovedsakelig handler om, heter **IPv4**. Den nyere versjonen **IPv6** blir du kjent med mot slutten av kapittelet.
:::
