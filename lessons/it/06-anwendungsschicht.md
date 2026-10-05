# Livelli 5–7: Livello di applicazione

:::goal
**Obiettivo di apprendimento:** Sai riconoscere nel tracer i principali protocolli del livello di applicazione (HTTP, DNS, SMTP/POP3/IMAP e DHCP), spiegarne il funzionamento e individuare gli errori tipici.
:::

:::osi 7
:::

:::sim
url=/sims/lesson-6.1.btsim
:::

Nel capitolo 5 hai visto che TCP e UDP consegnano i dati in modo affidabile (o veloce) al programma giusto, tramite le porte. *Che cosa* contengono questi dati lo stabiliscono i protocolli del **livello di applicazione**. Nel modello TCP/IP si tratta di un unico livello; nel modello ISO/OSI corrisponde ai livelli da 5 a 7.

Ognuno di questi protocolli ha il suo compito e la sua porta:

| Protocollo | Compito | Porta | Trasporto |
|---|---|---|---|
| **HTTP** | richiedere pagine web | 80 | TCP |
| **DNS** | tradurre nomi in indirizzi IP | 53 | per lo più UDP |
| **SMTP** | inviare e-mail | 25 | TCP |
| **POP3** / **IMAP** | scaricare e-mail | 110 / 143 | TCP |
| **DHCP** | assegnare automaticamente un indirizzo IP a un dispositivo | 67 / 68 | UDP |

Nel capitolo 1.3 hai ancora aperto una pagina web tramite il suo indirizzo IP. Nella vita di tutti i giorni nessuno digita `192.168.0.20`, e a nessun portatile nuovo l'indirizzo viene inserito a mano. In questo capitolo scoprirai, protocollo dopo protocollo, come tutto questo funziona insieme.
