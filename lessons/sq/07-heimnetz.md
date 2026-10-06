# Rrjeti shtëpiak: routeri dhe NAT

:::goal
**Objektivi i të nxënit:** Je në gjendje të përmendësh detyrat e një routeri shtëpiak, të konfigurosh një router shtëpiak, të shpjegosh se si NAT i lidh shumë pajisje me internetin përmes një adrese publike, si dhe të konfigurosh e të kontrollosh një përcjellje të portës.
:::

:::osi 3
:::

:::sim
url=/sims/lesson-7.1.btsim
:::

Në shtëpi shpejt gjenden dhjetë ose më shumë pajisje në rrjet: telefona celularë, laptopë, televizorë, konsola lojërash, altoparlantë. Të gjitha marrin adresa si `192.168.178.20` — nga një diapazon **privat**, i cili në internet nuk përcillet fare (kapitulli 4.2.2). Dhe megjithatë çdo një nga këto pajisje arrin në internet.

Këtë e bën të mundur një kuti e vogël e pavërejtur: **routeri shtëpiak**. Në hapësirën e punës shikon në të majtë një rrjet shtëpiak me një PC dhe një tablet, e në të djathtë „internetin“ — routerat e një ofruesi, një server DNS dhe serverin e uebit `www.beispiel.de`.

:::note
Adresat publike në këtë kapitull (`203.0.113.…`, `198.51.100.…`, `192.0.2.…`) janë të rezervuara për shembuj dhe materiale mësimore — pikërisht si `2001:db8::` te IPv6.
:::
