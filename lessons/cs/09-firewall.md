# Firewall: kdo smí dovnitř a kdo ven?

:::goal
**Cíl výuky:** Dokážeš vysvětlit, jak paketový filtr pracuje s pravidly, sám pravidla vytvořit a seřadit je ve správném pořadí, rozlišit zahození (drop) a odmítnutí (reject), vysvětlit rozdíl mezi bezstavovou a stavovou firewall, vybudovat DMZ a najít chyby v pravidlech firewallu.
:::

:::osi 4
:::

:::sim
url=/sims/lesson-9.btsim
:::

Beaver-škola má vlastní veřejné adresy (`198.51.100.…`): její **Schulserver** je přímo dostupný z internetu — bez NAT, tak jak to brzy bude všude díky IPv6 (kapitola 7.3). Mezi internetem a **Schulrouter** je zapojená **firewall**, která však zatím propouští úplně všechno.

Vlevo vidíš „internet“: **Internet-PC** a webový server `www.beispiel.de`. Vpravo je školní síť se **Schulserver** a **Lehrer-PC**.

## Co vidí útočník?

Kdo chce napadnout server, hledá nejdřív **otevřené porty** — tedy služby, které čekají na spojení. Nástroj k tomu se jmenuje **skener portů**; nejznámější je `nmap`.

Přepni do :fa-play: režimu **Spustit**, otevři na **Internet-PC** :fa-terminal: **Terminál** a zadej:

```
$ nmap 198.51.100.10
```

`nmap` se pokusí navázat TCP spojení s 20 nejběžnějšími porty a oznámí, které jsou otevřené.

:::quiz multi
Které porty jsou na školním serveru otevřené z internetu?
- [x] 22 (SSH, vzdálená správa)
- [x] 25 (SMTP)
- [x] 80 (HTTP)
- [x] 110 (POP3)
- [x] 143 (IMAP)
- [ ] 443 (HTTPS)
:::

:::evaluate
Zkontrolovat odpověď
:::

Webová stránka (80) a příjem e-mailů (25) mají být z internetu dostupné. Ale **vzdálenou správu** (22) a stahování pošty (110, 143) potřebuje jen školní síť. Každý otevřený port je možná plocha pro útok: pokud má služba bezpečnostní díru nebo slabé heslo, může ji útočník zneužít odkudkoli na světě — a automatické skenery na internetu to zkoušejí přesně takhle nepřetržitě.

:::tip Zapamatuj si
**Firewall** kontroluje datový provoz na hranici mezi dvěma sítěmi a propouští jen to, co je výslovně povoleno. Služby, které se potřebují jen interně, tak zůstávají pro internet neviditelné.
:::
