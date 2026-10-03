# Schicht 3: Router, IP-Adressen und Subnetting

:::goal
**Lernziel:** Du kannst IP-Adressen binär lesen, Netz- und Broadcastadressen berechnen, ein Netz in gleich große Teilnetze aufteilen und Netze über Router mit Routing-Tabellen verbinden.
:::

:::osi 3
:::

:::sim
url=/sims/lesson-4.1.btsim
:::

Bisher lagen alle Geräte in *einem* lokalen Netz — verbunden über Switches und Access Points. Das Internet besteht aber aus Millionen solcher Netze: dein Heimnetz, das Schulnetz, das Netz deines Mobilfunkanbieters, die Netze großer Rechenzentren.

Wie findet ein Paket den Weg von einem Netz in ein anderes? Darum kümmert sich **Schicht 3**, die Vermittlungsschicht — mit dem **Internet Protocol (IP)**, den IP-Adressen und den Geräten, die Netze miteinander verbinden: den **Routern**.

:::note
IP ist seit 1981 in einem Standard festgelegt, dem **RFC 791**. Die Version, um die es in diesem Kapitel hauptsächlich geht, heißt **IPv4**. Die neuere Version **IPv6** lernst du am Ende des Kapitels kennen.
:::
