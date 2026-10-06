# Turvallisuus: salaus ja varmenteet

:::goal
**Oppimistavoite:** Osaat selittää kolme suojaustavoitetta eli luottamuksellisuuden, eheyden ja aitouden, erottaa symmetrisen ja asymmetrisen salauksen toisistaan, hahmottaa tiivisteiden ja digitaalisten allekirjoitusten roolin, lukea varmenteita ja myöntää niitä itse, ottaa HTTPS:n käyttöön ja tulkita tyypillisiä varmennevaroituksia.
:::

Edellisissä luvuissa pystyit lukemaan Tracerissa lähes kaiken:

- **Luku 3.3.2:** Langattomassa verkossa jokainen kantoalueella oleva laite vastaanottaa kaikki radiopaketit.
- **Luku 6.1.2:** HTTP:ssä pyyntö ja verkkosivu ovat paketissa selkotekstinä.
- **Luku 6.3.2:** SMTP:ssä ja POP3:ssa käyttäjätunnus ja salasana kulkevat johdossa lähes selkotekstinä — `AUTH PLAIN` on pelkkää Base64:ää.

Kuka tahansa, joka kuuntelee johtoa tai on samassa langattomassa verkossa, näkee siis salasanat, arvosanat, viestit ja pankkitiedot. Ja hän voi tehdä vielä enemmän: **muuttaa** paketteja tai **esiintyä** jonakin toisena.

## Kolme suojaustavoitetta

Näitä uhkia vastaan auttaa kryptografia. Erotetaan kolme **suojaustavoitetta**:

| Suojaustavoite | Kysymys | Esimerkki hyökkäyksestä |
|---|---|---|
| **Luottamuksellisuus** | Voiko vain oikea vastaanottaja lukea tiedot? | Joku lukee langattomassa verkossa salasanasi. |
| **Eheys** | Saapuivatko tiedot muuttumattomina perille? | Joku muuttaa tilisiirron summaa. |
| **Aitous** | Ovatko tiedot todella peräisin ilmoitetulta lähettäjältä? | Väärennetty pankin verkkosivu udattelee PIN-koodiasi. |

Tässä luvussa tutustut työkaluihin, joilla nämä kolme tavoitetta saavutetaan — ja siihen, miten ne toimivat yhdessä **HTTPS**:ssä, eli selaimen lukkosymbolin takana.

:::quiz match
Joku lukee salasanasi langattomassa verkossa -> Luottamuksellisuus
Joku muuttaa tilisiirron summaa matkan varrella -> Eheys
Väärennetty verkkosivu esiintyy pankkinasi -> Aitous
:::

:::evaluate
Tarkista yhdistelmät
:::
