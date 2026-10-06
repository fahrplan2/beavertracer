# Stratul 3: routere, adrese IP și subnetting

:::goal
**Obiectiv de învățare:** Poți citi adrese IP în format binar, poți calcula adresele de rețea și de broadcast, poți împărți o rețea în subrețele de aceeași mărime și poți conecta rețele prin routere folosind tabele de rutare.
:::

:::osi 3
:::

:::sim
url=/sims/lesson-4.1.btsim
:::

Până acum, toate dispozitivele se aflau într-o *singură* rețea locală — conectate prin switch-uri și puncte de acces. Internetul este însă alcătuit din milioane de astfel de rețele: rețeaua ta de acasă, rețeaua școlii, rețeaua operatorului tău de telefonie mobilă, rețelele marilor centre de date.

Cum găsește un pachet drumul dintr-o rețea în alta? De acest lucru se ocupă **stratul 3**, stratul rețea — cu **Internet Protocol (IP)**, adresele IP și dispozitivele care conectează rețelele între ele: **routerele**.

:::note
IP este definit încă din 1981 într-un standard, **RFC 791**. Versiunea despre care este vorba în principal în acest capitol se numește **IPv4**. Versiunea mai nouă, **IPv6**, o vei descoperi la sfârșitul capitolului.
:::
