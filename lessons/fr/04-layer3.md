# Couche 3 : routeurs, adresses IP et découpage en sous-réseaux

:::goal
**Objectif d'apprentissage :** Tu sais lire des adresses IP en binaire, calculer des adresses réseau et des adresses de diffusion, diviser un réseau en sous-réseaux de même taille et relier des réseaux entre eux par des routeurs à l'aide de tables de routage.
:::

:::osi 3
:::

:::sim
url=/sims/lesson-4.1.btsim
:::

Jusqu'ici, tous les appareils se trouvaient dans *un seul* réseau local, reliés par des switchs et des points d'accès. Mais Internet se compose de millions de réseaux de ce type : ton réseau domestique, le réseau de l'école, le réseau de ton opérateur mobile, les réseaux des grands centres de données.

Comment un paquet trouve-t-il son chemin d'un réseau à un autre ? C'est le rôle de la **couche 3**, la couche réseau. Elle s'appuie sur l'**Internet Protocol (IP)**, sur les adresses IP et sur les appareils qui relient les réseaux entre eux : les **routeurs**.

:::note
IP est défini depuis 1981 dans une norme, la **RFC 791**. La version dont il est principalement question dans ce chapitre s'appelle **IPv4**. Tu découvriras la version plus récente, **IPv6**, à la fin du chapitre.
:::
