# Sloj 5–7: aplikacijski sloj

:::goal
**Ishod učenja:** Možeš prepoznati najvažnije protokole aplikacijskog sloja — HTTP, DNS, SMTP/POP3/IMAP i DHCP — u alatu Tracer, objasniti njihov tijek i pronaći tipične pogreške.
:::

:::osi 7
:::

:::sim
url=/sims/lesson-6.1.btsim
:::

U 5. poglavlju vidio/vidjela si: TCP i UDP isporučuju podatke pouzdano (ili brzo) pravom programu — putem portova. *Što* se nalazi u tim podacima, određuju protokoli **aplikacijskog sloja**. U TCP/IP modelu to je jedan sloj, a u ISO/OSI modelu odgovara slojevima od 5 do 7.

Svaki od tih protokola ima svoju zadaću — i svoj port:

| Protokol | Zadaća | Port | Transport |
|---|---|---|---|
| **HTTP** | preuzimanje web-stranica | 80 | TCP |
| **DNS** | prevođenje imena u IP adrese | 53 | uglavnom UDP |
| **SMTP** | slanje e-pošte | 25 | TCP |
| **POP3** / **IMAP** | preuzimanje e-pošte | 110 / 143 | TCP |
| **DHCP** | automatsko dodjeljivanje IP adrese uređaju | 67 / 68 | UDP |

U poglavlju 1.3 web-stranicu si još otvarao/otvarala putem njezine IP adrese. U svakodnevici nitko ne upisuje `192.168.0.20` — i nijedno novo prijenosno računalo ne dobiva adresu ručnim unosom. Kako sve to funkcionira zajedno, otkrit ćeš u ovom poglavlju, protokol po protokol.
