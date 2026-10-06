# Kodune võrk: ruuter ja NAT

:::goal
**Õpieesmärk:** Sa oskad nimetada koduruuteri ülesandeid, seadistada koduruuteri, selgitada, kuidas NAT viib paljud seadmed ühe avaliku aadressi kaudu internetti, ning seadistada ja kontrollida pordi edasisuunamist.
:::

:::osi 3
:::

:::sim
url=/sims/lesson-7.1.btsim
:::

Kodus on võrgus kiiresti kümme või rohkem seadet: mobiiltelefonid, sülearvutid, teler, mängukonsool, kõlarid. Kõik saavad aadressid nagu `192.168.178.20` — **privaatsest** vahemikust, mida internetis üldse edasi ei suunata (peatükk 4.2.2). Ja siiski pääseb iga selline seade internetti.

Selle teeb võimalikuks märkamatu väike karp: **kodune ruuter**. Tööalal näed vasakul kodust võrku, kus on üks arvuti ja üks tahvelarvuti, paremal „internetti“ — teenusepakkuja ruutereid, DNS-serverit ja veebiserverit `www.beispiel.de`.

:::note
Selle peatüki avalikud aadressid (`203.0.113.…`, `198.51.100.…`, `192.0.2.…`) on reserveeritud näidetele ja õppematerjalidele — täpselt nagu `2001:db8::` IPv6 puhul.
:::
