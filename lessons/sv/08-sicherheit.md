# Säkerhet: kryptering och certifikat

:::goal
**Lärandemål:** Du kan förklara de tre skyddsmålen sekretess, integritet och autenticitet, skilja mellan symmetrisk och asymmetrisk kryptering, placera in hashvärden och digitala signaturer, läsa och själv utfärda certifikat, konfigurera HTTPS och tolka vanliga certifikatvarningar.
:::

I de senaste kapitlen kunde du läsa med i nästan allt i Tracer:

- **Kapitel 3.3.2:** I WLAN tar varje enhet inom räckhåll emot alla radiopaket.
- **Kapitel 6.1.2:** Med HTTP står förfrågan och webbsidan i klartext i paketet.
- **Kapitel 6.3.2:** Med SMTP och POP3 skickas användarnamn och lösenord nästan i klartext över ledningen — `AUTH PLAIN` är bara Base64.

Den som lyssnar på en ledning eller i samma WLAN ser alltså lösenord, betyg, meddelanden och bankuppgifter. Och angriparen kan göra ännu mer: **ändra** paket eller **utge sig** för att vara någon annan.

## Tre skyddsmål

Kryptografi ska hjälpa mot dessa hot. Man skiljer på tre **skyddsmål**:

| Skyddsmål | Fråga | Exempel på en attack |
|---|---|---|
| **Sekretess** | Kan bara rätt mottagare läsa datan? | Någon läser ditt lösenord i WLAN. |
| **Integritet** | Har datan kommit fram oförändrad? | Någon ändrar beloppet i en överföring. |
| **Autenticitet** | Kommer datan verkligen från den angivna avsändaren? | En falsk bankwebbplats frågar efter din PIN-kod. |

I det här kapitlet lär du dig känna till verktygen som används för att uppnå de tre målen — och hur de samverkar i **HTTPS**, hänglås-symbolen i webbläsaren.

:::quiz match
Någon läser ditt lösenord i WLAN -> Sekretess
Någon ändrar beloppet i en överföring på vägen -> Integritet
En falsk webbplats utger sig för att vara din bank -> Autenticitet
:::

:::evaluate
Kontrollera matchningen
:::
