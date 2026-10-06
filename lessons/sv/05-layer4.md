# Lager 4: Transportlager

:::goal
**Lärandemål:** Du kan nämna transportlagrets uppgifter, visa förloppet för en TCP-förbindelse (uppkoppling, data, nedkoppling) som sekvensdiagram, förklara portar samt sekvens- och bekräftelsenummer och motivera när UDP används i stället för TCP.
:::

:::osi 4
:::

:::sim
url=/sims/lesson-5.1.btsim
:::

En kort återblick på kapitel 4: **Internet Protocol** på lager 3 levererar ett paket till rätt *dator* – även över många routrar. Mer än så lovar IP dock inte:

- På en dator körs många program samtidigt: webbläsare, e-postprogram, chattprogram. Vilket av dem är ett paket avsett för? Det framgår inte av IP-huvudet.
- Om ett paket går förlorat på vägen märker IP inte det. Paket kan också komma fram två gånger eller i fel ordning. Man säger att IP bara levererar efter bästa förmåga (*best effort*).

Dessa luckor fyller **lager 4**, transportlagret. På arbetsytan ser du en **Client-PC** och en **Server** – på dem undersöker du i det här kapitlet de två viktigaste protokollen på lager 4: **TCP** och **UDP**.

:::note
TCP har varit standardiserat sedan 1981 (**RFC 793**, numera **RFC 9293**), UDP redan sedan 1980 (**RFC 768**).
:::
