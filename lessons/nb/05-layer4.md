# Lag 4: Transportlaget

:::goal
**Læringsmål:** Du kan nevne oppgavene til transportlaget, vise forløpet av en TCP-forbindelse (oppkobling, data, nedkobling) som sekvensdiagram, forklare porter samt sekvensnummer og bekreftelsesnummer, og begrunne når UDP brukes i stedet for TCP.
:::

:::osi 4
:::

:::sim
url=/sims/lesson-5.1.btsim
:::

En kort tilbakeblikk på kapittel 4: **Internet Protocol** på lag 3 bringer en pakke til riktig *maskin* — også på tvers av mange rutere. Men mer enn det lover ikke IP:

- På en datamaskin kjører mange programmer samtidig: nettleser, e-postprogram, meldingsapp. Hvilket av dem er en pakke ment for? Det står ikke i IP-hodet.
- Hvis en pakke går tapt underveis, merker ikke IP det. Pakker kan også komme fram to ganger eller i feil rekkefølge. Man sier: IP leverer kun etter beste evne (*best effort*).

Disse hullene tetter **lag 4**, transportlaget. På arbeidsområdet ser du en **Client-PC** og en **Server** — på dem undersøker du i dette kapitlet de to viktigste protokollene på lag 4: **TCP** og **UDP**.

:::note
TCP har vært standardisert siden 1981 (**RFC 793**, i dag **RFC 9293**), UDP allerede siden 1980 (**RFC 768**).
:::
