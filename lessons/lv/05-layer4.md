# 4. slānis: transporta slānis

:::goal
**Mācību mērķis:** Tu vari nosaukt transporta slāņa uzdevumus, attēlot TCP savienojuma norisi (izveide, dati, atvienošana) kā sekvenču diagrammu, izskaidrot portus, kā arī secības un apstiprinājuma numurus, un pamatot, kad tiek izmantots UDP, nevis TCP.
:::

:::osi 4
:::

:::sim
url=/sims/lesson-5.1.btsim
:::

Īss atskats uz 4. nodaļu: **Internet Protocol** 3. slānī nogādā paketi pie pareizā *datora* — arī caur daudziem maršrutētājiem. Taču vairāk IP neapsola:

- Datorā vienlaikus darbojas daudzas programmas: pārlūks, pasta programma, ziņapmaiņas lietotne. Kurai no tām pakete ir paredzēta? IP galvenē tas nav norādīts.
- Ja pakete pa ceļam pazūd, IP to nepamana. Paketes var atnākt arī divreiz vai nepareizā secībā. Saka: IP piegādā pēc iespējas labāk (*best effort*).

Šīs nepilnības novērš **4. slānis**, transporta slānis. Uz darbvirsmas redzams **Client-PC** un **Server** — pie tiem šajā nodaļā izpētīsi divus svarīgākos 4. slāņa protokolus: **TCP** un **UDP**.

:::note
TCP ir standartizēts kopš 1981. gada (**RFC 793**, mūsdienās **RFC 9293**), UDP jau kopš 1980. gada (**RFC 768**).
:::
