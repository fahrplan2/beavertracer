# Beveiliging: versleuteling en certificaten

:::goal
**Leerdoel:** Je kunt de drie beveiligingsdoelen vertrouwelijkheid, integriteit en authenticiteit uitleggen, symmetrische en asymmetrische versleuteling van elkaar onderscheiden, hashwaarden en digitale handtekeningen plaatsen, certificaten lezen en zelf uitgeven, HTTPS instellen en typische certificaatwaarschuwingen duiden.
:::

In de vorige hoofdstukken kon je in de Tracer bijna alles meelezen:

- **Hoofdstuk 3.3.2:** In wifi ontvangt elk apparaat binnen bereik alle radiopakketten.
- **Hoofdstuk 6.1.2:** Bij HTTP staan verzoek en webpagina als platte tekst in het pakket.
- **Hoofdstuk 6.3.2:** Bij SMTP en POP3 gaan gebruikersnaam en wachtwoord bijna als platte tekst over de lijn — `AUTH PLAIN` is alleen Base64.

Wie op een kabel of in hetzelfde wifi-netwerk meeluistert, ziet dus wachtwoorden, cijfers, berichten en bankgegevens. En hij kan nog meer: pakketten **wijzigen** of zich **voordoen** als iemand anders.

## Drie beveiligingsdoelen

Tegen deze gevaren moet cryptografie helpen. Men onderscheidt drie **beveiligingsdoelen**:

| Beveiligingsdoel | Vraag | Voorbeeld van een aanval |
|---|---|---|
| **Vertrouwelijkheid** | Kan alleen de juiste ontvanger de gegevens lezen? | Iemand leest in het wifi-netwerk je wachtwoord mee. |
| **Integriteit** | Zijn de gegevens ongewijzigd aangekomen? | Iemand wijzigt in een overschrijving het bedrag. |
| **Authenticiteit** | Komen de gegevens echt van de opgegeven afzender? | Een valse bankwebsite vraagt naar je pincode. |

In dit hoofdstuk leer je de hulpmiddelen kennen waarmee je deze drie doelen bereikt — en hoe ze samenwerken in **HTTPS**, het slotsymbool in de browser.

:::quiz match
Iemand leest je wachtwoord in het wifi-netwerk mee -> Vertrouwelijkheid
Iemand wijzigt onderweg het bedrag van een overschrijving -> Integriteit
Een valse website doet zich voor als je bank -> Authenticiteit
:::

:::evaluate
Koppeling controleren
:::
