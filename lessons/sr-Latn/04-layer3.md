# Sloj 3: ruter, IP adrese i podmrežavanje

:::goal
**Cilj učenja:** Umeš da čitaš IP adrese u binarnom obliku, računaš adresu mreže i broadcast adresu, deliš mrežu na podmreže jednake veličine i povezuješ mreže preko rutera pomoću tabela rutiranja.
:::

:::osi 3
:::

:::sim
url=/sims/lesson-4.1.btsim
:::

Do sada su se svi uređaji nalazili u *jednoj* lokalnoj mreži — povezani preko switcheva i pristupnih tačaka. Internet se, međutim, sastoji od miliona takvih mreža: tvoja kućna mreža, školska mreža, mreža tvog mobilnog operatera, mreže velikih data centara.

Kako paket pronalazi put iz jedne mreže u drugu? O tome se stara **sloj 3**, mrežni sloj — pomoću **Internet Protocola (IP)**, IP adresa i uređaja koji povezuju mreže međusobno: **rutera**.

:::note
IP je od 1981. godine definisan standardom, dokumentom **RFC 791**. Verzija o kojoj je u ovom poglavlju uglavnom reč zove se **IPv4**. Noviju verziju **IPv6** upoznaćeš na kraju poglavlja.
:::
