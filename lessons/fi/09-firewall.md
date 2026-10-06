# Palomuuri: kuka pääsee sisään, kuka ulos?

:::goal
**Oppimistavoite:** Osaat selittää, miten pakettisuodatin toimii sääntöjen avulla, laatia sääntöjä itse ja asettaa ne oikeaan järjestykseen, erottaa hylkäämisen (verwerfen) ja torjumisen (zurückweisen) toisistaan, selittää eron tilattoman ja tilallisen palomuurin välillä, rakentaa DMZ-verkon ja löytää virheitä palomuurisäännöistä.
:::

:::osi 4
:::

:::sim
url=/sims/lesson-9.btsim
:::

Beaver-koululla on omat julkiset osoitteensa (`198.51.100.…`): sen **Schulserver** on tavoitettavissa suoraan internetistä – ilman NAT:ia, niin kuin se pian on kaikkialla IPv6:n myötä (luku 7.3). Internetin ja **Schulrouterin** välissä on **palomuuri**, joka päästää tällä hetkellä vielä kaiken läpi.

Vasemmalla näet "internetin": **Internet-PC**:n ja verkkopalvelimen `www.beispiel.de`. Oikealla on koulun verkko, jossa ovat **Schulserver** ja **Lehrer-PC**.

## Mitä hyökkääjä näkee?

Kun joku haluaa hyökätä palvelimeen, hän etsii ensin **avoimia portteja** eli palveluja, jotka odottavat yhteyksiä. Tähän käytettävää työkalua kutsutaan **porttiskanneriksi**; tunnetuin niistä on `nmap`.

Siirry :fa-play: **Suorita**-tilaan eli Suoritustilaan, avaa **Internet-PC**:llä :fa-terminal: **Pääte** ja kirjoita:

```
$ nmap 198.51.100.10
```

`nmap` yrittää muodostaa TCP-yhteyden 20 yleisimpään porttiin ja ilmoittaa, mitkä niistä ovat auki.

:::quiz multi
Mitkä portit ovat auki Schulserverillä internetistä katsottuna?
- [x] 22 (SSH, etähallinta)
- [x] 25 (SMTP)
- [x] 80 (HTTP)
- [x] 110 (POP3)
- [x] 143 (IMAP)
- [ ] 443 (HTTPS)
:::

:::evaluate
Tarkista vastaus
:::

Verkkosivuston (80) ja sähköpostin vastaanoton (25) pitää olla tavoitettavissa internetistä. Mutta **etähallinta** (22) ja sähköpostien nouto (110, 143) ovat tarpeen vain koulun verkossa. Jokainen avoin portti on mahdollinen hyökkäyspinta: jos palvelussa on tietoturva-aukko tai heikko salasana, hyökkääjä voi käyttää sitä hyväkseen mistä päin maailmaa tahansa – ja internetin automaattiset skannerit yrittävät juuri tätä ympäri vuorokauden.

:::tip Muista
**Palomuuri** valvoo tietoliikennettä kahden verkon rajalla ja päästää läpi vain sen, mikä on nimenomaisesti sallittu. Näin vain sisäisesti tarvittavat palvelut pysyvät internetiltä näkymättöminä.
:::
