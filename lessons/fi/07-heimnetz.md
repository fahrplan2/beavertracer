# Kotiverkko: reititin ja NAT

:::goal
**Oppimistavoite:** Osaat nimetä kotireitittimen tehtävät, ottaa kotireitittimen käyttöön, selittää, miten NAT yhdistää monta laitetta internetiin yhden julkisen osoitteen kautta, sekä määrittää ja testata porttiohjauksen.
:::

:::osi 3
:::

:::sim
url=/sims/lesson-7.1.btsim
:::

Kotona verkossa on nopeasti kymmenen tai useampi laite: puhelimia, kannettavia, televisio, pelikonsoli, kaiuttimia. Kaikki saavat osoitteita, kuten `192.168.178.20` — **yksityisestä** osoitealueesta, jota internetissä ei reititetä lainkaan (luku 4.2.2). Silti jokainen näistä laitteista pääsee internetiin.

Sen mahdollistaa vaatimaton pieni laatikko: **kotireititin**. Työtilassa näet vasemmalla kotiverkon, jossa on PC ja tabletti, ja oikealla "internetin" — palveluntarjoajan reitittimiä, DNS-palvelimen ja verkkopalvelimen `www.beispiel.de`.

:::note
Tämän luvun julkiset osoitteet (`203.0.113.…`, `198.51.100.…`, `192.0.2.…`) on varattu esimerkkeihin ja opetusmateriaaleihin — aivan kuten `2001:db8::` IPv6:ssa.
:::
