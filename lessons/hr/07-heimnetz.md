# Kućna mreža: usmjernik i NAT

:::goal
**Ishod učenja:** Možeš navesti zadaće kućnog usmjernika, postaviti kućni usmjernik, objasniti kako NAT omogućuje da mnogo uređaja izlazi na internet preko jedne javne adrese te postaviti i provjeriti preusmjeravanje porta.
:::

:::osi 3
:::

:::sim
url=/sims/lesson-7.1.btsim
:::

Kod kuće se u mreži vrlo brzo nađe deset ili više uređaja: mobiteli, prijenosna računala, televizor, igraća konzola, zvučnici. Svi dobivaju adrese poput `192.168.178.20` — iz **privatnog** raspona koji se na internetu uopće ne prosljeđuje (poglavlje 4.2.2).A ipak svaki od tih uređaja dolazi na internet.

To omogućuje jedna nenametljiva kutijica: **kućni usmjernik**. Na radnoj površini lijevo vidiš kućnu mrežu s jednim računalom i jednim tabletom, a desno „internet“ — usmjernike davatelja usluge, DNS poslužitelj i web poslužitelj `www.beispiel.de`.

:::note
Javne adrese u ovom poglavlju (`203.0.113.…`, `198.51.100.…`, `192.0.2.…`) rezervirane su za primjere i nastavne materijale — baš kao i `2001:db8::` kod IPv6.
:::
