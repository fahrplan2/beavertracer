# Sloj 4: transportni sloj

:::goal
**Ishod učenja:** Možeš nabrojati zadatke transportnog sloja, prikazati tok TCP veze (uspostavljanje, prijenos podataka, prekid) kao dijagram komunikacije, objasniti portove te sekvencijske brojeve i brojeve potvrde, te obrazložiti kada se umjesto TCP-a koristi UDP.
:::

:::osi 4
:::

:::sim
url=/sims/lesson-5.1.btsim
:::

Kratak osvrt na 4. poglavlje: **Internet Protocol** na sloju 3 donosi paket do pravog *računara* — čak i preko mnogo rutera. Ali IP ne obećava ništa više od toga:

- Na računaru istovremeno radi mnogo programa: preglednik, program za e-poštu, messenger. Za koji od njih je paket namijenjen? To se ne nalazi u IP zaglavlju.
- Ako se paket izgubi usput, IP to ne primijeti. Paketi mogu stići i dvaput ili pogrešnim redoslijedom. Kaže se: IP isporučuje samo po principu najboljeg truda (*best effort*).

Ove praznine popunjava **sloj 4**, transportni sloj. Na radnoj površini vidiš **Client-PC** i **Server** — na njima u ovom poglavlju istražuješ dva najvažnija protokola sloja 4: **TCP** i **UDP**.

:::note
TCP je standardiziran od 1981. godine (**RFC 793**, danas **RFC 9293**), a UDP već od 1980. (**RFC 768**).
:::
