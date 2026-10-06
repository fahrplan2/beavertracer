# Sigurnost: šifriranje i certifikati

:::goal
**Ishod učenja:** Možeš objasniti tri cilja zaštite: povjerljivost, integritet i autentičnost, razlikovati simetrično i asimetrično šifriranje, razumjeti hash vrijednosti i digitalne potpise, čitati certifikate i sam ih izdavati, postaviti HTTPS i protumačiti tipična upozorenja o certifikatima.
:::

U prethodnim poglavljima si u Traceru mogao pročitati gotovo sve:

- **Poglavlje 3.3.2:** U WLAN-u svaki uređaj u dometu prima sve radio-pakete.
- **Poglavlje 6.1.2:** Kod HTTP-a se zahtjev i web-stranica nalaze u paketu u čistom tekstu.
- **Poglavlje 6.3.2:** Kod SMTP-a i POP3 korisničko ime i lozinka putuju linijom gotovo u čistom tekstu — `AUTH PLAIN` je samo Base64.

Ko prisluškuje na vodu ili u istom WLAN-u, vidi dakle lozinke, ocjene, poruke i bankovne podatke. A može i više: **mijenjati** pakete ili se **lažno predstavljati** kao neko drugi.

## Tri cilja zaštite

Protiv ovih opasnosti pomaže kriptografija. Razlikuju se tri **cilja zaštite**:

| Cilj zaštite | Pitanje | Primjer napada |
|---|---|---|
| **Povjerljivost** | Može li podatke pročitati samo pravi primalac? | Neko u WLAN-u čita tvoju lozinku. |
| **Integritet** | Jesu li podaci stigli nepromijenjeni? | Neko u uplatnici promijeni iznos. |
| **Autentičnost** | Potiču li podaci zaista od navedenog pošiljaoca? | Lažna web-stranica banke traži tvoj PIN. |

U ovom poglavlju upoznaćeš alate kojima se postižu ova tri cilja — i kako zajedno djeluju u **HTTPS-u**, simbolu lokota u pregledniku.

:::quiz match
Neko čita tvoju lozinku u WLAN-u -> Povjerljivost
Neko usput mijenja iznos uplate -> Integritet
Lažna web-stranica predstavlja se kao tvoja banka -> Autentičnost
:::

:::evaluate
Provjeri pridruživanje
:::
