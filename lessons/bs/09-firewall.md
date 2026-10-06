# Firewall: ko smije unutra, ko smije van?

:::goal
**Ishod učenja:** Možeš objasniti kako paketni filter radi s pravilima, samostalno postaviti pravila i složiti ih pravilnim redoslijedom, razlikovati odbacivanje i odbijanje, objasniti razliku između firewalla bez praćenja stanja i firewalla s praćenjem stanja, izgraditi DMZ i pronaći greške u pravilima firewalla.
:::

:::osi 4
:::

:::sim
url=/sims/lesson-9.btsim
:::

Beaver škola ima vlastite javne adrese (`198.51.100.…`): njen **Schulserver** direktno je dostupan s interneta — bez NAT-a, kao što će uskoro svugdje biti s IPv6 (poglavlje 7.3). Između interneta i **Schulroutera** nalazi se **firewall**, koji trenutno još propušta sve.

Lijevo vidiš „internet“: **Internet-PC** i web server `www.beispiel.de`. Desno je školska mreža sa **Schulserverom** i **Lehrer-PC-jem**.

## Šta vidi napadač?

Ko želi napasti server, prvo traži **otvorene portove** — dakle usluge koje čekaju na veze. Alat za to zove se **skener portova**; najpoznatiji je `nmap`.

Prebaci se u :fa-play: **Način rada Pokretanje**, na **Internet-PC-ju** otvori :fa-terminal: **Terminal** i unesi:

```
$ nmap 198.51.100.10
```

`nmap` pokušava uspostaviti TCP vezu prema 20 najčešćih portova i javlja koji su otvoreni.

:::quiz multi
Koji su portovi na školskom serveru otvoreni s interneta?
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

Web stranica (80) i prijem e-pošte (25) trebaju biti dostupni s interneta. Ali **daljinsko održavanje** (22) i preuzimanje pošte (110, 143) treba samo školska mreža. Svaki otvoreni port je moguća površina za napad: ako usluga ima sigurnosni propust ili slabu lozinku, napadač to može iskoristiti s bilo kojeg mjesta na svijetu — a automatski skeneri na internetu upravo to isprobavaju danonoćno.

:::tip Zapamti
**Firewall** kontrolira promet na granici između dvije mreže i propušta samo ono što je izričito dozvoljeno. Tako usluge koje su potrebne samo interno ostaju nevidljive za internet.
:::
