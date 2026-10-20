# Firewall: Yaa gala, yaa baxa?

:::goal
**Hadafka waxbarashada:** Waxaad awoodaa inaad sharaxdo sida packet filter ugu shaqeeyo xeerar, inaad adigu xeerar samayso oo aad u dhigto isku xigga saxda ah, inaad kala saartid drop iyo reject, inaad sharaxdo farqiga u dhexeeya firewall aan xaaladda xasuusan (stateless) iyo mid xaaladda xasuusta (stateful), inaad dhisto DMZ, oo aad hesho khaladaadka ku jira xeerarka firewall-ka.
:::

:::osi 4
:::

:::sim
url=/sims/lesson-9.btsim
:::

Dugsiga Beaver wuxuu leeyahay IP address-yo dadweyne oo u gaar ah (`198.51.100.…`): **Schulserver**-kiisa waxaa si toos ah looga gaari karaa internet-ka — iyadoo aan NAT jirin, sida ay dhawaan wax walba ku noqon doonaan IPv6 (cutubka 7.3). Inta u dhexaysa internet-ka iyo **Schulrouter** waxaa ku jira **firewall**, laakiin hadda wax walba way dhex marinaysaa.

Bidix waxaad ku aragtaa "internet-ka": **Internet-PC** iyo web server-ka `www.beispiel.de`. Midig waxaa ku yaal network-ka dugsiga oo ay ku jiraan **Schulserver** iyo **Lehrer-PC**.

## Maxaa weeraryahanku arkaa?

Qofka rabaa inuu weeraro server, marka hore wuxuu raadiyaa **open ports** — taasoo ah adeegyo ku sugaya xidhiidho. Qalabka tan loo isticmaalo waxaa la yiraahdaa **port scanner**; kan ugu caansan waa `nmap`.

U gudub habka :fa-play: **Run** (Habka Socodsiinta), kaga fur :fa-terminal: **Terminal** **Internet-PC**, kuna qor:

```
$ nmap 198.51.100.10
```

`nmap` wuxuu isku dayaa inuu TCP connection ku furo 20-ka port ee ugu badan ee la isticmaalo, wuxuuna sheegaa kuwa furan.

:::quiz multi
Kuwee ka mid ah ports-ka Schulserver-ka ayaa laga furan yahay internet-ka?
- [x] 22 (SSH, maamul fog)
- [x] 25 (SMTP)
- [x] 80 (HTTP)
- [x] 110 (POP3)
- [x] 143 (IMAP)
- [ ] 443 (HTTPS)
:::

:::evaluate
Hubi jawaabta
:::

Websaydhka (80) iyo helitaanka e-mail-ka (25) waa in laga gaari karaa internet-ka. Laakiin **maamulka fog** (22) iyo soo qaadista mail-ka (110, 143) waxaa u baahan oo keliya network-ga dugsiga. Port kasta oo furan waa meel weerar laga geli karo: haddii adeegga uu leeyahay daloolka amni ama password daciif ah, weeraryahanku wuxuu ka faa'iidaysan karaa meel kasta oo dunida ah — iyo scanners-ka toos ah ee internet-ka ayaa sidaas oo kale isku dayaya maalintii oo dhan iyo habeenkii oo dhan.

:::tip Qodob muhiim ah
**Firewall** wuxuu kontroolaa traffic-ga ku yaal xadka u dhexeeya laba network, wuxuuna dhex marinayaa oo keliya waxa si cad loo oggolaaday. Sidaas ayaa adeegyada gudaha oo keliya loo baahan yahay looga dhigaa kuwo internet-ku aanu arki karin.
:::
