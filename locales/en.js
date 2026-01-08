//@ts-check

export default {
  //Meta Data; Here the Name of the language should be inserted in
  "lang.name": "English (English)",

  //App Name
  "name": "Beaver Tracer",

  "app.generic.title": "Gernic App",

  "app.about.title": "About",
  "app.about.heading.systemInfo": "System info",
  "app.about.body.systemInfo": "OS: {os}\nPID: {pid}\nRunning apps: {runningApps}\nFocusID: {focusID}\nTime: {time}",

  "app.ipv4config.title": "IP Settings",
  "app.ipv4config.button.apply": "Apply",
  "app.ipv4config.label.interface": "Interface",
  "app.ipv4config.label.ip": "IP",
  "app.ipv4config.label.netmask": "Netmask",
  "app.ipv4config.label.gateway": "Gateway",
  "app.ipv4config.msg.noInterfaces": "No interfaces available.",
  "app.ipv4config.msg.interfaceNotFound": "Interface {i} not found.",
  "app.ipv4config.msg.loadedInterface": "Loaded interface {i}.",
  "app.ipv4config.msg.appliedWithGw": "Applied: if{i} = {ip} / {netmask}, gw {gw}",
  "app.ipv4config.msg.appliedGwCleared": "Applied: if{i} = {ip} / {netmask}, gw (cleared)",
  "app.ipv4config.err.noNetDriver": "No net driver on OS.",
  "app.ipv4config.err.invalidIp": "Invalid IP address.",
  "app.ipv4config.err.invalidNetmask": "Invalid netmask.",
  "app.ipv4config.err.invalidNetmaskContiguous": "Invalid netmask (must be contiguous bits, e.g. 255.255.255.0).",
  "app.ipv4config.err.invalidGateway": "Invalid gateway address.",
  "app.ipv4config.err.gatewayZero": "Gateway must not be 0.0.0.0.",
  "app.ipv4config.err.applyFailed": "Apply failed: {reason}",

  "app.packetsniffer.nointerface": "No interface",
  "app.packetsniffer.title": "Packet Sniffer",
  "app.packetsniffer.unnamed": "Unnamed",
  "app.packetsniffer.button.show": "{show} – {name}{port}",
  "app.packetsniffer.button.download": "{download} – {name}{port}",

  "app.simplehttpserver.title": "HTTP-Server",
  "app.simpletcpclient.title": "Simple TCP Client",
  "app.simpletcpserver.title": "TCP Echo-Server",


  "app.simplehttpserver.placeholder.port": "Port (1..65535)",
  "app.simplehttpserver.placeholder.docRoot": "Document Root",

  "app.simplehttpserver.button.start": "Start",
  "app.simplehttpserver.button.stop": "Stop",
  "app.simplehttpserver.button.clearLog": "Clear Log",

  "app.simplehttpserver.label.port": "Port",
  "app.simplehttpserver.label.docRoot": "Document Root",
  "app.simplehttpserver.label.log": "Log:",

  "app.simplehttpserver.status.pid": "PID: {pid}",
  "app.simplehttpserver.status.running": "Running: {running}",
  "app.simplehttpserver.status.port": "Port: {port}",
  "app.simplehttpserver.status.docRoot": "DocRoot: {docRoot}",
  "app.simplehttpserver.status.serverRef": "ServerRef: {serverRef}",
  "app.simplehttpserver.status.logEntries": "Log entries: {n}",

  "app.simplehttpserver.err.timeout": "{label} timeout ({ms}ms)",

  "app.simplehttpserver.log.invalidPort": "[{time}] ERROR invalid port: \"{portStr}\"",
  "app.simplehttpserver.log.stopError": "[{time}] ERROR stop: {reason}",
  "app.simplehttpserver.log.stopped": "[{time}] STOPPED",
  "app.simplehttpserver.log.openSocketError": "[{time}] ERROR openTCPServerSocket: {reason}",
  "app.simplehttpserver.log.listen": "[{time}] LISTEN :{port} (docRoot={docRoot})",
  "app.simplehttpserver.log.acceptError": "[{time}] ERROR accept: {reason}",
  "app.simplehttpserver.log.connError": "[{time}] ERROR conn: {reason}",
  "app.simplehttpserver.log.methodNotAllowed": "[{time}] 405 {method} {target}",
  "app.simplehttpserver.log.notFound": "[{time}] 404 {method} {norm}",
  "app.simplehttpserver.log.ok": "[{time}] 200 {method} {norm} ({bytes} bytes)",

  "app.simplehttpserver.http.400.title": "400 Bad Request",
  "app.simplehttpserver.http.400.details": "Header end not found or header > 64KiB.",
  "app.simplehttpserver.http.400.invalidRequestLine": "Invalid request line:\n{reqLine}",

  "app.simplehttpserver.http.405.title": "405 Method Not Allowed",
  "app.simplehttpserver.http.405.details": "Only GET/HEAD are supported.\nYou sent: {method}",

  "app.simplehttpserver.http.404.title": "404 Not Found",
  "app.simplehttpserver.http.404.details": "File not found:\n{norm}\n\nFS path:\n{fsPath}",


  "app.simpletcpclient.placeholder.host": "Host / Address",
  "app.simpletcpclient.placeholder.port": "Port (1..65535)",
  "app.simpletcpclient.placeholder.message": "Type a message…",

  "app.simpletcpclient.button.connect": "Connect",
  "app.simpletcpclient.button.disconnect": "Disconnect",
  "app.simpletcpclient.button.send": "Send",
  "app.simpletcpclient.button.clearChat": "Clear Chat",

  "app.simpletcpclient.label.host": "Host",
  "app.simpletcpclient.label.port": "Port",
  "app.simpletcpclient.label.chat": "Chat:",
  "app.simpletcpclient.label.message": "Message",

  "app.simpletcpclient.status.pid": "PID: {pid}",
  "app.simpletcpclient.status.connected": "Connected: {connected}",
  "app.simpletcpclient.status.peer": "Peer: {peer}",
  "app.simpletcpclient.status.chatEntries": "Chat entries: {n}",

  "app.simpletcpclient.log.hostEmpty": "[{time}] ERROR host is empty",
  "app.simpletcpclient.log.invalidPort": "[{time}] ERROR invalid port: \"{portStr}\"",
  "app.simpletcpclient.log.resolveError": "[{time}] ERROR resolve host \"{host}\": {reason}",
  "app.simpletcpclient.log.connected": "[{time}] CONNECTED to {who}",
  "app.simpletcpclient.log.connectFailed": "[{time}] ERROR connect failed: {reason}",
  "app.simpletcpclient.log.disconnectRequested": "[{time}] DISCONNECT requested",
  "app.simpletcpclient.log.disconnectError": "[{time}] ERROR disconnect: {reason}",
  "app.simpletcpclient.log.sent": "[{time}] ME -> {who}: \"{msg}\" (len={len} hex={hex})",
  "app.simpletcpclient.log.sendError": "[{time}] ERROR send: {reason}",
  "app.simpletcpclient.log.recvError": "[{time}] ERROR recv: {reason}",
  "app.simpletcpclient.log.remoteClosed": "[{time}] REMOTE CLOSED {who}",
  "app.simpletcpclient.log.received": "[{time}] {who} -> ME: \"{text}\" (len={len} hex={hex})",
  "app.simpletcpclient.log.disconnected": "[{time}] DISCONNECTED",
  "app.simpletcpclient.err.dnsNotAvailable": "DNS not available (cannot resolve \"{name}\")",
  "app.simpletcpclient.err.noConnKey": "connectTCPConn did not return a connection key",


  "app.simpletcpserver.placeholder.port": "Port (1..65535)",
  "app.simpletcpserver.button.start": "Start",
  "app.simpletcpserver.button.stop": "Stop",
  "app.simpletcpserver.button.clearLog": "Clear Log",

  "app.simpletcpserver.label.listenPort": "Listen Port",
  "app.simpletcpserver.label.log": "Log:",

  "app.simpletcpserver.status.pid": "PID: {pid}",
  "app.simpletcpserver.status.running": "Running: {running}",
  "app.simpletcpserver.status.port": "Port: {port}",
  "app.simpletcpserver.status.connections": "Connections: {n}",
  "app.simpletcpserver.status.logEntries": "Log entries: {n}",

  "app.simpletcpserver.log.invalidPort": "[{time}] ERROR invalid port: \"{portStr}\"",
  "app.simpletcpserver.log.listening": "[{time}] Listening (TCP) on 0.0.0.0:{port}",
  "app.simpletcpserver.log.startFailed": "[{time}] ERROR start failed: {reason}",
  "app.simpletcpserver.log.stopped": "[{time}] Stopped (listen port {port} closed)",
  "app.simpletcpserver.log.stopError": "[{time}] ERROR stop: {reason}",
  "app.simpletcpserver.log.acceptError": "[{time}] ERROR accept: {reason}",
  "app.simpletcpserver.log.connect": "[{time}] CONNECT {who}",
  "app.simpletcpserver.log.connLoopError": "[{time}] ERROR conn loop: {reason}",
  "app.simpletcpserver.log.recvError": "[{time}] ERROR recv {who}: {reason}",
  "app.simpletcpserver.log.rx": "[{time}] RX {who} len={len} hex={hex}",
  "app.simpletcpserver.log.txEcho": "[{time}] TX echo {who} len={len}",
  "app.simpletcpserver.log.sendError": "[{time}] ERROR send {who}: {reason}",
  "app.simpletcpserver.log.disconnect": "[{time}] DISCONNECT {who}",


  "app.sparktail.title": "Browser",
  "app.sparktail.placeholder.url": "about:start or http://host[:port]/path",

  "app.sparktail.button.back": "←",
  "app.sparktail.button.forward": "→",
  "app.sparktail.button.reload": "⟳",
  "app.sparktail.button.go": "Go",
  "app.sparktail.button.stop": "Stop",
  "app.sparktail.button.clearLog": "Clear Log",

  "app.sparktail.tab.preview": "Preview",
  "app.sparktail.tab.source": "Source",
  "app.sparktail.tab.headers": "Headers",
  "app.sparktail.tab.log": "Log",

  "app.sparktail.status.ready": "Ready.",
  "app.sparktail.status.loading": "Loading: {url}",
  "app.sparktail.status.startPage": "Start page.",
  "app.sparktail.status.stopped": "Stopped.",
  "app.sparktail.status.invalidUrl": "Invalid URL: {error}",
  "app.sparktail.status.dnsError": "DNS error: {host}",
  "app.sparktail.status.socketError": "Socket error: {host}:{port}",
  "app.sparktail.status.bodyTooLarge": "HTTP {statusCode}: body too large.",
  "app.sparktail.status.httpSummary": "HTTP {statusCode} {reason} • {bytes} bytes • {ct}",
  "app.sparktail.status.errorUrlEmpty": "Error: URL is empty.",

  "app.sparktail.throbber.loading": "⏳",

  "app.sparktail.value.unknown": "(unknown)",

  "app.sparktail.label.recv": "Recv",
  "app.sparktail.label.dns": "DNS",
  "app.sparktail.label.connect": "Connect",

  "app.sparktail.err.onlyHttp": "Only http:// is allowed (no https://).",
  "app.sparktail.err.missingHostInUrl": "Host is missing in the URL.",
  "app.sparktail.err.hostEmpty": "Host is empty.",
  "app.sparktail.err.timeout": "{label} timeout ({ms}ms)",
  "app.sparktail.err.cancelled": "cancelled",
  "app.sparktail.err.eof": "EOF",
  "app.sparktail.err.readUntilExceeded": "readUntil exceeded maxBytes ({maxBytes})",
  "app.sparktail.err.bodyTooLarge": "Body too large",
  "app.sparktail.err.dnsNotAvailable": "DNS not available (cannot resolve \"{name}\")",
  "app.sparktail.err.noConnKey": "connectTCPConn did not return a connection key",
  "app.sparktail.err.chunkedInvalidChunkSize": "Chunked parse: invalid chunk-size \"{line}\"",
  "app.sparktail.err.chunkedInvalidSize": "Chunked parse: invalid size \"{hex}\"",
  "app.sparktail.err.bodyLimitExceeded": "Body limit exceeded (> {bodyLimit} bytes).",
  "app.sparktail.err.chunkedMissingCrlf": "Chunked parse: missing CRLF after chunk",
  "app.sparktail.err.invalidContentLength": "Invalid Content-Length",

  "app.sparktail.page.invalidUrl.title": "Invalid URL",

  "app.sparktail.page.dnsError.title": "DNS Error",
  "app.sparktail.page.dnsError.body": "Host \"{host}\" could not be resolved.\n\n{msg}",

  "app.sparktail.page.socketError.title": "Socket Error",
  "app.sparktail.page.socketError.body": "Connection to {host}:{port} failed.\n\n{msg}",

  "app.sparktail.page.sendError.title": "Send Error",

  "app.sparktail.page.recvError.title": "Timeout/Recv Error",

  "app.sparktail.page.bodyTooLarge.title": "Body too large",
  "app.sparktail.page.bodyTooLarge.body": "Body has {bytes} bytes, limit is {bodyLimit} bytes.",

  "app.sparktail.page.notSupported.title": "Not supported",
  "app.sparktail.page.notSupported.body": "Sparktail currently only renders 200 and 404.\n\nReceived: HTTP {statusCode} {reason}\n\nTip: Check the Headers/Source tab.",

  "app.sparktail.page.nonHtml.title": "HTTP {statusCode}",
  "app.sparktail.page.nonHtml.body": "Content-Type: {ct}\n\nPreview is disabled for non-HTML.\n\nSource contains the raw data as text.",

  "app.sparktail.headers.aboutStart": "about:start (internal)\r\n",

  "app.sparktail.log.urlEmpty": "[{time}] ERROR URL is empty",
  "app.sparktail.log.aboutStart": "[{time}] about:start",
  "app.sparktail.log.stop": "[{time}] STOP",

  "app.sparktail.log.dnsError": "[{time}] ERROR DNS \"{host}\": {msg}",
  "app.sparktail.log.connectError": "[{time}] ERROR connect {ip}:{port}: {msg}",
  "app.sparktail.log.request": "[{time}] -> {host}:{port} GET {path} (len={len} hex={hex})",
  "app.sparktail.log.sendError": "[{time}] ERROR send: {msg}",
  "app.sparktail.log.recvError": "[{time}] ERROR recv: {msg}",
  "app.sparktail.log.httpNotRendered": "[{time}] HTTP {statusCode} {reason} (not rendered)",
  "app.sparktail.log.httpOk": "[{time}] HTTP {statusCode} {reason} (body={bytes} bytes)",

  "app.terminal.title": "Terminal",
  "app.terminal.welcome": "Welcome to {host}",
  "app.terminal.hintHelp": "Use the command \"{cmd}\" to get a list of known commands.",
  "app.terminal.err.commandNotFound": "command not found: {cmd}",
  "app.terminal.err.errorPrefix": "error: {msg}",
  "app.terminal.interrupt": "^C",

  "app.terminal.commands.cat.err.noFilesystem": "cat: no filesystem",
  "app.terminal.commands.cat.usage": "usage: {cmd} <file>",
  "app.terminal.commands.cp.usage": "usage: cp [-r] <src>... <dst>",
  "app.terminal.commands.cp.err.noFilesystem": "cp: no filesystem",
  "app.terminal.commands.cp.err.missingDestination": "cp: missing destination file operand",
  "app.terminal.commands.cp.err.noSuchFile": "cp: cannot stat '{path}': No such file or directory",
  "app.terminal.commands.cp.err.omitDirectory": "cp: -r not specified; omitting directory '{path}'",
  "app.terminal.commands.cp.err.overwriteNonDir": "cp: cannot overwrite non-directory '{dst}' with directory '{src}'",
  "app.terminal.commands.cp.err.targetNotDir": "cp: target '{target}' is not a directory",
  "app.terminal.commands.ls.err.noFilesystem": "ls: no filesystem",
  "app.terminal.commands.mkdir.err.noFilesystem": "mkdir: no filesystem",
  "app.terminal.commands.mkdir.usage": "usage: mkdir [-p] <dir> [...]",
  "app.terminal.commands.mkdir.err.missingOperand": "mkdir: missing operand",
  "app.terminal.commands.mv.err.noFilesystem": "mv: no filesystem",
  "app.terminal.commands.mv.usage": "usage: mv <src>... <dst>",
  "app.terminal.commands.mv.err.cannotStat": "mv: cannot stat '{path}': No such file or directory",
  "app.terminal.commands.mv.err.overwriteNonDir": "mv: cannot overwrite non-directory '{dst}' with directory '{src}'",
  "app.terminal.commands.mv.err.targetNotDir": "mv: target '{target}' is not a directory",
  "app.terminal.commands.rm.err.noFilesystem": "rm: no filesystem",
  "app.terminal.commands.rm.usage": "usage: rm [-r|-rf] <path> [...]",
  "app.terminal.commands.rm.err.missingOperand": "rm: missing operand",
  "app.terminal.commands.rm.err.noSuchFile": "rm: cannot remove '{path}': No such file or directory",
  "app.terminal.commands.rm.err.isDirectory": "rm: cannot remove '{path}': Is a directory",
  "app.terminal.commands.rmdir.err.noFilesystem": "rmdir: no filesystem",
  "app.terminal.commands.rmdir.usage": "usage: rmdir <dir> [...]",
  "app.terminal.commands.rmdir.err.noSuchFile": "rmdir: failed to remove '{path}': No such file or directory",
  "app.terminal.commands.rmdir.err.notDirectory": "rmdir: failed to remove '{path}': Not a directory",
  "app.terminal.commands.rmdir.err.notEmpty": "rmdir: failed to remove '{path}': Directory not empty",
  "app.terminal.commands.touch.err.noFilesystem": "touch: no filesystem",
  "app.terminal.commands.touch.usage": "usage: touch <file> [...]",
  "app.terminal.commands.cd.err.noFilesystem": "cd: no filesystem",
  "app.terminal.commands.cd.err.notDirectory": "cd: not a directory: {path}",
  "app.terminal.commands.help.header": "Built-in commands:",
  "app.terminal.commands.help.list": "  {commands}",

  "app.terminal.commands.arp.err.noNetDriver": "arp: no net driver",
  "app.terminal.commands.arp.err.noInterfaces": "arp: no interfaces",
  "app.terminal.commands.arp.err.unknownInterface": "arp: unknown interface: {iface}",

  "app.terminal.commands.arp.msg.noArpTable": "{iface}: (no arp table)",
  "app.terminal.commands.arp.msg.header": "{iface}:",
  "app.terminal.commands.arp.msg.empty": "  (empty)",

  "app.terminal.commands.ip.err.noNetDriver": "ip: no net driver",
  "app.terminal.commands.ip.err.noInterfaces": "ip: no interfaces",
  "app.terminal.commands.ip.err.unknownInterface": "ip: unknown interface: {iface}",
  "app.terminal.commands.ip.err.invalidCidr": "ip: invalid cidr (expected A.B.C.D/len)",

  "app.terminal.commands.ip.usage.set": "usage: ip set <ifaceIndex|ifaceName> <ip>/<prefix>",
  "app.terminal.commands.ip.usage.main": "usage: ip [a|addr|show] | ip set <iface> <ip>/<prefix>",

  "app.terminal.commands.ip.state.up": "UP",
  "app.terminal.commands.ip.state.down": "DOWN",
  "app.terminal.commands.ip.state.unknown": "UNKNOWN",

  "app.terminal.commands.ip.out.inetLabel": "inet",
  "app.terminal.commands.ip.out.netmaskLabel": "netmask",
  "app.terminal.commands.ip.out.ifaceLine": "{idx}: {name}  {state}",
  "app.terminal.commands.ip.out.inetLine": "    {inetLabel} {ip}  {netmaskLabel} {netmask}",
  "app.terminal.commands.ip.out.okSet": "ok: {iface} = {ip}/{prefix}",

  "app.terminal.commands.ping.usage": "usage: ping [-c count] [-i interval] [-W timeout] <host>",

  "app.terminal.commands.ping.err.invalidCount": "ping: invalid count",
  "app.terminal.commands.ping.err.invalidInterval": "ping: invalid interval",
  "app.terminal.commands.ping.err.invalidTimeout": "ping: invalid timeout",
  "app.terminal.commands.ping.err.noNetworkDriver": "ping: no network driver",
  "app.terminal.commands.ping.err.cannotResolve": "ping: cannot resolve {host}",

  "app.terminal.commands.ping.out.banner": "PING {host} ({dst}) 56(84) bytes of data.",
  "app.terminal.commands.ping.out.reply": "{bytes} bytes from {dst}: icmp_seq={seq} ttl={ttl} time={timeMs} ms",
  "app.terminal.commands.ping.out.timeout": "Request timeout for icmp_seq {seq}",

  "app.terminal.commands.ping.out.statsHeader": "--- {host} ping statistics ---",
  "app.terminal.commands.ping.out.statsLine": "{transmitted} packets transmitted, {received} received, {lossPct}% packet loss, time {elapsedMs}ms",
  "app.terminal.commands.ping.out.rttLine": "rtt min/avg/max = {minMs}/{avgMs}/{maxMs} ms",

  "app.terminal.commands.route.err.noNetworkDriver": "route: no network driver",
  "app.terminal.commands.route.err.emptyTable": "route: routing table empty",
  "app.terminal.commands.route.err.invalidDestinationCidr": "route: invalid destination cidr",
  "app.terminal.commands.route.err.invalidGatewayIp": "route: invalid gateway ip",
  "app.terminal.commands.route.err.invalidInterface": "route: invalid interface: {iface}",

  "app.terminal.commands.route.usage.add": "usage: route add <dst>/<prefix> via <gateway> dev <ifIndex|ifName|lo>",
  "app.terminal.commands.route.usage.del": "usage: route del <dst>/<prefix>",
  "app.terminal.commands.route.usage.main": "usage: route [show] | route add ... | route del ...",

  "app.terminal.commands.route.out.tableHeader": "Destination        Netmask            Gateway            Iface  Auto",
  "app.terminal.commands.route.out.autoYes": "yes",
  "app.terminal.commands.route.out.autoNo": "no",
  "app.terminal.commands.route.out.okAdded": "ok: route added",
  "app.terminal.commands.route.out.okRemoved": "ok: removed {count}",
  "app.terminal.commands.ss.err.noNetworkDriver": "ss: no network driver",

  "app.terminal.commands.ss.out.header": "Netid  State         Local Address:Port          Peer Address:Port           Info",

  "app.terminal.commands.ss.out.udpLine": "udp    UNCONN        {local} {peer} rxq={rxq}",

  "app.terminal.commands.ss.out.tcpListenLine": "tcp    {state} {local} {peer} rxq={rxq} aq={aq}",

  "app.terminal.commands.ss.out.tcpConnLine": "tcp    {state} {local} {peer} rxq={rxq}",

  "app.terminal.commands.traceroute.usage": "usage: traceroute [-m max_ttl] [-q probes] [-w timeout] <host>",

  "app.terminal.commands.traceroute.err.invalidMaxTtl": "traceroute: invalid max_ttl",
  "app.terminal.commands.traceroute.err.invalidProbes": "traceroute: invalid probes",
  "app.terminal.commands.traceroute.err.invalidTimeout": "traceroute: invalid timeout",
  "app.terminal.commands.traceroute.err.noNetworkDriver": "traceroute: no network driver",
  "app.terminal.commands.traceroute.err.cannotResolve": "traceroute: cannot resolve {host}",

  "app.terminal.commands.traceroute.out.banner": "traceroute to {host} ({dst}), {maxTtl} hops max, {probes} probes",


  "app.texteditor.title": "Editor",
  "app.texteditor.noFilesystem": "No filesystem available.",
  "app.texteditor.status.newFile": "(new file)",
  "app.texteditor.status.modified": "● modified",
  "app.texteditor.button.new": "New",
  "app.texteditor.button.open": "Open...",
  "app.texteditor.button.save": "Save",
  "app.texteditor.button.saveAs": "Save As..",
  "app.texteditor.confirm.discardNew": "You have unsaved changes. Discard and create a new file?",
  "app.texteditor.confirm.discardOpen": "You have unsaved changes. Discard and open another file?",
  "app.texteditor.confirm.overwrite": "Overwrite existing file?",
  "app.texteditor.save.failed": "{path} — save failed",
  "app.texteditor.picker.title.open": "Open file",
  "app.texteditor.picker.title.save": "Save file as",
  "app.texteditor.picker.placeholder.filename": "filename.txt",
  "app.texteditor.picker.item.up": "..",
  "app.texteditor.picker.button.open": "Open",
  "app.texteditor.picker.button.save": "Save",
  "app.texteditor.picker.button.cancel": "Cancel",


  "app.udpechoserver.title": "UDP Echo-Server",
  "app.udpechoserver.placeholder.port": "Port (1..65535)",

  "app.udpechoserver.button.start": "Start",
  "app.udpechoserver.button.stop": "Stop",
  "app.udpechoserver.button.clearLog": "Clear Log",

  "app.udpechoserver.label.listenPort": "Listen Port",
  "app.udpechoserver.label.log": "Log:",

  "app.udpechoserver.status.pid": "PID: {pid}",
  "app.udpechoserver.status.running": "Running: {running}",
  "app.udpechoserver.status.port": "Port: {port}",
  "app.udpechoserver.status.logEntries": "Log entries: {n}",

  "app.udpechoserver.log.invalidPort": "[{time}] ERROR invalid port: \"{portStr}\"",
  "app.udpechoserver.log.listening": "[{time}] Listening on 0.0.0.0:{port}",
  "app.udpechoserver.log.startFailed": "[{time}] ERROR start failed: {reason}",
  "app.udpechoserver.log.stopped": "[{time}] Stopped (port {port} closed)",
  "app.udpechoserver.log.stopError": "[{time}] ERROR stop: {reason}",
  "app.udpechoserver.log.recvError": "[{time}] ERROR recv: {reason}",
  "app.udpechoserver.log.rx": "[{time}] RX from {ip}:{srcPort} len={len} hex={hex}",
  "app.udpechoserver.log.txEcho": "[{time}] TX echo to {ip}:{srcPort} len={len}",
  "app.udpechoserver.log.sendError": "[{time}] ERROR send: {reason}",

  "os.back": "Back",
  "os.notitle": "No Title",
  "os.untitled": "Untitled",

  "panel.close": "Close",

  "pc.title": "PC",

  "rect.title": "Rectangle",
  "rect.color": "Colour",
  "rect.opacity": "Opacity",

  "router.title": "Router",
  "router.genericsettingstitle": "Common Settings",
  "router.name": "Name",
  "router.apply": "Apply",
  "router.interfaces": "Interfaces",
  "router.save": "Save",
  "router.routingtable": "Routing table",
  "router.unknown": "unknown",
  "router.addinterface": "Add interface",

  "router.showpacketlog": "Show Packet Log",
  "router.nopacketlog": "No packet log to show",
  "router.deleteinterface": "Delete interface",
  "router.confirminterfacedelete": "Are you sure to delete interface ${name}",
  "router.nointerfaceselected": "no interface selected",

  "router.stateup": "up",
  "router.statedown": "down",
  "router.routingtable.actions": "Actions",
  "router.routingtable.auto": "Auto",
  "router.routingtable.dst": "Destination",
  "router.routingtable.interface": "Iface",
  "router.routingtable.netmask": "Netmask",
  "router.routingtable.nexthop": "Next Hop",

  "router.routingtable.add": "add",
  "router.routingtable.delete": "delete",
  "router.routingtable.save": "save",
  "router.routingtable.no": "no",
  "router.routingtable.yes": "yes",
  "router.routingtable.missing": "missing",

  "sim.new": "New",
  "sim.load": "Load",
  "sim.save": "Save",
  "sim.edit": "Edit",
  "sim.run": "Run",
  "sim.mode": "Mode",
  "sim.project": "Project",
  "sim.speed": "Speed",
  "sim.pause": "Pause",
  "sim.edittools": "Edit tools",
  "sim.about" : "About",
  "sim.trace" : "Trace",

  "sim.invalidfilewarning": "Invalid file format or unsupported save file format.",
  "sim.loadfailederror": "Load operation failed.",

  "sim.discardandnewwarning": "Discard current simulation and start a new one?",
  "sim.discardandloadwarning": "Discard current simulation and load another one?",

  "sim.langswitch.confirmdiscard": "Discard current simulation and switch languages?",

  "sim.language": "Language",

  "sim.tool.link": "Link",
  "sim.tool.pc": "PC",
  "sim.tool.rectangle": "Rectangle",
  "sim.tool.router": "Router",
  "sim.tool.select": "Select",
  "sim.tool.switch": "Switch",
  "sim.tool.textbox": "TextBox",
  "sim.tool.delete": "Delete",

  "switch.title": "Switch",
  "switch.genericsettings": "Common settings",
  "switch.name": "Name",
  "switch.apply": "Apply",
  "switch.sat": "Switch Adress Table (SAT)",
  "switch.sat.mac": "MAC",
  "switch.sat.port": "Port",

  "switch.sat.empty": "The SAT is still empty.",

  "textbox.text": "Text",
  "textbox.title": "Textbox",
  "textbox.hint": "supports Mini-Markdown like **bold**, *italic* etc.",
}