# 4 lygmuo: transporto lygmuo

:::goal
**Mokymosi tikslas:** Gali įvardyti transporto lygmens uždavinius, pavaizduoti TCP ryšio eigą (užmezgimą, duomenų perdavimą, nutraukimą) komunikacijos diagrama, paaiškinti prievadus (portus) bei sekos ir patvirtinimo numerius ir pagrįsti, kada vietoje TCP naudojamas UDP.
:::

:::osi 4
:::

:::sim
url=/sims/lesson-5.1.btsim
:::

Trumpa 4 skyriaus apžvalga: **Interneto protokolas** (IP) 3 lygmenyje nugabena paketą į reikiamą *kompiuterį* — net per daugybę maršrutizatorių. Tačiau daugiau IP nieko nežada:

- Kompiuteryje vienu metu veikia daug programų: naršyklė, pašto programa, pokalbių programa. Kuriai iš jų skirtas paketas? IP antraštėje to nėra.
- Jei pakeliui paketas pasimeta, IP to nepastebi. Paketai taip pat gali ateiti dukart arba netinkama tvarka. Sakoma: IP pristato tik pagal geriausias pastangas (*best effort*).

Šias spragas užpildo **4 lygmuo**, transporto lygmuo. Darbo srityje matai **Client-PC** ir **Server** — su jais šiame skyriuje tirsi du svarbiausius 4 lygmens protokolus: **TCP** ir **UDP**.

:::note
TCP standartizuotas nuo 1981 m. (**RFC 793**, dabar **RFC 9293**), o UDP — jau nuo 1980 m. (**RFC 768**).
:::
