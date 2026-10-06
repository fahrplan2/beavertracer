# Hemmanätverket: router och NAT

:::goal
**Lärandemål:** Du kan beskriva en hemmarouters uppgifter, konfigurera en hemmarouter, förklara hur NAT gör att många enheter kan nå internet via en enda offentlig adress, samt konfigurera och testa en portvidarebefordran.
:::

:::osi 3
:::

:::sim
url=/sims/lesson-7.1.btsim
:::

Hemma har man snabbt tio eller fler enheter i nätverket: mobiler, bärbara datorer, TV, spelkonsol, högtalare. Alla får adresser som `192.168.178.20` — från ett **privat** adressintervall som inte alls vidarebefordras på internet (kapitel 4.2.2). Och ändå når var och en av dessa enheter internet.

Det möjliggörs av en oansenlig liten låda: **hemmarouter**n. På arbetsytan ser du till vänster ett hemmanätverk med en PC och en surfplatta, och till höger "internet" — en leverantörs routrar, en DNS-server och webbservern `www.beispiel.de`.

:::note
De offentliga adresserna i det här kapitlet (`203.0.113.…`, `198.51.100.…`, `192.0.2.…`) är reserverade för exempel och undervisningsmaterial — precis som `2001:db8::` för IPv6.
:::
