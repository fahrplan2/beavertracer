# Firewall: quem pode entrar, quem pode sair?

:::goal
**Objetivo de aprendizagem:** Consegues explicar como funciona um filtro de pacotes com regras, definir regras tu próprio e colocá-las na ordem correta, distinguir entre descartar e rejeitar, explicar a diferença entre uma firewall sem estado e uma firewall com estado, montar uma DMZ e encontrar erros em regras de firewall.
:::

:::osi 4
:::

:::sim
url=/sims/lesson-9.btsim
:::

A Beaver-Schule tem endereços públicos próprios (`198.51.100.…`): o **Schulserver** é acessível diretamente a partir da Internet — sem NAT, tal como em breve acontecerá em todo o lado com IPv6 (capítulo 7.3). Entre a Internet e o **Schulrouter** encontra-se uma **firewall**, que neste momento ainda deixa passar tudo.

À esquerda vês «a Internet»: um **Internet-PC** e o servidor web `www.beispiel.de`. À direita está a rede da escola, com o **Schulserver** e o **Lehrer-PC**.

## O que vê um atacante?

Quem quer atacar um servidor procura primeiro **portas abertas** — ou seja, serviços que ficam à espera de ligações. A ferramenta para isso chama-se **scanner de portas**; o mais conhecido é o `nmap`.

Muda para o :fa-play: modo de execução, abre o :fa-terminal: **Terminal** no **Internet-PC** e escreve:

```
$ nmap 198.51.100.10
```

O `nmap` tenta estabelecer uma ligação TCP com as 20 portas mais comuns e indica quais estão abertas.

:::quiz multi
Que portas estão abertas no servidor da escola a partir da Internet?
- [x] 22 (SSH, manutenção remota)
- [x] 25 (SMTP)
- [x] 80 (HTTP)
- [x] 110 (POP3)
- [x] 143 (IMAP)
- [ ] 443 (HTTPS)
:::

:::evaluate
Verificar resposta
:::

O site (80) e a receção de e-mails (25) devem estar acessíveis a partir da Internet. Mas a **manutenção remota** (22) e a obtenção de e-mails (110, 143) só são necessárias para a rede da escola. Cada porta aberta é uma possível superfície de ataque: se o serviço tiver uma vulnerabilidade ou uma palavra-passe fraca, um atacante pode explorá-la a partir de qualquer parte do mundo — e os scanners automáticos na Internet tentam precisamente isso 24 horas por dia.

:::tip Ponto-chave
Uma **firewall** controla o tráfego na fronteira entre duas redes e só deixa passar o que é explicitamente permitido. Assim, os serviços que só são necessários internamente ficam invisíveis para a Internet.
:::
