# Firewall: kush mund të hyjë, kush mund të dalë?

:::goal
**Objektivi i të nxënit:** Ti mund të shpjegosh se si punon një filtër paketash me rregulla, të krijosh vetë rregulla dhe t'i rendisësh në radhën e duhur, të dallosh hedhjen (drop) nga refuzimi (reject), të shpjegosh dallimin midis një firewall-i pa gjendje dhe një firewall-i me gjendje, të ngresh një DMZ dhe të gjesh gabime në rregullat e firewall-it.
:::

:::osi 4
:::

:::sim
url=/sims/lesson-9.btsim
:::

Shkolla Beaver ka adresat e veta publike (`198.51.100.…`): **Schulserver** i saj është i arritshëm drejtpërdrejt nga interneti — pa NAT, ashtu siç do të jetë së shpejti kudo me IPv6 (kapitulli 7.3). Mes internetit dhe **Schulrouter** ndodhet një **firewall**, i cili për momentin ende lejon çdo gjë të kalojë.

Në të majtë shikon "internetin": një **Internet-PC** dhe serverin e uebit `www.beispiel.de`. Në të djathtë është rrjeti i shkollës me **Schulserver** dhe **Lehrer-PC**.

## Çfarë sheh një sulmues?

Kush dëshiron të sulmojë një server, kërkon fillimisht **porta të hapura** — pra shërbime që presin lidhje. Mjeti për këtë quhet **skaner portash**; më i njohuri është `nmap`.

Kalo në :fa-play: **Ekzekuto** (Modaliteti i ekzekutimit), hap në **Internet-PC** :fa-terminal: **Terminali** dhe shkruaj:

```
$ nmap 198.51.100.10
```

`nmap` përpiqet të ngrejë një lidhje TCP me 20 portat më të shpeshta dhe raporton se cilat janë të hapura.

:::quiz multi
Cilat porta janë të hapura në serverin e shkollës nga interneti?
- [x] 22 (SSH, mirëmbajtje në distancë)
- [x] 25 (SMTP)
- [x] 80 (HTTP)
- [x] 110 (POP3)
- [x] 143 (IMAP)
- [ ] 443 (HTTPS)
:::

:::evaluate
Kontrollo përgjigjen
:::

Faqja e uebit (80) dhe marrja e e-mail-eve (25) duhet të jenë të arritshme nga interneti. Por **mirëmbajtja në distancë** (22) dhe marrja e e-mail-eve nga kutia postare (110, 143) nevojiten vetëm nga rrjeti i shkollës. Çdo portë e hapur është një sipërfaqe e mundshme sulmi: nëse shërbimi ka një dobësi sigurie ose një fjalëkalim të dobët, një sulmues mund ta shfrytëzojë atë nga çdo cep i botës — dhe skanerët automatikë në internet provojnë pikërisht këtë ditë e natë.

:::tip Mbaj mend
Një **firewall** kontrollon trafikun në kufirin mes dy rrjeteve dhe lejon të kalojë vetëm atë që është lejuar shprehimisht. Kështu shërbimet që nevojiten vetëm brenda rrjetit mbeten të padukshme për internetin.
:::
