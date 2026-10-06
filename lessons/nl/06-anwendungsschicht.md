# Laag 5–7: applicatielaag

:::goal
**Leerdoel:** Je kunt de belangrijkste protocollen van de applicatielaag — HTTP, DNS, SMTP/POP3/IMAP en DHCP — in de tracer herkennen, hun verloop uitleggen en typische fouten vinden.
:::

:::osi 7
:::

:::sim
url=/sims/lesson-6.1.btsim
:::

In hoofdstuk 5 heb je gezien: TCP en UDP leveren gegevens betrouwbaar (of snel) af bij het juiste programma — via de poorten. *Wat* er in die gegevens staat, wordt bepaald door de protocollen van de **applicatielaag**. In het TCP/IP-model is dat één laag, in het ISO/OSI-model komt het overeen met de lagen 5 tot en met 7.

Elk van deze protocollen heeft zijn eigen taak — en zijn eigen poort:

| Protocol | Taak | Poort | Transport |
|---|---|---|---|
| **HTTP** | webpagina's ophalen | 80 | TCP |
| **DNS** | namen omzetten naar IP-adressen | 53 | meestal UDP |
| **SMTP** | e-mails verzenden | 25 | TCP |
| **POP3** / **IMAP** | e-mails ophalen | 110 / 143 | TCP |
| **DHCP** | een apparaat automatisch een IP-adres geven | 67 / 68 | UDP |

In hoofdstuk 1.3 heb je een webpagina nog via het IP-adres opgeroepen. In het dagelijks leven typt niemand `192.168.0.20` — en geen enkele nieuwe laptop krijgt zijn adres met de hand ingevoerd. Hoe dit alles samenwerkt, ontdek je in dit hoofdstuk, protocol voor protocol.
