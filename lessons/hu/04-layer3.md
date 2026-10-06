# 3. réteg: útválasztók, IP-címek és alhálózatok kialakítása

:::goal
**Tanulási cél:** Képes vagy az IP-címeket kettes számrendszerben olvasni, kiszámítani a hálózati és a broadcast címeket, egy hálózatot egyforma méretű alhálózatokra osztani, valamint hálózatokat útválasztókkal és útválasztó táblákkal összekötni.
:::

:::osi 3
:::

:::sim
url=/sims/lesson-4.1.btsim
:::

Eddig minden eszköz *egyetlen* helyi hálózatban volt — switchek és hozzáférési pontok kapcsolták össze őket. Az internet azonban ilyen hálózatok millióiból áll: az otthoni hálózatodból, az iskolai hálózatból, a mobilszolgáltatód hálózatából és a nagy adatközpontok hálózataiból.

Hogyan talál egy csomag utat az egyik hálózatból a másikba? Ezzel foglalkozik a **3. réteg**, a hálózati réteg — az **Internet Protocollal (IP)**, az IP-címekkel és a hálózatokat összekötő eszközökkel: az **útválasztókkal** (routerekkel).

:::note
Az IP-t 1981 óta egy szabvány rögzíti, az **RFC 791**. A verzió, amelyről ebben a fejezetben főleg szó lesz, az **IPv4**. Az újabb **IPv6** verzióval a fejezet végén ismerkedsz meg.
:::
