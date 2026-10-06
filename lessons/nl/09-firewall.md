# Firewall: wie mag erin, wie mag eruit?

:::goal
**Leerdoel:** Je kunt uitleggen hoe een pakketfilter met regels werkt, zelf regels opstellen en in de juiste volgorde zetten, het verschil tussen weggooien (drop) en weigeren (reject) benoemen, het verschil tussen een stateless en een stateful firewall uitleggen, een DMZ opbouwen en fouten in firewallregels vinden.
:::

:::osi 4
:::

:::sim
url=/sims/lesson-9.btsim
:::

De Beaver-school heeft eigen openbare adressen (`198.51.100.…`): haar **Schulserver** is rechtstreeks bereikbaar vanaf het internet — zonder NAT, zoals dat met IPv6 binnenkort overal zal zijn (hoofdstuk 7.3). Tussen het internet en de **Schulrouter** zit een **firewall**, die op dit moment nog alles doorlaat.

Links zie je "het internet": een **Internet-PC** en de webserver `www.beispiel.de`. Rechts staat het schoolnetwerk met de **Schulserver** en de **Lehrer-PC**.

## Wat ziet een aanvaller?

Wie een server wil aanvallen, zoekt eerst naar **open poorten** — dus naar diensten die op verbindingen wachten. Het hulpmiddel daarvoor heet **poortscanner**; de bekendste is `nmap`.

Schakel over naar de :fa-play: **Uitvoeren**-modus, open op de **Internet-PC** het :fa-terminal: **Terminal** en voer in:

```
$ nmap 198.51.100.10
```

`nmap` probeert met de 20 meest gebruikte poorten een TCP-verbinding op te bouwen en meldt welke open zijn.

:::quiz multi
Welke poorten op de schoolserver zijn vanaf het internet open?
- [x] 22 (SSH, beheer op afstand)
- [x] 25 (SMTP)
- [x] 80 (HTTP)
- [x] 110 (POP3)
- [x] 143 (IMAP)
- [ ] 443 (HTTPS)
:::

:::evaluate
Antwoord controleren
:::

De website (80) en het ontvangen van e-mails (25) moeten vanaf het internet bereikbaar zijn. Maar het **beheer op afstand** (22) en het ophalen van e-mail (110, 143) is alleen nodig binnen het schoolnetwerk. Elke open poort is een mogelijk aanvalsoppervlak: heeft de dienst een beveiligingslek of een zwak wachtwoord, dan kan een aanvaller dat vanaf overal ter wereld misbruiken — en automatische scanners op het internet proberen precies dat dag en nacht.

:::tip Onthoud
Een **firewall** controleert het dataverkeer op de grens tussen twee netwerken en laat alleen door wat uitdrukkelijk is toegestaan. Zo blijven diensten die alleen intern nodig zijn onzichtbaar voor het internet.
:::
