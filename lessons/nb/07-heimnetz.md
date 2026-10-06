# Hjemmenettverket: ruter og NAT

:::goal
**Læringsmål:** Du kan beskrive oppgavene til en hjemmeruter, sette opp en hjemmeruter, forklare hvordan NAT gir mange enheter tilgang til internett via én offentlig adresse, og sette opp og kontrollere en portviderekobling.
:::

:::osi 3
:::

:::sim
url=/sims/lesson-7.1.btsim
:::

Hjemme er det fort ti eller flere enheter på nettverket: mobiler, bærbare PC-er, TV, spillkonsoll, høyttalere. Alle får adresser som `192.168.178.20` — fra et **privat** område som slett ikke blir videresendt på internett (kapittel 4.2.2). Og likevel kommer hver eneste av disse enhetene seg ut på internett.

Det som gjør dette mulig, er en uanselig liten boks: **hjemmeruteren**. På arbeidsområdet ser du til venstre et hjemmenettverk med en PC og et nettbrett, og til høyre «internett» — ruterne til en leverandør, en DNS-server og webserveren `www.beispiel.de`.

:::note
De offentlige adressene i dette kapittelet (`203.0.113.…`, `198.51.100.…`, `192.0.2.…`) er reservert for eksempler og undervisningsmateriell — akkurat som `2001:db8::` i IPv6.
:::
