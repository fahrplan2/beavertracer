# Sigurtà: encryption u ċertifikati

:::goal
**Għan tat-tagħlim:** Tista' tispjega t-tliet miri tas-sigurtà: kunfidenzjalità, integrità u awtentiċità, tiddistingwi bejn symmetric u asymmetric encryption, tikklassifika hash values u digital signatures, taqra u toħroġ ċertifikati int stess, twaqqaf HTTPS u tinterpreta twissijiet tipiċi dwar iċ-ċertifikati.
:::

Fil-kapitli li għaddew, fit-Traċċa stajt taqra kważi kollox:

- **Kapitolu 3.3.2:** Fil-WLAN, kull apparat fil-firxa jirċievi l-pakketti kollha tar-radju.
- **Kapitolu 6.1.2:** Fl-HTTP, it-talba u l-websajt jinsabu fil-packet bħala plain text.
- **Kapitolu 6.3.2:** Fl-SMTP u l-POP3, l-isem tal-utent u l-password jaslu kważi bħala plain text — `AUTH PLAIN` huwa biss Base64.

Min jisma' fuq kejbil jew fl-istess WLAN, għalhekk jara passwords, marki, messaġġi u dettalji tal-bank. U jista' jagħmel iktar: **ibiddel** il-packets jew **jippretendi** li huwa xi ħadd ieħor.

## Tliet miri tas-sigurtà

Il-kriptografija suppost tgħin kontra dawn il-perikli. Wieħed jiddistingwi tliet **miri tas-sigurtà**:

| Mira tas-sigurtà | Mistoqsija | Eżempju ta' attakk |
|---|---|---|
| **Kunfidenzjalità** | Jista' biss ir-receiver t-tajjeb jaqra d-data? | Xi ħadd jaqra l-password tiegħek fil-WLAN. |
| **Integrità** | Waslet id-data bla ma nbidlet? | Xi ħadd ibiddel l-ammont f'trasferiment tal-flus. |
| **Awtentiċità** | Id-data tassew toriġina mis-sender indikat? | Websajt falza ta' bank titlob il-PIN tiegħek. |

F'dan il-kapitolu se titgħallem l-għodod li permezz tagħhom jintlaħqu dawn it-tliet miri — u kif jaħdmu flimkien f'**HTTPS**, is-simbolu tal-lukkett fil-browser.

:::quiz match
Xi ħadd jaqra l-password tiegħek fil-WLAN -> Kunfidenzjalità
Xi ħadd ibiddel fit-triq l-ammont ta' trasferiment tal-flus -> Integrità
Websajt falza tippretendi li hija l-bank tiegħek -> Awtentiċità
:::

:::evaluate
Iċċekkja t-tqabbil
:::
