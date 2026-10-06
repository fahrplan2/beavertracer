# 5–7 lygmenys: taikomųjų programų lygmuo

:::goal
**Mokymosi tikslas:** Gali atpažinti svarbiausius taikomųjų programų lygmens protokolus — HTTP, DNS, SMTP/POP3/IMAP ir DHCP — programoje Tracer, paaiškinti jų veikimą ir rasti tipines klaidas.
:::

:::osi 7
:::

:::sim
url=/sims/lesson-6.1.btsim
:::

5 skyriuje matei: TCP ir UDP pateikia duomenis patikimai (arba greitai) reikiamai programai — per prievadus. *Kas* yra šiuose duomenyse, nustato **taikomųjų programų lygmens** protokolai. TCP/IP modelyje tai vienas lygmuo, o ISO/OSI modelyje jis atitinka 5–7 lygmenis.

Kiekvienas iš šių protokolų turi savo paskirtį — ir savo prievadą:

| Protokolas | Paskirtis | Prievadas | Transportas |
|---|---|---|---|
| **HTTP** | tinklalapių gavimas | 80 | TCP |
| **DNS** | vardų vertimas į IP adresus | 53 | dažniausiai UDP |
| **SMTP** | el. laiškų siuntimas | 25 | TCP |
| **POP3** / **IMAP** | el. laiškų atsiėmimas | 110 / 143 | TCP |
| **DHCP** | automatiškai suteikti įrenginiui IP adresą | 67 / 68 | UDP |

1.3 skyriuje tinklalapį dar atidarei pagal jo IP adresą. Kasdienybėje niekas neveda `192.168.0.20` — ir joks naujas nešiojamasis kompiuteris negauna adreso įvedamo rankiniu būdu. Kaip visa tai veikia kartu, atrasi šiame skyriuje, protokolas po protokolo.
