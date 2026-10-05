# Sicurezza: crittografia e certificati

:::goal
**Obiettivo di apprendimento:** Sai spiegare i tre obiettivi di sicurezza riservatezza, integrità e autenticità, distinguere la crittografia simmetrica da quella asimmetrica, inquadrare i valori hash e le firme digitali, leggere certificati ed emetterne di tuoi, configurare HTTPS e interpretare i tipici avvisi relativi ai certificati.
:::

Nei capitoli precedenti potevi leggere quasi tutto nel Tracer:

- **Capitolo 3.3.2:** Nel WLAN ogni dispositivo nel raggio di copertura riceve tutti i pacchetti radio.
- **Capitolo 6.1.2:** Con HTTP la richiesta e la pagina web viaggiano in chiaro nel pacchetto.
- **Capitolo 6.3.2:** Con SMTP e POP3 nome utente e password passano sulla linea quasi in chiaro: `AUTH PLAIN` è solo Base64.

Chi intercetta una linea o si trova nella stessa WLAN vede quindi password, voti, messaggi e dati bancari. E può fare ancora di più: **modificare** i pacchetti o **spacciarsi** per qualcun altro.

## Tre obiettivi di sicurezza

La crittografia serve a proteggersi da questi pericoli. Si distinguono tre **obiettivi di sicurezza**:

| Obiettivo di sicurezza | Domanda | Esempio di attacco |
|---|---|---|
| **Riservatezza** | Solo il destinatario giusto può leggere i dati? | Qualcuno intercetta la tua password nel WLAN. |
| **Integrità** | I dati sono arrivati senza modifiche? | Qualcuno modifica l'importo di un bonifico. |
| **Autenticità** | I dati provengono davvero dal mittente indicato? | Un falso sito web bancario ti chiede il PIN. |

In questo capitolo conoscerai gli strumenti con cui si raggiungono questi tre obiettivi e vedrai come lavorano insieme in **HTTPS**, il simbolo del lucchetto nel browser.

:::quiz match
Qualcuno intercetta la tua password nel WLAN -> Riservatezza
Qualcuno modifica durante il percorso l'importo di un bonifico -> Integrità
Un sito web falso si spaccia per la tua banca -> Autenticità
:::

:::evaluate
Verifica gli abbinamenti
:::
