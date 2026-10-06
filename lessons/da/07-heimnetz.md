# Hjemmenetværket: router og NAT

:::goal
**Læringsmål:** Du kan nævne en hjemmerouters opgaver, opsætte en hjemmerouter, forklare, hvordan NAT får mange enheder på internettet via én offentlig adresse, og opsætte og teste port forwarding.
:::

:::osi 3
:::

:::sim
url=/sims/lesson-7.1.btsim
:::

Derhjemme er der hurtigt ti eller flere enheder på netværket: mobiltelefoner, bærbare computere, fjernsyn, spillekonsol, højttalere. Alle får adresser som `192.168.178.20` — fra et **privat** område, som slet ikke videresendes på internettet (kapitel 4.2.2). Og alligevel kommer hver eneste af disse enheder på internettet.

Det er en upåfaldende lille kasse, der gør det muligt: **hjemmeroteren**. På arbejdsområdet ser du til venstre et hjemmenetværk med en pc og en tablet, til højre „internettet“ — en internetudbyders routere, en DNS-server og webserveren `www.beispiel.de`.

:::note
De offentlige adresser i dette kapitel (`203.0.113.…`, `198.51.100.…`, `192.0.2.…`) er reserveret til eksempler og undervisningsmateriale — ligesom `2001:db8::` i IPv6.
:::
