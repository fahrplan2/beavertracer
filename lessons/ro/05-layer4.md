# Stratul 4: stratul transport

:::goal
**Obiectiv de învățare:** Poți enumera sarcinile stratului transport, poți reprezenta desfășurarea unei conexiuni TCP (stabilire, date, încheiere) ca diagramă de secvență, poți explica porturile, precum și numerele de secvență și de confirmare, și poți justifica în ce situații se folosește UDP în loc de TCP.
:::

:::osi 4
:::

:::sim
url=/sims/lesson-5.1.btsim
:::

O scurtă recapitulare a capitolului 4: **Internet Protocol** de pe stratul 3 duce un pachet la *calculatorul* potrivit — chiar și prin multe routere. Dar IP nu promite mai mult de atât:

- Pe un calculator rulează multe programe în același timp: browser, program de e-mail, messenger. Pentru care dintre ele este destinat un pachet? Asta nu se află în antetul IP.
- Dacă un pachet se pierde pe drum, IP nu observă acest lucru. Pachetele pot ajunge și în dublu exemplar sau în ordine greșită. Se spune că IP livrează doar în regim de cel mai bun efort (*best effort*).

Aceste lacune le acoperă **stratul 4**, stratul transport. Pe spațiul de lucru vezi un **Client-PC** și un **Server** — pe ele vei studia în acest capitol cele două protocoale cele mai importante ale stratului 4: **TCP** și **UDP**.

:::note
TCP este standardizat din 1981 (**RFC 793**, astăzi **RFC 9293**), iar UDP chiar din 1980 (**RFC 768**).
:::
