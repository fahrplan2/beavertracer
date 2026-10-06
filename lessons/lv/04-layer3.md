# 3. slānis: maršrutētāji, IP adreses un apakštīklu veidošana

:::goal
**Mācību mērķis:** Tu proti nolasīt IP adreses binārā veidā, aprēķināt tīkla un apraides adreses, sadalīt tīklu vienāda izmēra apakštīklos un savienot tīklus ar maršrutētājiem, izmantojot maršrutēšanas tabulas.
:::

:::osi 3
:::

:::sim
url=/sims/lesson-4.1.btsim
:::

Līdz šim visas ierīces atradās *vienā* lokālajā tīklā — savienotas ar komutatoriem un Access Point ierīcēm. Taču internets sastāv no miljoniem šādu tīklu: tavs mājas tīkls, skolas tīkls, tava mobilo sakaru operatora tīkls, lielo datu centru tīkli.

Kā pakete atrod ceļu no viena tīkla uz citu? Par to rūpējas **3. slānis**, tīkla slānis — ar **Internet Protocol (IP)**, IP adresēm un ierīcēm, kas savieno tīklus savā starpā: **maršrutētājiem**.

:::note
IP kopš 1981. gada ir noteikts standartā — **RFC 791**. Versiju, par kuru šajā nodaļā galvenokārt ir runa, sauc par **IPv4**. Jaunāko versiju **IPv6** tu iepazīsi nodaļas beigās.
:::
