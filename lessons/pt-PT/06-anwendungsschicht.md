# Camadas 5–7: camada de aplicação

:::goal
**Objetivo de aprendizagem:** Consegues reconhecer no Tracer os protocolos mais importantes da camada de aplicação — HTTP, DNS, SMTP/POP3/IMAP e DHCP —, explicar o respetivo funcionamento e encontrar erros típicos.
:::

:::osi 7
:::

:::sim
url=/sims/lesson-6.1.btsim
:::

No capítulo 5 viste que o TCP e o UDP entregam os dados de forma fiável (ou rápida) ao programa certo — através das portas. *O que* vai dentro desses dados é definido pelos protocolos da **camada de aplicação**. No modelo TCP/IP, trata-se de uma única camada; no modelo ISO/OSI, corresponde às camadas 5 a 7.

Cada um destes protocolos tem a sua própria função — e a sua própria porta:

| Protocolo | Função | Porta | Transporte |
|---|---|---|---|
| **HTTP** | obter páginas web | 80 | TCP |
| **DNS** | traduzir nomes em endereços IP | 53 | normalmente UDP |
| **SMTP** | enviar e-mails | 25 | TCP |
| **POP3** / **IMAP** | obter e-mails | 110 / 143 | TCP |
| **DHCP** | atribuir automaticamente um endereço IP a um dispositivo | 67 / 68 | UDP |

No capítulo 1.3, ainda acedeste a uma página web através do respetivo endereço IP. No dia a dia, ninguém escreve `192.168.0.20` — e nenhum portátil novo tem o endereço introduzido à mão. Como tudo isto funciona em conjunto, vais descobri-lo neste capítulo, protocolo a protocolo.
