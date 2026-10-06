# Firewall: cine are voie să intre, cine are voie să iasă?

:::goal
**Obiectiv de învățare:** Poți explica cum funcționează un filtru de pachete cu reguli, poți stabili singur reguli și le poți pune în ordinea corectă, poți deosebi ignorarea (drop) de respingere (reject), poți explica diferența dintre un firewall fără stare și unul cu stare, poți construi o DMZ și poți găsi erori în regulile de firewall.
:::

:::osi 4
:::

:::sim
url=/sims/lesson-9.btsim
:::

Școala Beaver are propriile adrese publice (`198.51.100.…`): **Schulserver** este accesibil direct din internet — fără NAT, așa cum va fi curând peste tot cu IPv6 (capitolul 7.3). Între internet și **Schulrouter** se află un **firewall**, care în acest moment încă lasă totul să treacă.

În stânga vezi „internetul": un **Internet-PC** și serverul web `www.beispiel.de`. În dreapta se află rețeaua școlii cu **Schulserver** și **Lehrer-PC**.

## Ce vede un atacator?

Cine vrea să atace un server caută mai întâi **porturi deschise** — adică servicii care așteaptă conexiuni. Instrumentul pentru asta se numește **scanner de porturi**; cel mai cunoscut este `nmap`.

Treci în modul :fa-play: **Rulare**, deschide :fa-terminal: **Terminal** pe **Internet-PC** și introdu:

```
$ nmap 198.51.100.10
```

`nmap` încearcă să stabilească o conexiune TCP către cele mai frecvente 20 de porturi și raportează care dintre ele sunt deschise.

:::quiz multi
Care porturi de pe Schulserver sunt deschise din internet?
- [x] 22 (SSH, administrare la distanță)
- [x] 25 (SMTP)
- [x] 80 (HTTP)
- [x] 110 (POP3)
- [x] 143 (IMAP)
- [ ] 443 (HTTPS)
:::

:::evaluate
Verifică răspunsul
:::

Pagina web (80) și primirea e-mailurilor (25) trebuie să fie accesibile din internet. Dar **administrarea la distanță** (22) și preluarea e-mailurilor (110, 143) sunt necesare doar în rețeaua școlii. Fiecare port deschis este o posibilă suprafață de atac: dacă serviciul are o vulnerabilitate de securitate sau o parolă slabă, un atacator o poate exploata de oriunde din lume — iar scannerele automate din internet încearcă exact asta non-stop.

:::tip De reținut
Un **firewall** controlează traficul de date la granița dintre două rețele și lasă să treacă doar ceea ce este permis în mod explicit. Astfel, serviciile care sunt necesare doar intern rămân invizibile pentru internet.
:::
