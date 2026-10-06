# Securitate: criptare și certificate

:::goal
**Obiectiv de învățare:** Poți explica cele trei obiective de securitate: confidențialitatea, integritatea și autenticitatea, poți deosebi criptarea simetrică de cea asimetrică, poți încadra valorile hash și semnăturile digitale, poți citi și emite singur certificate, poți configura HTTPS și poți interpreta avertismentele tipice legate de certificate.
:::

În capitolele anterioare ai putut citi aproape totul în Tracer:

- **Capitolul 3.3.2:** În WLAN, fiecare dispozitiv aflat în raza de acoperire primește toate pachetele radio.
- **Capitolul 6.1.2:** La HTTP, cererea și pagina web se află în pachet sub formă de text clar.
- **Capitolul 6.3.2:** La SMTP și POP3, numele de utilizator și parola circulă aproape în text clar — `AUTH PLAIN` este doar Base64.

Cine ascultă pe o linie sau în aceeași rețea WLAN vede deci parole, note, mesaje și date bancare. Și poate face chiar mai mult: poate **modifica** pachete sau se poate **da drept** altcineva.

## Trei obiective de securitate

Criptografia trebuie să ajute împotriva acestor pericole. Se disting trei **obiective de securitate**:

| Obiectiv de securitate | Întrebare | Exemplu de atac |
|---|---|---|
| **Confidențialitate** | Poate citi datele doar destinatarul potrivit? | Cineva îți citește parola în WLAN. |
| **Integritate** | Au ajuns datele nemodificate? | Cineva modifică suma dintr-un transfer bancar. |
| **Autenticitate** | Provin datele cu adevărat de la expeditorul indicat? | Un site web bancar fals îți cere PIN-ul. |

În acest capitol vei învăța să cunoști instrumentele cu care se ating aceste trei obiective — și cum acționează împreună în **HTTPS**, simbolul de lacăt din browser.

:::quiz match
Cineva îți citește parola în WLAN -> Confidențialitate
Cineva modifică pe parcurs suma unui transfer bancar -> Integritate
Un site web fals se dă drept banca ta -> Autenticitate
:::

:::evaluate
Verifică asocierea
:::
