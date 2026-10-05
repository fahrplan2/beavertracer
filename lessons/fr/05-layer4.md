# Couche 4 : couche transport

:::goal
**Objectif d'apprentissage :** Tu sais citer les fonctions de la couche transport, représenter le déroulement d'une connexion TCP (établissement, données, fermeture) sous forme de diagramme de séquence, expliquer les ports ainsi que les numéros de séquence et d'acquittement, et justifier quand on utilise UDP plutôt que TCP.
:::

:::osi 4
:::

:::sim
url=/sims/lesson-5.1.btsim
:::

Petit retour sur le chapitre 4 : l'**Internet Protocol** de la couche 3 achemine un paquet jusqu'au bon *ordinateur*, même en passant par de nombreux routeurs. Mais IP ne promet rien de plus :

- Sur un ordinateur, de nombreux programmes tournent en même temps : navigateur, logiciel de messagerie, messagerie instantanée. Auquel d'entre eux un paquet est-il destiné ? Cette information ne figure pas dans l'en-tête IP.
- Si un paquet se perd en chemin, IP ne s'en rend pas compte. Des paquets peuvent aussi arriver en double ou dans le mauvais ordre. On dit qu'IP ne fait que livrer « au mieux » (*best effort*).

C'est la **couche 4**, la couche transport, qui comble ces lacunes. Sur l'espace de travail, tu vois un **Client-PC** et un **Server** : c'est avec eux que tu vas étudier dans ce chapitre les deux protocoles les plus importants de la couche 4 : **TCP** et **UDP**.

:::note
TCP est normalisé depuis 1981 (**RFC 793**, aujourd'hui **RFC 9293**), UDP l'est même depuis 1980 (**RFC 768**).
:::
