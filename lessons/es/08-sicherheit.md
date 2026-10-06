# Seguridad: cifrado y certificados

:::goal
**Objetivo de aprendizaje:** Puedes explicar los tres objetivos de protección (confidencialidad, integridad y autenticidad), distinguir entre cifrado simétrico y asimétrico, clasificar valores hash y firmas digitales, leer y emitir certificados, configurar HTTPS e interpretar las advertencias de certificado más habituales.
:::

En los capítulos anteriores pudiste leer casi todo en el Tracer:

- **Capítulo 3.3.2:** En la WLAN, cada dispositivo dentro del alcance recibe todos los paquetes de radio.
- **Capítulo 6.1.2:** En HTTP, la solicitud y la página web van en texto plano dentro del paquete.
- **Capítulo 6.3.2:** En SMTP y POP3, el nombre de usuario y la contraseña viajan casi en texto plano por la línea: `AUTH PLAIN` es solo Base64.

Quien escucha en una línea o en la misma WLAN ve, por tanto, contraseñas, notas, mensajes y datos bancarios. Y puede hacer aún más: **modificar** paquetes o **hacerse pasar** por otra persona.

## Tres objetivos de protección

La criptografía debe ayudar contra estos peligros. Se distinguen tres **objetivos de protección**:

| Objetivo de protección | Pregunta | Ejemplo de ataque |
|---|---|---|
| **Confidencialidad** | ¿Solo el destinatario correcto puede leer los datos? | Alguien lee tu contraseña en la WLAN. |
| **Integridad** | ¿Los datos han llegado sin modificar? | Alguien cambia el importe en una transferencia. |
| **Autenticidad** | ¿Los datos proceden realmente del remitente indicado? | Una página web falsa de un banco te pide el PIN. |

En este capítulo conocerás las herramientas con las que se alcanzan estos tres objetivos, y cómo interactúan en **HTTPS**, el símbolo del candado en el navegador.

:::quiz match
Alguien lee tu contraseña en la WLAN -> Confidencialidad
Alguien cambia por el camino el importe de una transferencia -> Integridad
Una página web falsa se hace pasar por tu banco -> Autenticidad
:::

:::evaluate
Comprobar la asignación
:::
