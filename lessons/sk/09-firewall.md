# Firewall: kto môže dnu, kto môže von?

:::goal
**Cieľ učenia:** Vieš vysvetliť, ako paketový filter pracuje s pravidlami, vieš si pravidlá sám/sama vytvoriť a zoradiť ich do správneho poradia, rozlíšiť zahodenie (drop) a odmietnutie (reject), vysvetliť rozdiel medzi bezstavovou a stavovou firewall, vybudovať DMZ a nájsť chyby v pravidlách firewall.
:::

:::osi 4
:::

:::sim
url=/sims/lesson-9.btsim
:::

Škola Beaver má vlastné verejné adresy (`198.51.100.…`): jej **Schulserver** je dostupný priamo z internetu — bez NAT, tak ako to čoskoro bude všade vďaka IPv6 (kapitola 7.3). Medzi internetom a **Schulrouter** je zapojená **firewall**, ktorá však zatiaľ prepúšťa všetko.

Vľavo vidíš „internet“: **Internet-PC** a webový server `www.beispiel.de`. Vpravo je školská sieť so **Schulserver** a **Lehrer-PC**.

## Čo vidí útočník?

Kto chce zaútočiť na server, hľadá najprv **otvorené porty** — teda služby, ktoré čakajú na spojenia. Nástroj na to sa volá **skener portov**; najznámejší je `nmap`.

Prepni sa do :fa-play: režimu spustenia, na **Internet-PC** otvor :fa-terminal: **Terminál** a zadaj:

```
$ nmap 198.51.100.10
```

`nmap` sa pokúsi nadviazať TCP spojenie s 20 najčastejšími portmi a oznámi, ktoré sú otvorené.

:::quiz multi
Ktoré porty sú na školskom serveri otvorené z internetu?
- [x] 22 (SSH, vzdialená správa)
- [x] 25 (SMTP)
- [x] 80 (HTTP)
- [x] 110 (POP3)
- [x] 143 (IMAP)
- [ ] 443 (HTTPS)
:::

:::evaluate
Skontrolovať odpoveď
:::

Webová stránka (80) a prijímanie e-mailov (25) majú byť dostupné z internetu. Ale **vzdialenú správu** (22) a sťahovanie pošty (110, 143) potrebuje iba školská sieť. Každý otvorený port je možná plocha útoku: ak má služba bezpečnostnú chybu alebo slabé heslo, útočník ju môže zneužiť odkiaľkoľvek zo sveta — a automatické skenery na internete skúšajú presne to nepretržite.

:::tip Zapamätaj si
**Firewall** kontroluje dátovú prevádzku na hranici medzi dvoma sieťami a prepúšťa len to, čo je výslovne povolené. Služby, ktoré sú potrebné iba interne, tak zostanú pre internet neviditeľné.
:::
