# Bezpečnosť: šifrovanie a certifikáty

:::goal
**Cieľ učenia:** Vieš vysvetliť tri bezpečnostné ciele dôvernosť, integritu a autenticitu, rozlíšiť symetrické a asymetrické šifrovanie, zaradiť hašové hodnoty a digitálne podpisy, čítať certifikáty a vystavovať ich sám, nastaviť HTTPS a vyložiť typické varovania o certifikátoch.
:::

V posledných kapitolách si v Tracer mohol čítať takmer všetko:

- **Kapitola 3.3.2:** V sieti WLAN prijíma každé zariadenie v dosahu všetky rádiové pakety.
- **Kapitola 6.1.2:** Pri HTTP sú požiadavka a webová stránka v pakete v čistom texte.
- **Kapitola 6.3.2:** Pri SMTP a POP3 putuje používateľské meno a heslo po linke takmer v čistom texte — `AUTH PLAIN` je iba Base64.

Kto odpočúva na linke alebo v tej istej sieti WLAN, vidí heslá, známky, správy a bankové údaje. A dokáže ešte viac: pakety **meniť** alebo sa **vydávať** za niekoho iného.

## Tri bezpečnostné ciele

Proti týmto hrozbám má pomáhať kryptografia. Rozlišujeme tri **bezpečnostné ciele**:

| Bezpečnostný cieľ | Otázka | Príklad útoku |
|---|---|---|
| **Dôvernosť** | Môže údaje prečítať iba správny príjemca? | Niekto v sieti WLAN odpočúva tvoje heslo. |
| **Integrita** | Dorazili údaje nezmenené? | Niekto zmení v prevode sumu. |
| **Autenticita** | Pochádzajú údaje naozaj od uvedeného odosielateľa? | Falošná webová stránka banky sa pýta na tvoj PIN. |

V tejto kapitole spoznáš nástroje, pomocou ktorých dosiahneš tieto tri ciele — a ako spolupracujú v **HTTPS**, teda v symbole zámku v prehliadači.

:::quiz match
Niekto odpočúva tvoje heslo v sieti WLAN -> Dôvernosť
Niekto cestou zmení sumu prevodu -> Integrita
Falošná webová stránka sa vydáva za tvoju banku -> Autenticita
:::

:::evaluate
Skontrolovať priradenie
:::
