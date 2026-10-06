# Sloj 4: transportni sloj

:::goal
**Ishod učenja:** Znaš navesti zadaće transportnog sloja, prikazati tijek TCP veze (uspostava, podaci, prekid) kao dijagram slijeda, objasniti portove te redne brojeve i brojeve potvrde te obrazložiti kada se umjesto TCP-a koristi UDP.
:::

:::osi 4
:::

:::sim
url=/sims/lesson-5.1.btsim
:::

Kratki osvrt na 4. poglavlje: **Internet Protocol** na sloju 3 dostavlja paket do pravog *računala* — i preko mnogo usmjernika. No IP ne obećava ništa više od toga:

- Na računalu istodobno radi mnogo programa: preglednik, program za e-poštu, messenger. Kojem je od njih paket namijenjen? To ne piše u IP zaglavlju.
- Ako se paket usput izgubi, IP to ne primjećuje. Paketi mogu stići i dvostruko ili pogrešnim redoslijedom. Kaže se: IP isporučuje samo uz najbolji trud (*best effort*).

Te praznine popunjava **sloj 4**, transportni sloj. Na radnoj površini vidiš **Client-PC** i **Server** — na njima u ovom poglavlju proučavaš dva najvažnija protokola sloja 4: **TCP** i **UDP**.

:::note
TCP je standardiziran od 1981. (**RFC 793**, danas **RFC 9293**), a UDP još od 1980. (**RFC 768**).
:::
