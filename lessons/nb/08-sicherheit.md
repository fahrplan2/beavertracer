# Sikkerhet: kryptering og sertifikater

:::goal
**Læringsmål:** Du kan forklare de tre sikkerhetsmålene konfidensialitet, integritet og autentisitet, skille mellom symmetrisk og asymmetrisk kryptering, plassere hashverdier og digitale signaturer, lese og selv utstede sertifikater, sette opp HTTPS og tolke typiske sertifikatadvarsler.
:::

I de siste kapitlene kunne du lese med på nesten alt i Tracer:

- **Kapittel 3.3.2:** På WLAN mottar hver enhet innen rekkevidde alle radiopakkene.
- **Kapittel 6.1.2:** Med HTTP står forespørsel og nettside i klartekst i pakken.
- **Kapittel 6.3.2:** Med SMTP og POP3 går brukernavn og passord nesten i klartekst over linjen — `AUTH PLAIN` er bare Base64.

Den som avlytter på en linje eller på det samme WLAN-et, ser altså passord, karakterer, meldinger og bankopplysninger. Og vedkommende kan gjøre enda mer: **endre** pakker eller **utgi seg** for å være noen andre.

## Tre sikkerhetsmål

Kryptografi skal hjelpe mot disse truslene. Man skiller mellom tre **sikkerhetsmål**:

| Sikkerhetsmål | Spørsmål | Eksempel på et angrep |
|---|---|---|
| **Konfidensialitet** | Kan bare riktig mottaker lese dataene? | Noen leser passordet ditt på WLAN. |
| **Integritet** | Har dataene kommet fram uendret? | Noen endrer beløpet i en overføring. |
| **Autentisitet** | Kommer dataene virkelig fra den oppgitte avsenderen? | En falsk nettbanknettside ber om PIN-koden din. |

I dette kapittelet blir du kjent med verktøyene som brukes for å nå disse tre målene — og hvordan de virker sammen i **HTTPS**, hengelås-symbolet i nettleseren.

:::quiz match
Noen leser passordet ditt på WLAN -> Konfidensialitet
Noen endrer beløpet i en overføring underveis -> Integritet
En falsk nettside utgir seg for å være banken din -> Autentisitet
:::

:::evaluate
Kontroller sammenstillingen
:::
