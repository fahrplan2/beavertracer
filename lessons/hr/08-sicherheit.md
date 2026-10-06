# Sigurnost: šifriranje i certifikati

:::goal
**Ishod učenja:** Možeš objasniti tri cilja zaštite: povjerljivost, integritet i autentičnost, razlikovati simetrično i asimetrično šifriranje, razumjeti hash vrijednosti i digitalne potpise, čitati i sam izdavati certifikate, postaviti HTTPS i protumačiti uobičajena upozorenja o certifikatima.
:::

U prethodnim poglavljima u Traceru si mogao/mogla gotovo sve pročitati:

- **Poglavlje 3.3.2:** U WLAN-u svaki uređaj unutar dometa prima sve radijske pakete.
- **Poglavlje 6.1.2:** Kod HTTP-a se zahtjev i web-stranica nalaze u paketu kao običan tekst.
- **Poglavlje 6.3.2:** Kod SMTP-a i POP3-a korisničko ime i lozinka putuju vodom gotovo kao običan tekst — `AUTH PLAIN` je samo Base64.

Tko prisluškuje na vodu ili u istom WLAN-u, vidi lozinke, ocjene, poruke i bankovne podatke. A može i više: **mijenjati** pakete ili **lažno se predstavljati** kao netko drugi.

## Tri cilja zaštite

Protiv tih opasnosti pomaže kriptografija. Razlikuju se tri **cilja zaštite**:

| Cilj zaštite | Pitanje | Primjer napada |
|---|---|---|
| **Povjerljivost** | Može li podatke pročitati samo pravi primatelj? | Netko u WLAN-u čita tvoju lozinku. |
| **Integritet** | Jesu li podaci stigli nepromijenjeni? | Netko u uplatnici promijeni iznos. |
| **Autentičnost** | Potječu li podaci doista od navedenog pošiljatelja? | Lažna web-stranica banke traži tvoj PIN. |

U ovom poglavlju upoznat ćeš alate kojima se ta tri cilja postižu — i kako zajedno djeluju u **HTTPS-u**, simbolu lokota u pregledniku.

:::quiz match
Netko čita tvoju lozinku u WLAN-u -> Povjerljivost
Netko usput mijenja iznos uplatnice -> Integritet
Lažna web-stranica predstavlja se kao tvoja banka -> Autentičnost
:::

:::evaluate
Provjeri pridruživanje
:::
