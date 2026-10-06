# Vrstvy 5–7: aplikační vrstva

:::goal
**Cíl výuky:** Dokážeš v Traceru rozpoznat nejdůležitější protokoly aplikační vrstvy — HTTP, DNS, SMTP/POP3/IMAP a DHCP —, vysvětlit jejich průběh a najít typické chyby.
:::

:::osi 7
:::

:::sim
url=/sims/lesson-6.1.btsim
:::

V kapitole 5 jsi viděl(a): TCP a UDP doručují data spolehlivě (nebo rychle) správnému programu — pomocí portů. *Co* je v těchto datech obsaženo, určují protokoly **aplikační vrstvy**. V modelu TCP/IP je to jedna vrstva, v modelu ISO/OSI odpovídá vrstvám 5 až 7.

Každý z těchto protokolů má svůj vlastní úkol — a svůj vlastní port:

| Protokol | Úkol | Port | Transport |
|---|---|---|---|
| **HTTP** | načítání webových stránek | 80 | TCP |
| **DNS** | překlad jmen na IP adresy | 53 | většinou UDP |
| **SMTP** | odesílání e-mailů | 25 | TCP |
| **POP3** / **IMAP** | stahování e-mailů | 110 / 143 | TCP |
| **DHCP** | automatické přidělení IP adresy zařízení | 67 / 68 | UDP |

V kapitole 1.3 jsi ještě otevíral(a) webovou stránku pomocí její IP adresy. V běžném životě nikdo nezadává `192.168.0.20` — a žádnému novému notebooku se adresa nezadává ručně. Jak to všechno spolupracuje, objevíš v této kapitole, protokol po protokolu.
