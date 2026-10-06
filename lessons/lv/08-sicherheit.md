# Drošība: šifrēšana un sertifikāti

:::goal
**Mācību mērķis:** Tu vari izskaidrot trīs aizsardzības mērķus — konfidencialitāti, integritāti un autentiskumu, atšķirt simetrisko un asimetrisko šifrēšanu, izprast jaucējkodus un digitālos parakstus, lasīt sertifikātus un izsniegt tos pats, iestatīt HTTPS un izprast tipiskus sertifikātu brīdinājumus.
:::

Iepriekšējās nodaļās Tracer programmā tu varēji nolasīt gandrīz visu:

- **3.3.2. nodaļa:** WLAN tīklā katra ierīce uztveršanas zonā saņem visas radiopaketes.
- **6.1.2. nodaļa:** Izmantojot HTTP, pieprasījums un tīmekļa lapa paketē ir atklātā tekstā.
- **6.3.2. nodaļa:** Izmantojot SMTP un POP3, lietotājvārds un parole pa līniju tiek sūtīti gandrīz atklātā tekstā — `AUTH PLAIN` ir tikai Base64.

Tas, kas noklausās līniju vai atrodas tajā pašā WLAN tīklā, redz paroles, atzīmes, ziņojumus un bankas datus. Un viņš var vēl vairāk: **mainīt** paketes vai **uzdoties** par kādu citu.

## Trīs aizsardzības mērķi

Pret šiem draudiem palīdz kriptogrāfija. Izšķir trīs **aizsardzības mērķus**:

| Aizsardzības mērķis | Jautājums | Uzbrukuma piemērs |
|---|---|---|
| **Konfidencialitāte** | Vai datus var izlasīt tikai pareizais saņēmējs? | Kāds WLAN tīklā nolasa tavu paroli. |
| **Integritāte** | Vai dati ir ieradušies nemainīti? | Kāds pārskaitījumā maina summu. |
| **Autentiskums** | Vai dati tiešām nāk no norādītā sūtītāja? | Viltota bankas tīmekļa vietne pieprasa tavu PIN. |

Šajā nodaļā tu iepazīsi rīkus, ar kuriem šos trīs mērķus var sasniegt, un to, kā tie darbojas kopā **HTTPS** protokolā — slēdzenes simbolā pārlūkā.

:::quiz match
Kāds WLAN tīklā nolasa tavu paroli -> Konfidencialitāte
Kāds pa ceļam maina pārskaitījuma summu -> Integritāte
Viltota tīmekļa vietne uzdodas par tavu banku -> Autentiskums
:::

:::evaluate
Pārbaudīt sasaisti
:::
