# Biztonság: titkosítás és tanúsítványok

:::goal
**Tanulási cél:** El tudod magyarázni a három védelmi célt: a bizalmasságot, az integritást és a hitelességet. Meg tudod különböztetni a szimmetrikus és az aszimmetrikus titkosítást, be tudod sorolni a hash-értékeket és a digitális aláírásokat, tudsz tanúsítványokat olvasni és magad is kiállítani, be tudod állítani a HTTPS-t, és értelmezni tudod a tipikus tanúsítványfigyelmeztetéseket.
:::

Az előző fejezetekben a Tracerben szinte mindent el tudtál olvasni:

- **3.3.2. fejezet:** Wi-Fi hálózaton minden hatótávolságon belüli eszköz megkapja az összes rádiós csomagot.
- **6.1.2. fejezet:** HTTP esetén a kérés és a weboldal egyszerű szövegként szerepel a csomagban.
- **6.3.2. fejezet:** SMTP és POP3 esetén a felhasználónév és a jelszó szinte egyszerű szövegként halad a vezetéken — az `AUTH PLAIN` csak Base64.

Aki egy vezetéken vagy ugyanazon a Wi-Fi hálózaton lehallgat, az jelszavakat, jegyeket, üzeneteket és bankadatokat lát. És ennél többre is képes: **módosíthatja** a csomagokat, vagy **kiadhatja magát** valaki másnak.

## Három védelmi cél

Ezek ellen a veszélyek ellen segít a kriptográfia. Három **védelmi célt** különböztetünk meg:

| Védelmi cél | Kérdés | Példa támadásra |
|---|---|---|
| **Bizalmasság** | Csak a megfelelő címzett tudja elolvasni az adatokat? | Valaki a Wi-Fi hálózaton elolvassa a jelszavadat. |
| **Integritás** | Az adatok változatlanul érkeztek meg? | Valaki megváltoztatja egy átutalás összegét. |
| **Hitelesség** | Az adatok valóban a megadott feladótól származnak? | Egy hamis banki weboldal elkéri a PIN-kódodat. |

Ebben a fejezetben megismered azokat az eszközöket, amelyekkel ez a három cél elérhető — és azt, hogyan működnek együtt a **HTTPS**-ben, vagyis a böngésző lakat szimbólumában.

:::quiz match
Valaki a Wi-Fi hálózaton elolvassa a jelszavadat -> Bizalmasság
Valaki menet közben megváltoztatja egy átutalás összegét -> Integritás
Egy hamis weboldal a bankodnak adja ki magát -> Hitelesség
:::

:::evaluate
Párosítás ellenőrzése
:::
