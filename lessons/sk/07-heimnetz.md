# Domáca sieť: smerovač a NAT

:::goal
**Cieľ učenia:** Vieš pomenovať úlohy domáceho smerovača, nastaviť domáci smerovač, vysvetliť, ako NAT dostane veľa zariadení cez jednu verejnú adresu do internetu, a nastaviť a overiť presmerovanie portov.
:::

:::osi 3
:::

:::sim
url=/sims/lesson-7.1.btsim
:::

Doma je v sieti rýchlo desať alebo viac zariadení: mobily, notebooky, televízor, herná konzola, reproduktory. Všetky dostanú adresy ako `192.168.178.20` — z **privátneho** rozsahu, ktorý sa v internete vôbec nesmeruje (kapitola 4.2.2). A napriek tomu sa každé z týchto zariadení dostane do internetu.

Umožňuje to nenápadná škatuľka: **domáci smerovač**. Na pracovnej ploche vidíš vľavo domácu sieť s PC a tabletom, vpravo „internet“ — smerovače poskytovateľa, DNS server a webový server `www.beispiel.de`.

:::note
Verejné adresy v tejto kapitole (`203.0.113.…`, `198.51.100.…`, `192.0.2.…`) sú vyhradené pre príklady a učebné materiály — presne ako `2001:db8::` pri IPv6.
:::
