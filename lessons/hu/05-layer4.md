# 4. réteg: szállítási réteg

:::goal
**Tanulási cél:** Meg tudod nevezni a szállítási réteg feladatait, be tudod mutatni egy TCP-kapcsolat menetét (felépítés, adatátvitel, lebontás) üzenetváltási diagramként, el tudod magyarázni a portokat, valamint a sorszámokat és a nyugtaszámokat, és meg tudod indokolni, mikor használunk TCP helyett UDP-t.
:::

:::osi 4
:::

:::sim
url=/sims/lesson-5.1.btsim
:::

Rövid visszatekintés a 4. fejezetre: a 3. rétegben működő **Internet Protocol** a megfelelő *számítógéphez* juttatja el a csomagot – akár sok útválasztón keresztül is. Többet azonban az IP nem ígér:

- Egy számítógépen egyszerre sok program fut: böngésző, levelezőprogram, üzenetküldő. Vajon melyiknek szól a csomag? Ez nem szerepel az IP-fejlécben.
- Ha útközben elveszik egy csomag, az IP ezt nem veszi észre. A csomagok kétszer is megérkezhetnek, vagy rossz sorrendben. Úgy mondjuk: az IP csak a legjobb szándék szerint szállít (*best effort*).

Ezeket a hiányosságokat a **4. réteg**, a szállítási réteg pótolja. A munkaterületen egy **Client-PC**-t és egy **Server**t látsz – ezeken vizsgálod meg ebben a fejezetben a 4. réteg két legfontosabb protokollját: a **TCP**-t és az **UDP**-t.

:::note
A TCP 1981 óta szabványosított (**RFC 793**, ma **RFC 9293**), az UDP pedig már 1980 óta (**RFC 768**).
:::
