# Sloj 3: ruteri, IP adrese i podmrežavanje

:::goal
**Ishod učenja:** Znaš čitati IP adrese u binarnom zapisu, izračunati adresu mreže i broadcast adresu, podijeliti mrežu na podmreže jednake veličine i povezati mreže pomoću rutera i tabela rutiranja.
:::

:::osi 3
:::

:::sim
url=/sims/lesson-4.1.btsim
:::

Do sada su se svi uređaji nalazili u *jednoj* lokalnoj mreži — povezani preko switcheva i pristupnih tačaka. Internet se, međutim, sastoji od miliona takvih mreža: tvoje kućne mreže, školske mreže, mreže tvog mobilnog operatera, mreža velikih podatkovnih centara.

Kako paket pronalazi put iz jedne mreže u drugu? Za to je zadužen **sloj 3**, mrežni sloj — s **Internet Protocolom (IP)**, IP adresama i uređajima koji povezuju mreže međusobno: **ruterima**.

:::note
IP je od 1981. godine definisan standardom, **RFC 791**. Verzija o kojoj se u ovom poglavlju uglavnom govori zove se **IPv4**. Noviju verziju **IPv6** upoznat ćeš na kraju poglavlja.
:::
