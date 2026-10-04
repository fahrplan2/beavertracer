# Schicht 5–7: Anwendungsschicht

:::goal
**Lernziel:** Du kannst die wichtigsten Protokolle der Anwendungsschicht — HTTP, DNS, SMTP/POP3/IMAP und DHCP — im Tracer erkennen, ihren Ablauf erklären und typische Fehler finden.
:::

:::osi 7
:::

:::sim
url=/sims/lesson-6.1.btsim
:::

In Kapitel 5 hast du gesehen: TCP und UDP liefern Daten zuverlässig (oder schnell) beim richtigen Programm ab — über die Ports. *Was* in diesen Daten steht, legen die Protokolle der **Anwendungsschicht** fest. Im TCP/IP-Modell ist das eine Schicht, im ISO/OSI-Modell entspricht sie den Schichten 5 bis 7.

Jedes dieser Protokolle hat seine eigene Aufgabe — und seinen eigenen Port:

| Protokoll | Aufgabe | Port | Transport |
|---|---|---|---|
| **HTTP** | Webseiten abrufen | 80 | TCP |
| **DNS** | Namen in IP-Adressen übersetzen | 53 | meist UDP |
| **SMTP** | E-Mails versenden | 25 | TCP |
| **POP3** / **IMAP** | E-Mails abholen | 110 / 143 | TCP |
| **DHCP** | einem Gerät automatisch eine IP-Adresse geben | 67 / 68 | UDP |

In Kapitel 1.3 hast du eine Webseite noch über ihre IP-Adresse aufgerufen. Im Alltag tippt niemand `192.168.0.20` — und kein neuer Laptop bekommt seine Adresse von Hand eingetragen. Wie das alles zusammenspielt, entdeckst du in diesem Kapitel, Protokoll für Protokoll.
