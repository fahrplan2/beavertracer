# Livello 4: livello di trasporto

:::goal
**Obiettivo di apprendimento:** Sai elencare i compiti del livello di trasporto, rappresentare lo svolgimento di una connessione TCP (instaurazione, dati, chiusura) come diagramma di sequenza, spiegare le porte e i numeri di sequenza e di riscontro e motivare quando si usa UDP al posto di TCP.
:::

:::osi 4
:::

:::sim
url=/sims/lesson-5.1.btsim
:::

Un breve ripasso del capitolo 4: l'**Internet Protocol** al livello 3 porta un pacchetto al *computer* giusto, anche attraverso molti router. Ma IP non promette niente di più:

- Su un computer girano molti programmi contemporaneamente: browser, programma di posta, messenger. A quale di questi è destinato un pacchetto? Questo non è scritto nell'intestazione IP.
- Se un pacchetto va perso lungo il percorso, IP non se ne accorge. I pacchetti possono anche arrivare doppi o nell'ordine sbagliato. Si dice che IP consegna solo al meglio delle proprie possibilità (*best effort*).

Queste lacune vengono colmate dal **livello 4**, il livello di trasporto. Nell'area di lavoro vedi un **Client-PC** e un **Server**: con questi, in questo capitolo, studierai i due protocolli più importanti del livello 4: **TCP** e **UDP**.

:::note
TCP è standardizzato dal 1981 (**RFC 793**, oggi **RFC 9293**), UDP addirittura dal 1980 (**RFC 768**).
:::
