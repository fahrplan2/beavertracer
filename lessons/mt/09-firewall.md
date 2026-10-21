# Firewall: min jista' jidħol u min jista' joħroġ?

:::goal
**Għan tat-tagħlim:** Tista' tispjega kif packet filter jaħdem bir-regoli, tfassal ir-regoli int stess u tqegħedhom fl-ordni t-tajba, tiddistingwi bejn drop u reject, tispjega d-differenza bejn firewall stateless u stateful, tibni DMZ u ssib żbalji fir-regoli tal-firewall.
:::

:::osi 4
:::

:::sim
url=/sims/lesson-9.btsim
:::

L-iskola Beaver għandha indirizzi pubbliċi tagħha (`198.51.100.…`): is-**Schulserver** tagħha jista' jintlaħaq direttament mill-internet — mingħajr NAT, bħalma dalwaqt se jkun kullimkien bl-IPv6 (kapitolu 7.3). Bejn l-internet u s-**Schulrouter** hemm **firewall**, li però bħalissa għadha tħalli kollox jgħaddi.

Fuq ix-xellug tara "l-internet": **Internet-PC** u l-web server `www.beispiel.de`. Fuq il-lemin hemm in-network tal-iskola bis-**Schulserver** u l-**Lehrer-PC**.

## X'jara attakkant?

Min irid jattakka server l-ewwel ifittex **ports miftuħin** — jiġifieri servizzi li jkunu qed jistennew konnessjonijiet. L-għodda għal dan tissejjaħ **port scanner**; l-aktar waħda magħrufa hija `nmap`.

Aqleb għal modalità :fa-play: **Ħaddem** — jiġifieri l-Modalità ta' tħaddim — iftaħ it-:fa-terminal: **Terminal** fuq l-**Internet-PC** u ikteb:

```
$ nmap 198.51.100.10
```

`nmap` jipprova jaqbad konnessjoni TCP mal-20 port l-aktar komuni, u jirrapporta liema minnhom huma miftuħa.

:::quiz multi
Liema ports huma miftuħa fuq is-server tal-iskola mill-internet?
- [x] 22 (SSH, remote administration)
- [x] 25 (SMTP)
- [x] 80 (HTTP)
- [x] 110 (POP3)
- [x] 143 (IMAP)
- [ ] 443 (HTTPS)
:::

:::evaluate
Iċċekkja t-tweġiba
:::

Il-websajt (80) u r-riċeviment tal-e-mails (25) għandhom ikunu jistgħu jintlaħqu mill-internet. Imma l-**remote administration** (22) u t-tiġbid tal-mails (110, 143) huma meħtieġa biss min-network tal-iskola. Kull port miftuħ huwa wiċċ possibbli ta' attakk: jekk is-servizz ikollu nuqqas ta' sigurtà jew password dgħajfa, attakkant jista' jisfruttah minn kull rokna tad-dinja — u scanners awtomatiċi fuq l-internet jippruvaw eżattament dan ħin kollu.

:::tip Punt importanti
**Firewall** tikkontrolla t-traffiku fil-fruntiera bejn żewġ networks u tħalli tgħaddi biss dak li huwa permess espliċitament. B'hekk is-servizzi li huma meħtieġa biss internament jibqgħu inviżibbli għall-internet.
:::
