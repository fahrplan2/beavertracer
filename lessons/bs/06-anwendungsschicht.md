# Sloj 5–7: aplikacijski sloj

:::goal
**Ishod učenja:** Možeš prepoznati najvažnije protokole aplikacijskog sloja — HTTP, DNS, SMTP/POP3/IMAP i DHCP — u Traceru, objasniti njihov tok i pronaći tipične greške.
:::

:::osi 7
:::

:::sim
url=/sims/lesson-6.1.btsim
:::

U poglavlju 5 vidio/la si: TCP i UDP isporučuju podatke pouzdano (ili brzo) pravom programu — putem portova. *Šta* se nalazi u tim podacima, određuju protokoli **aplikacijskog sloja**. U TCP/IP modelu to je jedan sloj, a u ISO/OSI modelu odgovara slojevima 5 do 7.

Svaki od ovih protokola ima svoj zadatak — i svoj port:

| Protokol | Zadatak | Port | Transport |
|---|---|---|---|
| **HTTP** | preuzimanje web stranica | 80 | TCP |
| **DNS** | prevođenje imena u IP adrese | 53 | uglavnom UDP |
| **SMTP** | slanje e-pošte | 25 | TCP |
| **POP3** / **IMAP** | preuzimanje e-pošte | 110 / 143 | TCP |
| **DHCP** | automatsko dodjeljivanje IP adrese uređaju | 67 / 68 | UDP |

U poglavlju 1.3 web stranicu si još pozivao/la putem njene IP adrese. U svakodnevnom životu niko ne upisuje `192.168.0.20` — i nijedan novi laptop ne dobija adresu ručnim unosom. Kako sve ovo funkcionira zajedno, otkrit ćeš u ovom poglavlju, protokol po protokol.
