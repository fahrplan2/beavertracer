# Sauga: šifravimas ir sertifikatai

:::goal
**Mokymosi tikslas:** Gebėsi paaiškinti tris saugos tikslus – konfidencialumą, vientisumą ir autentiškumą, atskirti simetrinį ir asimetrinį šifravimą, suprasti maišos reikšmių ir skaitmeninių parašų paskirtį, skaityti ir patiems išduoti sertifikatus, nustatyti HTTPS ir aiškinti dažniausius įspėjimus apie sertifikatus.
:::

Ankstesniuose skyriuose Tracer programoje galėjai perskaityti beveik viską:

- **3.3.2 skyrius:** Belaidžiame tinkle (WLAN) kiekvienas veikimo zonoje esantis įrenginys gauna visus radijo paketus.
- **6.1.2 skyrius:** Naudojant HTTP, užklausa ir tinklalapis pakete matomi atviruoju tekstu.
- **6.3.2 skyrius:** Naudojant SMTP ir POP3, naudotojo vardas ir slaptažodis linija keliauja beveik atviruoju tekstu – `AUTH PLAIN` yra tik Base64.

Taigi tas, kas pasiklauso linijos arba to paties WLAN tinklo, mato slaptažodžius, pažymius, žinutes ir banko duomenis. Be to, jis gali dar daugiau: **keisti** paketus arba **apsimesti** kažkuo kitu.

## Trys saugos tikslai

Nuo šių grėsmių turi apsaugoti kriptografija. Išskiriami trys **saugos tikslai**:

| Saugos tikslas | Klausimas | Atakos pavyzdys |
|---|---|---|
| **Konfidencialumas** | Ar duomenis gali perskaityti tik tinkamas gavėjas? | Kažkas WLAN tinkle pasiklauso tavo slaptažodžio. |
| **Vientisumas** | Ar duomenys atkeliavo nepakitę? | Kažkas pakeičia pervedimo sumą. |
| **Autentiškumas** | Ar duomenys tikrai gauti iš nurodyto siuntėjo? | Suklastota banko svetainė prašo tavo PIN kodo. |

Šiame skyriuje susipažinsi su priemonėmis, kuriomis pasiekiami šie trys tikslai, ir su tuo, kaip jos veikia kartu **HTTPS** protokole – užrakto simbolyje naršyklėje.

:::quiz match
Kažkas WLAN tinkle pasiklauso tavo slaptažodžio -> Konfidencialumas
Kažkas pakeičia pervedimo sumą jam keliaujant -> Vientisumas
Suklastota svetainė apsimeta tavo banku -> Autentiškumas
:::

:::evaluate
Patikrinti atitikimą
:::
