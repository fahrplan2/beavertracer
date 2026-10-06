# Sloj 4: transportni sloj

:::goal
**Cilj učenja:** Možeš da navedeš zadatke transportnog sloja, da prikažeš tok TCP veze (uspostavljanje, prenos podataka, raskidanje) kao dijagram komunikacije, da objasniš portove, kao i redne brojeve i brojeve potvrde, i da obrazložiš kada se umesto TCP-a koristi UDP.
:::

:::osi 4
:::

:::sim
url=/sims/lesson-5.1.btsim
:::

Kratak osvrt na 4. poglavlje: **Internet Protocol** na sloju 3 dostavlja paket do pravog *računara* — i preko mnogo rutera. Ali IP ne obećava više od toga:

- Na računaru istovremeno radi mnogo programa: pregledač, program za e-poštu, messenger. Kom od njih je paket namenjen? To se ne nalazi u IP zaglavlju.
- Ako se paket usput izgubi, IP to ne primećuje. Paketi takođe mogu da stignu dvaput ili pogrešnim redosledom. Kaže se: IP isporučuje samo po principu najboljeg truda (*best effort*).

Ove praznine popunjava **sloj 4**, transportni sloj. Na radnoj površini vidiš jedan **Client-PC** i jedan **Server** — na njima u ovom poglavlju proučavaš dva najvažnija protokola sloja 4: **TCP** i **UDP**.

:::note
TCP je standardizovan od 1981. godine (**RFC 793**, danas **RFC 9293**), a UDP još od 1980. (**RFC 768**).
:::
