# La red doméstica: router y NAT

:::goal
**Objetivo de aprendizaje:** Puedes nombrar las funciones de un router doméstico, configurar un router doméstico, explicar cómo NAT conecta muchos dispositivos a internet mediante una única dirección pública, y configurar y comprobar un reenvío de puertos.
:::

:::osi 3
:::

:::sim
url=/sims/lesson-7.1.btsim
:::

En casa enseguida hay diez o más dispositivos en la red: móviles, portátiles, televisores, consolas de videojuegos, altavoces. Todos reciben direcciones como `192.168.178.20`, de un rango **privado** que en internet no se reenvía en absoluto (capítulo 4.2.2). Y aun así, cada uno de estos dispositivos llega a internet.

Lo hace posible una cajita discreta: el **router doméstico**. En el área de trabajo ves a la izquierda una red doméstica con un PC y una tableta, y a la derecha «internet»: los routers de un proveedor, un servidor DNS y el servidor web `www.beispiel.de`.

:::note
Las direcciones públicas de este capítulo (`203.0.113.…`, `198.51.100.…`, `192.0.2.…`) están reservadas para ejemplos y material didáctico, igual que `2001:db8::` en IPv6.
:::
