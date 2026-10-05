# Pare-feu : qui peut entrer, qui peut sortir ?

:::goal
**Objectif d'apprentissage :** Tu sais expliquer comment un filtre de paquets fonctionne avec des règles, établir toi-même des règles et les mettre dans le bon ordre, distinguer l'abandon et le rejet, expliquer la différence entre un pare-feu sans état et un pare-feu avec état, mettre en place une DMZ et trouver des erreurs dans des règles de pare-feu.
:::

:::osi 4
:::

:::sim
url=/sims/lesson-9.btsim
:::

L'école Beaver possède ses propres adresses publiques (`198.51.100.…`) : son **Schulserver** est directement accessible depuis Internet, sans NAT, comme ce sera bientôt le cas partout avec IPv6 (chapitre 7.3). Entre Internet et le **Schulrouter** se trouve un pare-feu (**Firewall**), qui pour l'instant laisse encore tout passer.

À gauche, tu vois « Internet » : un **Internet-PC** et le serveur web `www.beispiel.de`. À droite, le réseau de l'école avec le **Schulserver** et le **Lehrer-PC**.

## Que voit un attaquant ?

Quiconque veut attaquer un serveur commence par chercher des **ports ouverts**, c'est-à-dire des services qui attendent des connexions. L'outil pour cela s'appelle un **scanner de ports** ; le plus connu est `nmap`.

Clique sur :fa-play: **Exécuter** pour passer en mode Exécution, ouvre le :fa-terminal: **Terminal** sur l'**Internet-PC** et saisis :

```
$ nmap 198.51.100.10
```

`nmap` essaie d'établir une connexion TCP vers les 20 ports les plus courants et indique lesquels sont ouverts.

:::quiz multi
Quels ports du Schulserver sont ouverts depuis Internet ?
- [x] 22 (SSH, télémaintenance)
- [x] 25 (SMTP)
- [x] 80 (HTTP)
- [x] 110 (POP3)
- [x] 143 (IMAP)
- [ ] 443 (HTTPS)
:::

:::evaluate
Vérifier la réponse
:::

Le site web (80) et la réception des e-mails (25) doivent être accessibles depuis Internet. Mais la **télémaintenance** (22) et la récupération des e-mails (110, 143) ne concernent que le réseau de l'école. Chaque port ouvert est une surface d'attaque potentielle : si le service présente une faille de sécurité ou un mot de passe faible, un attaquant peut l'exploiter depuis n'importe où dans le monde — et des scanners automatiques sur Internet essaient justement de le faire 24 heures sur 24.

:::tip À retenir
Un **pare-feu** contrôle le trafic de données à la frontière entre deux réseaux et ne laisse passer que ce qui est explicitement autorisé. Ainsi, les services qui ne sont utilisés qu'en interne restent invisibles depuis Internet.
:::
