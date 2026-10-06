# Firewall: Hvem må komme ind, og hvem må komme ud?

:::goal
**Læringsmål:** Du kan forklare, hvordan et pakkefilter arbejder med regler, selv opstille regler og sætte dem i den rigtige rækkefølge, skelne mellem at droppe og afvise, forklare forskellen på en stateless og en stateful firewall, opbygge en DMZ og finde fejl i firewallregler.
:::

:::osi 4
:::

:::sim
url=/sims/lesson-9.btsim
:::

Beaver-skolen har sine egne offentlige adresser (`198.51.100.…`): Dens **Schulserver** er direkte tilgængelig fra internettet — uden NAT, sådan som det snart vil være overalt med IPv6 (kapitel 7.3). Mellem internettet og **Schulrouter** sidder en **firewall**, som lige nu dog stadig lader alt passere.

Til venstre ser du "internettet": en **Internet-PC** og webserveren `www.beispiel.de`. Til højre ser du skolens netværk med **Schulserver** og **Lehrer-PC**.

## Hvad kan en angriber se?

Den, der vil angribe en server, leder først efter **åbne porte** — altså tjenester, der venter på forbindelser. Værktøjet til det hedder en **portscanner**; den mest kendte er `nmap`.

Skift til :fa-play: **Kør**-tilstand, åbn :fa-terminal: **Terminal** på **Internet-PC** og skriv:

```
$ nmap 198.51.100.10
```

`nmap` forsøger at opbygge en TCP-forbindelse til de 20 mest almindelige porte og melder, hvilke der er åbne.

:::quiz multi
Hvilke porte på skoleserveren er åbne fra internettet?
- [x] 22 (SSH, fjernvedligeholdelse)
- [x] 25 (SMTP)
- [x] 80 (HTTP)
- [x] 110 (POP3)
- [x] 143 (IMAP)
- [ ] 443 (HTTPS)
:::

:::evaluate
Tjek svar
:::

Websiden (80) og modtagelsen af e-mails (25) skal kunne nås fra internettet. Men **fjernvedligeholdelsen** (22) og afhentningen af mails (110, 143) skal kun bruges af skolens netværk. Hver åben port er en mulig angrebsflade: Hvis tjenesten har en sikkerhedshul eller en svag adgangskode, kan en angriber udnytte det fra hele verden — og automatiske scannere på internettet prøver netop det døgnet rundt.

:::tip Husk
En **firewall** kontrollerer datatrafikken på grænsen mellem to netværk og lader kun det passere, som udtrykkeligt er tilladt. På den måde forbliver tjenester, der kun skal bruges internt, usynlige for internettet.
:::
