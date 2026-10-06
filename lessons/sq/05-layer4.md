# Shtresa 4: Shtresa e transportit

:::goal
**Objektivi i të nxënit:** Ti mund të përmendësh detyrat e shtresës së transportit, të paraqesësh rrjedhën e një lidhjeje TCP (ngritja, të dhënat, mbyllja) si diagram komunikimi, të shpjegosh portat si dhe numrat e sekuencës dhe të konfirmimit, dhe të arsyetosh kur përdoret UDP në vend të TCP.
:::

:::osi 4
:::

:::sim
url=/sims/lesson-5.1.btsim
:::

Një përmbledhje e shkurtër e kapitullit 4: **Internet Protocol** në shtresën 3 e çon një paketë te *kompjuteri* i duhur, edhe përmes shumë router-ave. Por IP nuk premton më shumë se kaq:

- Në një kompjuter ekzekutohen shumë programe njëkohësisht: shfletuesi, programi i postës elektronike, messenger-i. Për cilin prej tyre është menduar një paketë? Kjo nuk gjendet në kokën e IP.
- Nëse një paketë humbet gjatë rrugës, IP nuk e vëren. Paketat mund të mbërrijnë edhe dyfish ose në renditje të gabuar. Thuhet: IP dërgon vetëm me përpjekjen më të mirë (*best effort*).

Këto boshllëqe i mbmbyll **shtresa 4**, shtresa e transportit. Në Hapësira e punës sheh një **Client-PC** dhe një **Server** — në to do të shqyrtosh në këtë kapitull dy protokollet më të rëndësishme të shtresës 4: **TCP** dhe **UDP**.

:::note
TCP është i standardizuar që nga viti 1981 (**RFC 793**, sot **RFC 9293**), UDP që nga viti 1980 (**RFC 768**).
:::
