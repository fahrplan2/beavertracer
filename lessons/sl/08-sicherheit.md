# Varnost: šifriranje in digitalna potrdila

:::goal
**Učni cilj:** Znaš razložiti tri varnostne cilje: zaupnost, celovitost in verodostojnost. Znaš razlikovati simetrično in asimetrično šifriranje, razvrstiti zgoščene vrednosti in digitalne podpise, brati digitalna potrdila in jih izdati sam, nastaviti HTTPS ter razložiti značilna opozorila o digitalnih potrdilih.
:::

V zadnjih poglavjih si lahko v Tracerju prebral skoraj vse:

- **Poglavje 3.3.2:** V omrežju WLAN vsaka naprava v dosegu sprejme vse radijske pakete.
- **Poglavje 6.1.2:** Pri HTTP sta zahteva in spletna stran v paketu v čistopisu.
- **Poglavje 6.3.2:** Pri SMTP in POP3 uporabniško ime in geslo potujeta po vodniku skoraj v čistopisu — `AUTH PLAIN` je le Base64.

Kdor prisluškuje na vodniku ali v istem omrežju WLAN, torej vidi gesla, ocene, sporočila in bančne podatke. Zmore pa še več: pakete **spreminja** ali se **pretvarja**, da je nekdo drug.

## Trije varnostni cilji

Proti tem nevarnostim naj bi pomagala kriptografija. Razlikujemo tri **varnostne cilje**:

| Varnostni cilj | Vprašanje | Primer napada |
|---|---|---|
| **Zaupnost** | Ali lahko podatke prebere samo pravi prejemnik? | Nekdo v omrežju WLAN prebere tvoje geslo. |
| **Celovitost** | Ali so podatki prispeli nespremenjeni? | Nekdo v nakazilu spremeni znesek. |
| **Verodostojnost** | Ali podatki res izvirajo od navedenega pošiljatelja? | Ponarejena spletna stran banke zahteva tvoj PIN. |

V tem poglavju spoznaš orodja, s katerimi dosežemo te tri cilje, in kako delujejo skupaj v **HTTPS**, tj. v simbolu ključavnice v brskalniku.

:::quiz match
Nekdo v omrežju WLAN prebere tvoje geslo -> Zaupnost
Nekdo med prenosom spremeni znesek nakazila -> Celovitost
Ponarejena spletna stran se izdaja za tvojo banko -> Verodostojnost
:::

:::evaluate
Preveri razvrstitev
:::
