# Camada 4: camada de transporte

:::goal
**Objetivo de aprendizagem:** Consegues indicar as funções da camada de transporte, representar o funcionamento de uma ligação TCP (estabelecimento, dados, encerramento) num diagrama de sequência, explicar o que são portas, números de sequência e números de confirmação, e justificar quando se utiliza UDP em vez de TCP.
:::

:::osi 4
:::

:::sim
url=/sims/lesson-5.1.btsim
:::

Uma breve recapitulação do capítulo 4: o **Internet Protocol** na camada 3 leva um pacote ao *computador* certo — mesmo através de muitos routers. No entanto, o IP não promete mais do que isso:

- Num computador executam-se muitos programas em simultâneo: navegador, programa de correio eletrónico, aplicação de mensagens. Para qual deles se destina um pacote? Isso não consta do cabeçalho IP.
- Se um pacote se perder pelo caminho, o IP não dá por isso. Os pacotes também podem chegar duplicados ou pela ordem errada. Diz-se que o IP entrega apenas com o melhor esforço possível (*best effort*).

Estas lacunas são colmatadas pela **camada 4**, a camada de transporte. Na área de trabalho vês um **Client-PC** e um **Server** — é neles que, neste capítulo, vais analisar os dois protocolos mais importantes da camada 4: **TCP** e **UDP**.

:::note
O TCP está normalizado desde 1981 (**RFC 793**, hoje **RFC 9293**) e o UDP já desde 1980 (**RFC 768**).
:::
