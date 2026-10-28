# Sicherheit: Verschlüsselung un Zertifikate

:::goal
**Lernziel:** Du kannst die drei Schutzziele Vertraulichkeit, Integrität un Authentizität erkläre, symmetrische un asymmetrische Verschlüsselung unnerscheide, Hashwerte un digitale Signature einordne, Zertifikate lese un selbst ausstelle, HTTPS einrichte un typische Zertifikatswarnunge deute.
:::

In de letzte Kapitel konntest du im Tracer fast alles mitlese:

- **Kapitel 3.3.2:** Im WLAN empfängt jedes Gerät in Reichweit alle Funkpakete.
- **Kapitel 6.1.2:** Bei HTTP stehe Anfrag un Webseit im Klartext im Paket.
- **Kapitel 6.3.2:** Bei SMTP un POP3 gehn Benutzername un Passwort fast im Klartext iwwer die Leitung — `AUTH PLAIN` is nur Base64.

Wer an ere Leitung oder im selbe WLAN mithört, sieht also Passwörter, Note, Nachrichte un Bankdate. Un er kann noch mehr: Pakete **veränner** oder sich als jemand annerschter **ausgebe**.

## Drei Schutzziele

Gege diese Gefahre soll Kryptografie helfe. Mer unnerscheidet drei **Schutzziele**:

| Schutzziel | Frag | Beispiel für en Angriff |
|---|---|---|
| **Vertraulichkeit** | Kann nur der richtige Empfänger die Date lese? | Jemand liest im WLAN dein Passwort mit. |
| **Integrität** | Sin die Date unverännert ahkomme? | Jemand ännert in ere Iwwerweisung de Betrag. |
| **Authentizität** | Stammen die Date wirklich vom angegebene Absender? | Ei gefälschte Bank-Webseit fragt deine PIN ab. |

In dem Kapitel lernst du die Werkzeuge kenne, mit denne mer diese drei Ziele erreicht — un wie se in **HTTPS** zusammespiele, dem Schloss-Symbol im Browser.

:::quiz match
Jemand liest dein Passwort im WLAN mit -> Vertraulichkeit
Jemand ändert unnerwegs de Betrag von ere Iwwerweisung -> Integrität
Ei gefälschte Webseit gibt sich als deine Bank aus -> Authentizität
:::

:::evaluate
Zuordnung prüfe
:::
