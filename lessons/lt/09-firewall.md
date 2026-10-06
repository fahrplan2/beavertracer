# Ugniasienė: kam leidžiama įeiti, kam išeiti?

:::goal
**Mokymosi tikslas:** Gali paaiškinti, kaip paketų filtras veikia pagal taisykles, pats sudaryti taisykles ir išdėstyti jas teisinga tvarka, skirti paketų atmetimą be pranešimo (drop) nuo atmetimo su pranešimu (reject), paaiškinti skirtumą tarp ugniasienės be būsenos sekimo ir ugniasienės su būsenos sekimu, sukurti DMZ ir rasti klaidų ugniasienės taisyklėse.
:::

:::osi 4
:::

:::sim
url=/sims/lesson-9.btsim
:::

Beaver mokykla turi savo viešuosius adresus (`198.51.100.…`): jos **Schulserver** pasiekiamas tiesiogiai iš interneto — be NAT, kaip netrukus bus visur su IPv6 (7.3 skyrius). Tarp interneto ir **Schulrouter** yra **ugniasienė**, kuri šiuo metu dar praleidžia viską.

Kairėje matai „internetą“: **Internet-PC** ir žiniatinklio serverį `www.beispiel.de`. Dešinėje – mokyklos tinklas su **Schulserver** ir **Lehrer-PC**.

## Ką mato užpuolikas?

Kas nori užpulti serverį, pirmiausia ieško **atvirų prievadų** – t. y. paslaugų, kurios laukia ryšių. Tam skirta priemonė vadinasi **prievadų skeneris**; žinomiausias yra `nmap`.

Persijunk į :fa-play: **Paleisti** režimą (Vykdymo režimas), **Internet-PC** atidaryk :fa-terminal: **Terminalas** ir įvesk:

```
$ nmap 198.51.100.10
```

`nmap` bando užmegzti TCP ryšį su 20 dažniausiai naudojamų prievadų ir praneša, kurie iš jų yra atviri.

:::quiz multi
Kurie prievadai mokyklos serveryje yra atviri iš interneto?
- [x] 22 (SSH, nuotolinis administravimas)
- [x] 25 (SMTP)
- [x] 80 (HTTP)
- [x] 110 (POP3)
- [x] 143 (IMAP)
- [ ] 443 (HTTPS)
:::

:::evaluate
Patikrinti atsakymą
:::

Svetainė (80) ir el. laiškų priėmimas (25) turi būti pasiekiami iš interneto. Tačiau **nuotolinis administravimas** (22) ir laiškų atsiėmimas (110, 143) reikalingi tik mokyklos tinklui. Kiekvienas atviras prievadas yra galimas atakos paviršius: jei paslauga turi saugumo spragą arba silpną slaptažodį, užpuolikas gali tuo pasinaudoti iš bet kurios pasaulio vietos – o automatiniai skeneriai internete būtent tai ir bando visą parą.

:::tip Svarbu įsiminti
**Ugniasienė** kontroliuoja duomenų srautą ties riba tarp dviejų tinklų ir praleidžia tik tai, kas aiškiai leista. Taip paslaugos, kurių reikia tik viduje, lieka nematomos internetui.
:::
