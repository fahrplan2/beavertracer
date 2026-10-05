# Couches 5 à 7 : couche application

:::goal
**Objectif d'apprentissage :** Tu sais reconnaître dans le traceur les principaux protocoles de la couche application — HTTP, DNS, SMTP/POP3/IMAP et DHCP —, expliquer leur fonctionnement et trouver les erreurs typiques.
:::

:::osi 7
:::

:::sim
url=/sims/lesson-6.1.btsim
:::

Au chapitre 5, tu as vu que TCP et UDP livrent les données de manière fiable (ou rapide) au bon programme — grâce aux ports. *Ce que* contiennent ces données est défini par les protocoles de la **couche application**. Dans le modèle TCP/IP, il s'agit d'une seule couche ; dans le modèle ISO/OSI, elle correspond aux couches 5 à 7.

Chacun de ces protocoles a sa propre mission — et son propre port :

| Protocole | Mission | Port | Transport |
|---|---|---|---|
| **HTTP** | récupérer des pages web | 80 | TCP |
| **DNS** | traduire des noms en adresses IP | 53 | généralement UDP |
| **SMTP** | envoyer des e-mails | 25 | TCP |
| **POP3** / **IMAP** | relever des e-mails | 110 / 143 | TCP |
| **DHCP** | attribuer automatiquement une adresse IP à un appareil | 67 / 68 | UDP |

Au chapitre 1.3, tu as encore ouvert une page web via son adresse IP. Au quotidien, personne ne tape `192.168.0.20` — et aucun nouvel ordinateur portable ne reçoit son adresse saisie à la main. Comment tout cela fonctionne ensemble, tu le découvriras dans ce chapitre, protocole par protocole.
