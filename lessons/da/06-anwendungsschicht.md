# Lag 5–7: Applikationslag

:::goal
**Læringsmål:** Du kan genkende de vigtigste protokoller i applikationslaget — HTTP, DNS, SMTP/POP3/IMAP og DHCP — i Tracer, forklare deres forløb og finde typiske fejl.
:::

:::osi 7
:::

:::sim
url=/sims/lesson-6.1.btsim
:::

I kapitel 5 har du set: TCP og UDP afleverer data pålideligt (eller hurtigt) til det rigtige program — via portene. *Hvad* der står i disse data, fastlægges af protokollerne i **applikationslaget**. I TCP/IP-modellen er det ét lag, i ISO/OSI-modellen svarer det til lag 5 til 7.

Hver af disse protokoller har sin egen opgave — og sin egen port:

| Protokol | Opgave | Port | Transport |
|---|---|---|---|
| **HTTP** | hente websider | 80 | TCP |
| **DNS** | oversætte navne til IP-adresser | 53 | oftest UDP |
| **SMTP** | sende e-mails | 25 | TCP |
| **POP3** / **IMAP** | hente e-mails | 110 / 143 | TCP |
| **DHCP** | give en enhed en IP-adresse automatisk | 67 / 68 | UDP |

I kapitel 1.3 åbnede du endnu en webside via dens IP-adresse. I hverdagen taster ingen `192.168.0.20` — og ingen ny bærbar får sin adresse indtastet manuelt. Hvordan det hele spiller sammen, opdager du i dette kapitel, protokol for protokol.
