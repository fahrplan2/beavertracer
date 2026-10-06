# Capes 5–7: capa d'aplicació

:::goal
**Objectiu d'aprenentatge:** Pots reconèixer els protocols més importants de la capa d'aplicació — HTTP, DNS, SMTP/POP3/IMAP i DHCP — al Tracer, explicar-ne el funcionament i trobar-hi errors típics.
:::

:::osi 7
:::

:::sim
url=/sims/lesson-6.1.btsim
:::

Al capítol 5 has vist que TCP i UDP lliuren les dades de manera fiable (o ràpida) al programa correcte, mitjançant els ports. *Què* hi ha en aquestes dades ho determinen els protocols de la **capa d'aplicació**. En el model TCP/IP és una sola capa; en el model ISO/OSI correspon a les capes 5 a 7.

Cadascun d'aquests protocols té la seva pròpia funció — i el seu propi port:

| Protocol | Funció | Port | Transport |
|---|---|---|---|
| **HTTP** | obtenir pàgines web | 80 | TCP |
| **DNS** | traduir noms a adreces IP | 53 | sobretot UDP |
| **SMTP** | enviar correus electrònics | 25 | TCP |
| **POP3** / **IMAP** | recollir correus electrònics | 110 / 143 | TCP |
| **DHCP** | assignar automàticament una adreça IP a un dispositiu | 67 / 68 | UDP |

Al capítol 1.3 encara vas obrir una pàgina web a partir de la seva adreça IP. A la vida quotidiana ningú no escriu `192.168.0.20` — i a cap ordinador portàtil nou no se li introdueix l'adreça a mà. Com funciona tot plegat ho descobriràs en aquest capítol, protocol a protocol.
