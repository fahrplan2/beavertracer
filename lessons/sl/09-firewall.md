# Požarni zid: kdo sme noter, kdo sme ven?

:::goal
**Učni cilj:** Znaš razložiti, kako paketni filter deluje s pravili, sam postaviti pravila in jih razvrstiti v pravilen vrstni red, razlikovati med zavrženjem in zavrnitvijo, razložiti razliko med požarnim zidom brez stanja in požarnim zidom s stanjem, zgraditi DMZ ter poiskati napake v pravilih požarnega zidu.
:::

:::osi 4
:::

:::sim
url=/sims/lesson-9.btsim
:::

Šola Beaver ima lastne javne naslove (`198.51.100.…`): njen **Schulserver** je dosegljiv neposredno z interneta — brez NAT, tako kot bo kmalu povsod z IPv6 (poglavje 7.3). Med internetom in **Schulrouter** je **požarni zid**, ki trenutno še spušča vse skozi.

Na levi vidiš »internet«: **Internet-PC** in spletni strežnik `www.beispiel.de`. Na desni je šolsko omrežje s **Schulserver** in **Lehrer-PC**.

## Kaj vidi napadalec?

Kdor želi napasti strežnik, najprej poišče **odprta vrata** — torej storitve, ki čakajo na povezave. Orodje za to se imenuje **skener vrat**; najbolj znan je `nmap`.

Preklopi v :fa-play: način izvajanja, odpri na **Internet-PC** :fa-terminal: **Terminal** in vnesi:

```
$ nmap 198.51.100.10
```

`nmap` poskuša vzpostaviti povezavo TCP do 20 najpogostejših vrat in sporoči, katera so odprta.

:::quiz multi
Katera vrata na šolskem strežniku so z interneta odprta?
- [x] 22 (SSH, oddaljeno vzdrževanje)
- [x] 25 (SMTP)
- [x] 80 (HTTP)
- [x] 110 (POP3)
- [x] 143 (IMAP)
- [ ] 443 (HTTPS)
:::

:::evaluate
Preveri odgovor
:::

Spletna stran (80) in prejemanje e-pošte (25) naj bi bila dosegljiva z interneta. Toda **oddaljeno vzdrževanje** (22) in prevzem pošte (110, 143) potrebuje samo šolsko omrežje. Vsaka odprta vrata so možna napadalna površina: če ima storitev varnostno luknjo ali šibko geslo, jo lahko napadalec izkoristi od koderkoli na svetu — in samodejni skenerji na internetu počnejo prav to noč in dan.

:::tip Zapomni si
**Požarni zid** nadzoruje podatkovni promet na meji med dvema omrežjema in spusti skozi samo to, kar je izrecno dovoljeno. Tako storitve, ki jih potrebujemo samo interno, ostanejo za internet nevidne.
:::
