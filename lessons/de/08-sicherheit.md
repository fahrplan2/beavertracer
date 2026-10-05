# Sicherheit: Verschlüsselung und Zertifikate

:::goal
**Lernziel:** Du kannst die drei Schutzziele Vertraulichkeit, Integrität und Authentizität erklären, symmetrische und asymmetrische Verschlüsselung unterscheiden, Hashwerte und digitale Signaturen einordnen, Zertifikate lesen und selbst ausstellen, HTTPS einrichten und typische Zertifikatswarnungen deuten.
:::

In den letzten Kapiteln konntest du im Tracer fast alles mitlesen:

- **Kapitel 3.3.2:** Im WLAN empfängt jedes Gerät in Reichweite alle Funkpakete.
- **Kapitel 6.1.2:** Bei HTTP stehen Anfrage und Webseite im Klartext im Paket.
- **Kapitel 6.3.2:** Bei SMTP und POP3 gehen Benutzername und Passwort fast im Klartext über die Leitung — `AUTH PLAIN` ist nur Base64.

Wer an einer Leitung oder im selben WLAN mithört, sieht also Passwörter, Noten, Nachrichten und Bankdaten. Und er kann noch mehr: Pakete **verändern** oder sich als jemand anderes **ausgeben**.

## Drei Schutzziele

Gegen diese Gefahren soll Kryptografie helfen. Man unterscheidet drei **Schutzziele**:

| Schutzziel | Frage | Beispiel für einen Angriff |
|---|---|---|
| **Vertraulichkeit** | Kann nur der richtige Empfänger die Daten lesen? | Jemand liest im WLAN dein Passwort mit. |
| **Integrität** | Sind die Daten unverändert angekommen? | Jemand ändert in einer Überweisung den Betrag. |
| **Authentizität** | Stammen die Daten wirklich vom angegebenen Absender? | Eine gefälschte Bank-Webseite fragt deine PIN ab. |

In diesem Kapitel lernst du die Werkzeuge kennen, mit denen man diese drei Ziele erreicht — und wie sie in **HTTPS** zusammenspielen, dem Schloss-Symbol im Browser.

:::quiz match
Jemand liest dein Passwort im WLAN mit -> Vertraulichkeit
Jemand ändert unterwegs den Betrag einer Überweisung -> Integrität
Eine gefälschte Webseite gibt sich als deine Bank aus -> Authentizität
:::

:::evaluate
Zuordnung prüfen
:::
