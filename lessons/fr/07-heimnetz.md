# Le réseau domestique : routeur et NAT

:::goal
**Objectif d'apprentissage :** tu sais citer les fonctions d'un routeur domestique, configurer un routeur domestique, expliquer comment le NAT permet à de nombreux appareils d'accéder à Internet via une seule adresse publique, ainsi que mettre en place et vérifier une redirection de port.
:::

:::osi 3
:::

:::sim
url=/sims/lesson-7.1.btsim
:::

À la maison, on arrive vite à dix appareils ou plus sur le réseau : téléphones, ordinateurs portables, télévision, console de jeux, enceintes. Tous reçoivent des adresses comme `192.168.178.20`, issues d'une plage **privée** qui n'est pas du tout routée sur Internet (chapitre 4.2.2). Et pourtant, chacun de ces appareils accède à Internet.

C'est un petit boîtier discret qui rend cela possible : le **routeur domestique**. Dans l'espace de travail, tu vois à gauche un réseau domestique avec un PC et une tablette, et à droite « Internet » : les routeurs d'un fournisseur d'accès, un serveur DNS et le serveur web `www.beispiel.de`.

:::note
Les adresses publiques de ce chapitre (`203.0.113.…`, `198.51.100.…`, `192.0.2.…`) sont réservées aux exemples et au matériel pédagogique, tout comme `2001:db8::` en IPv6.
:::
