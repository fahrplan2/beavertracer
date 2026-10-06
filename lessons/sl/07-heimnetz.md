# Domače omrežje: usmerjevalnik in NAT

:::goal
**Učni cilj:** Znaš našteti naloge domačega usmerjevalnika, nastaviti domači usmerjevalnik, razložiti, kako NAT omogoči številnim napravam dostop do interneta prek enega javnega naslova, ter nastaviti in preveriti preusmeritev vrat.
:::

:::osi 3
:::

:::sim
url=/sims/lesson-7.1.btsim
:::

Doma je v omrežju hitro deset ali več naprav: telefoni, prenosniki, televizor, igralna konzola, zvočniki. Vse dobijo naslove, kot je `192.168.178.20` — iz **zasebnega** razpona, ki se v internetu sploh ne posreduje naprej (poglavje 4.2.2). In kljub temu vsaka od teh naprav pride do interneta.

To omogoča nepomembna majhna škatlica: **domači usmerjevalnik**. Na delovni površini vidiš levo domače omrežje z računalnikom in tabličnim računalnikom, desno pa „internet“ — usmerjevalnike ponudnika, strežnik DNS in spletni strežnik `www.beispiel.de`.

:::note
Javni naslovi v tem poglavju (`203.0.113.…`, `198.51.100.…`, `192.0.2.…`) so rezervirani za primere in učno gradivo — prav tako kot `2001:db8::` pri IPv6.
:::
