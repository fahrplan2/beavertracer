# Capas 5–7: capa de aplicación

:::goal
**Objetivo de aprendizaje:** Puedes reconocer en el Tracer los protocolos más importantes de la capa de aplicación — HTTP, DNS, SMTP/POP3/IMAP y DHCP —, explicar su funcionamiento y encontrar errores típicos.
:::

:::osi 7
:::

:::sim
url=/sims/lesson-6.1.btsim
:::

En el capítulo 5 viste que TCP y UDP entregan los datos de forma fiable (o rápida) al programa correcto, a través de los puertos. *Qué* contienen esos datos lo determinan los protocolos de la **capa de aplicación**. En el modelo TCP/IP es una sola capa; en el modelo ISO/OSI corresponde a las capas 5 a 7.

Cada uno de estos protocolos tiene su propia función — y su propio puerto:

| Protocolo | Función | Puerto | Transporte |
|---|---|---|---|
| **HTTP** | obtener páginas web | 80 | TCP |
| **DNS** | traducir nombres a direcciones IP | 53 | normalmente UDP |
| **SMTP** | enviar correos electrónicos | 25 | TCP |
| **POP3** / **IMAP** | recoger correos electrónicos | 110 / 143 | TCP |
| **DHCP** | asignar automáticamente una dirección IP a un dispositivo | 67 / 68 | UDP |

En el capítulo 1.3 todavía accediste a una página web mediante su dirección IP. En la vida cotidiana nadie escribe `192.168.0.20`, y a ningún portátil nuevo se le introduce la dirección a mano. Cómo encaja todo esto lo descubrirás en este capítulo, protocolo por protocolo.
