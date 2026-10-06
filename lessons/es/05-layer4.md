# Capa 4: capa de transporte

:::goal
**Objetivo de aprendizaje:** Puedes nombrar las tareas de la capa de transporte, representar el desarrollo de una conexión TCP (establecimiento, datos, cierre) como diagrama de secuencia, explicar los puertos así como los números de secuencia y de confirmación, y justificar cuándo se usa UDP en lugar de TCP.
:::

:::osi 4
:::

:::sim
url=/sims/lesson-5.1.btsim
:::

Un breve repaso del capítulo 4: el **Internet Protocol** de la capa 3 lleva un paquete al *equipo* correcto, incluso a través de muchos routers. Pero IP no promete nada más:

- En un equipo se ejecutan muchos programas a la vez: navegador, programa de correo, mensajería. ¿Para cuál de ellos está destinado un paquete? Eso no aparece en la cabecera IP.
- Si un paquete se pierde por el camino, IP no se da cuenta. Los paquetes también pueden llegar duplicados o en el orden incorrecto. Se dice que IP solo entrega con el mejor esfuerzo (*best effort*).

La **capa 4**, la capa de transporte, cierra estas lagunas. En el área de trabajo ves un **Client-PC** y un **Server**; con ellos analizarás en este capítulo los dos protocolos más importantes de la capa 4: **TCP** y **UDP**.

:::note
TCP está estandarizado desde 1981 (**RFC 793**, hoy **RFC 9293**) y UDP ya desde 1980 (**RFC 768**).
:::
