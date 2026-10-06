# Lager 3: routrar, IP-adresser och subnetting

:::goal
**Lärandemål:** Du kan läsa IP-adresser binärt, beräkna nätverksadresser och broadcastadresser, dela upp ett nätverk i delnät av samma storlek och förbinda nätverk via routrar med routingtabeller.
:::

:::osi 3
:::

:::sim
url=/sims/lesson-4.1.btsim
:::

Hittills har alla enheter legat i *ett* lokalt nätverk — anslutna via switchar och åtkomstpunkter. Internet består dock av miljontals sådana nätverk: ditt hemmanätverk, skolans nätverk, din mobiloperatörs nätverk och stora datacenters nätverk.

Hur hittar ett paket vägen från ett nätverk till ett annat? Det sköter **lager 3**, nätverkslagret — med **Internet Protocol (IP)**, IP-adresserna och de enheter som förbinder nätverk med varandra: **routrarna**.

:::note
IP har sedan 1981 varit fastlagt i en standard, **RFC 791**. Den version som det här kapitlet huvudsakligen handlar om kallas **IPv4**. Den nyare versionen **IPv6** får du lära känna i slutet av kapitlet.
:::
