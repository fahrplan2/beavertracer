# Schicht 4: Transportschicht

:::goal
**Lernziel:** Du kannst die Aufgaben der Transportschicht nennen, den Ablauf einer TCP-Verbindung (Aufbau, Daten, Abbau) als Kommunikationsdiagramm darstellen, Ports sowie Sequenz- und Bestätigungsnummern erklären und begründen, wann UDP statt TCP verwendet wird.
:::

:::osi 4
:::

:::sim
url=/sims/lesson-5.1.btsim
:::

Ein kurzer Rückblick auf Kapitel 4: Das **Internet Protocol** auf Schicht 3 bringt ein Paket zum richtigen *Rechner* — auch über viele Router hinweg. Mehr verspricht IP aber nicht:

- Auf einem Rechner laufen viele Programme gleichzeitig: Browser, Mail-Programm, Messenger. Für welches davon ist ein Paket bestimmt? Das steht nicht im IP-Kopf.
- Geht unterwegs ein Paket verloren, merkt IP das nicht. Pakete können auch doppelt oder in falscher Reihenfolge ankommen. Man sagt: IP liefert nur nach bestem Bemühen (*best effort*).

Diese Lücken schließt **Schicht 4**, die Transportschicht. Auf der Arbeitsfläche siehst du einen **Client-PC** und einen **Server** — daran untersuchst du in diesem Kapitel die beiden wichtigsten Protokolle der Schicht 4: **TCP** und **UDP**.

:::note
TCP ist seit 1981 standardisiert (**RFC 793**, heute **RFC 9293**), UDP schon seit 1980 (**RFC 768**).
:::
