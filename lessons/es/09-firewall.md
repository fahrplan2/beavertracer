# Cortafuegos: ¿quién puede entrar y quién puede salir?

:::goal
**Objetivo de aprendizaje:** Puedes explicar cómo trabaja un filtro de paquetes con reglas, definir reglas por ti mismo y ordenarlas correctamente, distinguir entre descartar y rechazar, explicar la diferencia entre un cortafuegos sin estado y uno con estado, montar una DMZ y encontrar errores en las reglas de un cortafuegos.
:::

:::osi 4
:::

:::sim
url=/sims/lesson-9.btsim
:::

La Beaver-Schule tiene sus propias direcciones públicas (`198.51.100.…`): su **Schulserver** es accesible directamente desde Internet, sin NAT, tal como pronto ocurrirá en todas partes con IPv6 (capítulo 7.3). Entre Internet y el **Schulrouter** hay un **cortafuegos**, que por ahora todavía deja pasar todo.

A la izquierda ves «Internet»: un **Internet-PC** y el servidor web `www.beispiel.de`. A la derecha, la red de la escuela con el **Schulserver** y el **Lehrer-PC**.

## ¿Qué ve un atacante?

Quien quiere atacar un servidor busca primero **puertos abiertos**, es decir, servicios que esperan conexiones. La herramienta para ello se llama **escáner de puertos**; el más conocido es `nmap`.

Cambia al modo de ejecución :fa-play: **Ejecutar**, abre en el **Internet-PC** el :fa-terminal: **Terminal** y escribe:

```
$ nmap 198.51.100.10
```

`nmap` intenta establecer una conexión TCP con los 20 puertos más habituales e informa de cuáles están abiertos.

:::quiz multi
¿Qué puertos del Schulserver están abiertos desde Internet?
- [x] 22 (SSH, mantenimiento remoto)
- [x] 25 (SMTP)
- [x] 80 (HTTP)
- [x] 110 (POP3)
- [x] 143 (IMAP)
- [ ] 443 (HTTPS)
:::

:::evaluate
Comprobar respuesta
:::

La página web (80) y la recepción de correos electrónicos (25) deben ser accesibles desde Internet. Pero el **mantenimiento remoto** (22) y la descarga de correos (110, 143) solo lo necesita la red de la escuela. Cada puerto abierto es una posible superficie de ataque: si el servicio tiene una vulnerabilidad o una contraseña débil, un atacante puede aprovecharla desde cualquier lugar del mundo, y los escáneres automáticos de Internet hacen justamente eso las 24 horas del día.

:::tip Recuerda
Un **cortafuegos** controla el tráfico de datos en el límite entre dos redes y solo deja pasar lo que está permitido de forma expresa. Así, los servicios que solo se necesitan internamente permanecen invisibles para Internet.
:::
