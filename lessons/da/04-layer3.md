# Lag 3: Routere, IP-adresser og subnetting

:::goal
**Læringsmål:** Du kan læse IP-adresser binært, beregne netadresser og broadcastadresser, opdele et netværk i delnetværk af samme størrelse og forbinde netværk via routere med routingtabeller.
:::

:::osi 3
:::

:::sim
url=/sims/lesson-4.1.btsim
:::

Hidtil lå alle enheder i *ét* lokalt netværk — forbundet via switches og access points. Men internettet består af millioner af sådanne netværk: dit hjemmenetværk, skolens netværk, din mobiludbyders netværk og de store datacentres netværk.

Hvordan finder en pakke vej fra ét netværk til et andet? Det tager **lag 3**, netværkslaget, sig af — med **Internet Protocol (IP)**, IP-adresserne og de enheder, der forbinder netværk med hinanden: **routerne**.

:::note
IP har siden 1981 været fastlagt i en standard, **RFC 791**. Den version, som dette kapitel hovedsageligt handler om, hedder **IPv4**. Den nyere version **IPv6** lærer du at kende i slutningen af kapitlet.
:::
