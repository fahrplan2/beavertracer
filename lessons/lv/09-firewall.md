# Ugunsmūris: kam drīkst iekšā, kam ārā?

:::goal
**Mācību mērķis:** Tu proti izskaidrot, kā pakešu filtrs darbojas ar noteikumiem, pats izveidot noteikumus un sakārtot tos pareizā secībā, nošķirt pakešu atmešanu (Verwerfen) no noraidīšanas (Zurückweisen), izskaidrot atšķirību starp bezstāvokļa un stāvokļa ugunsmūri, izveidot DMZ un atrast kļūdas ugunsmūra noteikumos.
:::

:::osi 4
:::

:::sim
url=/sims/lesson-9.btsim
:::

Beaver skolai ir savas publiskās adreses (`198.51.100.…`): tās **Schulserver** ir tieši sasniedzams no interneta — bez NAT, tāpat kā drīz būs visur ar IPv6 (7.3. nodaļa). Starp internetu un **Schulrouter** atrodas **ugunsmūris**, kas pašlaik vēl laiž cauri visu.

Kreisajā pusē redzams „internets“: **Internet-PC** un tīmekļa serveris `www.beispiel.de`. Labajā pusē ir skolas tīkls ar **Schulserver** un **Lehrer-PC**.

## Ko redz uzbrucējs?

Kas vēlas uzbrukt serverim, vispirms meklē **atvērtos portus** — proti, pakalpojumus, kas gaida savienojumus. Rīku tam sauc par **portu skeneri**; vispazīstamākais ir `nmap`.

Pārslēdzies uz :fa-play: **Palaist** režīmu (Izpildes režīms), atver **Internet-PC** :fa-terminal: **Termināls** un ievadi:

```
$ nmap 198.51.100.10
```

`nmap` mēģina izveidot TCP savienojumu ar 20 visbiežāk izmantotajiem portiem un ziņo, kuri no tiem ir atvērti.

:::quiz multi
Kuri porti uz skolas servera ir atvērti no interneta puses?
- [x] 22 (SSH, attālā administrēšana)
- [x] 25 (SMTP)
- [x] 80 (HTTP)
- [x] 110 (POP3)
- [x] 143 (IMAP)
- [ ] 443 (HTTPS)
:::

:::evaluate
Pārbaudīt atbildi
:::

Tīmekļa vietnei (80) un e-pasta saņemšanai (25) ir jābūt sasniedzamiem no interneta. Taču **attālā administrēšana** (22) un pasta izgūšana (110, 143) ir vajadzīga tikai skolas tīklam. Katrs atvērts ports ir iespējama uzbrukuma virsma: ja pakalpojumam ir drošības robs vai vāja parole, uzbrucējs to var izmantot jebkurā pasaules vietā — un automātiskie skeneri internetā tieši to arī mēģina visu diennakti.

:::tip Iegaumējamais secinājums
**Ugunsmūris** kontrolē datplūsmu uz robežas starp diviem tīkliem un laiž cauri tikai to, kas ir skaidri atļauts. Tā pakalpojumi, kas vajadzīgi tikai iekšēji, internetam paliek neredzami.
:::
