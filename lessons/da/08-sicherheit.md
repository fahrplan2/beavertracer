# Sikkerhed: kryptering og certifikater

:::goal
**Læringsmål:** Du kan forklare de tre sikkerhedsmål fortrolighed, integritet og autenticitet, skelne mellem symmetrisk og asymmetrisk kryptering, placere hashværdier og digitale signaturer, læse og selv udstede certifikater, opsætte HTTPS og fortolke typiske certifikatadvarsler.
:::

I de sidste kapitler kunne du læse næsten alt med i Tracer:

- **Kapitel 3.3.2:** På Wi-Fi modtager hver enhed inden for rækkevidde alle radiopakker.
- **Kapitel 6.1.2:** Ved HTTP står forespørgsel og webside i klartekst i pakken.
- **Kapitel 6.3.2:** Ved SMTP og POP3 sendes brugernavn og adgangskode næsten i klartekst over ledningen — `AUTH PLAIN` er kun Base64.

Hvis man aflytter på en ledning eller på det samme Wi-Fi, kan man altså se adgangskoder, karakterer, beskeder og bankoplysninger. Og man kan endnu mere: **ændre** pakker eller **udgive sig** for at være en anden.

## Tre sikkerhedsmål

Kryptografi skal hjælpe mod disse farer. Man skelner mellem tre **sikkerhedsmål**:

| Sikkerhedsmål | Spørgsmål | Eksempel på et angreb |
|---|---|---|
| **Fortrolighed** | Kan kun den rigtige modtager læse data? | Nogen læser din adgangskode med på Wi-Fi. |
| **Integritet** | Er data kommet frem uændrede? | Nogen ændrer beløbet i en overførsel. |
| **Autenticitet** | Stammer data virkelig fra den angivne afsender? | En falsk bankwebside spørger efter din PIN-kode. |

I dette kapitel lærer du de værktøjer at kende, som man opnår disse tre mål med — og hvordan de spiller sammen i **HTTPS**, hængelåssymbolet i browseren.

:::quiz match
Nogen læser din adgangskode med på Wi-Fi -> Fortrolighed
Nogen ændrer undervejs beløbet i en overførsel -> Integritet
En falsk webside udgiver sig for at være din bank -> Autenticitet
:::

:::evaluate
Tjek sammenhørende par
:::
