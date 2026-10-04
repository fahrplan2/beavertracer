# Das Heimnetz: Router und NAT

:::goal
**Lernziel:** Du kannst die Aufgaben eines Heimrouters benennen, einen Heimrouter einrichten, erklären, wie NAT viele Geräte über eine öffentliche Adresse ins Internet bringt, und eine Portweiterleitung einrichten und prüfen.
:::

:::osi 3
:::

:::sim
url=/sims/lesson-7.1.btsim
:::

Zu Hause sind schnell zehn oder mehr Geräte im Netz: Handys, Laptops, Fernseher, Spielkonsole, Lautsprecher. Alle bekommen Adressen wie `192.168.178.20` — aus einem **privaten** Bereich, der im Internet gar nicht weitergeleitet wird (Kapitel 4.2.2). Und trotzdem kommt jedes dieser Geräte ins Internet.

Möglich macht das ein unscheinbares Kästchen: der **Heimrouter**. Auf der Arbeitsfläche siehst du links ein Heimnetz mit einem PC und einem Tablet, rechts „das Internet“ — die Router eines Providers, einen DNS-Server und den Webserver `www.beispiel.de`.

:::note
Die öffentlichen Adressen in diesem Kapitel (`203.0.113.…`, `198.51.100.…`, `192.0.2.…`) sind für Beispiele und Lehrmaterial reserviert — genau wie `2001:db8::` bei IPv6.
:::
