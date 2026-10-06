# Vrstva 4: transportná vrstva

:::goal
**Cieľ učenia:** Vieš pomenovať úlohy transportnej vrstvy, znázorniť priebeh TCP spojenia (nadviazanie, dáta, ukončenie) ako diagram komunikácie, vysvetliť porty, poradové čísla a potvrdzovacie čísla a zdôvodniť, kedy sa namiesto TCP používa UDP.
:::

:::osi 4
:::

:::sim
url=/sims/lesson-5.1.btsim
:::

Krátky pohľad späť na kapitolu 4: **Internet Protocol** na vrstve 3 doručí paket na správny *počítač* – aj cez mnoho smerovačov. Viac však IP neslúbi:

- Na počítači beží naraz veľa programov: prehliadač, poštový program, messenger. Pre ktorý z nich je paket určený? To v hlavičke IP nie je.
- Ak sa paket cestou stratí, IP si to nevšimne. Pakety môžu doraziť aj dvakrát alebo v nesprávnom poradí. Hovorí sa, že IP doručuje len podľa možností (*best effort*).

Tieto medzery vypĺňa **vrstva 4**, transportná vrstva. Na pracovnej ploche vidíš **Client-PC** a **Server** – na nich v tejto kapitole preskúmaš dva najdôležitejšie protokoly vrstvy 4: **TCP** a **UDP**.

:::note
TCP je štandardizovaný od roku 1981 (**RFC 793**, dnes **RFC 9293**), UDP už od roku 1980 (**RFC 768**).
:::
