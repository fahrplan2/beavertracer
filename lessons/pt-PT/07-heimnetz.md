# A rede doméstica: router e NAT

:::goal
**Objetivo de aprendizagem:** Sabes indicar as funções de um router doméstico, configurar um router doméstico, explicar como o NAT permite que muitos dispositivos acedam à Internet através de um único endereço público, e configurar e testar um reencaminhamento de portas.
:::

:::osi 3
:::

:::sim
url=/sims/lesson-7.1.btsim
:::

Em casa, rapidamente há dez ou mais dispositivos na rede: telemóveis, portáteis, televisores, consola de jogos, colunas. Todos recebem endereços como `192.168.178.20` — de um intervalo **privado**, que não é encaminhado na Internet (capítulo 4.2.2). E, mesmo assim, cada um destes dispositivos consegue aceder à Internet.

Quem torna isto possível é uma caixinha discreta: o **router doméstico**. Na área de trabalho vês, à esquerda, uma rede doméstica com um PC e um tablet e, à direita, «a Internet» — os routers de um fornecedor de serviços, um servidor DNS e o servidor web `www.beispiel.de`.

:::note
Os endereços públicos neste capítulo (`203.0.113.…`, `198.51.100.…`, `192.0.2.…`) estão reservados para exemplos e material didático — tal como `2001:db8::` no IPv6.
:::
