# Lakabka 5–7: Application layer

:::goal
**Hadafka waxbarashada:** Waxaad awoodaa inaad ku aqoonsato protocols-ka ugu muhiimsan ee application layer — HTTP, DNS, SMTP/POP3/IMAP iyo DHCP — gudaha tracer-ka, inaad sharaxdo sida ay u shaqeeyaan, oo aad hesho khaladaadka caadiga ah.
:::

:::osi 7
:::

:::sim
url=/sims/lesson-6.1.btsim
:::

Cutubka 5 waxaad ku aragtay: TCP iyo UDP waxay xogta si la isku halleyn karo (ama si dhakhso ah) u gaarsiiyaan barnaamijka saxda ah — iyagoo adeegsanaya ports-ka. *Waxa* ku jira xogtaas waxaa qeexa protocols-ka **application layer**. Qaabka TCP/IP waa hal layer, halka qaabka ISO/OSI ay ku waafaqsan tahay layers 5 ilaa 7.

Mid kasta oo ka mid ah protocols-kan wuxuu leeyahay shaqadiisa gaarka ah — iyo port-kiisa gaarka ah:

| Protocol | Shaqo | Port | Transport |
|---|---|---|---|
| **HTTP** | soo qaadista boggag web ah | 80 | TCP |
| **DNS** | u turjumidda magacyada IP addresses | 53 | badanaa UDP |
| **SMTP** | dirista e-mails | 25 | TCP |
| **POP3** / **IMAP** | soo qaadista e-mails | 110 / 143 | TCP |
| **DHCP** | siinta qalab IP address si toos ah | 67 / 68 | UDP |

Cutubka 1.3 waxaad weli boggag web ah ku furtay IP address-kiisa. Nolosha maalinlaha ah ma jiro qofka qora `192.168.0.20` — mana jiro laptop cusub oo address-kiisa gacanta lagu galiyo. Sida kuwaas oo dhan isu wada shaqeeyaan waxaad ka heli doontaa cutubkan, protocol protocol.
