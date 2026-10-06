# Plasti 5–7: aplikacijska plast

:::goal
**Učni cilj:** Znaš prepoznati najpomembnejše protokole aplikacijske plasti — HTTP, DNS, SMTP/POP3/IMAP in DHCP — v orodju Sled, razložiti njihovo delovanje in najti tipične napake.
:::

:::osi 7
:::

:::sim
url=/sims/lesson-6.1.btsim
:::

V 5. poglavju si videl: TCP in UDP dostavita podatke zanesljivo (ali hitro) pravemu programu — prek vrat. *Kaj* je v teh podatkih, določajo protokoli **aplikacijske plasti**. V modelu TCP/IP je to ena plast, v modelu ISO/OSI pa ustreza plastem od 5 do 7.

Vsak od teh protokolov ima svojo nalogo — in svoja vrata:

| Protokol | Naloga | Vrata | Prenos |
|---|---|---|---|
| **HTTP** | prenos spletnih strani | 80 | TCP |
| **DNS** | prevajanje imen v naslove IP | 53 | večinoma UDP |
| **SMTP** | pošiljanje e-pošte | 25 | TCP |
| **POP3** / **IMAP** | prevzem e-pošte | 110 / 143 | TCP |
| **DHCP** | samodejna dodelitev naslova IP napravi | 67 / 68 | UDP |

V poglavju 1.3 si spletno stran še odprl prek njenega naslova IP. V vsakdanjem življenju nihče ne vtipka `192.168.0.20` — in nobenemu novemu prenosniku naslova ne vpišemo ročno. Kako vse to deluje skupaj, boš odkril v tem poglavju, protokol za protokolom.
