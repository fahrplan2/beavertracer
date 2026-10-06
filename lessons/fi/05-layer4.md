# Kerros 4: Kuljetuskerros

:::goal
**Oppimistavoite:** Osaat nimetä kuljetuskerroksen tehtävät, esittää TCP-yhteyden kulun (muodostus, data, purku) sekvenssikaaviona, selittää portit sekä järjestys- ja kuittausnumerot ja perustella, milloin käytetään UDP:tä TCP:n sijaan.
:::

:::osi 4
:::

:::sim
url=/sims/lesson-5.1.btsim
:::

Lyhyt kertaus luvusta 4: **Internet Protocol** kerroksella 3 vie paketin oikealle *tietokoneelle* – myös useiden reitittimien yli. IP ei kuitenkaan lupaa sen enempää:

- Tietokoneella toimii monta ohjelmaa yhtä aikaa: selain, sähköpostiohjelma, pikaviestin. Mille niistä paketti on tarkoitettu? Sitä ei kerrota IP-otsakkeessa.
- Jos paketti katoaa matkalla, IP ei huomaa sitä. Paketit voivat myös saapua kahdesti tai väärässä järjestyksessä. Sanotaan, että IP toimittaa vain parhaan yrityksen periaatteella (*best effort*).

Nämä puutteet korjaa **kerros 4**, kuljetuskerros. Työtilassa näet **Client-PC**:n ja **Server**in – niiden avulla tutkit tässä luvussa kerroksen 4 kahta tärkeintä protokollaa: **TCP**:tä ja **UDP**:tä.

:::note
TCP on standardoitu vuodesta 1981 (**RFC 793**, nykyisin **RFC 9293**), UDP jo vuodesta 1980 (**RFC 768**).
:::
