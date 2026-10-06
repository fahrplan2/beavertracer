# Kerrokset 5–7: sovelluskerros

:::goal
**Oppimistavoite:** Osaat tunnistaa sovelluskerroksen tärkeimmät protokollat — HTTP, DNS, SMTP/POP3/IMAP ja DHCP — jäljittimessä, selittää niiden toiminnan ja löytää tyypilliset virheet.
:::

:::osi 7
:::

:::sim
url=/sims/lesson-6.1.btsim
:::

Luvussa 5 näit, että TCP ja UDP toimittavat datan luotettavasti (tai nopeasti) oikealle ohjelmalle porttien avulla. Se, *mitä* tässä datassa on, määräytyy **sovelluskerroksen** protokollien mukaan. TCP/IP-mallissa tämä on yksi kerros, ISO/OSI-mallissa se vastaa kerroksia 5–7.

Jokaisella näistä protokollista on oma tehtävänsä — ja oma porttinsa:

| Protokolla | Tehtävä | Portti | Kuljetus |
|---|---|---|---|
| **HTTP** | verkkosivujen noutaminen | 80 | TCP |
| **DNS** | nimien muuntaminen IP-osoitteiksi | 53 | yleensä UDP |
| **SMTP** | sähköpostien lähettäminen | 25 | TCP |
| **POP3** / **IMAP** | sähköpostien nouto | 110 / 143 | TCP |
| **DHCP** | IP-osoitteen antaminen laitteelle automaattisesti | 67 / 68 | UDP |

Luvussa 1.3 avasit verkkosivun vielä sen IP-osoitteen avulla. Arjessa kukaan ei kirjoita `192.168.0.20` — eikä uuteen kannettavaan syötetä osoitetta käsin. Miten kaikki tämä toimii yhdessä, saat selville tässä luvussa, protokolla kerrallaan.
