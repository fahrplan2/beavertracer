# Sécurité : chiffrement et certificats

:::goal
**Objectif d'apprentissage :** Tu sais expliquer les trois objectifs de sécurité que sont la confidentialité, l'intégrité et l'authenticité, distinguer le chiffrement symétrique du chiffrement asymétrique, situer les empreintes (valeurs de hachage) et les signatures numériques, lire et émettre toi-même des certificats, mettre en place HTTPS et interpréter les avertissements de certificat les plus courants.
:::

Dans les derniers chapitres, tu as pu lire presque tout dans le Tracer :

- **Chapitre 3.3.2 :** En WLAN, chaque appareil à portée reçoit tous les paquets radio.
- **Chapitre 6.1.2 :** Avec HTTP, la requête et la page web figurent en clair dans le paquet.
- **Chapitre 6.3.2 :** Avec SMTP et POP3, le nom d'utilisateur et le mot de passe circulent presque en clair sur la ligne : `AUTH PLAIN` n'est que du Base64.

Quiconque écoute sur une ligne ou dans le même WLAN voit donc les mots de passe, les notes, les messages et les données bancaires. Et il peut faire encore plus : **modifier** des paquets ou **se faire passer** pour quelqu'un d'autre.

## Trois objectifs de sécurité

La cryptographie doit aider à se protéger contre ces dangers. On distingue trois **objectifs de sécurité** :

| Objectif de sécurité | Question | Exemple d'attaque |
|---|---|---|
| **Confidentialité** | Seul le bon destinataire peut-il lire les données ? | Quelqu'un intercepte ton mot de passe dans le WLAN. |
| **Intégrité** | Les données sont-elles arrivées sans modification ? | Quelqu'un modifie le montant d'un virement. |
| **Authenticité** | Les données proviennent-elles vraiment de l'expéditeur indiqué ? | Une fausse page web de banque te demande ton code PIN. |

Dans ce chapitre, tu découvres les outils qui permettent d'atteindre ces trois objectifs, et comment ils se combinent dans **HTTPS**, le symbole du cadenas dans le navigateur.

:::quiz match
Quelqu'un intercepte ton mot de passe dans le WLAN -> Confidentialité
Quelqu'un modifie en cours de route le montant d'un virement -> Intégrité
Une fausse page web se fait passer pour ta banque -> Authenticité
:::

:::evaluate
Vérifier les associations
:::
