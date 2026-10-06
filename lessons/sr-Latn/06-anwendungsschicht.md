# Sloj 5–7: aplikativni sloj

:::goal
**Cilj učenja:** Možeš da prepoznaš najvažnije protokole aplikativnog sloja — HTTP, DNS, SMTP/POP3/IMAP i DHCP — u Tracer-u, da objasniš njihov tok i da pronađeš tipične greške.
:::

:::osi 7
:::

:::sim
url=/sims/lesson-6.1.btsim
:::

U poglavlju 5 si videla/video: TCP i UDP isporučuju podatke pouzdano (ili brzo) pravom programu — preko portova. *Šta* se nalazi u tim podacima, određuju protokoli **aplikativnog sloja**. U TCP/IP modelu to je jedan sloj, a u ISO/OSI modelu odgovara slojevima 5 do 7.

Svaki od ovih protokola ima svoj zadatak — i svoj port:

| Protokol | Zadatak | Port | Transport |
|---|---|---|---|
| **HTTP** | učitavanje veb-stranica | 80 | TCP |
| **DNS** | prevođenje imena u IP adrese | 53 | uglavnom UDP |
| **SMTP** | slanje e-poruka | 25 | TCP |
| **POP3** / **IMAP** | preuzimanje e-poruka | 110 / 143 | TCP |
| **DHCP** | automatsko dodeljivanje IP adrese uređaju | 67 / 68 | UDP |

U poglavlju 1.3 si veb-stranicu još pozivao/pozivala preko njene IP adrese. U svakodnevnom životu niko ne kuca `192.168.0.20` — i nijedan novi laptop ne dobija adresu ručnim unosom. Kako sve to funkcioniše zajedno, otkrićeš u ovom poglavlju, protokol po protokol.
