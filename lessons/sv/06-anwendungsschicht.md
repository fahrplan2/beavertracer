# Lager 5–7: Applikationslager

:::goal
**Lärandemål:** Du kan känna igen de viktigaste protokollen i applikationslagret — HTTP, DNS, SMTP/POP3/IMAP och DHCP — i Tracer, förklara hur de fungerar och hitta typiska fel.
:::

:::osi 7
:::

:::sim
url=/sims/lesson-6.1.btsim
:::

I kapitel 5 såg du att TCP och UDP levererar data pålitligt (eller snabbt) till rätt program — via portarna. *Vad* som finns i den datan bestäms av protokollen i **applikationslagret**. I TCP/IP-modellen är det ett enda lager, och i ISO/OSI-modellen motsvarar det lager 5 till 7.

Vart och ett av dessa protokoll har sin egen uppgift — och sin egen port:

| Protokoll | Uppgift | Port | Transport |
|---|---|---|---|
| **HTTP** | hämta webbsidor | 80 | TCP |
| **DNS** | översätta namn till IP-adresser | 53 | oftast UDP |
| **SMTP** | skicka e-post | 25 | TCP |
| **POP3** / **IMAP** | hämta e-post | 110 / 143 | TCP |
| **DHCP** | automatiskt ge en enhet en IP-adress | 67 / 68 | UDP |

I kapitel 1.3 öppnade du fortfarande en webbsida via dess IP-adress. I vardagen skriver ingen in `192.168.0.20` — och ingen ny laptop får sin adress inskriven för hand. Hur allt detta hänger ihop får du upptäcka i det här kapitlet, protokoll för protokoll.
