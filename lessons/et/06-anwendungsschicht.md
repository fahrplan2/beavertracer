# Kiht 5–7: rakenduskiht

:::goal
**Õpieesmärk:** Sa oskad tuvastada Tracer-is rakenduskihi olulisimaid protokolle — HTTP, DNS, SMTP/POP3/IMAP ja DHCP —, selgitada nende tööd ning leida tüüpilisi vigu.
:::

:::osi 7
:::

:::sim
url=/sims/lesson-6.1.btsim
:::

Peatükis 5 nägid: TCP ja UDP toimetavad andmed usaldusväärselt (või kiiresti) õigele programmile — portide kaudu. *Mis* nendes andmetes on, määravad **rakenduskihi** protokollid. TCP/IP mudelis on see üks kiht, ISO/OSI mudelis vastab see kihtidele 5 kuni 7.

Igal neist protokollidest on oma ülesanne — ja oma port:

| Protokoll | Ülesanne | Port | Transport |
|---|---|---|---|
| **HTTP** | veebilehtede laadimine | 80 | TCP |
| **DNS** | nimede tõlkimine IP-aadressideks | 53 | enamasti UDP |
| **SMTP** | e-kirjade saatmine | 25 | TCP |
| **POP3** / **IMAP** | e-kirjade kättesaamine | 110 / 143 | TCP |
| **DHCP** | seadmele IP-aadressi automaatne andmine | 67 / 68 | UDP |

Peatükis 1.3 laadisid veebilehe veel IP-aadressi kaudu. Igapäevaelus ei trüki keegi `192.168.0.20` — ja ühelegi uuele sülearvutile ei sisestata aadressi käsitsi. Kuidas see kõik koos töötab, avastad selles peatükis, protokoll protokolli haaval.
