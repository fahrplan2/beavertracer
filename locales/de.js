//@ts-check

export default {
  //Meta Data; Here the Name of the language should be inserted in
  "lang.name": "Deutsch (German)",

  //App Name
  "name": "Beaver Tracer",

  "app.generic.title": "Gernic App",

  "app.about.title": "Über",
  "app.about.heading.systemInfo": "Systeminformationen",
  "app.about.body.systemInfo": "Betriebssystem: {os}\nPID: {pid}\nLaufende Apps: {runningApps}\nFocusID: {focusID}\nZeit: {time}",

  "app.ipv4config.title": "IP-Einstellungen",
  "app.ipv4config.button.apply": "Übernehmen",
  "app.ipv4config.label.interface": "Schnittstelle",
  "app.ipv4config.label.ip": "IP",
  "app.ipv4config.label.netmask": "Netzmaske",
  "app.ipv4config.label.gateway": "Gateway",
  "app.ipv4config.msg.noInterfaces": "Keine Schnittstellen verfügbar.",
  "app.ipv4config.msg.interfaceNotFound": "Schnittstelle {i} nicht gefunden.",
  "app.ipv4config.msg.loadedInterface": "Schnittstelle {i} geladen.",
  "app.ipv4config.msg.appliedWithGw": "Übernommen: if{i} = {ip} / {netmask}, gw {gw}",
  "app.ipv4config.msg.appliedGwCleared": "Übernommen: if{i} = {ip} / {netmask}, gw (gelöscht)",
  "app.ipv4config.err.noNetDriver": "Kein Netzwerktreiber auf dem Betriebssystem.",
  "app.ipv4config.err.invalidIp": "Ungültige IP-Adresse.",
  "app.ipv4config.err.invalidNetmask": "Ungültige Netzmaske.",
  "app.ipv4config.err.invalidNetmaskContiguous": "Ungültige Netzmaske (muss zusammenhängende Bits sein, z.B. 255.255.255.0).",
  "app.ipv4config.err.invalidGateway": "Ungültige Gateway-Adresse.",
  "app.ipv4config.err.gatewayZero": "Gateway darf nicht 0.0.0.0 sein.",
  "app.ipv4config.err.applyFailed": "Übernehmen fehlgeschlagen: {reason}",

  "app.packetsniffer.nointerface": "Keine Schnittstelle",
  "app.packetsniffer.title": "Paket-Sniffer",
  "app.packetsniffer.unnamed": "Unbenannt",
  "app.packetsniffer.button.show": "{show} – {name}{port}",
  "app.packetsniffer.button.download": "{download} – {name}{port}",

  "app.simplehttpserver.title": "HTTP-Server",
  "app.simpletcpclient.title": "Einfacher TCP-Client",
  "app.simpletcpserver.title": "TCP Echo-Server",


  "app.simplehttpserver.appTitle": "Einfacher HTTP-Server",
  "app.simplehttpserver.placeholder.port": "Port (1..65535)",
  "app.simplehttpserver.placeholder.docRoot": "Dokumenten-Stammverzeichnis",

  "app.simplehttpserver.button.start": "Start",
  "app.simplehttpserver.button.stop": "Stopp",
  "app.simplehttpserver.button.clearLog": "Protokoll löschen",

  "app.simplehttpserver.label.port": "Port",
  "app.simplehttpserver.label.docRoot": "Dokumenten-Stammverzeichnis",
  "app.simplehttpserver.label.log": "Protokoll:",

  "app.simplehttpserver.status.pid": "PID: {pid}",
  "app.simplehttpserver.status.running": "Läuft: {running}",
  "app.simplehttpserver.status.port": "Port: {port}",
  "app.simplehttpserver.status.docRoot": "DocRoot: {docRoot}",
  "app.simplehttpserver.status.serverRef": "ServerRef: {serverRef}",
  "app.simplehttpserver.status.logEntries": "Protokolleinträge: {n}",

  "app.simplehttpserver.err.timeout": "{label} Timeout ({ms}ms)",

  "app.simplehttpserver.log.invalidPort": "[{time}] FEHLER ungültiger Port: \"{portStr}\"",
  "app.simplehttpserver.log.stopError": "[{time}] FEHLER Stopp: {reason}",
  "app.simplehttpserver.log.stopped": "[{time}] STOPPT",
  "app.simplehttpserver.log.openSocketError": "[{time}] FEHLER openTCPServerSocket: {reason}",
  "app.simplehttpserver.log.listen": "[{time}] LAUSCHEN :{port} (docRoot={docRoot})",
  "app.simplehttpserver.log.acceptError": "[{time}] FEHLER akzeptieren: {reason}",
  "app.simplehttpserver.log.connError": "[{time}] FEHLER Verbindung: {reason}",
  "app.simplehttpserver.log.methodNotAllowed": "[{time}] 405 {method} {target}",
  "app.simplehttpserver.log.notFound": "[{time}] 404 {method} {norm}",
  "app.simplehttpserver.log.ok": "[{time}] 200 {method} {norm} ({bytes} Bytes)",

  "app.simplehttpserver.http.400.title": "400 Ungültige Anfrage",
  "app.simplehttpserver.http.400.details": "Kopfende nicht gefunden oder Kopf größer als 64KiB.",
  "app.simplehttpserver.http.400.invalidRequestLine": "Ungültige Anforderungszeile:\n{reqLine}",

  "app.simplehttpserver.http.405.title": "405 Methode nicht erlaubt",
  "app.simplehttpserver.http.405.details": "Nur GET/HEAD werden unterstützt.\nSie haben gesendet: {method}",

  "app.simplehttpserver.http.404.title": "404 Nicht gefunden",
  "app.simplehttpserver.http.404.details": "Datei nicht gefunden:\n{norm}\n\nFS Pfad:\n{fsPath}",


  "app.simpletcpclient.placeholder.host": "Host / Adresse",
  "app.simpletcpclient.placeholder.port": "Port (1..65535)",
  "app.simpletcpclient.placeholder.message": "Nachricht eingeben…",

  "app.simpletcpclient.button.connect": "Verbinden",
  "app.simpletcpclient.button.disconnect": "Trennen",
  "app.simpletcpclient.button.send": "Senden",
  "app.simpletcpclient.button.clearChat": "Chat löschen",

  "app.simpletcpclient.label.host": "Host",
  "app.simpletcpclient.label.port": "Port",
  "app.simpletcpclient.label.chat": "Chat:",
  "app.simpletcpclient.label.message": "Nachricht",

  "app.simpletcpclient.status.pid": "PID: {pid}",
  "app.simpletcpclient.status.connected": "Verbunden: {connected}",
  "app.simpletcpclient.status.peer": "Peer: {peer}",
  "app.simpletcpclient.status.chatEntries": "Chat-Einträge: {n}",

  "app.simpletcpclient.log.hostEmpty": "[{time}] FEHLER Host ist leer",
  "app.simpletcpclient.log.invalidPort": "[{time}] FEHLER ungültiger Port: \"{portStr}\"",
  "app.simpletcpclient.log.resolveError": "[{time}] FEHLER Host auflösen \"{host}\": {reason}",
  "app.simpletcpclient.log.connected": "[{time}] VERBUNDEN mit {who}",
  "app.simpletcpclient.log.connectFailed": "[{time}] FEHLER Verbindung fehlgeschlagen: {reason}",
  "app.simpletcpclient.log.disconnectRequested": "[{time}] TRENNUNG angefordert",
  "app.simpletcpclient.log.disconnectError": "[{time}] FEHLER Trennung: {reason}",
  "app.simpletcpclient.log.sent": "[{time}] ICH -> {who}: \"{msg}\" (len={len} hex={hex})",
  "app.simpletcpclient.log.sendError": "[{time}] FEHLER Senden: {reason}",
  "app.simpletcpclient.log.recvError": "[{time}] FEHLER Empfang: {reason}",
  "app.simpletcpclient.log.remoteClosed": "[{time}] FERNVERBINDUNG GESCHLOSSEN {who}",
  "app.simpletcpclient.log.received": "[{time}] {who} -> ICH: \"{text}\" (len={len} hex={hex})",
  "app.simpletcpclient.log.disconnected": "[{time}] GETRENNT",
  "app.simpletcpclient.err.dnsNotAvailable": "DNS nicht verfügbar (kann \"{name}\" nicht auflösen)",
  "app.simpletcpclient.err.noConnKey": "connectTCPConn hat keinen Verbindungs-Schlüssel zurückgegeben",


  "app.simpletcpserver.placeholder.port": "Port (1..65535)",
  "app.simpletcpserver.button.start": "Starten",
  "app.simpletcpserver.button.stop": "Stoppen",
  "app.simpletcpserver.button.clearLog": "Protokoll löschen",

  "app.simpletcpserver.label.listenPort": "Lausch-Port",
  "app.simpletcpserver.label.log": "Protokoll:",

  "app.simpletcpserver.status.pid": "PID: {pid}",
  "app.simpletcpserver.status.running": "Läuft: {running}",
  "app.simpletcpserver.status.port": "Port: {port}",
  "app.simpletcpserver.status.connections": "Verbindungen: {n}",
  "app.simpletcpserver.status.logEntries": "Protokoll-Einträge: {n}",

  "app.simpletcpserver.log.invalidPort": "[{time}] FEHLER ungültiger Port: \"{portStr}\"",
  "app.simpletcpserver.log.listening": "[{time}] Lauschen (TCP) auf 0.0.0.0:{port}",
  "app.simpletcpserver.log.startFailed": "[{time}] FEHLER Start fehlgeschlagen: {reason}",
  "app.simpletcpserver.log.stopped": "[{time}] Gestoppt (Lausch-Port {port} geschlossen)",
  "app.simpletcpserver.log.stopError": "[{time}] FEHLER Stopp: {reason}",
  "app.simpletcpserver.log.acceptError": "[{time}] FEHLER Akzeptieren: {reason}",
  "app.simpletcpserver.log.connect": "[{time}] VERBUNDEN {who}",
  "app.simpletcpserver.log.connLoopError": "[{time}] FEHLER Verbindungs-Schleife: {reason}",
  "app.simpletcpserver.log.recvError": "[{time}] FEHLER Empfang {who}: {reason}",
  "app.simpletcpserver.log.rx": "[{time}] RX {who} len={len} hex={hex}",
  "app.simpletcpserver.log.txEcho": "[{time}] TX Echo {who} len={len}",
  "app.simpletcpserver.log.sendError": "[{time}] FEHLER Senden {who}: {reason}",
  "app.simpletcpserver.log.disconnect": "[{time}] TRENNUNG {who}",


  "app.sparktail.title": "Browser",
  "app.sparktail.placeholder.url": "about:start oder http://host[:port]/pfad",

  "app.sparktail.button.back": "←",
  "app.sparktail.button.forward": "→",
  "app.sparktail.button.reload": "⟳",
  "app.sparktail.button.go": "Los",
  "app.sparktail.button.stop": "Stopp",
  "app.sparktail.button.clearLog": "Protokoll löschen",

  "app.sparktail.tab.preview": "Vorschau",
  "app.sparktail.tab.source": "Quelle",
  "app.sparktail.tab.headers": "Header",
  "app.sparktail.tab.log": "Protokoll",

  "app.sparktail.status.ready": "Bereit.",
  "app.sparktail.status.loading": "Lädt: {url}",
  "app.sparktail.status.startPage": "Startseite.",
  "app.sparktail.status.stopped": "Gestoppt.",
  "app.sparktail.status.invalidUrl": "Ungültige URL: {error}",
  "app.sparktail.status.dnsError": "DNS-Fehler: {host}",
  "app.sparktail.status.socketError": "Socket-Fehler: {host}:{port}",
  "app.sparktail.status.bodyTooLarge": "HTTP {statusCode}: Körper zu groß.",
  "app.sparktail.status.httpSummary": "HTTP {statusCode} {reason} • {bytes} Bytes • {ct}",
  "app.sparktail.status.errorUrlEmpty": "Fehler: URL ist leer.",

  "app.sparktail.throbber.loading": "⏳",

  "app.sparktail.value.unknown": "(unbekannt)",

  "app.sparktail.label.recv": "Empf",
  "app.sparktail.label.dns": "DNS",
  "app.sparktail.label.connect": "Verbinden",

  "app.sparktail.err.onlyHttp": "Nur http:// ist erlaubt (kein https://).",
  "app.sparktail.err.missingHostInUrl": "Host fehlt in der URL.",
  "app.sparktail.err.hostEmpty": "Host ist leer.",
  "app.sparktail.err.timeout": "{label} Zeitüberschreitung ({ms}ms)",
  "app.sparktail.err.cancelled": "abgebrochen",
  "app.sparktail.err.eof": "EOF",
  "app.sparktail.err.readUntilExceeded": "readUntil überschritt maxBytes ({maxBytes})",
  "app.sparktail.err.bodyTooLarge": "Körper zu groß",
  "app.sparktail.err.dnsNotAvailable": "DNS nicht verfügbar (\"{name}\" kann nicht aufgelöst werden)",
  "app.sparktail.err.noConnKey": "connectTCPConn lieferte keinen Verbindungs-Schlüssel zurück",
  "app.sparktail.err.chunkedInvalidChunkSize": "Chunked Parse: ungültige Chunk-Größe \"{line}\"",
  "app.sparktail.err.chunkedInvalidSize": "Chunked Parse: ungültige Größe \"{hex}\"",
  "app.sparktail.err.bodyLimitExceeded": "Körperlimit überschritten (> {bodyLimit} Bytes).",
  "app.sparktail.err.chunkedMissingCrlf": "Chunked Parse: fehlendes CRLF nach Chunk",
  "app.sparktail.err.invalidContentLength": "Ungültige Content-Length",

  "app.sparktail.page.invalidUrl.title": "Ungültige URL",

  "app.sparktail.page.dnsError.title": "DNS-Fehler",
  "app.sparktail.page.dnsError.body": "Host \"{host}\" konnte nicht aufgelöst werden.\n\n{msg}",

  "app.sparktail.page.socketError.title": "Socket-Fehler",
  "app.sparktail.page.socketError.body": "Verbindung zu {host}:{port} fehlgeschlagen.\n\n{msg}",

  "app.sparktail.page.sendError.title": "Sende-Fehler",

  "app.sparktail.page.recvError.title": "Timeout/Empfangs-Fehler",

  "app.sparktail.page.bodyTooLarge.title": "Körper zu groß",
  "app.sparktail.page.bodyTooLarge.body": "Der Körper hat {bytes} Bytes, das Limit sind {bodyLimit} Bytes.",

  "app.sparktail.page.notSupported.title": "Nicht unterstützt",
  "app.sparktail.page.notSupported.body": "Sparktail rendert derzeit nur 200 und 404.\n\nEmpfangen: HTTP {statusCode} {reason}\n\nTipp: Überprüfen Sie den Tab Header/Quelle.",

  "app.sparktail.page.nonHtml.title": "HTTP {statusCode}",
  "app.sparktail.page.nonHtml.body": "Content-Type: {ct}\n\nVorschau ist für Nicht-HTML deaktiviert.\n\nQuelle enthält die Rohdaten als Text.",

  "app.sparktail.headers.aboutStart": "about:start (intern)\r\n",

  "app.sparktail.log.urlEmpty": "[{time}] FEHLER URL ist leer",
  "app.sparktail.log.aboutStart": "[{time}] about:start",
  "app.sparktail.log.stop": "[{time}] STOP",

  "app.sparktail.log.dnsError": "[{time}] FEHLER DNS \"{host}\": {msg}",
  "app.sparktail.log.connectError": "[{time}] FEHLER Verbindung {ip}:{port}: {msg}",
  "app.sparktail.log.request": "[{time}] -> {host}:{port} GET {path} (len={len} hex={hex})",
  "app.sparktail.log.sendError": "[{time}] FEHLER senden: {msg}",
  "app.sparktail.log.recvError": "[{time}] FEHLER empfangen: {msg}",
  "app.sparktail.log.httpNotRendered": "[{time}] HTTP {statusCode} {reason} (nicht dargestellt)",
  "app.sparktail.log.httpOk": "[{time}] HTTP {statusCode} {reason} (Body={bytes} Bytes)",

  "app.terminal.title": "Terminal",
  "app.terminal.welcome": "Willkommen bei {host}",
  "app.terminal.hintHelp": "Benutze den Befehl \"{cmd}\", um eine Liste bekannter Befehle zu erhalten.",
  "app.terminal.err.commandNotFound": "Befehl nicht gefunden: {cmd}",
  "app.terminal.err.errorPrefix": "Fehler: {msg}",
  "app.terminal.interrupt": "^C",

  "app.terminal.commands.cat.err.noFilesystem": "cat: kein Dateisystem",
  "app.terminal.commands.cat.usage": "Verwendung: {cmd} <Datei>",
  "app.terminal.commands.cp.usage": "Verwendung: cp [-r] <Quelle>... <Ziel>",
  "app.terminal.commands.cp.err.noFilesystem": "cp: kein Dateisystem",
  "app.terminal.commands.cp.err.missingDestination": "cp: Ziel-Datei fehlt",
  "app.terminal.commands.cp.err.noSuchFile": "cp: '{path}' kann nicht statget: Datei oder Verzeichnis existiert nicht",
  "app.terminal.commands.cp.err.omitDirectory": "cp: -r nicht angegeben; Verzeichnis '{path}' wird übersprungen",
  "app.terminal.commands.cp.err.overwriteNonDir": "cp: kann nicht Nicht-Verzeichnis '{dst}' mit Verzeichnis '{src}' überschreiben",
  "app.terminal.commands.cp.err.targetNotDir": "cp: Ziel '{target}' ist kein Verzeichnis",
  "app.terminal.commands.ls.err.noFilesystem": "ls: kein Dateisystem",
  "app.terminal.commands.mkdir.err.noFilesystem": "mkdir: kein Dateisystem",
  "app.terminal.commands.mkdir.usage": "Verwendung: mkdir [-p] <Verzeichnis> [...]",
  "app.terminal.commands.mkdir.err.missingOperand": "mkdir: fehlendes Argument",
  "app.terminal.commands.mv.err.noFilesystem": "mv: kein Dateisystem",
  "app.terminal.commands.mv.usage": "Verwendung: mv <Quelle>... <Ziel>",
  "app.terminal.commands.mv.err.cannotStat": "mv: '{path}' kann nicht statget: Datei oder Verzeichnis existiert nicht",
  "app.terminal.commands.mv.err.overwriteNonDir": "mv: kann nicht Nicht-Verzeichnis '{dst}' mit Verzeichnis '{src}' überschreiben",
  "app.terminal.commands.mv.err.targetNotDir": "mv: Ziel '{target}' ist kein Verzeichnis",
  "app.terminal.commands.rm.err.noFilesystem": "rm: kein Dateisystem",
  "app.terminal.commands.rm.usage": "Verwendung: rm [-r|-rf] <Pfad> [...]",
  "app.terminal.commands.rm.err.missingOperand": "rm: fehlendes Argument",
  "app.terminal.commands.rm.err.noSuchFile": "rm: '{path}' kann nicht entfernt werden: Datei oder Verzeichnis existiert nicht",
  "app.terminal.commands.rm.err.isDirectory": "rm: '{path}' kann nicht entfernt werden: Ist ein Verzeichnis",
  "app.terminal.commands.rmdir.err.noFilesystem": "rmdir: kein Dateisystem",
  "app.terminal.commands.rmdir.usage": "Verwendung: rmdir <Verzeichnis> [...]",
  "app.terminal.commands.rmdir.err.noSuchFile": "rmdir: Entfernen von '{path}' fehlgeschlagen: Datei oder Verzeichnis existiert nicht",
  "app.terminal.commands.rmdir.err.notDirectory": "rmdir: Entfernen von '{path}' fehlgeschlagen: Kein Verzeichnis",
  "app.terminal.commands.rmdir.err.notEmpty": "rmdir: Entfernen von '{path}' fehlgeschlagen: Verzeichnis nicht leer",
  "app.terminal.commands.touch.err.noFilesystem": "touch: kein Dateisystem",
  "app.terminal.commands.touch.usage": "Verwendung: touch <Datei> [...]",
  "app.terminal.commands.cd.err.noFilesystem": "cd: kein Dateisystem",
  "app.terminal.commands.cd.err.notDirectory": "cd: kein Verzeichnis: {path}",
  "app.terminal.commands.help.header": "Eingebaute Befehle:",
  "app.terminal.commands.help.list": "  {commands}",

  "app.terminal.commands.arp.err.noNetDriver": "arp: kein Netzwerk-Treiber",
  "app.terminal.commands.arp.err.noInterfaces": "arp: keine Schnittstellen",
  "app.terminal.commands.arp.err.unknownInterface": "arp: unbekannte Schnittstelle: {iface}",

  "app.terminal.commands.arp.msg.noArpTable": "{iface}: (keine ARP-Tabelle)",
  "app.terminal.commands.arp.msg.header": "{iface}:",
  "app.terminal.commands.arp.msg.empty": "  (leer)",

  "app.terminal.commands.ip.err.noNetDriver": "ip: kein Netzwerk-Treiber",
  "app.terminal.commands.ip.err.noInterfaces": "ip: keine Schnittstellen",
  "app.terminal.commands.ip.err.unknownInterface": "ip: unbekannte Schnittstelle: {iface}",
  "app.terminal.commands.ip.err.invalidCidr": "ip: ungültiges CIDR (erwartet A.B.C.D/len)",

  "app.terminal.commands.ip.usage.set": "Verwendung: ip set <ifaceIndex|ifaceName> <ip>/<prefix>",
  "app.terminal.commands.ip.usage.main": "Verwendung: ip [a|addr|show] | ip set <iface> <ip>/<prefix>",

  "app.terminal.commands.ip.state.up": "AKTIV",
  "app.terminal.commands.ip.state.down": "INAKTIV",
  "app.terminal.commands.ip.state.unknown": "UNBEKANNT",

  "app.terminal.commands.ip.out.inetLabel": "inet",
  "app.terminal.commands.ip.out.netmaskLabel": "Netzmaske",
  "app.terminal.commands.ip.out.ifaceLine": "{idx}: {name}  {state}",
  "app.terminal.commands.ip.out.inetLine": "    {inetLabel} {ip}  {netmaskLabel} {netmask}",
  "app.terminal.commands.ip.out.okSet": "ok: {iface} = {ip}/{prefix}",

  "app.terminal.commands.ping.usage": "usage: ping [-c Zähler] [-i Intervall] [-W Timeout] <Host>",

  "app.terminal.commands.ping.err.invalidCount": "ping: ungültige Anzahl",
  "app.terminal.commands.ping.err.invalidInterval": "ping: ungültiges Intervall",
  "app.terminal.commands.ping.err.invalidTimeout": "ping: ungültiger Timeout",
  "app.terminal.commands.ping.err.noNetworkDriver": "ping: kein Netzwerktreiber",
  "app.terminal.commands.ping.err.cannotResolve": "ping: {host} konnte nicht aufgelöst werden",

  "app.terminal.commands.ping.out.banner": "PING {host} ({dst}) 56(84) Bytes Daten.",
  "app.terminal.commands.ping.out.reply": "{bytes} Bytes von {dst}: icmp_seq={seq} ttl={ttl} zeit={timeMs} ms",
  "app.terminal.commands.ping.out.timeout": "Anfrage-Timeout für icmp_seq {seq}",

  "app.terminal.commands.ping.out.statsHeader": "--- {host} Ping-Statistik ---",
  "app.terminal.commands.ping.out.statsLine": "{transmitted} Pakete gesendet, {received} empfangen, {lossPct}% Paketverlust, Zeit {elapsedMs}ms",
  "app.terminal.commands.ping.out.rttLine": "rtt min/durchschnitt/max = {minMs}/{avgMs}/{maxMs} ms",

  "app.terminal.commands.route.err.noNetworkDriver": "route: kein Netzwerktreiber",
  "app.terminal.commands.route.err.emptyTable": "route: Routingtabelle leer",
  "app.terminal.commands.route.err.invalidDestinationCidr": "route: ungültiger Ziel-CIDR",
  "app.terminal.commands.route.err.invalidGatewayIp": "route: ungültige Gateway-IP",
  "app.terminal.commands.route.err.invalidInterface": "route: ungültiges Interface: {iface}",

  "app.terminal.commands.route.usage.add": "usage: route add <dst>/<prefix> via <gateway> dev <ifIndex|ifName|lo>",
  "app.terminal.commands.route.usage.del": "usage: route del <dst>/<prefix>",
  "app.terminal.commands.route.usage.main": "usage: route [show] | route add ... | route del ...",

  "app.terminal.commands.route.out.tableHeader": "Ziel              Netzmaske          Gateway            Interface  Auto",
  "app.terminal.commands.route.out.autoYes": "ja",
  "app.terminal.commands.route.out.autoNo": "nein",
  "app.terminal.commands.route.out.okAdded": "ok: Route hinzugefügt",
  "app.terminal.commands.route.out.okRemoved": "ok: {count} entfernt",
  "app.terminal.commands.ss.err.noNetworkDriver": "ss: kein Netzwerktreiber",

  "app.terminal.commands.ss.out.header": "Netid  Status       Lokale Adresse:Port         Zieladresse:Port          Info",

  "app.terminal.commands.ss.out.udpLine": "udp    UNCONN      {local} {peer} rxq={rxq}",

  "app.terminal.commands.ss.out.tcpListenLine": "tcp    {state} {local} {peer} rxq={rxq} aq={aq}",

  "app.terminal.commands.ss.out.tcpConnLine": "tcp    {state} {local} {peer} rxq={rxq}",

  "app.terminal.commands.traceroute.usage": "usage: traceroute [-m max_ttl] [-q probes] [-w timeout] <host>",

  "app.terminal.commands.traceroute.err.invalidMaxTtl": "traceroute: ungültiges max_ttl",
  "app.terminal.commands.traceroute.err.invalidProbes": "traceroute: ungültige Anzahl von Probes",
  "app.terminal.commands.traceroute.err.invalidTimeout": "traceroute: ungültiger Timeout",
  "app.terminal.commands.traceroute.err.noNetworkDriver": "traceroute: kein Netzwerktreiber",
  "app.terminal.commands.traceroute.err.cannotResolve": "traceroute: {host} konnte nicht aufgelöst werden",

  "app.terminal.commands.traceroute.out.banner": "Traceroute zu {host} ({dst}), max. {maxTtl} Hops, {probes} Probes",


  "app.texteditor.title": "Editor",
  "app.texteditor.noFilesystem": "Kein Dateisystem verfügbar.",
  "app.texteditor.status.newFile": "(neue Datei)",
  "app.texteditor.status.modified": "● geändert",
  "app.texteditor.button.new": "Neu",
  "app.texteditor.button.open": "Öffnen...",
  "app.texteditor.button.save": "Speichern",
  "app.texteditor.button.saveAs": "Speichern als..",
  "app.texteditor.confirm.discardNew": "Es gibt nicht gespeicherte Änderungen. Verwerfen und neue Datei erstellen?",
  "app.texteditor.confirm.discardOpen": "Es gibt nicht gespeicherte Änderungen. Verwerfen und eine andere Datei öffnen?",
  "app.texteditor.confirm.overwrite": "Bestehende Datei überschreiben?",
  "app.texteditor.save.failed": "{path} — Speichern fehlgeschlagen",
  "app.texteditor.picker.title.open": "Datei öffnen",
  "app.texteditor.picker.title.save": "Datei speichern als",
  "app.texteditor.picker.placeholder.filename": "datei.txt",
  "app.texteditor.picker.item.up": "..",
  "app.texteditor.picker.button.open": "Öffnen",
  "app.texteditor.picker.button.save": "Speichern",
  "app.texteditor.picker.button.cancel": "Abbrechen",


  "app.udpechoserver.title": "UDP Echo-Server",
  "app.udpechoserver.placeholder.port": "Port (1..65535)",

  "app.udpechoserver.button.start": "Start",
  "app.udpechoserver.button.stop": "Stopp",
  "app.udpechoserver.button.clearLog": "Log löschen",

  "app.udpechoserver.label.listenPort": "Lauschport",
  "app.udpechoserver.label.log": "Log:",

  "app.udpechoserver.status.pid": "PID: {pid}",
  "app.udpechoserver.status.running": "Läuft: {running}",
  "app.udpechoserver.status.port": "Port: {port}",
  "app.udpechoserver.status.logEntries": "Logeinträge: {n}",

  "app.udpechoserver.log.invalidPort": "[{time}] FEHLER ungültiger Port: \"{portStr}\"",
  "app.udpechoserver.log.listening": "[{time}] Lausche auf 0.0.0.0:{port}",
  "app.udpechoserver.log.startFailed": "[{time}] FEHLER Start fehlgeschlagen: {reason}",
  "app.udpechoserver.log.stopped": "[{time}] Gestoppt (Port {port} geschlossen)",
  "app.udpechoserver.log.stopError": "[{time}] FEHLER Stopp: {reason}",
  "app.udpechoserver.log.recvError": "[{time}] FEHLER Empfang: {reason}",
  "app.udpechoserver.log.rx": "[{time}] RX von {ip}:{srcPort} Länge={len} hex={hex}",
  "app.udpechoserver.log.txEcho": "[{time}] TX Echo an {ip}:{srcPort} Länge={len}",
  "app.udpechoserver.log.sendError": "[{time}] FEHLER Senden: {reason}",

  "os.back": "Zurück",
  "os.notitle": "Kein Titel",
  "os.untitled": "Unbenannt",

  "panel.close": "Schließen",

  "pc.title": "PC",

  "rect.title": "Rechteck",
  "rect.color": "Farbe",
  "rect.opacity": "Deckkraft",

  "router.title": "Router",
  "router.genericsettingstitle": "Allgemeine Einstellungen",
  "router.name": "Name",
  "router.apply": "Anwenden",
  "router.interfaces": "Schnittstellen",
  "router.save": "Speichern",
  "router.routingtable": "Routing-Tabelle",
  "router.unknown": "unbekannt",
  "router.addinterface": "Schnittstelle hinzufügen",

  "router.showpacketlog": "Paket-Log anzeigen",
  "router.nopacketlog": "Kein Paket-Log verfügbar",
  "router.deleteinterface": "Schnittstelle löschen",
  "router.confirminterfacedelete": "Sind Sie sicher, dass Sie die Schnittstelle ${name} löschen möchten?",
  "router.nointerfaceselected": "Keine Schnittstelle ausgewählt",

  "router.stateup": "aktiv",
  "router.statedown": "inaktiv",
  "router.routingtable.actions": "Aktionen",
  "router.routingtable.auto": "Automatisch",
  "router.routingtable.dst": "Ziel",
  "router.routingtable.interface": "Schnittstelle",
  "router.routingtable.netmask": "Netzmaske",
  "router.routingtable.nexthop": "Nächster Hop",

  "router.routingtable.add": "hinzufügen",
  "router.routingtable.delete": "löschen",
  "router.routingtable.save": "speichern",
  "router.routingtable.no": "nein",
  "router.routingtable.yes": "ja",
  "router.routingtable.missing": "fehlt",

  "sim.new": "Neu",
  "sim.load": "Laden",
  "sim.save": "Speichern",
  "sim.edit": "Bearbeiten",
  "sim.run": "Starten",
  "sim.mode": "Modus",
  "sim.project": "Projekt",
  "sim.speed": "Geschwindigkeit",
  "sim.pause": "Pause",
  "sim.edittools": "Bearbeitungswerkzeuge",

  "sim.invalidfilewarning": "Ungültiges Dateiformat oder nicht unterstütztes Speicherformat.",
  "sim.loadfailederror": "Ladevorgang fehlgeschlagen.",

  "sim.discardandnewwarning": "Aktuelle Simulation verwerfen und eine neue starten?",
  "sim.discardandloadwarning": "Aktuelle Simulation verwerfen und eine andere laden?",

  "sim.langswitch.confirmdiscard": "Aktuelle Simulation verwerfen und die Sprache wechseln?",

  "sim.language": "Sprache",

  "sim.tool.link": "Verbindung",
  "sim.tool.pc": "PC",
  "sim.tool.rectangle": "Rechteck",
  "sim.tool.router": "Router",
  "sim.tool.select": "Auswählen",
  "sim.tool.switch": "Switch",
  "sim.tool.textbox": "Textfeld",
  "sim.tool.delete": "Löschen",

  "switch.title": "Switch",
  "switch.genericsettings": "Allgemeine Einstellungen",
  "switch.name": "Name",
  "switch.apply": "Anwenden",
  "switch.sat": "Switch Adressentabelle (SAT)",
  "switch.sat.mac": "MAC",
  "switch.sat.port": "Port",

  "switch.sat.empty": "Die SAT ist noch leer.",

  "textbox.text": "Text",
  "textbox.title": "Textfeld",
  "textbox.hint": "unterstützt Mini-Markdown wie **fett**, *kursiv* usw.",
}