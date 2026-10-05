# Firewall: chi può entrare, chi può uscire?

:::goal
**Obiettivo di apprendimento:** Sai spiegare come un filtro di pacchetti lavora con delle regole, definire tu stesso delle regole e metterle nell'ordine corretto, distinguere tra scartare e rifiutare, spiegare la differenza tra firewall senza stato (stateless) e con stato (stateful), realizzare una DMZ e individuare errori nelle regole del firewall.
:::

:::osi 4
:::

:::sim
url=/sims/lesson-9.btsim
:::

La Beaver-Schule ha propri indirizzi pubblici (`198.51.100.…`): il suo **Schulserver** è raggiungibile direttamente da Internet, senza NAT, come presto accadrà ovunque con IPv6 (capitolo 7.3). Tra Internet e lo **Schulrouter** si trova un **firewall**, che però al momento lascia ancora passare tutto.

A sinistra vedi «Internet»: un **Internet-PC** e il server web `www.beispiel.de`. A destra c'è la rete scolastica con lo **Schulserver** e il **Lehrer-PC**.

## Che cosa vede un aggressore?

Chi vuole attaccare un server cerca prima di tutto le **porte aperte**, cioè i servizi in attesa di connessioni. Lo strumento per farlo si chiama **port scanner**; il più famoso è `nmap`.

Passa alla Modalità di esecuzione con :fa-play: **Esegui**, apri il :fa-terminal: **Terminale** sull'**Internet-PC** e digita:

```
$ nmap 198.51.100.10
```

`nmap` prova a stabilire una connessione TCP verso le 20 porte più comuni e segnala quali sono aperte.

:::quiz multi
Quali porte dello Schulserver sono aperte se viste da Internet?
- [x] 22 (SSH, manutenzione remota)
- [x] 25 (SMTP)
- [x] 80 (HTTP)
- [x] 110 (POP3)
- [x] 143 (IMAP)
- [ ] 443 (HTTPS)
:::

:::evaluate
Controlla risposta
:::

Il sito web (80) e la ricezione delle e-mail (25) devono essere raggiungibili da Internet. Ma la **manutenzione remota** (22) e il ritiro della posta (110, 143) servono solo alla rete scolastica. Ogni porta aperta è una possibile superficie d'attacco: se il servizio ha una vulnerabilità o una password debole, un aggressore può sfruttarla da qualsiasi parte del mondo, e gli scanner automatici in Internet ci provano proprio così, 24 ore su 24.

:::tip Punto chiave
Un **firewall** controlla il traffico dati al confine tra due reti e lascia passare solo ciò che è esplicitamente consentito. In questo modo i servizi che servono solo internamente restano invisibili da Internet.
:::
