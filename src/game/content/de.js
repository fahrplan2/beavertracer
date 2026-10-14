//@ts-check
// German game content: everything in the game that is prose rather than
// interface (ticket stories, intermezzo tasks, badges, ranks). Interface
// strings live in locales/*.js under "game.*".
//
// Every language file has exactly this shape (tests/game/contentParity.test.js):
// same keys, same array lengths, same numbers, same {placeholders}. Only
// the text differs. HTML is allowed where the German text uses it.

export default {
    intermezzos: {
        routing: {
            title: "Routing-Rush",
            desc: "Du bist der Router! Pakete rasen heran — schick jedes zum richtigen Ausgang, bevor das Netz verstopft.",
            kc: "Subnetzbildung, Router und Wegesteuerung",
        },
        vlsm: {
            title: "Adressraum-Tetris",
            desc: "Räume brauchen Adressen! Leg passende Teilnetze in den Adressraum — ohne Verschnitt und ohne dir den Platz zu verbauen.",
            kc: "Subnetzbildung IPv4 (VLSM), Subnetzmaske",
        },
        belt: {
            title: "Paket-Förderband",
            desc: "Pakete rollen an — stell mit den Bit-Schaltern ihre Nummer ein, bevor der Puffer überläuft.",
            kc: "Adressbildung IPv4 (Binärsystem), Netzmaske",
        },
        guard: {
            title: "Türsteher",
            desc: "Dienst am Empfang: Wer darf in den Serverraum, ans Admin-Konto, in den Noten-Ordner? Stempel richtig — nach Hausordnung.",
            kc: "Datensicherheit: Zutritts-, Zugangs- und Zugriffskontrolle",
        },
        binary: {
            title: "Binär-Blitz",
            desc: "Schalte die richtigen Bits ein — erst mit Hilfe, dann ohne. Zum Schluss liest du Binärzahlen.",
            kc: "Adressbildung IPv4",
        },
        mask: {
            title: "Masken-Training",
            desc: "Präfix, Netzmaske, Netz- und Broadcastadresse in Ruhe üben.",
            kc: "Subnetzmaske und Subnetzbildung",
        },
        access: {
            title: "Wer darf rein?",
            desc: "Ordne Schutzmaßnahmen richtig ein: Tür, Anmeldung oder Daten?",
            kc: "Zutritts-, Zugangs- und Zugriffskontrolle",
        },
        media: {
            title: "Kabel oder Funk?",
            desc: "Glasfaser, Twisted Pair, WLAN oder LoRaWAN — welches Medium passt zur Aufgabe?",
            kc: "Übertragungsmedien, LAN/WAN, LoRaWAN, strukturierte Verkabelung",
        },
        line: {
            title: "Leitungs-Labor",
            desc: "Rechne mit Baud und Bit/s, bestimme Betriebsarten und unterscheide Nachricht, Information und Signal.",
            kc: "Nachricht/Information/Signal, Bitrate, Symbolrate, Betriebsarten",
        },
    },

    acts: {
        1: {
            title: "Erste Woche im Schulnetz",
            intro: "Herr Biber, der Administrator der Beaver-Schule, begrüßt dich: „Schön, dass du da bist! Fang mit den Switches an — da hakt es gerade an zwei Stellen.“",
        },
        2: {
            title: "Adressen und Wege",
            intro: "„Jetzt wird's spannend“, sagt Herr Biber. „Teilnetze, Router, DHCP — hier passieren die meisten Fehler.“",
        },
        3: {
            title: "Dienste im Netz",
            intro: "„Das Netz läuft. Aber die Leute wollen ja Webseiten, Mails und Namen statt Zahlen …“",
        },
        4: {
            title: "Sicherheit",
            intro: "„Letzte Etappe: Von außen erreichbar sein — aber bitte nur das, was erreichbar sein soll.“",
        },
    },

    tickets: {
        "t-switch": {
            title: "Clara ist verschwunden",
            from: "Sekretariat",
            kc: "Switches, Fehlersuche mit ping",
            story: "Seit <strong>David</strong> neu im Netz ist, ist Clara für niemanden mehr erreichbar — und mit Ben stimmt auch etwas nicht. Bring das Netz in Ordnung.",
            plan: {
                head: ["Gerät", "IP-Adresse", "Switch-Port"],
                rows: [["Anna", "192.168.0.10/24", "1"], ["Ben", "192.168.0.11/24", "2"], ["Clara", "192.168.0.12/24", "3"], ["David", "192.168.0.13/24", "4"]],
            },
            hints: [
                "Schau dir zuerst die Kabel an: Hängt jeder PC am richtigen Port? Dann die IP-Einstellungen jedes PCs.",
                "Pinge von Anna aus Ben an und öffne einen Trace für Anna. Wie viele ARP-Antworten kommen — und mit welchen MAC-Adressen?",
            ],
            checks: [
                "Anna hat ihre Adresse laut Plan",
                "Ben hat seine Adresse laut Plan",
                "Clara hat ihre Adresse laut Plan",
                "David hat seine Adresse laut Plan",
                "Anna erreicht Clara",
                "Anna erreicht David",
                "Ben erreicht Clara",
            ],
            question: {
                text: "Woran erkennst du im Tracer, dass zwei Geräte dieselbe IP-Adresse haben?",
                options: [
                    "Der Ping scheitert immer",
                    "Auf eine ARP-Anfrage kommen zwei Antworten mit verschiedenen MAC-Adressen",
                    "Der Switch zeigt eine Fehlermeldung",
                ],
            },
            lessonLearned: "Fehlersuche heißt: <strong>Soll</strong> (Netzplan) mit <strong>Ist</strong> (Kabel, Einstellungen, Tracer) vergleichen. Ein erfolgreicher Ping heißt nicht, dass alles stimmt.",
        },
        "t-vlan": {
            title: "Ben sieht zu viel",
            from: "Schulleitung",
            kc: "VLAN (fakultativ), Switches",
            story: "Nach dem Umbau am Wochenende: „<strong>Ben</strong> kommt plötzlich an die Rechner der Verwaltung — aber nicht mehr zu Anna.“ Das ist ein Datenschutzproblem! Port 8 ist an beiden Switches der Trunk (<code>tagged</code>, VLANs <code>10,20</code>).",
            plan: {
                head: ["Gerät", "Switch", "Port", "VLAN", "IP-Adresse"],
                rows: [["Sekretariat", "EG", "1", "10", "192.168.0.10"], ["Anna", "EG", "2", "20", "192.168.0.20"], ["Schulleitung", "OG", "1", "10", "192.168.0.11"], ["Ben", "OG", "2", "20", "192.168.0.21"]],
            },
            hints: [
                "Öffne bei beiden Switches den Reiter VLAN und vergleiche jede Zeile mit dem Plan: PVID der PC-Ports und die zulässigen VLANs am Trunk.",
                "Es sind zwei Fehler, beide am Switch OG.",
            ],
            checks: [
                "Verwaltung erreicht sich über beide Stockwerke",
                "Anna und Ben erreichen sich",
                "Verwaltung und Unterricht sind getrennt (1)",
                "Verwaltung und Unterricht sind getrennt (2)",
                "Verwaltung und Unterricht sind getrennt (3)",
            ],
            question: {
                text: "Was war los?",
                options: [
                    "Bens Port hatte die falsche PVID, und der Trunk am Switch OG ließ VLAN 20 nicht durch",
                    "Ben hatte eine falsche IP-Adresse",
                    "Der Trunk-Port war nicht gesteckt",
                ],
            },
            lessonLearned: "Typische VLAN-Fehler: ein Port mit <strong>falscher PVID</strong> und ein <strong>Trunk, der ein VLAN nicht zulässt</strong>. Prüfe immer beide Enden eines Trunks.",
        },
        "t-subnet": {
            title: "Drei Bereiche, null Verbindung",
            from: "Hausmeister",
            kc: "Subnetzbildung IPv4, Router",
            story: "Ein Kollege hat die PCs im Schulnetz eingerichtet — seitdem funktioniert zwischen den Bereichen fast nichts mehr. Rechne nach!",
            plan: {
                head: ["Gerät", "IP-Adresse", "Präfix", "Gateway"],
                rows: [["PC Verwaltung", "192.168.10.2", "/26", "192.168.10.1"], ["PC Lehrerzimmer", "192.168.10.66", "/26", "192.168.10.65"], ["PC Computerraum", "192.168.10.130", "/26", "192.168.10.129"]],
            },
            hints: [
                "Schau dir bei jedem PC die IP-Einstellungen an und vergleiche sie mit dem Plan. Nicht jeder Fehler fällt sofort auf.",
                "Rechne für jeden PC aus: In welchem Teilnetz liegt seine Adresse wirklich? Ist sie die Netz- oder Broadcastadresse? Stimmt die Maske?",
            ],
            checks: [
                "PC Verwaltung hat die richtige Adresse",
                "PC Lehrerzimmer hat die richtige Adresse",
                "PC Computerraum hat die richtige Adresse",
                "Verwaltung erreicht Lehrerzimmer",
                "Verwaltung erreicht Computerraum",
                "Lehrerzimmer erreicht Computerraum",
            ],
            question: {
                text: "Warum durfte der PC im Computerraum nicht die Adresse 192.168.10.191/26 haben?",
                options: [
                    "Sie liegt außerhalb des Adressbereichs von 192.168.0.0/16",
                    "Sie ist die Broadcastadresse des Teilnetzes 192.168.10.128/26",
                    "Sie ist die Netzadresse des Teilnetzes",
                ],
            },
            lessonLearned: "Typische Subnetting-Fehler: Adresse <strong>außerhalb des eigenen Teilnetzes</strong>, <strong>falsche Maske</strong>, <strong>Netz- oder Broadcastadresse</strong> als Geräteadresse.",
        },
        "t-route": {
            title: "Hin geht's, zurück nicht",
            from: "Firma A (Anna)",
            kc: "Router und Wegesteuerung (statisch), traceroute",
            story: "Firma A — Router A — Zwischennetz — Router B — Firma B. Bei <strong>Router A</strong> ist die Route zu Firma B (<code>172.16.0.0/24</code> über <code>10.0.0.2</code>) eingetragen. Trotzdem: Clara antwortet Anna nicht.",
            hints: [
                "Pinge von Anna aus Clara an und öffne einen Trace für Clara. Kommt der Ping an — und antwortet sie?",
                "traceroute 172.16.0.10 auf Anna: Bis zu welchem Router kommen Antworten?",
                "Schau dir die Routing-Tabelle von Router B an. Kennt er 192.168.0.0/24?",
            ],
            checks: [
                "Router B kennt den Weg zu Firma A",
                "Anna erreicht Clara",
            ],
            question: {
                text: "Warum reicht eine Route nur in eine Richtung nicht?",
                options: [
                    "Router leiten nur Pakete weiter, die sie selbst erzeugt haben",
                    "Die Antwort muss auch zurückfinden — jeder Router auf dem Rückweg braucht eine Route zum Absendernetz",
                    "Ping funktioniert grundsätzlich nur innerhalb eines Netzes",
                ],
            },
            lessonLearned: "Jede Verbindung braucht <strong>Hin- und Rückweg</strong>. traceroute zeigt, bis wohin es klappt.",
        },
        "t-dhcp": {
            title: "Laptops ohne Netz",
            from: "Lehrerzimmer",
            kc: "Dynamische Vergabe von IP-Adressen (DHCP)",
            story: "Nach den Ferien: „Unsere Laptops kommen nicht mehr ins Netz!“ Beide stehen auf <strong>DHCP</strong>. Der DHCP-Server soll <code>192.168.0.100</code>–<code>192.168.0.120</code> verteilen, Gateway <code>192.168.0.1</code>, DNS <code>192.168.0.53</code>.",
            hints: [
                "Eine Adresse, die mit 169.254 beginnt, hat sich das Gerät selbst gegeben — kein DHCP-Server hat geantwortet.",
                "Trace für einen Laptop: Nur DHCP Discover — oder auch eine Antwort? Läuft der DHCP-Server, und welchen Bereich verteilt er?",
                "Nach einer Änderung am Server: Laptop kurz auf Statisch und wieder auf DHCP stellen, Anwenden.",
            ],
            checks: [
                "Laptop 1 hat eine Adresse aus dem Bereich",
                "Laptop 2 hat eine Adresse aus dem Bereich",
                "Laptop 1 erreicht den Server",
                "Laptop 2 erreicht den Server",
            ],
            question: {
                text: "Ein Gerät hat die Adresse 169.254.17.3. Was bedeutet das?",
                options: [
                    "Es hat eine Adresse vom DHCP-Server bekommen",
                    "Es hat keine Antwort von einem DHCP-Server bekommen und sich selbst eine Adresse gegeben",
                    "Es ist ein Router",
                ],
            },
            lessonLearned: "<code>169.254.x.x</code> = <strong>kein DHCP-Server hat geantwortet</strong>. Prüfe: Läuft der Server? Stimmt der Bereich?",
        },
        "t-dns": {
            title: "Mit Zahl geht's, mit Namen nicht",
            from: "Frau Kraus (Lehrerin)",
            kc: "Hostnamen und Namensauflösung (DNS)",
            story: "„<code>www.beaver-schule.de</code> lädt bei mir nicht. Mit <code>http://192.168.0.20</code> klappt es aber!“",
            plan: {
                head: ["Was", "Soll"],
                rows: [["DNS-Server am Client-PC", "192.168.0.53"], ["Eintrag im Schul-DNS", "www.beaver-schule.de → 192.168.0.20"]],
            },
            hints: [
                "nslookup www.beaver-schule.de auf dem Client-PC: Welcher Server wurde gefragt — und was kam zurück?",
                "Vergleiche die Antwort mit dem Plan. Wo ist dieser Name eingetragen?",
            ],
            checks: [
                "Der Client-PC löst den Namen richtig auf",
            ],
            question: {
                text: "Eine Webseite ist per IP-Adresse erreichbar, per Name nicht. Wo suchst du zuerst?",
                options: [
                    "Beim Webserver",
                    "Beim DNS: eingetragener DNS-Server und der Eintrag selbst",
                    "Beim Switch",
                ],
            },
            lessonLearned: "Geht's mit IP, aber nicht mit Name: <strong>DNS</strong>. Erst den DNS-Server prüfen, dann den Eintrag.",
        },
        "t-ports": {
            title: "Verbindung abgelehnt",
            from: "Informatik-Fachschaft",
            kc: "Dienste im Internet, Ports",
            story: "Nach einem Update: „Der Echo-Dienst lehnt jede Verbindung ab, und die Webseite lädt auch nicht mehr.“ Laut Plan: <strong>Webserver</strong> an Port <code>80</code>, <strong>Echo-Dienst</strong> an Port <code>5000</code>.",
            hints: [
                "Verbinde dich mit dem einfachen TCP-Client zu 192.168.0.20:5000 und öffne einen Trace. Womit antwortet der Server auf dein SYN?",
                "nmap -p 80,5000 192.168.0.20 auf dem Client-PC — und ss auf dem Server.",
                "Öffne auf dem Server die Apps TCP-Echo-Server und HTTP-Server: Laufen sie? An welchem Port?",
            ],
            checks: [
                "Echo-Dienst an Port 5000 erreichbar",
                "Webserver an Port 80 erreichbar",
            ],
            question: {
                text: "Auf dein SYN antwortet der Server mit RST. Was heißt das?",
                options: [
                    "Der Rechner ist nicht erreichbar",
                    "Der Rechner ist erreichbar, aber an diesem Port lauscht kein Programm",
                    "Die Verbindung wurde erfolgreich aufgebaut",
                ],
            },
            lessonLearned: "<strong>RST</strong> auf SYN: Rechner da, <strong>Dienst nicht</strong> — nicht gestartet oder falscher Port.",
        },
        "t-http": {
            title: "Die Kontaktseite ist weg",
            from: "Sekretariat",
            kc: "Dienste im Internet (HTTP)",
            story: "„Auf unserer Webseite führt der Link <strong>Kontakt</strong> nur noch zu einer Fehlermeldung.“ Die Seite soll unter <code>http://192.168.0.20/kontakt.html</code> erreichbar sein.",
            hints: [
                "Rufe die Seite im Browser oder mit curl -v auf. Welcher Statuscode kommt zurück?",
                "Der Webserver liefert nur Dateien aus seinem Dokumentstammverzeichnis. Schau mit ls auf dem Server nach — auch in /home.",
                "Mit mv verschiebst du eine Datei: mv <Quelle> <Zielordner>.",
            ],
            checks: [
                "Die Kontaktseite liegt im Dokumentstammverzeichnis",
            ],
            question: {
                text: "Was bedeutet der Statuscode 404?",
                options: [
                    "Der Server ist nicht erreichbar",
                    "Der Server läuft, aber die angefragte Datei gibt es dort nicht",
                    "Der Zugriff ist verboten",
                ],
            },
            lessonLearned: "<strong>404</strong>: Server erreichbar, <strong>Datei fehlt</strong> im Dokumentstammverzeichnis.",
        },
        "t-mail": {
            title: "Post für Ben",
            from: "Anna",
            kc: "Dienste im Internet (SMTP, POP3/IMAP), DNS",
            story: "„Ich kann Ben keine Mail schicken!“ Repariere alles und schick dann von Anna eine Mail an <code>ben@biber-mail.de</code>. Das Weiterleiten zwischen den Mailservern dauert ein paar Sekunden.",
            plan: {
                head: ["Was", "Soll"],
                rows: [["Annas Postausgang (SMTP)", "mail.beaver-schule.de, Port 25"], ["MX-Eintrag von biber-mail.de", "mail.biber-mail.de (Priorität 10)"]],
            },
            hints: [
                "Versuch zu senden und schau in den Reiter Protokoll. Klingt die Antwort nach SMTP?",
                "Lies die Nachricht vom MAILER-DAEMON. nslookup -type=MX biber-mail.de auf Annas PC.",
                "Postausgang: App E-Mail → Einstellungen. MX-Einträge: DNS-Server → Reiter MX.",
            ],
            checks: [
                "Eine Mail liegt in Bens Postfach",
            ],
            question: {
                text: "Woher weiß ein Mailserver, wohin er eine Mail für @biber-mail.de schicken muss?",
                options: [
                    "Aus dem MX-Eintrag der Domain im DNS",
                    "Aus der Adresszeile des Browsers",
                    "Er schickt sie an alle bekannten Mailserver",
                ],
            },
            lessonLearned: "Mailserver finden den Ziel-Mailserver über den <strong>MX-Eintrag</strong> im DNS.",
        },
        "t-nat": {
            title: "Gestern ging es noch",
            from: "Clara (von außen)",
            kc: "Router, Adressbildung (NAT, Portweiterleitung)",
            story: "Die Portweiterleitung <code>TCP 80 → 192.168.178.10:80</code> ist eingerichtet. Nach einem Stromausfall kommt Clara nicht mehr auf den Heim-Webserver. Behebe den Fehler <strong>dauerhaft</strong>.",
            hints: [
                "Vergleiche die LAN-IP in den Portfreigaben mit der Adresse, die der Heim-Webserver gerade wirklich hat.",
                "Steht der Server auf DHCP? Wie sorgst du dafür, dass er immer dieselbe Adresse hat?",
            ],
            checks: [
                "Der Heim-Webserver hat seine feste Adresse",
                "Clara erreicht den Server über die Portweiterleitung",
            ],
            question: {
                text: "Warum braucht ein Server hinter einer Portweiterleitung eine feste Adresse?",
                options: [
                    "Weil die Regel auf eine bestimmte LAN-Adresse zeigt — per DHCP kann sie sich ändern",
                    "Weil DHCP im Heimnetz verboten ist",
                    "Weil Webserver nur mit festen Adressen starten",
                ],
            },
            lessonLearned: "Portweiterleitungen zeigen auf eine <strong>feste LAN-Adresse</strong>. Server bekommen eine statische Adresse oder eine DHCP-Reservierung.",
        },
        "t-tls": {
            title: "Warnung bei der Mensa",
            from: "Mensa-Team",
            kc: "SSL/TLS-Zertifikate",
            story: "Die Mensa-Seite <code>https://mensa.beaver-schule.de/</code> zeigt plötzlich eine Zertifikatswarnung. Der Client-PC vertraut der Schul-CA. Die Schul-CA liegt zur Vereinfachung direkt auf dem Mensa-Server. Sorg dafür, dass die Seite <strong>ohne Warnung</strong> lädt.",
            hints: [
                "Ruf die Seite auf dem Client-PC auf und lies die Warnung: Betreff, Aussteller, Gültig bis.",
                "Zertifikatverwaltung auf mensa.beaver-schule.de → Reiter Signieren: das vorhandene Zertifikat von der Schul-CA neu signieren, unter neuem Namen speichern.",
                "HTTP-Server der Mensa: Stoppen, im Reiter HTTPS das neue Zertifikat wählen, Verwenden, Starten.",
            ],
            checks: [
                "Die Mensa-Seite lädt ohne Zertifikatswarnung",
            ],
            question: {
                text: "Was ist der Vorteil eines von einer vertrauenswürdigen CA ausgestellten Zertifikats?",
                options: [
                    "Die Verbindung wird schneller",
                    "Der Browser kann prüfen, dass er wirklich mit dem richtigen Server spricht, und die Verbindung ist verschlüsselt",
                    "Der Server braucht keine IP-Adresse mehr",
                ],
            },
            lessonLearned: "Ein gültiges Zertifikat beweist die <strong>Identität</strong> des Servers. Häufige Fehler: <strong>abgelaufen</strong>, <strong>selbstsigniert</strong>, <strong>falscher Name</strong>.",
        },
        "t-firewall": {
            title: "Seit den neuen Regeln geht nichts",
            from: "Herr Biber",
            kc: "Datensicherheit (Zugangskontrolle), Firewall",
            story: "Herr Biber hat die Firewall auf das Whitelist-Prinzip umgestellt. Seitdem ist die <strong>Webseite</strong> von außen nicht erreichbar, und es kommen <strong>keine Mails</strong> mehr an. SSH soll aber gesperrt bleiben!",
            hints: [
                "Teste vom Internet-PC aus mit nmap -p 22,25,80 198.51.100.10 und sieh dir die Spalte Treffer der Regeln an.",
                "Welcher Port gehört zu HTTP, welcher zu SMTP? Und: Die erste passende Regel gewinnt.",
            ],
            checks: [
                "Webseite von außen erreichbar",
                "Mailserver von außen erreichbar",
                "SSH bleibt von außen gesperrt",
            ],
            question: {
                text: "Was bedeutet das Whitelist-Prinzip bei einer Firewall?",
                options: [
                    "Alles ist erlaubt, nur Bekanntes wird gesperrt",
                    "Alles ist verboten, nur ausdrücklich Erlaubtes darf durch",
                    "Nur weiße Pakete dürfen passieren",
                ],
            },
            lessonLearned: "Whitelist: <strong>alles verboten, außer erlaubt</strong>. Die <strong>erste passende Regel</strong> entscheidet.",
        },
    },

    ranks: ["Praktikant/in", "Azubi", "Junior-Admin", "Netzwerk-Admin", "Senior-Admin", "Netzwerk-Guru"],

    badges: {
        first: { title: "Erste Schritte", desc: "Ein Intermezzo oder Ticket abgeschlossen" },
        router: { title: "Paketprofi", desc: "Routing-Rush mit mindestens 90 Punkten" },
        space: { title: "Platzsparer", desc: "Adressraum-Tetris mit mindestens 90 Punkten" },
        belt: { title: "Fließband-Profi", desc: "Paket-Förderband mit mindestens 90 Punkten" },
        gate: { title: "Schlüsselmeister", desc: "Türsteher mit mindestens 90 Punkten" },
        bits: { title: "Bit-Meister", desc: "Binär-Blitz mit mindestens 90 Punkten" },
        masks: { title: "Masken-Profi", desc: "Masken-Training mit mindestens 90 Punkten" },
        guard: { title: "Torwächter", desc: "„Wer darf rein?“ mit mindestens 90 Punkten" },
        cables: { title: "Kabel-Kenner", desc: "„Kabel oder Funk?“ mit mindestens 90 Punkten" },
        lab: { title: "Laborratte", desc: "Leitungs-Labor mit mindestens 90 Punkten" },
        allround: { title: "Allrounder", desc: "Alle Intermezzos abgeschlossen" },
        ticket: { title: "Erstes Ticket", desc: "Dein erstes Ticket gelöst" },
        nohints: { title: "Ohne Spickzettel", desc: "Ein Ticket ohne einen einzigen Tipp gelöst" },
        act: { title: "Akt {no} geschafft", desc: "Alle Tickets aus „{title}“ gelöst" },
        learner: { title: "Fleißig", desc: "20 Quizze in den Lektionen ausgewertet" },
        guru: { title: "Netzwerk-Guru", desc: "Den höchsten Rang erreicht" },
    },

    games: {
        routing: {
            intro: `<p>Du bist der <strong>Router</strong> der Beaver-Schule. Pakete kommen über die Leitung herein — jedes hat eine <strong>Ziel-IP-Adresse</strong>.
                Schick jedes Paket mit den Tasten <kbd>1</kbd>–<kbd>4</kbd> (oder per Klick) zum Ausgang, dessen Netz zur Ziel-IP passt.</p>
                <p>Kommt ein Paket am Router an, ohne dass du entschieden hast, oder schickst du es zum falschen Ausgang, verlierst du ein Leben.
                Je schneller du entscheidest, desto mehr Punkte. Richtige Entscheidungen am Stück erhöhen deinen Multiplikator.</p>
                <p>In späteren Leveln kommen eine <strong>Default-Route</strong> und sich überlappende Netze dazu: Dann gewinnt das <strong>längste passende Präfix</strong>.</p>`,
            rooms: ["Verwaltung", "Lehrerzimmer", "Computerraum", "Bibliothek", "Server", "WLAN", "Mensa", "Werkstatt"],
            internet: "Internet",
            levels: [
                "Zwei Hälften: ein /24 geteilt in zwei /25.",
                "Vier Viertel: vier /26-Netze.",
                "Gemischt: unterschiedlich große Netze.",
                "Noch kleiner: /27-Netze kommen dazu.",
                "Masken statt Präfixe: Jetzt steht die Netzmaske in der Tabelle.",
                "Über die Oktettgrenze: Netze, die im dritten Oktett beginnen.",
                "Ab ins Internet: Alles, was nirgends passt, geht über die Default-Route.",
                "Longest Prefix Match: Die Netze überlappen — das längste passende Präfix gewinnt.",
            ],
        },
        vlsm: {
            intro: `<p>Die Schule hat einen Adressbereich bekommen — und jeder Raum braucht ein eigenes <strong>Teilnetz</strong>.
                Für jede Anfrage wählst du die <strong>Blockgröße</strong> (das Präfix) und legst den Block in den Adressraum.</p>
                <ul>
                    <li>Ein Netz braucht <strong>Geräte + 2</strong> Adressen (Netz- und Broadcastadresse). Ein <code>/26</code> hat 64 Adressen, also Platz für 62 Geräte.</li>
                    <li>Blöcke rasten nur an <strong>gültigen Grenzen</strong> ein: Ein 64er-Block beginnt bei .0, .64, .128 oder .192.</li>
                    <li>Zu klein kostet ein Leben. Zu groß klappt, verschwendet aber Adressen — und vielleicht fehlt dir der Platz später.</li>
                </ul>
                <p>Steuerung: <kbd>←</kbd> <kbd>→</kbd> verschieben, <kbd>↑</kbd> <kbd>↓</kbd> Blockgröße, <kbd>Leertaste</kbd> ablegen — oder mit der Maus.</p>`,
            rooms: ["Verwaltung", "Lehrerzimmer", "Computerraum 1", "Computerraum 2", "Bibliothek", "WLAN Gäste", "WLAN Schüler", "Server", "Drucker", "Mensa", "Werkstatt", "Kameras", "Telefonie", "Hausmeister"],
            levels: [
                "Der Größe nach: Die Anfragen kommen vom größten zum kleinsten Netz.",
                "Mehr Räume: kleinere Netze kommen dazu.",
                "Durcheinander: Jetzt kommen die Anfragen in zufälliger Reihenfolge. Lass Platz für große Blöcke!",
                "Eng wird's: sieben Netze in einem /24.",
                "Doppelt so groß: ein /23 — und er wird randvoll.",
                "Profi-Level: ein /22 und viele Netze.",
            ],
        },
        belt: {
            intro: `<p>Am Förderband kommen Pakete an. Die Sortiermaschine erkennt ein Paket nur an seinem <strong>Bitmuster</strong>.</p>
                <ul>
                    <li><strong>Paket mit Zahl:</strong> Schalte die 8 Bits (<kbd>1</kbd>–<kbd>8</kbd> oder Klick) so, dass ihre Stellenwerte zusammen die Zahl ergeben. Stimmt das Muster, ist das Paket sofort zugestellt. <kbd>0</kbd> löscht alle Bits.</li>
                    <li><strong>Paket mit Binärzahl:</strong> Tipp den Dezimalwert ein und bestätige mit <kbd>Enter</kbd>.</li>
                </ul>
                <p>Kommt ein Paket am Ende an, landet es im <strong>Puffer</strong>. Hat der Puffer keinen Platz mehr, ist das Spiel vorbei.</p>`,
            levels: [
                "Aufwärmen: kleine Zahlen bis 15 — mit Summenanzeige.",
                "Volles Oktett: Zahlen bis 255 — noch mit Summenanzeige.",
                "Ohne Netz und doppelten Boden: keine Summenanzeige mehr.",
                "Andersherum: Lies die Binärzahl und tipp den Dezimalwert ein.",
                "Masken-Oktette: 128, 192, 224 … — so sehen Netzmasken binär aus.",
                "Gemischt und schnell: Einstellen und Lesen im Wechsel.",
            ],
        },
        guard: {
            intro: `<p>Du hast heute <strong>Dienst am Empfang</strong> der Beaver-Schule. Nacheinander kommen Leute mit einem Anliegen. Prüf ihre Angaben gegen die <strong>Hausordnung</strong> und stempel:</p>
                <ul>
                    <li><strong>Zutritt</strong> — es geht um einen <em>Raum</em>.</li>
                    <li><strong>Zugang</strong> — es geht um die <em>Anmeldung</em> an einem System.</li>
                    <li><strong>Zugriff</strong> — es geht um <em>Daten</em>, nach der Anmeldung.</li>
                </ul>
                <p>Jeweils <strong>erlauben</strong> oder <strong>ablehnen</strong> — Tasten <kbd>1</kbd>–<kbd>6</kbd> oder Klick. Richtig ist ein Stempel nur, wenn Kontrollart <em>und</em> Entscheidung stimmen. Drei falsche Stempel, und Herr Biber übernimmt den Empfang wieder selbst.</p>`,
            names: ["Anna Becker", "Ben Yılmaz", "Clara Wagner", "David Nowak", "Elif Kaya", "Finn Schulz", "Greta Hoffmann", "Hamid Rahimi", "Ida Fischer", "Jonas Weber", "Kim Nguyen", "Lena Schäfer", "Mats Braun", "Nora Klein", "Omar Haddad", "Paula Wolf"],
            roles: {
                it: "IT-Team",
                teacher: "Lehrkraft",
                student: "Schüler/in",
                office: "Sekretariat",
                head: "Schulleitung",
                caretaker: "Hausmeister",
                visitor: "Besucher/in",
            },
            entry: {
                server: "möchte in den <strong>Serverraum</strong>.",
                office: "möchte ins <strong>Sekretariat</strong>.",
            },
            login: {
                pc: "möchte sich am <strong>Schul-PC</strong> anmelden.",
                admin: "möchte sich mit dem <strong>Admin-Konto</strong> am Server anmelden.",
            },
            data: {
                read: "möchte im Ordner <strong>„{folder}“</strong> Dateien <strong>lesen</strong>.",
                write: "möchte im Ordner <strong>„{folder}“</strong> Dateien <strong>ändern</strong>.",
            },
            folders: { grades: "Noten", files: "Schülerakten", exams: "Abiturprüfungen" },
            rules: {
                server: "Serverraum: nur das IT-Team.",
                office: "Sekretariat: alle Beschäftigten der Schule. Besucher nur in Begleitung, Schüler/innen nicht.",
                own: "Anmelden nur mit dem eigenen Konto.",
                lockout: "Nach 3 Fehlversuchen ist ein Konto gesperrt.",
                admin: "Admin-Konto: nur das IT-Team, und nur mit Zwei-Faktor-Anmeldung.",
                grades: "Ordner „Noten“: nur Lehrkräfte.",
                files: "Ordner „Schülerakten“: nur Sekretariat und Schulleitung.",
                exams: "Ordner „Abiturprüfungen“: lesen Lehrkräfte und Schulleitung, ändern nur die Schulleitung.",
                expired: "Abgelaufene Ausweise gelten nicht — kein Zutritt.",
                night: "Ab 20 Uhr Zutritt nur für Hausmeister und IT-Team.",
            },
            levels: [
                "Erste Schicht: Es geht nur um Räume.",
                "Jetzt auch Anmeldungen: Konten, Fehlversuche, Zwei-Faktor.",
                "Daten kommen dazu: Wer darf welche Ordner lesen oder ändern?",
                "Genau hinsehen: Ablaufdatum und Uhrzeit zählen jetzt.",
                "Großer Andrang: alle Regeln, viele Leute.",
            ],
        },
        binary: {
            intro: `<p>Computer rechnen mit <strong>Bits</strong> — Nullen und Einsen. Ein <strong>Oktett</strong> hat 8 Bits mit den Stellenwerten
                <code>128 64 32 16 8 4 2 1</code>. Eine IPv4-Adresse besteht aus vier Oktetten.</p>
                <p>Schalte die richtigen Bits ein, bis die Zielzahl erreicht ist. In den ersten Runden hilft dir eine Anzeige der Summe — danach nicht mehr.</p>`,
            set: "Stelle die Zahl <strong>{n}</strong> ein.",
            setBlind: "Ohne Hilfe: Stelle die Zahl <strong>{n}</strong> ein.",
            toDec: "Welche Dezimalzahl ist <code>{bin}</code>?",
            toBin: "Schreib <strong>{n}</strong> als 8-stellige Binärzahl.",
            allOff: "alle Bits aus",
            facts: [
                { q: "Wie viele verschiedene Werte kann ein Oktett (8 Bit) darstellen?", a: "256", wrong: ["255", "128", "8"], why: "2⁸ = 256 Werte, nämlich 0 bis 255." },
                { q: "Wie viele Bit hat eine IPv4-Adresse?", a: "32", wrong: ["8", "64", "128"], why: "4 Oktette × 8 Bit = 32 Bit." },
                { q: "Wie viele Bit hat eine IPv6-Adresse?", a: "128", wrong: ["32", "64", "48"], why: "IPv6-Adressen sind 128 Bit lang — viermal so lang wie IPv4-Adressen." },
            ],
        },
        mask: {
            intro: `<p>Die <strong>Netzmaske</strong> trennt eine IPv4-Adresse in <strong>Netzteil</strong> und <strong>Hostteil</strong>.
                Das <strong>Präfix</strong> <code>/n</code> sagt, wie viele Bits (von links) zum Netzteil gehören.</p>
                <p>Netzadresse: alle Hostbits 0. Broadcastadresse: alle Hostbits 1. Nutzbare Hosts: 2<sup>Hostbits</sup> − 2.</p>`,
            qMask: "Welche Netzmaske gehört zu <code>/{p}</code>?",
            eMask: "/{p} = {p} Einsen: <code>{mask}</code>.",
            qPrefix: "Welches Präfix gehört zur Netzmaske <code>{mask}</code>? (nur die Zahl)",
            ePrefix: "{mask} hat {p} Einsen → <code>/{p}</code>.",
            qHosts: "Wie viele Geräte (Hosts) passen in ein <code>/{p}</code>-Netz?",
            eHosts: "32 − {p} = {h} Hostbits → 2<sup>{h}</sup> − 2 = {n} (Netz- und Broadcastadresse abgezogen).",
            qFit: "Ein Raum braucht <strong>{need}</strong> Adressen für Geräte. Welches Präfix ist das <em>kleinste passende</em> Netz?",
            eFit: "/{p} bietet {n} Hosts, /{p2} nur {n2}.",
            qNet: "Wie lautet die <strong>Netzadresse</strong> von <code>{cidr}</code>?",
            eNet: "Blockgröße im letzten Oktett: {block}. {octet} liegt im Block ab {start} → <code>{net}</code>.",
            qBc: "Wie lautet die <strong>Broadcastadresse</strong> von <code>{cidr}</code>?",
            eBc: "Netz <code>{net}</code>, Blockgröße {block} → letzte Adresse <code>{bc}</code>.",
            qSame: "Liegen <code>{a}</code> und <code>{b}</code> im <strong>selben Netz</strong>?",
            yes: "Ja",
            no: "Nein",
            eSame: "Netz von {a}: <code>{na}</code>, Netz von {b}: <code>{nb}</code>.",
            qCount: "Wie viele <code>/{to}</code>-Teilnetze passen in ein <code>/{from}</code>-Netz?",
            eCount: "{d} geliehene Bits → 2<sup>{d}</sup> = {n} Teilnetze.",
            qProNet: "Profi-Runde: Netzadresse von <code>{cidr}</code>?",
            eProNet: "Das interessante Oktett ist das dritte (Blockgröße {block}), das vierte wird 0 → <code>{net}</code>.",
            qProBc: "Profi-Runde: Broadcastadresse von <code>{cidr}</code>?",
            eProBc: "Netz <code>{net}</code>, Maske <code>{mask}</code> → alle Hostbits 1: <code>{bc}</code>.",
        },
        access: {
            intro: `<p>Datensicherheit fängt an der Tür an. Man unterscheidet drei Ebenen:</p>
                <ul>
                    <li><strong>Zutrittskontrolle</strong> — wer darf einen <em>Raum</em> oder ein Gebäude betreten? <i class="fa-solid fa-door-closed" aria-hidden="true"></i></li>
                    <li><strong>Zugangskontrolle</strong> — wer darf ein <em>IT-System</em> überhaupt benutzen (Anmeldung)? <i class="fa-solid fa-key" aria-hidden="true"></i></li>
                    <li><strong>Zugriffskontrolle</strong> — wer darf nach der Anmeldung auf welche <em>Daten</em> zugreifen? <i class="fa-solid fa-folder-closed" aria-hidden="true"></i></li>
                </ul>
                <p>Ordne jede Maßnahme der richtigen Ebene zu.</p>`,
            cats: ["Zutrittskontrolle", "Zugangskontrolle", "Zugriffskontrolle"],
            explain: "{cat}: {why}",
            items: [
                { text: "Der Serverraum lässt sich nur mit einer Chipkarte öffnen.", cat: 0, why: "Es geht um das Betreten eines Raums." },
                { text: "Besucher melden sich am Empfang an und tragen einen Besucherausweis.", cat: 0, why: "Regelt, wer das Gebäude betreten darf." },
                { text: "Das Rechenzentrum hat eine Alarmanlage und Videoüberwachung.", cat: 0, why: "Schützt die Räume vor unbefugtem Betreten." },
                { text: "Schlüssel für den Technikraum werden nur gegen Unterschrift ausgegeben.", cat: 0, why: "Kontrolliert den physischen Zutritt zum Raum." },
                { text: "Der Netzwerkschrank im Flur ist abgeschlossen.", cat: 0, why: "Verhindert, dass jemand an die Geräte selbst kommt." },
                { text: "Zur Anmeldung am PC braucht man ein Passwort mit mindestens 12 Zeichen.", cat: 1, why: "Regelt, wer das IT-System überhaupt benutzen darf." },
                { text: "Nach drei falschen Passwörtern wird das Konto gesperrt.", cat: 1, why: "Schützt die Anmeldung am System." },
                { text: "Die Anmeldung beim Schulportal verlangt zusätzlich einen Code aus einer App (2FA).", cat: 1, why: "Zwei-Faktor-Anmeldung sichert den Zugang zum System." },
                { text: "Der Bildschirm sperrt sich nach fünf Minuten ohne Eingabe.", cat: 1, why: "Niemand kann ein unbeaufsichtigtes System benutzen." },
                { text: "Ins Schul-WLAN kommt nur, wer den WPA3-Schlüssel kennt.", cat: 1, why: "Regelt, wer das Netz benutzen darf." },
                { text: "Von zu Hause kommen Lehrkräfte nur per VPN mit persönlichem Zertifikat ins Schulnetz.", cat: 1, why: "Das VPN regelt, wer das Netz von außen benutzen darf." },
                { text: "Schülerinnen und Schüler können den Ordner „Noten“ nicht öffnen.", cat: 2, why: "Angemeldet sind sie — aber bestimmte Daten dürfen sie nicht sehen." },
                { text: "Im Ordner „Abiturprüfungen“ darf nur die Schulleitung schreiben, Lehrkräfte nur lesen.", cat: 2, why: "Lese- und Schreibrechte auf Daten." },
                { text: "Jede Rolle (Schüler, Lehrkraft, Verwaltung) bekommt nur die Rechte, die sie für ihre Arbeit braucht.", cat: 2, why: "Rollen- und Rechtekonzept nach dem Need-to-know-Prinzip." },
                { text: "Wer welche Schülerakte geöffnet hat, wird protokolliert.", cat: 2, why: "Die Protokollierung von Datenzugriffen gehört zur Zugriffskontrolle." },
                { text: "Nur Administratoren dürfen Programme installieren.", cat: 2, why: "Rechte innerhalb des Systems — nach der Anmeldung." },
            ],
        },
        media: {
            intro: `<p>Jedes Übertragungsmedium hat Stärken und Schwächen:</p>
                <ul>
                    <li><strong>Twisted Pair</strong> (Kupfer): günstig, einfach, bis 100 m.</li>
                    <li><strong>Glasfaser</strong>: lange Strecken, sehr hohe Datenraten, unempfindlich gegen Störungen.</li>
                    <li><strong>WLAN</strong>: mobil, aber geteiltes Medium mit begrenzter Reichweite.</li>
                    <li><strong>LoRaWAN</strong>: Funk über Kilometer, wenig Strom — aber nur winzige Datenmengen.</li>
                </ul>
                <p>Dazu: <strong>LAN oder WAN</strong> und die Bereiche der <strong>strukturierten Verkabelung</strong>.</p>`,
            sets: {
                media: ["Twisted-Pair-Kabel", "Glasfaser", "WLAN", "LoRaWAN"],
                net: ["LAN", "WAN"],
                cabling: ["Primärbereich", "Sekundärbereich", "Tertiärbereich"],
            },
            items: [
                { text: "Ein PC im Klassenraum soll an die Netzwerkdose 15 m entfernt.", set: "media", answer: 0, why: "Kurze Strecke im Gebäude, günstig, bis 100 m: Twisted Pair." },
                { text: "Zwei Schulgebäude auf dem Campus, 450 m voneinander entfernt, sollen verbunden werden.", set: "media", answer: 1, why: "Twisted Pair schafft nur 100 m. Für längere Strecken: Glasfaser." },
                { text: "Eine Werkhalle mit Schweißrobotern stört Kupferkabel stark (elektromagnetische Störungen).", set: "media", answer: 1, why: "Licht ist unempfindlich gegen elektromagnetische Störungen." },
                { text: "Die Tablets der Klasse sollen sich im Raum frei bewegen können.", set: "media", answer: 2, why: "Mobile Geräte im Gebäude: WLAN." },
                { text: "Bodenfeuchte-Sensoren auf einem 3 km großen Feld senden einmal pro Stunde ein paar Bytes. Die Batterie soll Jahre halten.", set: "media", answer: 3, why: "Große Reichweite, sehr wenig Daten, sehr wenig Strom: LoRaWAN." },
                { text: "Füllstandsmelder an Altglascontainern in der ganzen Stadt melden, wann sie voll sind.", set: "media", answer: 3, why: "Wenige Daten über große Entfernungen mit Batteriebetrieb — typisch LoRaWAN." },
                { text: "Im Rechenzentrum sollen Server mit 100 Gbit/s an den Kern-Switch angebunden werden.", set: "media", answer: 1, why: "Höchste Datenraten: Glasfaser." },
                { text: "Besucher sollen im Foyer mit ihren Smartphones ins Gäste-Netz.", set: "media", answer: 2, why: "Mobile Fremdgeräte: WLAN (am besten als getrenntes Gäste-Netz)." },
                { text: "Ein Drucker steht im Büro, der Switch ist zwei Meter entfernt.", set: "media", answer: 0, why: "Kurze Strecke, Standardfall: Twisted-Pair-Kabel (Patchkabel)." },
                { text: "Wie lang darf eine Twisted-Pair-Strecke (Ethernet) höchstens sein?", set: "custom", options: ["100 m", "10 m", "1 km", "10 km"], answer: 0, why: "Ethernet über Twisted Pair: maximal 100 m pro Strecke." },
                { text: "Das Netz innerhalb eines Schulgebäudes ist ein …", set: "net", answer: 0, why: "Local Area Network: ein räumlich begrenztes Netz (Gebäude, Gelände)." },
                { text: "Die Verbindung zwischen der Filiale in Kassel und der Zentrale in Frankfurt ist Teil eines …", set: "net", answer: 1, why: "Wide Area Network: verbindet Standorte über große Entfernungen." },
                { text: "Das Internet ist das größte …", set: "net", answer: 1, why: "Das Internet verbindet Netze weltweit — ein WAN." },
                { text: "Strukturierte Verkabelung: die Leitung zwischen zwei Gebäuden des Schulgeländes gehört zum …", set: "cabling", answer: 0, why: "Primärbereich (Campus/Gelände): verbindet Gebäude, meist mit Glasfaser." },
                { text: "Strukturierte Verkabelung: die Leitungen zwischen den Stockwerken eines Gebäudes gehören zum …", set: "cabling", answer: 1, why: "Sekundärbereich (Gebäude/Steigbereich): vom Gebäudeverteiler zu den Etagenverteilern." },
                { text: "Strukturierte Verkabelung: die Leitung vom Etagenverteiler zur Netzwerkdose im Klassenraum gehört zum …", set: "cabling", answer: 2, why: "Tertiärbereich (Etage): vom Etagenverteiler zur Anschlussdose, meist Twisted Pair." },
            ],
        },
        line: {
            intro: `<p>Ein paar Grundlagen der Übertragung:</p>
                <ul>
                    <li><strong>Symbolrate</strong> (in Baud, Bd): Wie viele Symbole pro Sekunde gesendet werden.</li>
                    <li>Ein Symbol mit <em>M</em> Zuständen trägt log<sub>2</sub>(<em>M</em>) Bit. <strong>Bitrate</strong> = Symbolrate × Bit pro Symbol.</li>
                    <li><strong>Übertragungszeit</strong> = Datenmenge ÷ Bitrate. Achtung: 1 Byte = 8 Bit.</li>
                    <li><strong>Simplex</strong> (eine Richtung), <strong>Halbduplex</strong> (abwechselnd), <strong>Vollduplex</strong> (gleichzeitig).</li>
                    <li><strong>Information</strong> (Bedeutung) → <strong>Nachricht</strong> (Zeichen) → <strong>Signal</strong> (physikalisch).</li>
                </ul>`,
            units: { bit: "Bit", bps: "bit/s", baud: "Bd", s: "s" },
            decimalSep: ",",
            qBits: "Ein Symbol kann <strong>{m}</strong> verschiedene Zustände annehmen. Wie viele Bit trägt es?",
            eBits: "2<sup>{b}</sup> = {m} → {b} Bit pro Symbol.",
            qRate: "Symbolrate <strong>{baud} Bd</strong>, <strong>{m}</strong> Zustände pro Symbol. Wie groß ist die Bitrate?",
            eRate: "{baud} Bd × {b} Bit = {rate} bit/s.",
            qBaud: "Eine Leitung soll <strong>{rate} bit/s</strong> übertragen, jedes Symbol hat <strong>{m}</strong> Zustände. Welche Symbolrate ist nötig?",
            eBaud: "{rate} bit/s ÷ {b} Bit = {baud} Bd.",
            qTime: "Wie viele Sekunden dauert es, <strong>{mb} MB</strong> über eine <strong>{rate} Mbit/s</strong>-Leitung zu übertragen? (1 MB = 8 Mbit, ohne Protokoll-Overhead)",
            eTime: "{mb} MB × 8 = {mbit} Mbit; {mbit} ÷ {rate} = {secs} s.",
            modes: ["Simplex", "Halbduplex", "Vollduplex"],
            modeItems: [
                { text: "Ein Radiosender sendet, die Radios empfangen nur.", answer: 0, why: "Nur eine Richtung: Simplex." },
                { text: "Mit einem Walkie-Talkie spricht immer nur einer — wer redet, drückt die Taste.", answer: 1, why: "Beide Richtungen, aber abwechselnd: Halbduplex." },
                { text: "Beim Telefonieren können beide gleichzeitig sprechen.", answer: 2, why: "Beide Richtungen gleichzeitig: Vollduplex." },
                { text: "Ein PC ist per Kabel an einen Switch angeschlossen und sendet und empfängt gleichzeitig.", answer: 2, why: "Switch-Ports arbeiten im Vollduplex — getrennte Adernpaare je Richtung." },
                { text: "Im WLAN teilen sich alle Geräte denselben Funkkanal; es sendet immer nur eines.", answer: 1, why: "Ein gemeinsamer Kanal, abwechselnd: Halbduplex." },
                { text: "Ein Temperatursensor schickt nur Messwerte an die Zentrale, empfangen kann er nichts.", answer: 0, why: "Nur eine Richtung: Simplex." },
            ],
            nis: ["Nachricht", "Information", "Signal"],
            nisItems: [
                { text: "Der Spannungsverlauf auf dem Netzwerkkabel.", answer: 2, why: "Das Signal ist die physikalische Darstellung (Spannung, Licht, Funkwelle)." },
                { text: "Die Lichtimpulse in der Glasfaser.", answer: 2, why: "Lichtimpulse sind die physikalische Form — ein Signal." },
                { text: "Der Text „Treffen um 8 Uhr“ als Folge von Zeichen in einer E-Mail.", answer: 0, why: "Eine Nachricht ist Information in übertragbarer Form — Zeichen nach einer Vereinbarung." },
                { text: "Die Zeichenfolge „ACK“, die ein Protokoll nach festen Regeln zurückschickt.", answer: 0, why: "Zeichen nach vereinbarten Regeln: eine Nachricht." },
                { text: "Was Ben Neues erfährt, als er die Mail liest: Das Treffen ist um 8 Uhr.", answer: 1, why: "Information ist die Bedeutung — das, was der Empfänger Neues weiß." },
                { text: "Die Erkenntnis, dass der Server wieder läuft, nachdem der Ping beantwortet wurde.", answer: 1, why: "Der Bedeutungsinhalt, den der Empfänger daraus gewinnt: Information." },
            ],
            bandwidth: {
                q: "Was gibt die <strong>Bandbreite</strong> einer Leitung im engeren Sinn an?",
                a: "Den Frequenzbereich, den sie übertragen kann (in Hz)",
                wrong: ["Die Länge des Kabels", "Die Anzahl der angeschlossenen Geräte", "Die Zahl der Pakete pro Sekunde"],
                why: "Bandbreite = Frequenzbereich (Hz). Je größer, desto mehr Symbole pro Sekunde — und damit mehr Bit/s (Leitungskapazität).",
            },
        },
    },
};
