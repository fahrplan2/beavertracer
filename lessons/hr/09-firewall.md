# Vatrozid: tko smije unutra, tko smije van?

:::goal
**Ishod učenja:** Možeš objasniti kako paketni filtar radi s pravilima, sam/sama postaviti pravila i složiti ih u ispravan redoslijed, razlikovati odbacivanje (drop) i odbijanje (reject), objasniti razliku između vatrozida bez praćenja stanja i vatrozida s praćenjem stanja, izgraditi DMZ i pronaći pogreške u pravilima vatrozida.
:::

:::osi 4
:::

:::sim
url=/sims/lesson-9.btsim
:::

Beaver škola ima vlastite javne adrese (`198.51.100.…`): njezin **Schulserver** izravno je dostupan s interneta — bez NAT-a, onako kako će uskoro biti posvuda s IPv6 (poglavlje 7.3). Između interneta i **Schulroutera** nalazi se **vatrozid**, koji trenutačno još propušta sve.

Lijevo vidiš „internet“: **Internet-PC** i web poslužitelj `www.beispiel.de`. Desno je školska mreža sa **Schulserverom** i **Lehrer-PC-jem**.

## Što vidi napadač?

Tko želi napasti poslužitelj, prvo traži **otvorene portove** — to jest usluge koje čekaju na veze. Alat za to zove se **skener portova**; najpoznatiji je `nmap`.

Prijeđi u način izvođenja :fa-play: **Pokreni**, na **Internet-PC-ju** otvori :fa-terminal: **Terminal** i upiši:

```
$ nmap 198.51.100.10
```

`nmap` pokušava uspostaviti TCP vezu prema 20 najčešćih portova i javlja koji su otvoreni.

:::quiz multi
Koji su portovi na školskom poslužitelju otvoreni s interneta?
- [x] 22 (SSH, daljinsko održavanje)
- [x] 25 (SMTP)
- [x] 80 (HTTP)
- [x] 110 (POP3)
- [x] 143 (IMAP)
- [ ] 443 (HTTPS)
:::

:::evaluate
Provjeri odgovor
:::

Web-stranica (80) i primanje e-pošte (25) trebaju biti dostupni s interneta. No **daljinsko održavanje** (22) i preuzimanje pošte (110, 143) treba samo školska mreža. Svaki otvoreni port potencijalna je površina napada: ako usluga ima sigurnosni propust ili slabu lozinku, napadač ga može iskoristiti s bilo kojeg mjesta na svijetu — a automatski skeneri na internetu upravo to isprobavaju danonoćno.

:::tip Zapamti
**Vatrozid** nadzire promet na granici između dviju mreža i propušta samo ono što je izričito dopušteno. Tako usluge koje su potrebne samo interno ostaju nevidljive za internet.
:::
