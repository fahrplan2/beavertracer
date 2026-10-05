# Bac à sable — Markdown & quiz (page de test)

[[toc]]

Cette page sert à tester la syntaxe Markdown et les types de questions interactives.

---

## Syntaxe Markdown

### Mise en forme du texte

**Gras**, *italique*, ~~barré~~, `code en ligne`, et **_combiné_**.

Paragraphe normal avec un [lien vers une autre page](01-einfuehrung.html) et un [lien externe](https://www.beavertracer.eu).

### Titres

Les niveaux H2 à H4 apparaissent automatiquement dans la table des matières (TOC).

#### Ceci est un H4 — il n'apparaît pas dans la TOC

### Listes

Non ordonnée :

- Ethernet
- IP
- TCP
  - HTTP
  - SMTP

Ordonnée :

1. Mode Édition : construire la topologie
2. Mode Exécution : démarrer la simulation
3. Mode Trace : analyser les paquets

### Tableau

| Protocole | Couche | Port |
|-----------|---------|------|
| HTTP      | 7       | 80   |
| HTTPS     | 7       | 443  |
| DNS       | 7       | 53   |
| TCP       | 4       | —    |

### Code

En ligne : `ping 192.168.0.1`

Bloc :

```
$ ping 192.168.0.2
PING 192.168.0.2: 56 data bytes
64 bytes from 192.168.0.2: icmp_seq=0 ttl=64 time=0.4 ms
```

### Encadrés

:::note
Ceci est un encadré **note** — pour les remarques neutres et les informations complémentaires.
:::

:::tip
Ceci est un encadré **tip** — pour les astuces utiles et les recommandations.
:::

:::warning
Ceci est un encadré **warning** — pour les avertissements qui demandent de l'attention.
:::

:::danger
Ceci est un encadré **danger** — pour les sources d'erreur critiques.
:::

:::draft
:::

### Icônes

Font Awesome Solid : :fa-play: :fa-stop: :fa-desktop: :fa-shield-halved: :fa-wifi:

Font Awesome Regular : :far-file: :far-circle:

Icônes d'appareils : :router: :switch:

### Simulation intégrée

:::sim
url=/sims/demo.btsim
:::

### Tâche avec vérification du comportement

:::task
title: Connecter PC 1 et PC 2
Vérifie si PC 1 (id 9) possède une adresse IP dans le réseau 192.168.0.0/24 et peut joindre PC 2 (id 11).
check: ip(9, "192.168.0.0/24")
check: pingOk(9, 11)
:::

---

## Modèle de référence OSI : code couleur

Exemple d'un tableau mis en évidence aux couleurs de l'arc-en-ciel (couche 1 en bas, comme dans la pile) ainsi que d'un « feu tricolore » en marge avec habillage du texte.

### Tableau en couleurs

<table class="osi-table">
<thead>
<tr><th>Couche</th><th>Nom</th><th>Exemples de protocoles</th></tr>
</thead>
<tbody>
<tr class="osi-l7"><td>7</td><td>Application</td><td>HTTP, DNS, SMTP</td></tr>
<tr class="osi-l6"><td>6</td><td>Présentation</td><td>TLS, JPEG, ASCII</td></tr>
<tr class="osi-l5"><td>5</td><td>Session</td><td>RPC, NetBIOS</td></tr>
<tr class="osi-l4"><td>4</td><td>Transport</td><td>TCP, UDP</td></tr>
<tr class="osi-l3"><td>3</td><td>Réseau</td><td>IP, ICMP</td></tr>
<tr class="osi-l2"><td>2</td><td>Liaison de données</td><td>Ethernet, ARP</td></tr>
<tr class="osi-l1"><td>1</td><td>Physique</td><td>Cuivre, fibre optique, Wi-Fi</td></tr>
</tbody>
</table>

### Feu tricolore avec habillage du texte

Le feu tricolore est créé avec `:::osi N`, où `N` est la couche à mettre en évidence (ici la couche 3). Il flotte en marge, et le texte qui suit s'écoule automatiquement autour de lui.

:::osi 3
:::

Lorem ipsum dolor sit amet, consetetur sadipscing elitr, sed diam nonumy eirmod tempor invidunt ut labore et dolore magna aliquyam erat, sed diam voluptua. At vero eos et accusam et justo duo dolores et ea rebum. Stet clita kasd gubergren, no sea takimata sanctus est Lorem ipsum dolor sit amet.

Lorem ipsum dolor sit amet, consetetur sadipscing elitr, sed diam nonumy eirmod tempor invidunt ut labore et dolore magna aliquyam erat, sed diam voluptua. At vero eos et accusam et justo duo dolores et ea rebum, ce qui fait que le contenu de cette section relève de la couche réseau (couche 3) — c'est pourquoi c'est précisément cette case du feu tricolore qui est colorée, toutes les autres restent grises.

---

## Section 1 : notions de base

:::quiz short
Quelle est la notation CIDR du masque de sous-réseau 255.255.255.0 ?
= /24
= 24
:::

:::quiz mc
Parmi les adresses suivantes, laquelle est l'adresse réseau de 192.168.1.42/24 ?
- [ ] 192.168.1.42
- [x] 192.168.1.0
- [ ] 192.168.1.255
- [ ] 192.168.0.0
:::

:::quiz fill
On obtient l'adresse réseau par une opération {AND} bit à bit entre l'adresse IP et le {masque de sous-réseau}. L'adresse la plus élevée du sous-réseau est l'adresse de {diffusion}.
:::

:::evaluate
Vérifier la section 1
:::

---

## Section 2 : association — les protocoles et leurs rôles

:::quiz match
ARP -> Détermine l'adresse MAC correspondant à une adresse IP
DNS -> Résout les noms d'hôtes en adresses IP
DHCP -> Attribue automatiquement des adresses IP aux clients
ICMP -> Est utilisé par ping et traceroute
:::

:::evaluate
Vérifier la section 2
:::

---

## Section 3 : découpage en sous-réseaux

:::quiz short
Combien d'adresses d'hôtes utilisables un sous-réseau /30 possède-t-il ?
= 2
:::

:::quiz mc
À quoi sert typiquement un sous-réseau /30 ?
- [ ] Aux grands réseaux de bureau comportant de nombreux appareils
- [ ] De plage d'adresses pour les pools DHCP
- [x] De réseau de liaison entre deux routeurs
- [ ] Aux points d'accès Wi-Fi
:::

:::quiz fill
Un sous-réseau /25 compte {128} adresses, dont {126} sont utilisables pour les hôtes.
:::

:::quiz match
/24 -> 254 adresses d'hôtes utilisables
/25 -> 126 adresses d'hôtes utilisables
/28 -> 14 adresses d'hôtes utilisables
/30 -> 2 adresses d'hôtes utilisables
:::

:::evaluate
Vérifier la section 3
:::

## Section 4 : choix multiple et exercices aléatoires

Avec `:::quiz multi`, un nombre quelconque de réponses peut être correct — chaque affirmation est évaluée individuellement :

:::quiz multi
Quelles affirmations sur ARP sont exactes ?
- [x] ARP détermine l'adresse MAC correspondant à une adresse IP
- [ ] ARP détermine l'adresse IP correspondant à un nom
- [x] Une requête ARP est une diffusion (broadcast)
- [ ] Une réponse ARP est une diffusion (broadcast)
:::

`:::quiz random <typ>` génère de nouveaux exercices à chaque affichage (`count=N` fixe leur nombre). Types : `bin2dec`, `dec2bin`, `cidr2mask`, `hosts`, `netbcast`, `samenet`, `subnet`.

:::quiz random dec2bin
count=2
:::

:::quiz random netbcast
Calcule pour l'adresse suivante :
:::

:::quiz random samenet
count=3
:::

:::quiz random subnet
:::

:::evaluate
Vérifier la section 4
:::

## Section 4b : tableau à compléter

`:::quiz table` — un tableau Markdown normal ; les cellules `{Antwort}` deviennent des champs de saisie (séparer les variantes par `|`) :

:::quiz table
Divise `192.168.42.0/24` en deux sous-réseaux :
| Sous-réseau | Adresse réseau | Adresse de diffusion |
|---|---|---|
| 1 | {192.168.42.0} | {192.168.42.127} |
| 2 | {192.168.42.128} | {192.168.42.255} |
:::

:::evaluate
Vérifier le tableau
:::

## Section 5 : colorer les bits

Pour les chapitres sur l'IP et le découpage en sous-réseaux : `[[n|…]]` = partie réseau, `[[e|…]]` = extension, `[[h|…]]` = partie hôte — dans le texte courant comme dans les tableaux :

[[n|11111111.11111111.11111111]].[[e|11]][[h|000000]] = `255.255.255.192`

Pour les représentations sur plusieurs lignes, utilise un bloc `<pre class="bits-block">` au lieu de ``` (dans les blocs de code, les couleurs ne seraient pas affichées) :

<pre class="bits-block">
avant (/24):  [[n|NNNNNNNN.NNNNNNNN.NNNNNNNN]].[[h|HHHHHHHH]]
après (/26):  [[n|NNNNNNNN.NNNNNNNN.NNNNNNNN]].[[e|EE]][[h|HHHHHH]]
</pre>

## Section 6 : diagramme de séquence

`:::seq` dessine un diagramme avec deux lignes de vie. Les numéros SEQ et ACK ainsi que les compteurs sur les lignes de vie sont calculés à partir des flags et des données utiles (`"…"`). `-x` au lieu de `->` fait perdre un segment, `seq=…` remplace un numéro (par exemple lors d'une retransmission).

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

Avec `:::quiz seq`, les `?` (devant les flags, ou `seq=?` / `ack=?`) deviennent des champs de saisie ; `hide: counters` masque les compteurs :

:::quiz seq
Client -> Server: SYN
Server -> Client: ? SYN, ACK ack=?
Client -> Server: ? ACK ack=?
Client -> Server: PSH, ACK "Hello World"
Server -> Client: ACK ack=?
:::

:::evaluate
Vérifier le diagramme
:::
