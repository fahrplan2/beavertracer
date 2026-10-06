# Firewall: ko sme unutra, ko sme napolje?

:::goal
**Cilj učenja:** Možeš da objasniš kako paketski filter radi sa pravilima, da sam postaviš pravila i složiš ih pravilnim redosledom, da razlikuješ odbacivanje (drop) i odbijanje (reject), da objasniš razliku između firewall-a bez praćenja stanja i firewall-a sa praćenjem stanja, da napraviš DMZ i da pronađeš greške u pravilima firewall-a.
:::

:::osi 4
:::

:::sim
url=/sims/lesson-9.btsim
:::

Beaver škola ima sopstvene javne adrese (`198.51.100.…`): njen **Schulserver** je direktno dostupan sa interneta — bez NAT-a, onako kako će uskoro svuda biti sa IPv6 (poglavlje 7.3). Između interneta i **Schulrouter**-a nalazi se **firewall**, koji trenutno još propušta sve.

Levo vidiš „internet“: jedan **Internet-PC** i veb server `www.beispiel.de`. Desno je školska mreža sa **Schulserver**-om i **Lehrer-PC**-jem.

## Šta vidi napadač?

Ko želi da napadne server, prvo traži **otvorene portove** — dakle servise koji čekaju na veze. Alat za to zove se **skener portova**; najpoznatiji je `nmap`.

Pređi u :fa-play: **Pokreni** režim (Režim izvršavanja), otvori :fa-terminal: **Terminal** na **Internet-PC**-ju i unesi:

```
$ nmap 198.51.100.10
```

`nmap` pokušava da uspostavi TCP vezu sa 20 najčešćih portova i javlja koji su otvoreni.

:::quiz multi
Koji su portovi na školskom serveru otvoreni sa interneta?
- [x] 22 (SSH, daljinsko održavanje)
- [x] 25 (SMTP)
- [x] 80 (HTTP)
- [x] 110 (POP3)
- [x] 143 (IMAP)
- [ ] 443 (HTTPS)
:::

:::evaluate
Proveri odgovor
:::

Veb stranica (80) i prijem e-pošte (25) treba da budu dostupni sa interneta. Ali **daljinsko održavanje** (22) i preuzimanje pošte (110, 143) potrebni su samo školskoj mreži. Svaki otvoreni port je moguća napadačka površina: ako servis ima sigurnosni propust ili slabu lozinku, napadač to može da iskoristi bilo gde u svetu — a automatski skeneri na internetu upravo to isprobavaju non-stop.

:::tip Zapamti
**Firewall** kontroliše saobraćaj na granici između dve mreže i propušta samo ono što je izričito dozvoljeno. Tako servisi koji su potrebni samo interno ostaju nevidljivi za internet.
:::
