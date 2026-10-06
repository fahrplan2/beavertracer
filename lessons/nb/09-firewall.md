# Brannmur: hvem slipper inn, og hvem slipper ut?

:::goal
**Læringsmål:** Du kan forklare hvordan et pakkefilter arbeider med regler, sette opp regler selv og plassere dem i riktig rekkefølge, skille mellom å forkaste og å avvise, forklare forskjellen mellom en tilstandsløs og en tilstandsbasert brannmur, bygge en DMZ og finne feil i brannmurregler.
:::

:::osi 4
:::

:::sim
url=/sims/lesson-9.btsim
:::

Beaver-skolen har egne offentlige adresser (`198.51.100.…`): **Schulserver** er direkte tilgjengelig fra internett — uten NAT, slik det snart vil være overalt med IPv6 (kapittel 7.3). Mellom internett og **Schulrouter** står det en **brannmur**, men den slipper foreløpig alt igjennom.

Til venstre ser du «internett»: en **Internet-PC** og webserveren `www.beispiel.de`. Til høyre ser du skolenettverket med **Schulserver** og **Lehrer-PC**.

## Hva ser en angriper?

Den som vil angripe en server, leter først etter **åpne porter** — altså tjenester som venter på tilkoblinger. Verktøyet for dette heter **portskanner**; den mest kjente er `nmap`.

Bytt til :fa-play: **Kjør**-modus, åpne :fa-terminal: **Terminal** på **Internet-PC** og skriv inn:

```
$ nmap 198.51.100.10
```

`nmap` prøver å opprette en TCP-forbindelse til de 20 vanligste portene og melder fra om hvilke som er åpne.

:::quiz multi
Hvilke porter er åpne på skoleserveren fra internett?
- [x] 22 (SSH, fjernvedlikehold)
- [x] 25 (SMTP)
- [x] 80 (HTTP)
- [x] 110 (POP3)
- [x] 143 (IMAP)
- [ ] 443 (HTTPS)
:::

:::evaluate
Kontroller svar
:::

Nettsiden (80) og mottak av e-post (25) skal være tilgjengelige fra internett. Men **fjernvedlikehold** (22) og henting av e-post (110, 143) trengs bare i skolenettverket. Hver åpne port er en mulig angrepsflate: Hvis tjenesten har et sikkerhetshull eller et svakt passord, kan en angriper utnytte det fra hvor som helst i verden — og automatiske skannere på internett prøver akkurat det døgnet rundt.

:::tip Husk dette
En **brannmur** kontrollerer datatrafikken ved grensen mellom to nettverk og slipper bare igjennom det som uttrykkelig er tillatt. Slik forblir tjenester som bare trengs internt, usynlige for internett.
:::
