# Ausblick: Dynamisches Routing

Im Projekt hast du für vier Standorte zwölf Routen von Hand eingetragen. Ein großes Firmennetz hat Hunderte Router, das Internet Zehntausende — und ständig fällt irgendwo eine Leitung aus oder kommt eine neue dazu. Von Hand ist das nicht mehr zu schaffen.

Deshalb tauschen Router ihre Routen meist automatisch untereinander aus. Dafür gibt es **Routing-Protokolle**. Man spricht dann von **dynamischem Routing** — im Gegensatz zum **statischen Routing**, bei dem alles von Hand eingetragen wird.

Die bekanntesten Routing-Protokolle:

| Protokoll | Idee | typischer Einsatz |
|---|---|---|
| **RIP** (*Routing Information Protocol*) | Jeder Router erzählt seinen Nachbarn regelmäßig, welche Netze er wie viele Router (*Hops*) entfernt erreicht. | kleine Netze, Lehrbeispiel |
| **OSPF** (*Open Shortest Path First*) | Jeder Router kennt den kompletten Plan des Netzes und berechnet daraus selbst den kürzesten Weg. | Firmennetze |
| **BGP** (*Border Gateway Protocol*) | Große Netzbetreiber (z.B. Internetanbieter) teilen sich mit, welche Netze sie erreichen. | das Internet zwischen den Anbietern |

:::quiz match
RIP -> Router teilen ihren Nachbarn mit, wie viele Hops entfernt sie ein Netz erreichen
OSPF -> Jeder Router kennt den ganzen Netzplan und berechnet den kürzesten Weg
BGP -> Verbindet die Netze der großen Internetanbieter
:::

:::evaluate
Zuordnung prüfen
:::

:::tip Merksatz
Beim **statischen Routing** trägt ein Administrator alle Routen von Hand ein. Beim **dynamischen Routing** tauschen Router ihre Routen mit Hilfe von **Routing-Protokollen** wie RIP, OSPF oder BGP automatisch aus — und passen sich selbst an, wenn eine Verbindung ausfällt.
:::

:::note
BeaverTracer kann RIP, OSPF und BGP simulieren — du findest sie in den gleichnamigen Reitern eines Routers. In diesem Kurs bleibt es beim Ausblick.
:::
