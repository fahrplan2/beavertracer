# Sieć domowa: router i NAT

:::goal
**Cel lekcji:** Potrafisz wymienić zadania routera domowego, skonfigurować router domowy, wyjaśnić, jak NAT umożliwia wielu urządzeniom dostęp do internetu przez jeden adres publiczny, a także skonfigurować i sprawdzić przekierowanie portów.
:::

:::osi 3
:::

:::sim
url=/sims/lesson-7.1.btsim
:::

W domu w sieci szybko pojawia się dziesięć lub więcej urządzeń: telefony, laptopy, telewizor, konsola do gier, głośniki. Wszystkie dostają adresy takie jak `192.168.178.20` — z **prywatnej** puli, która w internecie w ogóle nie jest przekazywana dalej (rozdział 4.2.2). A mimo to każde z tych urządzeń łączy się z internetem.

Umożliwia to niepozorne pudełko: **router domowy**. Na obszarze roboczym po lewej widzisz sieć domową z komputerem PC i tabletem, a po prawej „internet" — routery dostawcy usług internetowych, serwer DNS i serwer WWW `www.beispiel.de`.

:::note
Adresy publiczne używane w tym rozdziale (`203.0.113.…`, `198.51.100.…`, `192.0.2.…`) są zarezerwowane na potrzeby przykładów i materiałów dydaktycznych — tak samo jak `2001:db8::` w IPv6.
:::
