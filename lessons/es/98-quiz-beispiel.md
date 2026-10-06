# Zona de pruebas — Markdown y cuestionarios (página de prueba)

[[toc]]

Esta página sirve para probar la sintaxis Markdown y los tipos de preguntas interactivas.

---

## Sintaxis Markdown

### Formato de texto

**Negrita**, *cursiva*, ~~tachado~~, `Inline-Code`, y **_combinado_**.

Párrafo normal con un [enlace a otra página](01-einfuehrung.html) y un [enlace externo](https://www.beavertracer.eu).

### Títulos

Los niveles H2–H4 aparecen automáticamente en el índice de contenidos (TOC).

#### Esto es H4 — no aparece en el TOC

### Listas

Sin orden:

- Ethernet
- IP
- TCP
  - HTTP
  - SMTP

Con orden:

1. Modo de edición: construir la topología
2. Modo de ejecución: iniciar la simulación
3. Modo de rastreo: analizar paquetes

### Tabla

| Protocolo | Capa | Puerto |
|-----------|---------|------|
| HTTP      | 7       | 80   |
| HTTPS     | 7       | 443  |
| DNS       | 7       | 53   |
| TCP       | 4       | —    |

### Código

En línea: `ping 192.168.0.1`

Bloque:

```
$ ping 192.168.0.2
PING 192.168.0.2: 56 data bytes
64 bytes from 192.168.0.2: icmp_seq=0 ttl=64 time=0.4 ms
```

### Callouts

:::note
Este es un callout **note** — para avisos neutrales e información complementaria.
:::

:::tip
Este es un callout **tip** — para consejos útiles y recomendaciones.
:::

:::warning
Este es un callout **warning** — para advertencias que requieren atención.
:::

:::danger
Este es un callout **danger** — para fuentes de error críticas.
:::

:::draft
:::

### Iconos

Font Awesome Solid: :fa-play: :fa-stop: :fa-desktop: :fa-shield-halved: :fa-wifi:

Font Awesome Regular: :far-file: :far-circle:

Símbolos de dispositivos: :router: :switch:

### Simulación integrada

:::sim
url=/sims/demo.btsim
:::

### Tarea con comprobación de comportamiento

:::task
title: Conectar PC 1 y PC 2
Comprueba si PC 1 (id 9) tiene una IP en la red 192.168.0.0/24 y puede alcanzar a PC 2 (id 11).
check: ip(9, "192.168.0.0/24")
check: pingOk(9, 11)
:::

---

## Modelo de referencia OSI: esquema de colores

Ejemplo de una tabla resaltada en los colores del arcoíris (capa 1 abajo, como en la pila) y de un «semáforo» en el margen con el texto fluyendo a su alrededor.

### Tabla de colores

<table class="osi-table">
<thead>
<tr><th>Capa</th><th>Nombre</th><th>Protocolos de ejemplo</th></tr>
</thead>
<tbody>
<tr class="osi-l7"><td>7</td><td>Aplicación</td><td>HTTP, DNS, SMTP</td></tr>
<tr class="osi-l6"><td>6</td><td>Presentación</td><td>TLS, JPEG, ASCII</td></tr>
<tr class="osi-l5"><td>5</td><td>Sesión</td><td>RPC, NetBIOS</td></tr>
<tr class="osi-l4"><td>4</td><td>Transporte</td><td>TCP, UDP</td></tr>
<tr class="osi-l3"><td>3</td><td>Red</td><td>IP, ICMP</td></tr>
<tr class="osi-l2"><td>2</td><td>Enlace de datos</td><td>Ethernet, ARP</td></tr>
<tr class="osi-l1"><td>1</td><td>Física</td><td>Cobre, fibra óptica, WLAN</td></tr>
</tbody>
</table>

### Semáforo con texto envolvente

El semáforo se genera con `:::osi N`, donde `N` es la capa que se desea resaltar (aquí la capa 3). Flota en el margen y el texto siguiente fluye automáticamente a su alrededor.

:::osi 3
:::

Lorem ipsum dolor sit amet, consetetur sadipscing elitr, sed diam nonumy eirmod tempor invidunt ut labore et dolore magna aliquyam erat, sed diam voluptua. At vero eos et accusam et justo duo dolores et ea rebum. Stet clita kasd gubergren, no sea takimata sanctus est Lorem ipsum dolor sit amet.

Lorem ipsum dolor sit amet, consetetur sadipscing elitr, sed diam nonumy eirmod tempor invidunt ut labore et dolore magna aliquyam erat, sed diam voluptua. At vero eos et accusam et justo duo dolores et ea rebum, por lo que este apartado pertenece, por su contenido, a la capa de red (Layer 3) — por eso precisamente esta casilla del semáforo está en color y todas las demás permanecen grises.

---

## Apartado 1: conceptos básicos

:::quiz short
¿Cuál es la notación CIDR de la máscara de subred 255.255.255.0?
= /24
= 24
:::

:::quiz mc
¿Cuál de las siguientes direcciones es la dirección de red de 192.168.1.42/24?
- [ ] 192.168.1.42
- [x] 192.168.1.0
- [ ] 192.168.1.255
- [ ] 192.168.0.0
:::

:::quiz fill
La dirección de red se obtiene mediante una operación {AND} bit a bit entre la dirección IP y la {máscara de subred}. La dirección más alta de la subred es la dirección de {broadcast}.
:::

:::evaluate
Comprobar apartado 1
:::

---

## Apartado 2: emparejar — protocolos y sus funciones

:::quiz match
ARP -> Averigua la dirección MAC correspondiente a una dirección IP
DNS -> Resuelve nombres de host en direcciones IP
DHCP -> Asigna direcciones IP automáticamente a los clientes
ICMP -> Lo utilizan ping y traceroute
:::

:::evaluate
Comprobar apartado 2
:::

---

## Apartado 3: subnetting

:::quiz short
¿Cuántas direcciones de host utilizables tiene una subred /30?
= 2
:::

:::quiz mc
¿Para qué se utiliza normalmente una subred /30?
- [ ] Para redes de oficina grandes con muchos dispositivos
- [ ] Como rango de direcciones para pools DHCP
- [x] Como red de enlace entre dos routers
- [ ] Para puntos de acceso WLAN
:::

:::quiz fill
Una subred /25 tiene {128} direcciones, de las cuales {126} se pueden utilizar para hosts.
:::

:::quiz match
/24 -> 254 direcciones de host utilizables
/25 -> 126 direcciones de host utilizables
/28 -> 14 direcciones de host utilizables
/30 -> 2 direcciones de host utilizables
:::

:::evaluate
Comprobar apartado 3
:::

## Apartado 4: selección múltiple y tareas aleatorias

Con `:::quiz multi` puede haber cualquier número de respuestas correctas — cada afirmación se evalúa por separado:

:::quiz multi
¿Qué afirmaciones sobre ARP son correctas?
- [x] ARP averigua la dirección MAC correspondiente a una dirección IP
- [ ] ARP averigua la dirección IP correspondiente a un nombre
- [x] Una solicitud ARP es un broadcast
- [ ] Una respuesta ARP es un broadcast
:::

`:::quiz random <tipo>` genera tareas nuevas en cada acceso (`count=N` fija la cantidad). Tipos: `bin2dec`, `dec2bin`, `cidr2mask`, `hosts`, `netbcast`, `samenet`, `subnet`.

:::quiz random dec2bin
count=2
:::

:::quiz random netbcast
Calcula para la siguiente dirección:
:::

:::quiz random samenet
count=3
:::

:::quiz random subnet
:::

:::evaluate
Comprobar apartado 4
:::

## Apartado 4b: tabla para completar

`:::quiz table` — una tabla Markdown normal; las celdas `{respuesta}` se convierten en campos de entrada (separa las variantes con `|`):

:::quiz table
Divide `192.168.42.0/24` en dos subredes:
| Subred | Dirección de red | Dirección de broadcast |
|---|---|---|
| 1 | {192.168.42.0} | {192.168.42.127} |
| 2 | {192.168.42.128} | {192.168.42.255} |
:::

:::evaluate
Comprobar tabla
:::

## Apartado 5: colorear bits

Para los capítulos de IP y subnetting: `[[n|…]]` = parte de red, `[[e|…]]` = extensión, `[[h|…]]` = parte de host — en el texto corrido y en tablas:

[[n|11111111.11111111.11111111]].[[e|11]][[h|000000]] = `255.255.255.192`

Para representaciones de varias líneas, usa un bloque `<pre class="bits-block">` en lugar de ``` (en los bloques de código los colores no se mostrarían):

<pre class="bits-block">
vorher  (/24):  [[n|NNNNNNNN.NNNNNNNN.NNNNNNNN]].[[h|HHHHHHHH]]
nachher (/26):  [[n|NNNNNNNN.NNNNNNNN.NNNNNNNN]].[[e|EE]][[h|HHHHHH]]
</pre>

## Apartado 6: diagrama de secuencia

`:::seq` dibuja un diagrama con dos líneas de vida. Los números SEQ y ACK, así como los contadores en las líneas de vida, se calculan a partir de los flags y de los datos útiles (`"…"`). `-x` en lugar de `->` hace que se pierda un segmento, `seq=…` sobrescribe un número (p. ej., en una retransmisión).

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

Con `:::quiz seq`, los `?` (antes de los flags, o `seq=?` / `ack=?`) se convierten en campos de entrada; `hide: counters` oculta los contadores:

:::quiz seq
Client -> Server: SYN
Server -> Client: ? SYN, ACK ack=?
Client -> Server: ? ACK ack=?
Client -> Server: PSH, ACK "Hello World"
Server -> Client: ACK ack=?
:::

:::evaluate
Comprobar diagrama
:::
