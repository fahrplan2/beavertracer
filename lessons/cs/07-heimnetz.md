# Domácí síť: router a NAT

:::goal
**Cíl výuky:** Umíš pojmenovat úlohy domácího routeru, nastavit domácí router, vysvětlit, jak NAT připojí mnoho zařízení k internetu přes jednu veřejnou adresu, a nastavit a ověřit přesměrování portu.
:::

:::osi 3
:::

:::sim
url=/sims/lesson-7.1.btsim
:::

Doma je v síti rychle deset nebo více zařízení: mobily, notebooky, televize, herní konzole, reproduktory. Všechna dostanou adresy jako `192.168.178.20` — z **privátního** rozsahu, který se v internetu vůbec nesměruje (kapitola 4.2.2). A přesto se každé z těchto zařízení dostane do internetu.

Umožňuje to nenápadná krabička: **domácí router**. Na pracovní ploše vidíš vlevo domácí síť s PC a tabletem, vpravo „internet“ — routery poskytovatele, server DNS a webový server `www.beispiel.de`.

:::note
Veřejné adresy v této kapitole (`203.0.113.…`, `198.51.100.…`, `192.0.2.…`) jsou vyhrazeny pro příklady a výukové materiály — stejně jako `2001:db8::` u IPv6.
:::
