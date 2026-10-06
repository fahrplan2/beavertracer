# Camada 3: routers, endereços IP e sub-redes

:::goal
**Objetivo de aprendizagem:** Consegues ler endereços IP em binário, calcular endereços de rede e de broadcast, dividir uma rede em sub-redes do mesmo tamanho e ligar redes através de routers com tabelas de encaminhamento.
:::

:::osi 3
:::

:::sim
url=/sims/lesson-4.1.btsim
:::

Até agora, todos os dispositivos estavam numa *única* rede local — ligados através de switches e pontos de acesso. A Internet, porém, é composta por milhões dessas redes: a tua rede doméstica, a rede da escola, a rede do teu operador móvel, as redes de grandes centros de dados.

Como é que um pacote encontra o caminho de uma rede para outra? Quem trata disso é a **camada 3**, a camada de rede — com o **Internet Protocol (IP)**, os endereços IP e os dispositivos que ligam redes entre si: os **routers**.

:::note
O IP está definido numa norma desde 1981, o **RFC 791**. A versão de que este capítulo trata principalmente chama-se **IPv4**. A versão mais recente, o **IPv6**, vais conhecê-la no final do capítulo.
:::
