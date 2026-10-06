# Tallafocs: qui pot entrar i qui pot sortir?

:::goal
**Objectiu d'aprenentatge:** Saps explicar com treballa un filtre de paquets amb regles, establir regles pel teu compte i posar-les en l'ordre correcte, distingir entre descartar i rebutjar, explicar la diferència entre un tallafocs sense estat i un amb estat, construir una DMZ i trobar errors en les regles d'un tallafocs.
:::

:::osi 4
:::

:::sim
url=/sims/lesson-9.btsim
:::

L'escola Beaver té adreces públiques pròpies (`198.51.100.…`): el seu **Schulserver** és accessible directament des d'Internet, sense NAT, tal com aviat serà arreu amb IPv6 (capítol 7.3). Entre Internet i el **Schulrouter** hi ha un **tallafocs**, que de moment encara ho deixa passar tot.

A l'esquerra veus «Internet»: un **Internet-PC** i el servidor web `www.beispiel.de`. A la dreta, la xarxa de l'escola amb el **Schulserver** i el **Lehrer-PC**.

## Què veu un atacant?

Qui vol atacar un servidor busca primer **ports oberts**, és a dir, serveis que esperen connexions. L'eina per fer-ho s'anomena **escàner de ports**; el més conegut és `nmap`.

Canvia al mode d'execució :fa-play: **Executar**, obre el :fa-terminal: **Terminal** de l'**Internet-PC** i escriu:

```
$ nmap 198.51.100.10
```

`nmap` intenta establir una connexió TCP amb els 20 ports més habituals i informa de quins són oberts.

:::quiz multi
Quins ports del servidor de l'escola són oberts des d'Internet?
- [x] 22 (SSH, manteniment remot)
- [x] 25 (SMTP)
- [x] 80 (HTTP)
- [x] 110 (POP3)
- [x] 143 (IMAP)
- [ ] 443 (HTTPS)
:::

:::evaluate
Comprova la resposta
:::

La pàgina web (80) i la recepció de correus electrònics (25) han de ser accessibles des d'Internet. Però el **manteniment remot** (22) i la recollida del correu (110, 143) només els necessita la xarxa de l'escola. Cada port obert és una possible superfície d'atac: si el servei té una vulnerabilitat o una contrasenya feble, un atacant la pot aprofitar des de qualsevol lloc del món, i els escàners automàtics d'Internet fan exactament això les vint-i-quatre hores del dia.

:::tip Idea clau
Un **tallafocs** controla el trànsit a la frontera entre dues xarxes i només deixa passar el que està permès expressament. Així, els serveis que només calen internament resten invisibles per a Internet.
:::
