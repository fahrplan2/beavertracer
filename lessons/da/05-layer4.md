# Lag 4: Transportlag

:::goal
**Læringsmål:** Du kan nævne transportlagets opgaver, fremstille forløbet af en TCP-forbindelse (opbygning, data, nedlæggelse) som sekvensdiagram, forklare porte samt sekvensnumre og kvitteringsnumre og begrunde, hvornår UDP bruges i stedet for TCP.
:::

:::osi 4
:::

:::sim
url=/sims/lesson-5.1.btsim
:::

Et kort tilbageblik på kapitel 4: **Internet Protocol** på lag 3 bringer en pakke frem til den rigtige *computer* — også på tværs af mange routere. Men mere end det lover IP ikke:

- På en computer kører mange programmer samtidig: browser, mailprogram, messenger. Hvilket af dem er en pakke beregnet til? Det står ikke i IP-headeren.
- Hvis en pakke går tabt undervejs, opdager IP det ikke. Pakker kan også ankomme dobbelt eller i forkert rækkefølge. Man siger: IP leverer kun efter bedste evne (*best effort*).

Disse huller lukkes af **lag 4**, transportlaget. På arbejdsområdet ser du en **Client-PC** og en **Server** — på dem undersøger du i dette kapitel de to vigtigste protokoller på lag 4: **TCP** og **UDP**.

:::note
TCP har været standardiseret siden 1981 (**RFC 793**, i dag **RFC 9293**), UDP allerede siden 1980 (**RFC 768**).
:::
