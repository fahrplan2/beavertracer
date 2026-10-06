# Laag 4: transportlaag

:::goal
**Leerdoel:** Je kunt de taken van de transportlaag noemen, het verloop van een TCP-verbinding (opbouw, data, afbouw) weergeven als sequentiediagram, poorten en volg- en bevestigingsnummers uitleggen en beargumenteren wanneer UDP in plaats van TCP wordt gebruikt.
:::

:::osi 4
:::

:::sim
url=/sims/lesson-5.1.btsim
:::

Een korte terugblik op hoofdstuk 4: Het **Internet Protocol** op laag 3 brengt een pakket naar de juiste *computer* — ook over veel routers heen. Meer belooft IP echter niet:

- Op een computer draaien veel programma's tegelijk: browser, mailprogramma, messenger. Voor welk programma is een pakket bedoeld? Dat staat niet in de IP-header.
- Als er onderweg een pakket verloren gaat, merkt IP dat niet. Pakketten kunnen ook dubbel of in de verkeerde volgorde aankomen. Men zegt: IP levert alleen volgens de beste inspanning (*best effort*).

Deze hiaten dicht **laag 4**, de transportlaag. In de werkruimte zie je een **Client-PC** en een **Server** — daaraan onderzoek je in dit hoofdstuk de twee belangrijkste protocollen van laag 4: **TCP** en **UDP**.

:::note
TCP is sinds 1981 gestandaardiseerd (**RFC 793**, tegenwoordig **RFC 9293**), UDP al sinds 1980 (**RFC 768**).
:::
