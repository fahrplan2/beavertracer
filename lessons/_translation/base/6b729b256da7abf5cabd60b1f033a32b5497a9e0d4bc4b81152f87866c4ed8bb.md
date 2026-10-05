# Firewall: Wer darf rein, wer darf raus?

:::goal
**Lernziel:** Du kannst erklären, wie ein Paketfilter mit Regeln arbeitet, Regeln selbst aufstellen und in die richtige Reihenfolge bringen, Verwerfen und Zurückweisen unterscheiden, den Unterschied zwischen zustandsloser und zustandsbehafteter Firewall erklären, eine DMZ aufbauen und Fehler in Firewall-Regeln finden.
:::

:::osi 4
:::

:::sim
url=/sims/lesson-9.btsim
:::

Die Beaver-Schule hat eigene öffentliche Adressen (`198.51.100.…`): Ihr **Schulserver** ist direkt aus dem Internet erreichbar — ohne NAT, so wie es mit IPv6 bald überall sein wird (Kapitel 7.3). Zwischen dem Internet und dem **Schulrouter** steckt eine **Firewall**, die im Moment aber noch alles durchlässt.

Links siehst du „das Internet“: einen **Internet-PC** und den Webserver `www.beispiel.de`. Rechts das Schulnetz mit dem **Schulserver** und dem **Lehrer-PC**.

## Was sieht ein Angreifer?

Wer einen Server angreifen will, sucht zuerst nach **offenen Ports** — also nach Diensten, die auf Verbindungen warten. Das Werkzeug dafür heißt **Portscanner**; der bekannteste ist `nmap`.

Wechsle in den :fa-play: **Ausführen**-Modus, öffne auf dem **Internet-PC** das :fa-terminal: **Terminal** und gib ein:

```
$ nmap 198.51.100.10
```

`nmap` versucht, zu den 20 häufigsten Ports eine TCP-Verbindung aufzubauen, und meldet, welche offen sind.

:::quiz multi
Welche Ports sind auf dem Schulserver vom Internet aus offen?
- [x] 22 (SSH, Fernwartung)
- [x] 25 (SMTP)
- [x] 80 (HTTP)
- [x] 110 (POP3)
- [x] 143 (IMAP)
- [ ] 443 (HTTPS)
:::

:::evaluate
Antwort prüfen
:::

Die Webseite (80) und der Empfang von E-Mails (25) sollen aus dem Internet erreichbar sein. Aber die **Fernwartung** (22) und das Abholen von Mails (110, 143) braucht nur das Schulnetz. Jeder offene Port ist eine mögliche Angriffsfläche: Hat der Dienst eine Sicherheitslücke oder ein schwaches Passwort, kann ein Angreifer sie von überall auf der Welt ausnutzen — und automatische Scanner im Internet probieren genau das rund um die Uhr.

:::tip Merksatz
Eine **Firewall** kontrolliert den Datenverkehr an der Grenze zwischen zwei Netzen und lässt nur durch, was ausdrücklich erlaubt ist. So bleiben Dienste, die nur intern gebraucht werden, für das Internet unsichtbar.
:::
