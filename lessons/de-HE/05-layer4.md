# Schicht 4: Transportschicht

:::goal
**Lernziel:** Du kannst die Aufgabe vun de Transportschicht nenne, de Ablauf vun re TCP-Verbindung (Uffbau, Daten, Abbau) als Kommunikationsdiagramm darstelle, Ports sowie Sequenz- und Bestätigungsnummere erkläre un begründe, wann UDP statt TCP verwendet werd.
:::

:::osi 4
:::

:::sim
url=/sims/lesson-5.1.btsim
:::

Ei gude, erst emol en kurze Rückblick uff Kapitel 4: Des **Internet Protocol** uff Schicht 3 bringt e Paket zum richtische *Rechner* — aach iwwer viele Router hinweg. Mehr verspricht IP awwer net:

- Uff eme Rechner laafe viele Programme gleichzeitisch: Browser, Mail-Programm, Messenger. Für welsches devon is e Paket bestimmt? Des steht net im IP-Kopf.
- Geht unnerwegs e Paket verlore, merkt IP des net. Pakete kenne aach doppelt oder in de falsche Reihefolsch ankomme. Mer sagt: IP liefert nur noh bestem Bemühe (*best effort*).

Die Lücke schließt **Schicht 4**, die Transportschicht. Uff de Arbeitsfläche siehste en **Client-PC** un en **Server** — dodra untersuchste in dem Kapitel die zwei wichtigste Protokolle vun de Schicht 4: **TCP** un **UDP**.

:::note
TCP is seit 1981 standardisiert (**RFC 793**, heut **RFC 9293**), UDP sogar schon seit 1980 (**RFC 768**).
:::
