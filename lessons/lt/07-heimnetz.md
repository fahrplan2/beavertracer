# Namų tinklas: maršrutizatorius ir NAT

:::goal
**Mokymosi tikslas:** Tu gali įvardyti namų maršrutizatoriaus užduotis, sukonfigūruoti namų maršrutizatorių, paaiškinti, kaip NAT leidžia daugeliui įrenginių pasiekti internetą per vieną viešąjį adresą, ir sukonfigūruoti bei patikrinti prievadų peradresavimą.
:::

:::osi 3
:::

:::sim
url=/sims/lesson-7.1.btsim
:::

Namuose tinkle greitai atsiranda dešimt ar daugiau įrenginių: telefonai, nešiojamieji kompiuteriai, televizorius, žaidimų konsolė, garsiakalbiai. Visi gauna tokius adresus kaip `192.168.178.20` — iš **privataus** diapazono, kuris internete visai nėra persiunčiamas (4.2.2 skyrius). Ir vis dėlto kiekvienas iš šių įrenginių patenka į internetą.

Tai įmanoma dėl nepastebimos dėžutės: **namų maršrutizatoriaus**. Darbo srityje kairėje matai namų tinklą su kompiuteriu ir planšete, o dešinėje – „internetą“: paslaugų teikėjo maršrutizatorius, DNS serverį ir žiniatinklio serverį `www.beispiel.de`.

:::note
Viešieji adresai šiame skyriuje (`203.0.113.…`, `198.51.100.…`, `192.0.2.…`) yra rezervuoti pavyzdžiams ir mokymo medžiagai – lygiai kaip `2001:db8::` IPv6 atveju.
:::
