# Tűzfal: Ki jöhet be, ki mehet ki?

:::goal
**Tanulási cél:** Képes vagy elmagyarázni, hogyan működik a csomagszűrő szabályokkal, saját szabályokat felállítani és helyes sorrendbe rendezni, megkülönböztetni az eldobást és az elutasítást, elmagyarázni az állapot nélküli és az állapottartó tűzfal közötti különbséget, DMZ-t kialakítani, valamint hibákat találni a tűzfalszabályokban.
:::

:::osi 4
:::

:::sim
url=/sims/lesson-9.btsim
:::

A Beaver-iskolának saját nyilvános címei vannak (`198.51.100.…`): az **Schulserver** közvetlenül elérhető az internetről — NAT nélkül, ahogy az IPv6-tal hamarosan mindenütt lesz (7.3. fejezet). Az internet és a **Schulrouter** között egy **tűzfal** áll, amely jelenleg még mindent átenged.

Balra „az internetet" látod: egy **Internet-PC**-t és a `www.beispiel.de` webszervert. Jobbra az iskolai hálózat látható a **Schulserver**rel és a **Lehrer-PC**-vel.

## Mit lát egy támadó?

Aki egy szervert meg akar támadni, először **nyitott portokat** keres — vagyis olyan szolgáltatásokat, amelyek kapcsolatokra várnak. Az erre való eszköz a **portszkenner**; a legismertebb a `nmap`.

Válts :fa-play: **Futtatás** módra, nyisd meg az **Internet-PC** :fa-terminal: **Terminál**ját, és írd be:

```
$ nmap 198.51.100.10
```

Az `nmap` megpróbál TCP-kapcsolatot felépíteni a 20 leggyakoribb porthoz, és jelzi, melyek nyitottak.

:::quiz multi
Mely portok nyitottak az iskolai szerveren az internet felől?
- [x] 22 (SSH, távfelügyelet)
- [x] 25 (SMTP)
- [x] 80 (HTTP)
- [x] 110 (POP3)
- [x] 143 (IMAP)
- [ ] 443 (HTTPS)
:::

:::evaluate
Válasz ellenőrzése
:::

A weboldalnak (80) és az e-mailek fogadásának (25) elérhetőnek kell lennie az internetről. A **távfelügyeletre** (22) és a levelek letöltésére (110, 143) viszont csak az iskolai hálózatnak van szüksége. Minden nyitott port lehetséges támadási felület: ha a szolgáltatásnak biztonsági rése vagy gyenge jelszava van, egy támadó a világ bármely pontjáról kihasználhatja — és az interneten az automatikus szkennerek pontosan ezt próbálgatják éjjel-nappal.

:::tip Jegyezd meg!
A **tűzfal** két hálózat határán ellenőrzi az adatforgalmat, és csak azt engedi át, ami kifejezetten engedélyezett. Így a csak belső használatra szánt szolgáltatások láthatatlanok maradnak az internet számára.
:::
