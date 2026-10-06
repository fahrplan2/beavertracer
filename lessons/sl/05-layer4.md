# Plast 4: prenosna plast

:::goal
**Učni cilj:** Znaš našteti naloge prenosne plasti, prikazati potek povezave TCP (vzpostavitev, podatki, prekinitev) kot komunikacijski diagram, razložiti vrata ter zaporedne in potrditvene številke ter utemeljiti, kdaj se namesto TCP uporablja UDP.
:::

:::osi 4
:::

:::sim
url=/sims/lesson-5.1.btsim
:::

Kratek pregled 4. poglavja: **Internet Protocol** na plasti 3 pripelje paket do pravega *računalnika* — tudi prek številnih usmerjevalnikov. A več IP ne obljublja:

- V računalniku hkrati teče veliko programov: brskalnik, poštni program, program za klepet. Za katerega od njih je paket namenjen? Tega v glavi IP ni.
- Če se paket na poti izgubi, IP tega ne opazi. Paketi lahko prispejo tudi dvakrat ali v napačnem vrstnem redu. Pravimo: IP dostavlja le po najboljših močeh (*best effort*).

Te vrzeli zapolni **plast 4**, prenosna plast. Na delovni površini vidiš **Client-PC** in **Server** — na njiju v tem poglavju raziskuješ najpomembnejša protokola plasti 4: **TCP** in **UDP**.

:::note
TCP je standardiziran od leta 1981 (**RFC 793**, danes **RFC 9293**), UDP že od leta 1980 (**RFC 768**).
:::
