# Vrstva 4: transportní vrstva

:::goal
**Cíl výuky:** Umíš pojmenovat úlohy transportní vrstvy, znázornit průběh spojení TCP (navázání, přenos dat, ukončení) v sekvenčním diagramu, vysvětlit porty a také sekvenční a potvrzovací čísla a zdůvodnit, kdy se místo TCP používá UDP.
:::

:::osi 4
:::

:::sim
url=/sims/lesson-5.1.btsim
:::

Krátká rekapitulace 4. kapitoly: **Internet Protocol** na vrstvě 3 doručí paket ke správnému *počítači* – i přes mnoho routerů. Víc ale IP neslibuje:

- Na počítači běží současně mnoho programů: prohlížeč, e-mailový klient, messenger. Pro který z nich je paket určen? To v hlavičce IP není.
- Pokud se paket cestou ztratí, IP si toho nevšimne. Pakety mohou také dorazit dvakrát nebo ve špatném pořadí. Říká se, že IP doručuje jen na základě nejlepší snahy (*best effort*).

Tyto mezery zaplňuje **vrstva 4**, tedy transportní vrstva. Na pracovní ploše vidíš **Client-PC** a **Server** – na nich v této kapitole prozkoumáš dva nejdůležitější protokoly vrstvy 4: **TCP** a **UDP**.

:::note
TCP je standardizováno od roku 1981 (**RFC 793**, dnes **RFC 9293**), UDP už od roku 1980 (**RFC 768**).
:::
