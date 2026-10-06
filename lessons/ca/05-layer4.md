# Capa 4: capa de transport

:::goal
**Objectiu d'aprenentatge:** Pots anomenar les tasques de la capa de transport, representar el desenvolupament d'una connexió TCP (establiment, dades, tancament) com a diagrama de seqüència, explicar els ports i els números de seqüència i de confirmació, i justificar quan s'utilitza UDP en lloc de TCP.
:::

:::osi 4
:::

:::sim
url=/sims/lesson-5.1.btsim
:::

Una breu mirada enrere al capítol 4: el **Internet Protocol** de la capa 3 porta un paquet a l'*ordinador* correcte, fins i tot a través de molts encaminadors. Però IP no promet res més:

- En un ordinador s'executen molts programes alhora: el navegador, el programa de correu, el missatger. Per a quin d'ells és un paquet? Això no consta a la capçalera IP.
- Si un paquet es perd pel camí, IP no ho nota. Els paquets també poden arribar duplicats o en un ordre incorrecte. Es diu que IP només lliura amb el millor esforç (*best effort*).

Aquests buits els tanca la **capa 4**, la capa de transport. A l'espai de treball hi veus un **Client-PC** i un **Server**: amb ells examinaràs en aquest capítol els dos protocols més importants de la capa 4: **TCP** i **UDP**.

:::note
TCP està estandarditzat des del 1981 (**RFC 793**, avui **RFC 9293**) i UDP ja des del 1980 (**RFC 768**).
:::
