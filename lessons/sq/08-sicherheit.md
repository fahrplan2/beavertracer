# Siguria: enkriptimi dhe certifikatat

:::goal
**Objektivi i të nxënit:** Ti mund të shpjegosh tre objektivat e mbrojtjes: konfidencialitetin, integritetin dhe autenticitetin, të dallosh enkriptimin simetrik nga ai asimetrik, të vendosësh vlerat hash dhe nënshkrimet dixhitale në kontekstin e duhur, të lexosh dhe të lëshosh vetë certifikata, të konfigurosh HTTPS dhe të interpretosh paralajmërimet tipike të certifikatave.
:::

Në kapitujt e fundit mund të lexoje pothuajse gjithçka në Tracer:

- **Kapitulli 3.3.2:** Në WLAN çdo pajisje brenda rrezes merr të gjitha paketat e transmetuara me valë.
- **Kapitulli 6.1.2:** Në HTTP kërkesa dhe faqja e internetit gjenden në tekst të hapur brenda paketës.
- **Kapitulli 6.3.2:** Në SMTP dhe POP3 emri i përdoruesit dhe fjalëkalimi udhëtojnë pothuajse në tekst të hapur nëpër linjë — `AUTH PLAIN` është vetëm Base64.

Kushdo që përgjon në një linjë ose në të njëjtin WLAN, shikon fjalëkalime, nota, mesazhe dhe të dhëna bankare. Dhe ai mund të bëjë edhe më shumë: të **ndryshojë** paketat ose të **paraqitet** si dikush tjetër.

## Tre objektivat e mbrojtjes

Kriptografia duhet të ndihmojë kundër këtyre rreziqeve. Dallohen tre **objektiva mbrojtjeje**:

| Objektivi i mbrojtjes | Pyetja | Shembull i një sulmi |
|---|---|---|
| **Konfidencialiteti** | A mund t'i lexojë të dhënat vetëm marrësi i duhur? | Dikush lexon fjalëkalimin tënd në WLAN. |
| **Integriteti** | A kanë mbërritur të dhënat të pandryshuara? | Dikush ndryshon shumën në një transferim bankar. |
| **Autenticiteti** | A vijnë të dhënat vërtet nga dërguesi i deklaruar? | Një faqe interneti e rreme e bankës kërkon PIN-in tënd. |

Në këtë kapitull njihesh me mjetet me të cilat arrihen këto tre objektiva — dhe se si ato bashkëveprojnë në **HTTPS**, simbolin e bravës në shfletues.

:::quiz match
Dikush lexon fjalëkalimin tënd në WLAN -> Konfidencialiteti
Dikush ndryshon rrugës shumën e një transferimi bankar -> Integriteti
Një faqe interneti e rreme paraqitet si banka jote -> Autenticiteti
:::

:::evaluate
Kontrollo përshoqërimin
:::
