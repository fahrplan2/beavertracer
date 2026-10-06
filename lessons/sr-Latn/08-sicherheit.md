# Bezbednost: šifrovanje i sertifikati

:::goal
**Cilj učenja:** Možeš da objasniš tri cilja zaštite: poverljivost, integritet i autentičnost, da razlikuješ simetrično i asimetrično šifrovanje, da razumeš heš vrednosti i digitalne potpise, da čitaš i sam izdaješ sertifikate, da podesiš HTTPS i da protumačiš tipična upozorenja o sertifikatima.
:::

U prethodnim poglavljima si u Tracer-u mogao da pročitaš skoro sve:

- **Poglavlje 3.3.2:** U WLAN-u svaki uređaj u dometu prima sve radio-pakete.
- **Poglavlje 6.1.2:** Kod HTTP-a se zahtev i veb-stranica nalaze u paketu kao običan tekst.
- **Poglavlje 6.3.2:** Kod SMTP-a i POP3-a korisničko ime i lozinka putuju kroz vod skoro kao običan tekst — `AUTH PLAIN` je samo Base64.

Ko prisluškuje na vodu ili u istom WLAN-u, dakle, vidi lozinke, ocene, poruke i bankovne podatke. A može i više: može da **menja** pakete ili da se **predstavlja** kao neko drugi.

## Tri cilja zaštite

Protiv ovih opasnosti treba da pomogne kriptografija. Razlikuju se tri **cilja zaštite**:

| Cilj zaštite | Pitanje | Primer napada |
|---|---|---|
| **Poverljivost** | Može li samo pravi primalac da pročita podatke? | Neko u WLAN-u čita tvoju lozinku. |
| **Integritet** | Da li su podaci stigli nepromenjeni? | Neko u uplatnici menja iznos. |
| **Autentičnost** | Potiču li podaci zaista od navedenog pošiljaoca? | Lažna veb-stranica banke traži tvoj PIN. |

U ovom poglavlju upoznaćeš alate pomoću kojih se postižu ta tri cilja — i kako zajedno funkcionišu u **HTTPS-u**, simbolu katanca u pregledaču.

:::quiz match
Neko čita tvoju lozinku u WLAN-u -> Poverljivost
Neko usput menja iznos uplate -> Integritet
Lažna veb-stranica predstavlja se kao tvoja banka -> Autentičnost
:::

:::evaluate
Proveri povezivanje
:::
