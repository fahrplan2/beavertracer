# Vrstva 5–7: aplikačná vrstva

:::goal
**Cieľ učenia:** Vieš v Tracery rozpoznať najdôležitejšie protokoly aplikačnej vrstvy — HTTP, DNS, SMTP/POP3/IMAP a DHCP —, vysvetliť ich priebeh a nájsť typické chyby.
:::

:::osi 7
:::

:::sim
url=/sims/lesson-6.1.btsim
:::

V kapitole 5 si videl: TCP a UDP doručujú dáta spoľahlivo (alebo rýchlo) správnemu programu — prostredníctvom portov. *Čo* je v týchto dátach, určujú protokoly **aplikačnej vrstvy**. V modeli TCP/IP je to jedna vrstva, v modeli ISO/OSI zodpovedá vrstvám 5 až 7.

Každý z týchto protokolov má svoju vlastnú úlohu — a svoj vlastný port:

| Protokol | Úloha | Port | Transport |
|---|---|---|---|
| **HTTP** | sťahovanie webových stránok | 80 | TCP |
| **DNS** | prekladanie mien na IP adresy | 53 | väčšinou UDP |
| **SMTP** | odosielanie e-mailov | 25 | TCP |
| **POP3** / **IMAP** | preberanie e-mailov | 110 / 143 | TCP |
| **DHCP** | automatické pridelenie IP adresy zariadeniu | 67 / 68 | UDP |

V kapitole 1.3 si ešte otváral webovú stránku cez jej IP adresu. V bežnom živote nikto nepíše `192.168.0.20` — a ani nový notebook nemá adresu zadanú ručne. Ako všetko toto spolupracuje, objavíš v tejto kapitole, protokol po protokole.
