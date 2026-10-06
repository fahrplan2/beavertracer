# Turvalisus: krüptimine ja sertifikaadid

:::goal
**Õpieesmärk:** Sa oskad selgitada kolme kaitse-eesmärki – konfidentsiaalsust, terviklikkust ja autentsust –, eristada sümmeetrilist ja asümmeetrilist krüptimist, paigutada räsiväärtused ja digiallkirjad õigesse konteksti, lugeda sertifikaate ja neid ise välja anda, seadistada HTTPS-i ning tõlgendada tüüpilisi sertifikaadihoiatusi.
:::

Eelmistes peatükkides said Tracerist peaaegu kõike kaasa lugeda:

- **Peatükk 3.3.2:** WLAN-is võtab iga leviulatuses olev seade vastu kõik raadiopaketid.
- **Peatükk 6.1.2:** HTTP puhul on päring ja veebileht paketis lahtise tekstina.
- **Peatükk 6.3.2:** SMTP ja POP3 puhul liiguvad kasutajanimi ja parool peaaegu lahtise tekstina üle liini – `AUTH PLAIN` on vaid Base64.

Kes kuulab pealt liini või samas WLAN-is, näeb seega paroole, hindeid, sõnumeid ja pangaandmeid. Ja ta suudab veel rohkem: pakette **muuta** või ennast kellegi teisena **esitleda**.

## Kolm kaitse-eesmärki

Nende ohtude vastu peab aitama krüptograafia. Eristatakse kolme **kaitse-eesmärki**:

| Kaitse-eesmärk | Küsimus | Näide ründest |
|---|---|---|
| **Konfidentsiaalsus** | Kas andmeid saab lugeda ainult õige vastuvõtja? | Keegi loeb WLAN-is sinu parooli kaasa. |
| **Terviklikkus** | Kas andmed jõudsid kohale muutumatuna? | Keegi muudab ülekandes summat. |
| **Autentsus** | Kas andmed pärinevad tõesti märgitud saatjalt? | Võlts pangaveebileht küsib sinu PIN-koodi. |

Selles peatükis tutvud töövahenditega, mille abil neid kolme eesmärki saavutatakse – ja sellega, kuidas need **HTTPS-is** koos töötavad, st lukusümbolis brauseris.

:::quiz match
Keegi loeb WLAN-is sinu parooli kaasa -> Konfidentsiaalsus
Keegi muudab teel ülekande summat -> Terviklikkus
Võltsveebileht esineb sinu pangana -> Autentsus
:::

:::evaluate
Kontrolli vastavusi
:::
