# Zabezpečení: šifrování a certifikáty

:::goal
**Cíl výuky:** Dokážeš vysvětlit tři bezpečnostní cíle – důvěrnost, integritu a autenticitu –, rozlišit symetrické a asymetrické šifrování, zařadit hashe a digitální podpisy, číst certifikáty a sám je vystavit, nastavit HTTPS a správně vyložit typická varování ohledně certifikátů.
:::

V posledních kapitolách jsi v Traceru mohl téměř všechno odposlechnout:

- **Kapitola 3.3.2:** V síti Wi-Fi přijímá každé zařízení v dosahu všechny rádiové pakety.
- **Kapitola 6.1.2:** U HTTP jsou požadavek i webová stránka v paketu v čitelné podobě (nešifrovaně).
- **Kapitola 6.3.2:** U SMTP a POP3 putují uživatelské jméno a heslo po lince téměř nešifrovaně – `AUTH PLAIN` je jen Base64.

Kdo odposlouchává na lince nebo ve stejné síti Wi-Fi, vidí hesla, známky, zprávy i bankovní údaje. A může ještě víc: pakety **měnit** nebo se **vydávat** za někoho jiného.

## Tři bezpečnostní cíle

Proti těmto hrozbám má pomáhat kryptografie. Rozlišují se tři **bezpečnostní cíle**:

| Bezpečnostní cíl | Otázka | Příklad útoku |
|---|---|---|
| **Důvěrnost** | Může data přečíst jen správný příjemce? | Někdo v síti Wi-Fi odposlechne tvé heslo. |
| **Integrita** | Dorazila data nezměněná? | Někdo změní v převodu částku. |
| **Autenticita** | Pocházejí data opravdu od uvedeného odesílatele? | Falešná webová stránka banky se ptá na tvůj PIN. |

V této kapitole poznáš nástroje, kterými se tyto tři cíle dosahují – a jak spolupracují v **HTTPS**, tedy v symbolu zámku v prohlížeči.

:::quiz match
Někdo odposlechne tvé heslo v síti Wi-Fi -> Důvěrnost
Někdo cestou změní částku v převodu -> Integrita
Falešná webová stránka se vydává za tvou banku -> Autenticita
:::

:::evaluate
Zkontrolovat přiřazení
:::
