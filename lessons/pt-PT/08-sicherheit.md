# Segurança: cifragem e certificados

:::goal
**Objetivo de aprendizagem:** Consegues explicar os três objetivos de proteção — confidencialidade, integridade e autenticidade —, distinguir cifragem simétrica de assimétrica, classificar valores de hash e assinaturas digitais, ler e emitir certificados, configurar HTTPS e interpretar avisos de certificado típicos.
:::

Nos últimos capítulos, conseguiste ler quase tudo no Tracer:

- **Capítulo 3.3.2:** Na rede Wi-Fi, cada dispositivo ao alcance recebe todos os pacotes de rádio.
- **Capítulo 6.1.2:** No HTTP, o pedido e a página web seguem em texto simples no pacote.
- **Capítulo 6.3.2:** No SMTP e no POP3, o nome de utilizador e a palavra-passe viajam quase em texto simples pela linha — `AUTH PLAIN` é apenas Base64.

Quem escuta numa linha ou na mesma rede Wi-Fi vê, portanto, palavras-passe, notas, mensagens e dados bancários. E pode fazer ainda mais: **alterar** pacotes ou **fazer-se passar** por outra pessoa.

## Três objetivos de proteção

A criptografia deve ajudar contra estes perigos. Distinguem-se três **objetivos de proteção**:

| Objetivo de proteção | Pergunta | Exemplo de um ataque |
|---|---|---|
| **Confidencialidade** | Só o destinatário correto consegue ler os dados? | Alguém lê a tua palavra-passe na rede Wi-Fi. |
| **Integridade** | Os dados chegaram inalterados? | Alguém altera o montante numa transferência. |
| **Autenticidade** | Os dados provêm mesmo do remetente indicado? | Um site de banco falso pede o teu PIN. |

Neste capítulo ficas a conhecer as ferramentas com que se alcançam estes três objetivos — e como atuam em conjunto no **HTTPS**, o símbolo do cadeado no navegador.

:::quiz match
Alguém lê a tua palavra-passe na rede Wi-Fi -> Confidencialidade
Alguém altera pelo caminho o montante de uma transferência -> Integridade
Um site falso faz-se passar pelo teu banco -> Autenticidade
:::

:::evaluate
Verificar associação
:::
