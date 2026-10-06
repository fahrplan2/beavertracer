# Rețeaua de acasă: router și NAT

:::goal
**Obiectiv de învățare:** Poți enumera sarcinile unui router de acasă, poți configura un router de acasă, poți explica cum aduce NAT multe dispozitive în internet printr-o singură adresă publică și poți configura și verifica o redirecționare de porturi.
:::

:::osi 3
:::

:::sim
url=/sims/lesson-7.1.btsim
:::

Acasă ajung repede zece sau mai multe dispozitive în rețea: telefoane, laptopuri, televizor, consolă de jocuri, boxe. Toate primesc adrese precum `192.168.178.20` — dintr-un interval **privat**, care nu este deloc rutat în internet (capitolul 4.2.2). Și totuși, fiecare dintre aceste dispozitive ajunge în internet.

Acest lucru este posibil datorită unei cutiuțe discrete: **routerul de acasă**. Pe spațiul de lucru vezi în stânga o rețea de acasă cu un PC și o tabletă, iar în dreapta „internetul" — routerele unui furnizor, un server DNS și serverul web `www.beispiel.de`.

:::note
Adresele publice din acest capitol (`203.0.113.…`, `198.51.100.…`, `192.0.2.…`) sunt rezervate pentru exemple și materiale didactice — exact ca `2001:db8::` la IPv6.
:::
