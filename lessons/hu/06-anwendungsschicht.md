# 5–7. réteg: alkalmazási réteg

:::goal
**Tanulási cél:** Fel tudod ismerni a nyomkövetőben az alkalmazási réteg legfontosabb protokolljait — a HTTP-t, a DNS-t, az SMTP/POP3/IMAP-ot és a DHCP-t —, el tudod magyarázni a működésüket, és meg tudod találni a tipikus hibákat.
:::

:::osi 7
:::

:::sim
url=/sims/lesson-6.1.btsim
:::

Az 5. fejezetben láttad: a TCP és az UDP megbízhatóan (vagy gyorsan) juttatja el az adatokat a megfelelő programhoz — a portokon keresztül. Azt pedig, hogy *mi* áll ezekben az adatokban, az **alkalmazási réteg** protokolljai határozzák meg. A TCP/IP-modellben ez egyetlen réteg, az ISO/OSI-modellben az 5–7. rétegnek felel meg.

Ezeknek a protokolloknak mindegyike a saját feladatát látja el — és saját portja van:

| Protokoll | Feladat | Port | Szállítás |
|---|---|---|---|
| **HTTP** | weboldalak letöltése | 80 | TCP |
| **DNS** | nevek lefordítása IP-címekre | 53 | többnyire UDP |
| **SMTP** | e-mailek küldése | 25 | TCP |
| **POP3** / **IMAP** | e-mailek lekérése | 110 / 143 | TCP |
| **DHCP** | automatikusan IP-címet ad egy eszköznek | 67 / 68 | UDP |

Az 1.3. fejezetben még IP-cím alapján nyitottál meg egy weboldalt. A mindennapokban senki sem gépeli be, hogy `192.168.0.20` — és egy új laptopnak sem kézzel írják be a címét. Hogy mindez hogyan működik együtt, azt ebben a fejezetben fedezed fel, protokollról protokollra.
