# Lag 5–7: Applikasjonslag

:::goal
**Læringsmål:** Du kan kjenne igjen de viktigste protokollene i applikasjonslaget — HTTP, DNS, SMTP/POP3/IMAP og DHCP — i Tracer, forklare hvordan de fungerer og finne typiske feil.
:::

:::osi 7
:::

:::sim
url=/sims/lesson-6.1.btsim
:::

I kapittel 5 så du at TCP og UDP leverer data pålitelig (eller raskt) til riktig program — via portene. *Hva* som står i disse dataene, bestemmes av protokollene i **applikasjonslaget**. I TCP/IP-modellen er dette ett lag, mens det i ISO/OSI-modellen tilsvarer lag 5 til 7.

Hver av disse protokollene har sin egen oppgave — og sin egen port:

| Protokoll | Oppgave | Port | Transport |
|---|---|---|---|
| **HTTP** | hente nettsider | 80 | TCP |
| **DNS** | oversette navn til IP-adresser | 53 | oftest UDP |
| **SMTP** | sende e-poster | 25 | TCP |
| **POP3** / **IMAP** | hente e-poster | 110 / 143 | TCP |
| **DHCP** | gi en enhet en IP-adresse automatisk | 67 / 68 | UDP |

I kapittel 1.3 åpnet du fortsatt en nettside via IP-adressen. I hverdagen er det ingen som skriver inn `192.168.0.20` — og ingen ny bærbar PC får adressen sin lagt inn for hånd. Hvordan alt dette henger sammen, får du oppdage i dette kapittelet, protokoll for protokoll.
