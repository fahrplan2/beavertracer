# 5.–7. slānis: lietojumu slānis

:::goal
**Mācību mērķis:** Tu vari atpazīt svarīgākos lietojumu slāņa protokolus — HTTP, DNS, SMTP/POP3/IMAP un DHCP — izsekotājā (Tracer), izskaidrot to darbību un atrast tipiskas kļūdas.
:::

:::osi 7
:::

:::sim
url=/sims/lesson-6.1.btsim
:::

5. nodaļā tu redzēji: TCP un UDP piegādā datus uzticami (vai ātri) īstajai programmai — izmantojot portus. *Kas* šajos datos ir ietverts, nosaka **lietojumu slāņa** protokoli. TCP/IP modelī tas ir viens slānis, ISO/OSI modelī tas atbilst 5. līdz 7. slānim.

Katram no šiem protokoliem ir sava uzdevums — un savs ports:

| Protokols | Uzdevums | Ports | Transports |
|---|---|---|---|
| **HTTP** | tīmekļa lapu lejupielāde | 80 | TCP |
| **DNS** | nosaukumu pārvēršana IP adresēs | 53 | parasti UDP |
| **SMTP** | e-pasta ziņojumu sūtīšana | 25 | TCP |
| **POP3** / **IMAP** | e-pasta ziņojumu izgūšana | 110 / 143 | TCP |
| **DHCP** | automātiski piešķirt ierīcei IP adresi | 67 / 68 | UDP |

1.3 nodaļā tu tīmekļa lapu vēl atvēri, izmantojot tās IP adresi. Ikdienā neviens neraksta `192.168.0.20` — un neviens jauns portatīvais dators nesaņem savu adresi, to ievadot ar roku. Kā tas viss darbojas kopā, tu atklāsi šajā nodaļā, protokolu pa protokolam.
