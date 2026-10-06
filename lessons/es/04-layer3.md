# Capa 3: routers, direcciones IP y subnetting

:::goal
**Objetivo de aprendizaje:** Puedes leer direcciones IP en binario, calcular direcciones de red y de broadcast, dividir una red en subredes del mismo tamaño y conectar redes mediante routers con tablas de enrutamiento.
:::

:::osi 3
:::

:::sim
url=/sims/lesson-4.1.btsim
:::

Hasta ahora, todos los dispositivos estaban en *una* única red local, conectados mediante switches y puntos de acceso. Pero internet se compone de millones de redes como esas: tu red doméstica, la red del colegio, la red de tu proveedor de telefonía móvil, las redes de los grandes centros de datos.

¿Cómo encuentra un paquete el camino de una red a otra? De eso se ocupa la **capa 3**, la capa de red, con el **Internet Protocol (IP)**, las direcciones IP y los dispositivos que conectan redes entre sí: los **routers**.

:::note
IP está definido desde 1981 en un estándar, el **RFC 791**. La versión de la que trata principalmente este capítulo se llama **IPv4**. La versión más reciente, **IPv6**, la conocerás al final del capítulo.
:::
