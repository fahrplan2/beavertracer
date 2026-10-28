# Schicht 5–7: Anwendungsschicht

:::goal
**Lernziel:** Du kannst die wichtigste Protokolle vun de Anwendungsschicht — HTTP, DNS, SMTP/POP3/IMAP und DHCP — im Tracer erkenne, ihrn Ablauf erkläre und typische Fehler finde.
:::

:::osi 7
:::

:::sim
url=/sims/lesson-6.1.btsim
:::

In Kapitel 5 hosde gesehe: TCP und UDP liefern Date zuverlässisch (oder schnell) beim richtische Programm ab — iwwer die Ports. *Was* in dene Date drinsteht, legge die Protokolle vun de **Anwendungsschicht** fest. Im TCP/IP-Modell is des e Schicht, im ISO/OSI-Modell entspricht se de Schichte 5 bis 7.

Jedes vun dene Protokolle hat sei eigene Aufgab — und sein eigene Port:

| Protokoll | Aufgabe | Port | Transport |
|---|---|---|---|
| **HTTP** | Webseite abrufe | 80 | TCP |
| **DNS** | Name in IP-Adresse iwwersetze | 53 | meist UDP |
| **SMTP** | E-Mails verschicke | 25 | TCP |
| **POP3** / **IMAP** | E-Mails abhole | 110 / 143 | TCP |
| **DHCP** | em Gerät automatisch e IP-Adress gebbe | 67 / 68 | UDP |

In Kapitel 1.3 hosde e Webseite noch iwwer ihre IP-Adresse uffgerufe. Im Alldag tippt kei Mensch `192.168.0.20` ei — und kein neuer Laptop kriegt seine Adress vun Hand eigetrage. Wie des alles zusammespielt, entdeckste in dem Kapitel, Protokoll fer Protokoll, gell?
