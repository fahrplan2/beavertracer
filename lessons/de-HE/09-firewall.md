# Firewall: Wer derf erein, wer derf erus?

:::goal
**Lernziel:** Du kannst erkläre, wie en Paketfilter mit Regele arbeitet, Regele selbst uffstelle un in die richtische Reihefolsch bringe, Verwerfe un Zurückweise unnerscheide, de Unnerschied zwische zustandsloser un zustandsbehafteter Firewall erkläre, en DMZ uffbaue un Fehler in Firewall-Regele finne.
:::

:::osi 4
:::

:::sim
url=/sims/lesson-9.btsim
:::

Die Beaver-Schul hat eigene öffentliche Adresse (`198.51.100.…`): Ihr **Schulserver** is direkt aus em Internet erreichbar — ohne NAT, so wie des mit IPv6 bald iwwerall sei werd (Kapitel 7.3). Zwische em Internet un em **Schulrouter** steckt en **Firewall**, die im Moment awwer noch alles durchlässt.

Links guggst de „des Internet“: en **Internet-PC** un de Webserver `www.beispiel.de`. Rechts des Schulnetz mit em **Schulserver** un em **Lehrer-PC**.

## Was sieht en Angreifer?

Wer en Server angreife will, sucht zuerscht noch **offene Ports** — also noch Dienste, die uff Verbindunge warte. Des Werkzeug dafür haaßt **Portscanner**; de bekanntest is `nmap`.

Wechsel in de :fa-play: **Laafe lasse**-Modus, mach uff em **Internet-PC** des :fa-terminal: **Terminal** uff un gib ei:

```
$ nmap 198.51.100.10
```

`nmap` versucht, zu de 20 häufigste Ports e TCP-Verbindung uffzubaue, un meldet, welche offe sin.

:::quiz multi
Welche Ports sin uff em Schulserver vom Internet aus offe?
- [x] 22 (SSH, Fernwartung)
- [x] 25 (SMTP)
- [x] 80 (HTTP)
- [x] 110 (POP3)
- [x] 143 (IMAP)
- [ ] 443 (HTTPS)
:::

:::evaluate
Antwort prüfe
:::

Die Webseit (80) un de Empfang vo E-Mails (25) solle aus em Internet erreichbar sei. Awwer die **Fernwartung** (22) un des Abhole vo Mails (110, 143) braucht nur des Schulnetz. Jeder offene Port is e mööglich Angriffsfläch: Hat de Dienst e Sicherheitslück oder e schwach Passwort, kann en Angreifer sie vo iwwerall uff de Welt ausnutze — un automatische Scanner im Internet probiern genau des rund um die Uhr, gell?

:::tip Merksatz
En **Firewall** kontrolliert de Datenverkehr an de Grenz zwische zwei Netze un lässt nur durch, was ausdrücklich erlaabt is. So bleibe Dienste, die nur intern gebraucht werre, fürs Internet unsichtbar.
:::
