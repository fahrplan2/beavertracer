# Recreio — Markdown e questionários (página de teste)

[[toc]]

Esta página serve para testar a sintaxe Markdown e os tipos de perguntas interativas.

---

## Sintaxe Markdown

### Formatação de texto

**Negrito**, *itálico*, ~~rasurado~~, `Inline-Code`, e **_combinado_**.

Parágrafo normal com uma [ligação para outra página](01-einfuehrung.html) e uma [ligação externa](https://www.beavertracer.eu).

### Títulos

Os níveis H2–H4 aparecem automaticamente no índice (TOC).

#### Este é um H4 — não aparece no TOC

### Listas

Não ordenada:

- Ethernet
- IP
- TCP
  - HTTP
  - SMTP

Ordenada:

1. Modo de edição: construir a topologia
2. Modo de execução: iniciar a simulação
3. Modo de rastreamento: analisar pacotes

### Tabela

| Protocolo | Camada | Porta |
|-----------|---------|------|
| HTTP      | 7       | 80   |
| HTTPS     | 7       | 443  |
| DNS       | 7       | 53   |
| TCP       | 4       | —    |

### Código

Inline: `ping 192.168.0.1`

Bloco:

```
$ ping 192.168.0.2
PING 192.168.0.2: 56 data bytes
64 bytes from 192.168.0.2: icmp_seq=0 ttl=64 time=0.4 ms
```

### Callouts

:::note
Este é um callout **note** — para indicações neutras e informações complementares.
:::

:::tip
Este é um callout **tip** — para dicas úteis e recomendações.
:::

:::warning
Este é um callout **warning** — para avisos que exigem atenção.
:::

:::danger
Este é um callout **danger** — para fontes de erro críticas.
:::

:::draft
:::

### Ícones

Font Awesome Solid: :fa-play: :fa-stop: :fa-desktop: :fa-shield-halved: :fa-wifi:

Font Awesome Regular: :far-file: :far-circle:

Símbolos de dispositivos: :router: :switch:

### Simulação incorporada

:::sim
url=/sims/demo.btsim
:::

### Tarefa com verificação de comportamento

:::task
title: Ligar o PC 1 e o PC 2
Verifica se o PC 1 (id 9) tem um IP na rede 192.168.0.0/24 e consegue alcançar o PC 2 (id 11).
check: ip(9, "192.168.0.0/24")
check: pingOk(9, 11)
:::

---

## Modelo de referência OSI: esquema de cores

Exemplo de uma tabela destacada com as cores do arco-íris (camada 1 em baixo, como na pilha) e de um "semáforo" na margem da página com texto a contorná-lo.

### Tabela colorida

<table class="osi-table">
<thead>
<tr><th>Camada</th><th>Nome</th><th>Protocolos de exemplo</th></tr>
</thead>
<tbody>
<tr class="osi-l7"><td>7</td><td>Aplicação</td><td>HTTP, DNS, SMTP</td></tr>
<tr class="osi-l6"><td>6</td><td>Apresentação</td><td>TLS, JPEG, ASCII</td></tr>
<tr class="osi-l5"><td>5</td><td>Sessão</td><td>RPC, NetBIOS</td></tr>
<tr class="osi-l4"><td>4</td><td>Transporte</td><td>TCP, UDP</td></tr>
<tr class="osi-l3"><td>3</td><td>Rede</td><td>IP, ICMP</td></tr>
<tr class="osi-l2"><td>2</td><td>Ligação de dados</td><td>Ethernet, ARP</td></tr>
<tr class="osi-l1"><td>1</td><td>Física</td><td>Cobre, fibra ótica, WLAN</td></tr>
</tbody>
</table>

### Semáforo com texto a contorná-lo

O semáforo é criado através de `:::osi N`, em que `N` é a camada a destacar (aqui, a camada 3). Flutua na margem e o texto seguinte flui automaticamente à sua volta.

:::osi 3
:::

Lorem ipsum dolor sit amet, consetetur sadipscing elitr, sed diam nonumy eirmod tempor invidunt ut labore et dolore magna aliquyam erat, sed diam voluptua. At vero eos et accusam et justo duo dolores et ea rebum. Stet clita kasd gubergren, no sea takimata sanctus est Lorem ipsum dolor sit amet.

Lorem ipsum dolor sit amet, consetetur sadipscing elitr, sed diam nonumy eirmod tempor invidunt ut labore et dolore magna aliquyam erat, sed diam voluptua. At vero eos et accusam et justo duo dolores et ea rebum, pelo que esta secção está associada, em termos de conteúdo, à camada de rede (layer 3) — por isso é precisamente esta caixa do semáforo que está colorida, enquanto todas as outras permanecem cinzentas.

---

## Secção 1: conceitos básicos

:::quiz short
Qual é a notação CIDR da máscara de sub-rede 255.255.255.0?
= /24
= 24
:::

:::quiz mc
Qual dos seguintes endereços é o endereço de rede de 192.168.1.42/24?
- [ ] 192.168.1.42
- [x] 192.168.1.0
- [ ] 192.168.1.255
- [ ] 192.168.0.0
:::

:::quiz fill
O endereço de rede obtém-se através de uma operação {AND} bit a bit entre o endereço IP e a {máscara de rede}. O endereço mais alto da sub-rede é o endereço de {broadcast}.
:::

:::evaluate
Verificar secção 1
:::

---

## Secção 2: associação — protocolos e as suas funções

:::quiz match
ARP -> Determina o endereço MAC correspondente a um endereço IP
DNS -> Resolve nomes de anfitrião em endereços IP
DHCP -> Atribui endereços IP automaticamente aos clientes
ICMP -> É utilizado pelo ping e pelo traceroute
:::

:::evaluate
Verificar secção 2
:::

---

## Secção 3: sub-redes

:::quiz short
Quantos endereços de anfitrião utilizáveis tem uma sub-rede /30?
= 2
:::

:::quiz mc
Para que se utiliza normalmente uma sub-rede /30?
- [ ] Para grandes redes de escritório com muitos dispositivos
- [ ] Como intervalo de endereços para pools DHCP
- [x] Como rede de ligação entre dois routers
- [ ] Para pontos de acesso WLAN
:::

:::quiz fill
Uma sub-rede /25 tem {128} endereços, dos quais {126} são utilizáveis para anfitriões.
:::

:::quiz match
/24 -> 254 endereços de anfitrião utilizáveis
/25 -> 126 endereços de anfitrião utilizáveis
/28 -> 14 endereços de anfitrião utilizáveis
/30 -> 2 endereços de anfitrião utilizáveis
:::

:::evaluate
Verificar secção 3
:::

## Secção 4: escolha múltipla e tarefas aleatórias

Em `:::quiz multi` podem estar corretas quantas respostas se quiser — cada afirmação é avaliada individualmente:

:::quiz multi
Que afirmações sobre o ARP são verdadeiras?
- [x] O ARP determina o endereço MAC correspondente a um endereço IP
- [ ] O ARP determina o endereço IP correspondente a um nome
- [x] Um pedido ARP é um broadcast
- [ ] Uma resposta ARP é um broadcast
:::

`:::quiz random <tipo>` gera novas tarefas a cada chamada (`count=N` define o número). Tipos: `bin2dec`, `dec2bin`, `cidr2mask`, `hosts`, `netbcast`, `samenet`, `subnet`.

:::quiz random dec2bin
count=2
:::

:::quiz random netbcast
Calcula para o seguinte endereço:
:::

:::quiz random samenet
count=3
:::

:::quiz random subnet
:::

:::evaluate
Verificar secção 4
:::

## Secção 4b: tabela para preencher

`:::quiz table` — uma tabela Markdown normal; as células `{resposta}` tornam-se campos de entrada (separa as variantes com `|`):

:::quiz table
Divide `192.168.42.0/24` em duas sub-redes:
| Sub-rede | Endereço de rede | Endereço de broadcast |
|---|---|---|
| 1 | {192.168.42.0} | {192.168.42.127} |
| 2 | {192.168.42.128} | {192.168.42.255} |
:::

:::evaluate
Verificar tabela
:::

## Secção 5: colorir bits

Para os capítulos de IP e de sub-redes: `[[n|…]]` = parte de rede, `[[e|…]]` = extensão, `[[h|…]]` = parte de anfitrião — no texto corrido e em tabelas:

[[n|11111111.11111111.11111111]].[[e|11]][[h|000000]] = `255.255.255.192`

Para representações com várias linhas, usa-se um bloco `<pre class="bits-block">` em vez de ``` (em blocos de código as cores não seriam apresentadas):

<pre class="bits-block">
antes   (/24):  [[n|NNNNNNNN.NNNNNNNN.NNNNNNNN]].[[h|HHHHHHHH]]
depois  (/26):  [[n|NNNNNNNN.NNNNNNNN.NNNNNNNN]].[[e|EE]][[h|HHHHHH]]
</pre>

## Secção 6: diagrama de sequência

`:::seq` desenha um diagrama com duas linhas de vida. Os números SEQ e ACK, bem como os contadores nas linhas de vida, são calculados a partir das flags e dos dados úteis (`"…"`). `-x` em vez de `->` faz com que um segmento se perca, `seq=…` substitui um número (p. ex., numa retransmissão).

:::seq
Client -> Server: SYN
Server -> Client: SYN, ACK
Client -> Server: ACK
Client -> Server: PSH, ACK "Hello World"
Server -> Client: ACK
Client -x Server: PSH, ACK "Hallo"
Client -> Server: PSH, ACK "Hallo" seq=12
Server -> Client: ACK
Client -> Server: FIN, ACK
Server -> Client: ACK
Server -> Client: FIN, ACK
Client -> Server: ACK
:::

Com `:::quiz seq`, os `?` (antes das flags, ou `seq=?` / `ack=?`) tornam-se campos de entrada; `hide: counters` oculta os contadores:

:::quiz seq
Client -> Server: SYN
Server -> Client: ? SYN, ACK ack=?
Client -> Server: ? ACK ack=?
Client -> Server: PSH, ACK "Hello World"
Server -> Client: ACK ack=?
:::

:::evaluate
Verificar diagrama
:::
