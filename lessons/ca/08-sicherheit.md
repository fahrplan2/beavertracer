# Seguretat: xifratge i certificats

:::goal
**Objectiu d'aprenentatge:** Saps explicar els tres objectius de protecció: confidencialitat, integritat i autenticitat; distingir el xifratge simètric de l'asimètric, situar els valors hash i les signatures digitals, llegir i emetre certificats pel teu compte, configurar HTTPS i interpretar les advertències de certificat més habituals.
:::

En els últims capítols a la Traça podies llegir gairebé tot:

- **Capítol 3.3.2:** A la xarxa Wi-Fi, cada dispositiu dins de l'abast rep tots els paquets de ràdio.
- **Capítol 6.1.2:** Amb HTTP, la petició i la pàgina web van en text pla dins del paquet.
- **Capítol 6.3.2:** Amb SMTP i POP3, el nom d'usuari i la contrasenya passen pel cable gairebé en text pla — `AUTH PLAIN` és només Base64.

Qui escolta en una línia o a la mateixa xarxa Wi-Fi veu, doncs, contrasenyes, notes, missatges i dades bancàries. I encara pot fer més: **modificar** paquets o **fer-se passar** per una altra persona.

## Tres objectius de protecció

La criptografia ha d'ajudar contra aquests perills. Es distingeixen tres **objectius de protecció**:

| Objectiu de protecció | Pregunta | Exemple d'atac |
|---|---|---|
| **Confidencialitat** | Només el receptor correcte pot llegir les dades? | Algú llegeix la teva contrasenya a la xarxa Wi-Fi. |
| **Integritat** | Les dades han arribat sense modificar? | Algú canvia l'import en una transferència. |
| **Autenticitat** | Les dades provenen realment del remitent indicat? | Una pàgina web bancària falsa et demana el PIN. |

En aquest capítol coneixeràs les eines amb què s'assoleixen aquests tres objectius — i com col·laboren en **HTTPS**, el símbol del cadenat al navegador.

:::quiz match
Algú llegeix la teva contrasenya a la xarxa Wi-Fi -> Confidencialitat
Algú canvia pel camí l'import d'una transferència -> Integritat
Una pàgina web falsa es fa passar pel teu banc -> Autenticitat
:::

:::evaluate
Comprova l'associació
:::
