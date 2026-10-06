# Sloj 3: usmjernici, IP adrese i podmrežavanje

:::goal
**Ishod učenja:** Znaš binarno čitati IP adrese, izračunati adresu mreže i broadcast adresu, podijeliti mrežu na podmreže jednake veličine te povezati mreže pomoću usmjernika i tablica usmjeravanja.
:::

:::osi 3
:::

:::sim
url=/sims/lesson-4.1.btsim
:::

Do sada su se svi uređaji nalazili u *jednoj* lokalnoj mreži — povezani preko switcheva i pristupnih točaka. No internet se sastoji od milijuna takvih mreža: tvoja kućna mreža, školska mreža, mreža tvog mobilnog operatera, mreže velikih podatkovnih centara.

Kako paket pronalazi put iz jedne mreže u drugu? Za to se brine **sloj 3**, mrežni sloj — s **Internet Protocolom (IP)**, IP adresama i uređajima koji međusobno povezuju mreže: **usmjernicima**.

:::note
IP je od 1981. definiran standardom, **RFC 791**. Verzija na koju se ovo poglavlje uglavnom odnosi zove se **IPv4**. Noviju verziju **IPv6** upoznat ćeš na kraju poglavlja.
:::
