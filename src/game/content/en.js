//@ts-check
// English game content — same shape as de.js (see there). Device names in
// network plans stay as they are named in the simulations (German), like
// in the English lessons.

export default {
    intermezzos: {
        routing: {
            title: "Routing Rush",
            desc: "You are the router! Packets come racing in — send each one to the right exit before the network clogs up.",
            kc: "Subnetting, routers and routing",
        },
        vlsm: {
            title: "Address Space Tetris",
            desc: "Rooms need addresses! Fit subnets into the address space — without waste and without blocking yourself.",
            kc: "IPv4 subnetting (VLSM), subnet mask",
        },
        belt: {
            title: "Packet Belt",
            desc: "Packets roll in — set their number with the bit switches before the buffer overflows.",
            kc: "IPv4 addressing (binary), netmask",
        },
        guard: {
            title: "Gatekeeper",
            desc: "Front desk duty: who may enter the server room, use the admin account, open the grades folder? Stamp right — by the house rules.",
            kc: "Data security: physical, system and data access control",
        },
        binary: {
            title: "Binary Blitz",
            desc: "Switch on the right bits — first with help, then without. Finally you read binary numbers.",
            kc: "IPv4 addressing",
        },
        mask: {
            title: "Mask Training",
            desc: "Practise prefix, netmask, network and broadcast address at your own pace.",
            kc: "Subnet mask and subnetting",
        },
        access: {
            title: "Who gets in?",
            desc: "Classify security measures: door, login or data?",
            kc: "Physical, system and data access control",
        },
        media: {
            title: "Cable or radio?",
            desc: "Fibre, twisted pair, Wi-Fi or LoRaWAN — which medium fits the job?",
            kc: "Transmission media, LAN/WAN, LoRaWAN, structured cabling",
        },
        line: {
            title: "Line Lab",
            desc: "Calculate with baud and bit/s, identify transmission modes and tell message, information and signal apart.",
            kc: "Message/information/signal, bit rate, symbol rate, transmission modes",
        },
    },

    acts: {
        1: {
            title: "First week on the school network",
            intro: "Mr Biber, the Beaver school's administrator, welcomes you: “Great to have you! Start with the switches — there are two problems right now.”",
        },
        2: {
            title: "Addresses and routes",
            intro: "“Now it gets exciting,” says Mr Biber. “Subnets, routers, DHCP — that's where most mistakes happen.”",
        },
        3: {
            title: "Services on the network",
            intro: "“The network is running. But people want websites, mail and names instead of numbers …”",
        },
        4: {
            title: "Security",
            intro: "“Final stage: being reachable from outside — but only what's supposed to be reachable.”",
        },
    },

    tickets: {
        "t-switch": {
            title: "Clara has disappeared",
            from: "School office",
            kc: "Switches, troubleshooting with ping",
            story: "Ever since <strong>David</strong> joined the network, nobody can reach Clara — and something is off with Ben too. Sort the network out.",
            plan: {
                head: ["Device", "IP address", "Switch port"],
                rows: [["Anna", "192.168.0.10/24", "1"], ["Ben", "192.168.0.11/24", "2"], ["Clara", "192.168.0.12/24", "3"], ["David", "192.168.0.13/24", "4"]],
            },
            hints: [
                "Look at the cables first: is every PC on the right port? Then check each PC's IP settings.",
                "Ping Ben from Anna and open a trace for Anna. How many ARP replies arrive — and with which MAC addresses?",
            ],
            checks: [
                "Anna has her address from the plan",
                "Ben has his address from the plan",
                "Clara has her address from the plan",
                "David has his address from the plan",
                "Anna reaches Clara",
                "Anna reaches David",
                "Ben reaches Clara",
            ],
            question: {
                text: "How can you tell in the tracer that two devices have the same IP address?",
                options: [
                    "The ping always fails",
                    "One ARP request gets two replies with different MAC addresses",
                    "The switch shows an error message",
                ],
            },
            lessonLearned: "Troubleshooting means comparing the <strong>target</strong> (network plan) with the <strong>actual state</strong> (cables, settings, tracer). A successful ping doesn't mean everything is right.",
        },
        "t-vlan": {
            title: "Ben sees too much",
            from: "Head teacher",
            kc: "VLAN (optional), switches",
            story: "After the weekend rebuild: “<strong>Ben</strong> can suddenly get to the administration computers — but not to Anna any more.” That's a data protection problem! Port 8 is the trunk on both switches (<code>tagged</code>, VLANs <code>10,20</code>).",
            plan: {
                head: ["Device", "Switch", "Port", "VLAN", "IP address"],
                rows: [["Sekretariat", "EG", "1", "10", "192.168.0.10"], ["Anna", "EG", "2", "20", "192.168.0.20"], ["Schulleitung", "OG", "1", "10", "192.168.0.11"], ["Ben", "OG", "2", "20", "192.168.0.21"]],
            },
            hints: [
                "Open the VLAN tab on both switches and compare each row with the plan: PVID of the PC ports and the allowed VLANs on the trunk.",
                "There are two faults, both on Switch OG.",
            ],
            checks: [
                "Administration reaches itself across both floors",
                "Anna and Ben reach each other",
                "Administration and teaching are separated (1)",
                "Administration and teaching are separated (2)",
                "Administration and teaching are separated (3)",
            ],
            question: {
                text: "What was going on?",
                options: [
                    "Ben's port had the wrong PVID, and the trunk on Switch OG didn't let VLAN 20 through",
                    "Ben had a wrong IP address",
                    "The trunk port wasn't plugged in",
                ],
            },
            lessonLearned: "Typical VLAN faults: a port with the <strong>wrong PVID</strong> and a <strong>trunk that doesn't allow a VLAN</strong>. Always check both ends of a trunk.",
        },
        "t-subnet": {
            title: "Three areas, zero connections",
            from: "Caretaker",
            kc: "IPv4 subnetting, routers",
            story: "A colleague set up the PCs on the school network — since then almost nothing works between the areas. Do the maths!",
            plan: {
                head: ["Device", "IP address", "Prefix", "Gateway"],
                rows: [["PC Verwaltung", "192.168.10.2", "/26", "192.168.10.1"], ["PC Lehrerzimmer", "192.168.10.66", "/26", "192.168.10.65"], ["PC Computerraum", "192.168.10.130", "/26", "192.168.10.129"]],
            },
            hints: [
                "Look at each PC's IP settings and compare them with the plan. Not every fault is obvious at first glance.",
                "Work out for each PC: which subnet is its address really in? Is it the network or broadcast address? Is the mask right?",
            ],
            checks: [
                "PC Verwaltung has the right address",
                "PC Lehrerzimmer has the right address",
                "PC Computerraum has the right address",
                "Verwaltung reaches Lehrerzimmer",
                "Verwaltung reaches Computerraum",
                "Lehrerzimmer reaches Computerraum",
            ],
            question: {
                text: "Why couldn't the PC in the Computerraum use the address 192.168.10.191/26?",
                options: [
                    "It lies outside the address range of 192.168.0.0/16",
                    "It is the broadcast address of the subnet 192.168.10.128/26",
                    "It is the network address of the subnet",
                ],
            },
            lessonLearned: "Typical subnetting faults: an address <strong>outside its own subnet</strong>, a <strong>wrong mask</strong>, the <strong>network or broadcast address</strong> used for a device.",
        },
        "t-route": {
            title: "There, but not back",
            from: "Firma A (Anna)",
            kc: "Routers and static routing, traceroute",
            story: "Firma A — Router A — transit network — Router B — Firma B. <strong>Router A</strong> has the route to Firma B (<code>172.16.0.0/24</code> via <code>10.0.0.2</code>). Still, Clara doesn't answer Anna.",
            hints: [
                "Ping Clara from Anna and open a trace for Clara. Does the ping arrive — and does she answer?",
                "traceroute 172.16.0.10 on Anna: up to which router do replies come back?",
                "Look at Router B's routing table. Does it know 192.168.0.0/24?",
            ],
            checks: [
                "Router B knows the way to Firma A",
                "Anna reaches Clara",
            ],
            question: {
                text: "Why isn't a route in one direction enough?",
                options: [
                    "Routers only forward packets they created themselves",
                    "The reply has to find its way back too — every router on the way back needs a route to the sender's network",
                    "Ping only ever works within one network",
                ],
            },
            lessonLearned: "Every connection needs a <strong>way there and back</strong>. traceroute shows how far it gets.",
        },
        "t-dhcp": {
            title: "Laptops without network",
            from: "Staff room",
            kc: "Dynamic IP address assignment (DHCP)",
            story: "After the holidays: “Our laptops can't get onto the network any more!” Both are set to <strong>DHCP</strong>. The DHCP server should hand out <code>192.168.0.100</code>–<code>192.168.0.120</code>, gateway <code>192.168.0.1</code>, DNS <code>192.168.0.53</code>.",
            hints: [
                "An address starting with 169.254 is one the device gave itself — no DHCP server answered.",
                "Trace for a laptop: only DHCP Discover — or a reply too? Is the DHCP server running, and which range does it hand out?",
                "After changing the server: set the laptop to static and back to DHCP, Apply.",
            ],
            checks: [
                "Laptop 1 has an address from the range",
                "Laptop 2 has an address from the range",
                "Laptop 1 reaches the server",
                "Laptop 2 reaches the server",
            ],
            question: {
                text: "A device has the address 169.254.17.3. What does that mean?",
                options: [
                    "It got an address from the DHCP server",
                    "It got no reply from a DHCP server and gave itself an address",
                    "It is a router",
                ],
            },
            lessonLearned: "<code>169.254.x.x</code> = <strong>no DHCP server answered</strong>. Check: is the server running? Is the range right?",
        },
        "t-dns": {
            title: "Works with the number, not the name",
            from: "Ms Kraus (teacher)",
            kc: "Host names and name resolution (DNS)",
            story: "“<code>www.beaver-schule.de</code> doesn't load for me. But <code>http://192.168.0.20</code> works!”",
            plan: {
                head: ["What", "Target"],
                rows: [["DNS server on the Client-PC", "192.168.0.53"], ["Entry in the Schul-DNS", "www.beaver-schule.de → 192.168.0.20"]],
            },
            hints: [
                "nslookup www.beaver-schule.de on the Client-PC: which server was asked — and what came back?",
                "Compare the answer with the plan. Where is this name configured?",
            ],
            checks: [
                "The Client-PC resolves the name correctly",
            ],
            question: {
                text: "A website is reachable by IP address but not by name. Where do you look first?",
                options: [
                    "At the web server",
                    "At DNS: the configured DNS server and the entry itself",
                    "At the switch",
                ],
            },
            lessonLearned: "Works with IP but not with the name: <strong>DNS</strong>. Check the DNS server first, then the entry.",
        },
        "t-ports": {
            title: "Connection refused",
            from: "Computer science department",
            kc: "Internet services, ports",
            story: "After an update: “The echo service refuses every connection, and the website won't load either.” According to the plan: <strong>web server</strong> on port <code>80</code>, <strong>echo service</strong> on port <code>5000</code>.",
            hints: [
                "Connect to 192.168.0.20:5000 with the simple TCP client and open a trace. What does the server answer to your SYN?",
                "nmap -p 80,5000 192.168.0.20 on the client PC — and ss on the server.",
                "Open the TCP echo server and HTTP server apps on the server: are they running? On which port?",
            ],
            checks: [
                "Echo service reachable on port 5000",
                "Web server reachable on port 80",
            ],
            question: {
                text: "The server answers your SYN with RST. What does that mean?",
                options: [
                    "The computer can't be reached",
                    "The computer is reachable, but no program is listening on that port",
                    "The connection was established successfully",
                ],
            },
            lessonLearned: "<strong>RST</strong> to a SYN: computer there, <strong>service not</strong> — not started or wrong port.",
        },
        "t-http": {
            title: "The contact page is gone",
            from: "School office",
            kc: "Internet services (HTTP)",
            story: "“On our website, the <strong>Contact</strong> link only leads to an error message.” The page should be at <code>http://192.168.0.20/kontakt.html</code>.",
            hints: [
                "Open the page in the browser or with curl -v. Which status code comes back?",
                "The web server only serves files from its document root. Look on the server with ls — in /home as well.",
                "mv moves a file: mv <source> <target folder>.",
            ],
            checks: [
                "The contact page is in the document root",
            ],
            question: {
                text: "What does status code 404 mean?",
                options: [
                    "The server can't be reached",
                    "The server is running, but the requested file doesn't exist there",
                    "Access is forbidden",
                ],
            },
            lessonLearned: "<strong>404</strong>: server reachable, <strong>file missing</strong> from the document root.",
        },
        "t-mail": {
            title: "Mail for Ben",
            from: "Anna",
            kc: "Internet services (SMTP, POP3/IMAP), DNS",
            story: "“I can't send Ben any mail!” Fix everything, then send a mail from Anna to <code>ben@biber-mail.de</code>. Relaying between the mail servers takes a few seconds.",
            plan: {
                head: ["What", "Target"],
                rows: [["Anna's outgoing server (SMTP)", "mail.beaver-schule.de, port 25"], ["MX entry of biber-mail.de", "mail.biber-mail.de (priority 10)"]],
            },
            hints: [
                "Try to send and look at the Log tab. Does the answer sound like SMTP?",
                "Read the message from MAILER-DAEMON. nslookup -type=MX biber-mail.de on Anna's PC.",
                "Outgoing server: Mail app → Settings. MX entries: DNS server → MX tab.",
            ],
            checks: [
                "A mail is in Ben's mailbox",
            ],
            question: {
                text: "How does a mail server know where to send a mail for @biber-mail.de?",
                options: [
                    "From the domain's MX entry in DNS",
                    "From the browser's address bar",
                    "It sends it to every mail server it knows",
                ],
            },
            lessonLearned: "Mail servers find the destination mail server through the <strong>MX entry</strong> in DNS.",
        },
        "t-nat": {
            title: "It worked yesterday",
            from: "Clara (from outside)",
            kc: "Routers, addressing (NAT, port forwarding)",
            story: "The port forwarding <code>TCP 80 → 192.168.178.10:80</code> is set up. After a power cut, Clara can't reach the home web server any more. Fix the fault <strong>for good</strong>.",
            hints: [
                "Compare the LAN IP in the port forwarding with the address the home web server actually has right now.",
                "Is the server set to DHCP? How do you make sure it always gets the same address?",
            ],
            checks: [
                "The home web server has its fixed address",
                "Clara reaches the server through the port forwarding",
            ],
            question: {
                text: "Why does a server behind port forwarding need a fixed address?",
                options: [
                    "Because the rule points to one specific LAN address — with DHCP it can change",
                    "Because DHCP is forbidden on home networks",
                    "Because web servers only start with fixed addresses",
                ],
            },
            lessonLearned: "Port forwardings point to a <strong>fixed LAN address</strong>. Servers get a static address or a DHCP reservation.",
        },
        "t-tls": {
            title: "Warning at the canteen",
            from: "Canteen team",
            kc: "SSL/TLS certificates",
            story: "The canteen page <code>https://mensa.beaver-schule.de/</code> suddenly shows a certificate warning. The client PC trusts the school CA. To keep things simple, the school CA is on the canteen server itself. Make the page load <strong>without a warning</strong>.",
            hints: [
                "Open the page on the client PC and read the warning: subject, issuer, valid until.",
                "Certificate manager on mensa.beaver-schule.de → Sign tab: have the school CA re-sign the existing certificate and save it under a new name.",
                "Canteen HTTP server: Stop, choose the new certificate in the HTTPS tab, Use, Start.",
            ],
            checks: [
                "The canteen page loads without a certificate warning",
            ],
            question: {
                text: "What is the advantage of a certificate issued by a trusted CA?",
                options: [
                    "The connection gets faster",
                    "The browser can check it really is talking to the right server, and the connection is encrypted",
                    "The server no longer needs an IP address",
                ],
            },
            lessonLearned: "A valid certificate proves the server's <strong>identity</strong>. Common faults: <strong>expired</strong>, <strong>self-signed</strong>, <strong>wrong name</strong>.",
        },
        "t-firewall": {
            title: "Nothing works since the new rules",
            from: "Mr Biber",
            kc: "Data security (system access control), firewall",
            story: "Mr Biber switched the firewall to the whitelist principle. Since then the <strong>website</strong> can't be reached from outside, and <strong>no mail</strong> arrives. But SSH must stay blocked!",
            hints: [
                "Test from the internet PC with nmap -p 22,25,80 198.51.100.10 and look at the Hits column of the rules.",
                "Which port belongs to HTTP, which to SMTP? And: the first matching rule wins.",
            ],
            checks: [
                "Website reachable from outside",
                "Mail server reachable from outside",
                "SSH stays blocked from outside",
            ],
            question: {
                text: "What does the whitelist principle mean for a firewall?",
                options: [
                    "Everything is allowed, only known bad things are blocked",
                    "Everything is forbidden, only what is explicitly allowed gets through",
                    "Only white packets may pass",
                ],
            },
            lessonLearned: "Whitelist: <strong>everything forbidden unless allowed</strong>. The <strong>first matching rule</strong> decides.",
        },
    },

    ranks: ["Intern", "Trainee", "Junior admin", "Network admin", "Senior admin", "Network guru"],

    badges: {
        first: { title: "First steps", desc: "Finished an intermezzo or a ticket" },
        router: { title: "Packet pro", desc: "Routing Rush with at least 90 points" },
        space: { title: "Space saver", desc: "Address Space Tetris with at least 90 points" },
        belt: { title: "Belt pro", desc: "Packet Belt with at least 90 points" },
        gate: { title: "Key master", desc: "Gatekeeper with at least 90 points" },
        bits: { title: "Bit master", desc: "Binary Blitz with at least 90 points" },
        masks: { title: "Mask pro", desc: "Mask Training with at least 90 points" },
        guard: { title: "Gatekeeper", desc: "“Who gets in?” with at least 90 points" },
        cables: { title: "Cable expert", desc: "“Cable or radio?” with at least 90 points" },
        lab: { title: "Lab rat", desc: "Line Lab with at least 90 points" },
        allround: { title: "All-rounder", desc: "Finished every intermezzo" },
        ticket: { title: "First ticket", desc: "Solved your first ticket" },
        nohints: { title: "No crib sheet", desc: "Solved a ticket without a single hint" },
        act: { title: "Act {no} done", desc: "Solved every ticket in “{title}”" },
        learner: { title: "Hard worker", desc: "Evaluated 20 quizzes in the lessons" },
        guru: { title: "Network guru", desc: "Reached the highest rank" },
    },

    games: {
        routing: {
            intro: `<p>You are the Beaver school's <strong>router</strong>. Packets arrive over the line — each one has a <strong>destination IP address</strong>.
                Send each packet with the keys <kbd>1</kbd>–<kbd>4</kbd> (or by clicking) to the exit whose network matches the destination IP.</p>
                <p>If a packet reaches the router before you decide, or you send it to the wrong exit, you lose a life.
                The faster you decide, the more points. Right decisions in a row raise your multiplier.</p>
                <p>Later levels add a <strong>default route</strong> and overlapping networks: then the <strong>longest matching prefix</strong> wins.</p>`,
            rooms: ["Administration", "Staff room", "Computer lab", "Library", "Servers", "Wi-Fi", "Canteen", "Workshop"],
            internet: "Internet",
            levels: [
                "Two halves: a /24 split into two /25s.",
                "Four quarters: four /26 networks.",
                "Mixed: networks of different sizes.",
                "Even smaller: /27 networks join in.",
                "Masks instead of prefixes: now the table shows the netmask.",
                "Across the octet boundary: networks that start in the third octet.",
                "Out to the internet: anything that matches nowhere goes via the default route.",
                "Longest prefix match: the networks overlap — the longest matching prefix wins.",
            ],
        },
        vlsm: {
            intro: `<p>The school has been given an address range — and every room needs its own <strong>subnet</strong>.
                For each request you choose the <strong>block size</strong> (the prefix) and place the block in the address space.</p>
                <ul>
                    <li>A network needs <strong>devices + 2</strong> addresses (network and broadcast address). A <code>/26</code> has 64 addresses, so room for 62 devices.</li>
                    <li>Blocks only snap to <strong>valid boundaries</strong>: a 64 block starts at .0, .64, .128 or .192.</li>
                    <li>Too small costs a life. Too big works but wastes addresses — and you may run out of room later.</li>
                </ul>
                <p>Controls: <kbd>←</kbd> <kbd>→</kbd> move, <kbd>↑</kbd> <kbd>↓</kbd> block size, <kbd>Space</kbd> place — or use the mouse.</p>`,
            rooms: ["Administration", "Staff room", "Computer lab 1", "Computer lab 2", "Library", "Guest Wi-Fi", "Student Wi-Fi", "Servers", "Printers", "Canteen", "Workshop", "Cameras", "Telephony", "Caretaker"],
            levels: [
                "By size: requests come from the largest to the smallest network.",
                "More rooms: smaller networks join in.",
                "Shuffled: now requests come in random order. Leave room for big blocks!",
                "Getting tight: seven networks in one /24.",
                "Twice as big: a /23 — and it gets filled to the brim.",
                "Pro level: a /22 and lots of networks.",
            ],
        },
        belt: {
            intro: `<p>Packets arrive on the conveyor belt. The sorting machine only recognises a packet by its <strong>bit pattern</strong>.</p>
                <ul>
                    <li><strong>Packet with a number:</strong> switch the 8 bits (<kbd>1</kbd>–<kbd>8</kbd> or click) so that their place values add up to the number. As soon as the pattern matches, the packet is delivered. <kbd>0</kbd> clears all bits.</li>
                    <li><strong>Packet with a binary number:</strong> type the decimal value and confirm with <kbd>Enter</kbd>.</li>
                </ul>
                <p>If a packet reaches the end, it goes into the <strong>buffer</strong>. When the buffer has no room left, the game is over.</p>`,
            levels: [
                "Warm-up: small numbers up to 15 — with a sum display.",
                "Full octet: numbers up to 255 — still with a sum display.",
                "No safety net: the sum display is gone.",
                "The other way round: read the binary number and type the decimal value.",
                "Mask octets: 128, 192, 224 … — this is what netmasks look like in binary.",
                "Mixed and fast: setting and reading in turn.",
            ],
        },
        guard: {
            intro: `<p>Today you're on <strong>front desk duty</strong> at the Beaver school. People come one after another with a request. Check their details against the <strong>house rules</strong> and stamp:</p>
                <ul>
                    <li><strong>Physical access</strong> — it's about a <em>room</em>.</li>
                    <li><strong>System access</strong> — it's about <em>logging in</em> to a system.</li>
                    <li><strong>Data access</strong> — it's about <em>data</em>, after logging in.</li>
                </ul>
                <p>Each one <strong>allow</strong> or <strong>deny</strong> — keys <kbd>1</kbd>–<kbd>6</kbd> or click. A stamp only counts if the kind of control <em>and</em> the decision are right. Three wrong stamps and Mr Biber takes over the desk himself.</p>`,
            names: ["Anna Becker", "Ben Yılmaz", "Clara Wagner", "David Nowak", "Elif Kaya", "Finn Schulz", "Greta Hoffmann", "Hamid Rahimi", "Ida Fischer", "Jonas Weber", "Kim Nguyen", "Lena Schäfer", "Mats Braun", "Nora Klein", "Omar Haddad", "Paula Wolf"],
            roles: {
                it: "IT team",
                teacher: "Teacher",
                student: "Student",
                office: "School office",
                head: "Head teacher",
                caretaker: "Caretaker",
                visitor: "Visitor",
            },
            entry: {
                server: "wants to enter the <strong>server room</strong>.",
                office: "wants to enter the <strong>school office</strong>.",
            },
            login: {
                pc: "wants to log in to a <strong>school PC</strong>.",
                admin: "wants to log in to the server with the <strong>admin account</strong>.",
            },
            data: {
                read: "wants to <strong>read</strong> files in the folder <strong>“{folder}”</strong>.",
                write: "wants to <strong>change</strong> files in the folder <strong>“{folder}”</strong>.",
            },
            folders: { grades: "Grades", files: "Student files", exams: "Final exams" },
            rules: {
                server: "Server room: IT team only.",
                office: "School office: all school staff. Visitors only when accompanied, students not at all.",
                own: "Log in with your own account only.",
                lockout: "After 3 failed attempts an account is locked.",
                admin: "Admin account: IT team only, and only with two-factor login.",
                grades: "Folder “Grades”: teachers only.",
                files: "Folder “Student files”: school office and head teacher only.",
                exams: "Folder “Final exams”: teachers and head teacher may read, only the head teacher may change.",
                expired: "Expired badges don't count — no entry.",
                night: "From 8 pm, entry only for the caretaker and the IT team.",
            },
            levels: [
                "First shift: it's only about rooms.",
                "Now logins too: accounts, failed attempts, two-factor.",
                "Data joins in: who may read or change which folders?",
                "Look closely: expiry dates and the time now count.",
                "Rush hour: all rules, lots of people.",
            ],
        },
        binary: {
            intro: `<p>Computers calculate with <strong>bits</strong> — zeros and ones. An <strong>octet</strong> has 8 bits with the place values
                <code>128 64 32 16 8 4 2 1</code>. An IPv4 address consists of four octets.</p>
                <p>Switch on the right bits until you reach the target number. In the first rounds a sum display helps you — after that it doesn't.</p>`,
            set: "Set the number <strong>{n}</strong>.",
            setBlind: "No help: set the number <strong>{n}</strong>.",
            toDec: "Which decimal number is <code>{bin}</code>?",
            toBin: "Write <strong>{n}</strong> as an 8-digit binary number.",
            allOff: "all bits off",
            facts: [
                { q: "How many different values can an octet (8 bits) represent?", a: "256", wrong: ["255", "128", "8"], why: "2⁸ = 256 values, namely 0 to 255." },
                { q: "How many bits does an IPv4 address have?", a: "32", wrong: ["8", "64", "128"], why: "4 octets × 8 bits = 32 bits." },
                { q: "How many bits does an IPv6 address have?", a: "128", wrong: ["32", "64", "48"], why: "IPv6 addresses are 128 bits long — four times as long as IPv4 addresses." },
            ],
        },
        mask: {
            intro: `<p>The <strong>netmask</strong> splits an IPv4 address into a <strong>network part</strong> and a <strong>host part</strong>.
                The <strong>prefix</strong> <code>/n</code> says how many bits (from the left) belong to the network part.</p>
                <p>Network address: all host bits 0. Broadcast address: all host bits 1. Usable hosts: 2<sup>host bits</sup> − 2.</p>`,
            qMask: "Which netmask belongs to <code>/{p}</code>?",
            eMask: "/{p} = {p} ones: <code>{mask}</code>.",
            qPrefix: "Which prefix belongs to the netmask <code>{mask}</code>? (number only)",
            ePrefix: "{mask} has {p} ones → <code>/{p}</code>.",
            qHosts: "How many devices (hosts) fit into a <code>/{p}</code> network?",
            eHosts: "32 − {p} = {h} host bits → 2<sup>{h}</sup> − 2 = {n} (network and broadcast address subtracted).",
            qFit: "A room needs <strong>{need}</strong> addresses for devices. Which prefix is the <em>smallest network that fits</em>?",
            eFit: "/{p} offers {n} hosts, /{p2} only {n2}.",
            qNet: "What is the <strong>network address</strong> of <code>{cidr}</code>?",
            eNet: "Block size in the last octet: {block}. {octet} lies in the block starting at {start} → <code>{net}</code>.",
            qBc: "What is the <strong>broadcast address</strong> of <code>{cidr}</code>?",
            eBc: "Network <code>{net}</code>, block size {block} → last address <code>{bc}</code>.",
            qSame: "Are <code>{a}</code> and <code>{b}</code> in the <strong>same network</strong>?",
            yes: "Yes",
            no: "No",
            eSame: "Network of {a}: <code>{na}</code>, network of {b}: <code>{nb}</code>.",
            qCount: "How many <code>/{to}</code> subnets fit into a <code>/{from}</code> network?",
            eCount: "{d} borrowed bits → 2<sup>{d}</sup> = {n} subnets.",
            qProNet: "Pro round: network address of <code>{cidr}</code>?",
            eProNet: "The interesting octet is the third (block size {block}), the fourth becomes 0 → <code>{net}</code>.",
            qProBc: "Pro round: broadcast address of <code>{cidr}</code>?",
            eProBc: "Network <code>{net}</code>, mask <code>{mask}</code> → all host bits 1: <code>{bc}</code>.",
        },
        access: {
            intro: `<p>Data security starts at the door. There are three levels:</p>
                <ul>
                    <li><strong>Physical access control</strong> — who may enter a <em>room</em> or building? <i class="fa-solid fa-door-closed" aria-hidden="true"></i></li>
                    <li><strong>System access control</strong> — who may use an <em>IT system</em> at all (login)? <i class="fa-solid fa-key" aria-hidden="true"></i></li>
                    <li><strong>Data access control</strong> — after logging in, who may access which <em>data</em>? <i class="fa-solid fa-folder-closed" aria-hidden="true"></i></li>
                </ul>
                <p>Assign each measure to the right level.</p>`,
            cats: ["Physical access", "System access", "Data access"],
            explain: "{cat}: {why}",
            items: [
                { text: "The server room can only be opened with a chip card.", cat: 0, why: "It's about entering a room." },
                { text: "Visitors sign in at reception and wear a visitor badge.", cat: 0, why: "Controls who may enter the building." },
                { text: "The data centre has an alarm system and video surveillance.", cat: 0, why: "Protects the rooms against unauthorised entry." },
                { text: "Keys for the technical room are only handed out against a signature.", cat: 0, why: "Controls physical entry to the room." },
                { text: "The network cabinet in the corridor is locked.", cat: 0, why: "Stops anyone getting at the devices themselves." },
                { text: "Logging on to the PC requires a password of at least 12 characters.", cat: 1, why: "Controls who may use the IT system at all." },
                { text: "After three wrong passwords the account is locked.", cat: 1, why: "Protects the login to the system." },
                { text: "Logging in to the school portal also requires a code from an app (2FA).", cat: 1, why: "Two-factor login secures access to the system." },
                { text: "The screen locks after five minutes without input.", cat: 1, why: "Nobody can use an unattended system." },
                { text: "Only those who know the WPA3 key get onto the school Wi-Fi.", cat: 1, why: "Controls who may use the network." },
                { text: "From home, teachers can only get onto the school network via VPN with a personal certificate.", cat: 1, why: "The VPN controls who may use the network from outside." },
                { text: "Students cannot open the “Grades” folder.", cat: 2, why: "They are logged in — but they may not see certain data." },
                { text: "In the “Final exams” folder only the head teacher may write, teachers may only read.", cat: 2, why: "Read and write permissions on data." },
                { text: "Each role (student, teacher, office) only gets the permissions it needs for its work.", cat: 2, why: "Role and permission concept following the need-to-know principle." },
                { text: "Who opened which student file is logged.", cat: 2, why: "Logging data access is part of data access control." },
                { text: "Only administrators may install programs.", cat: 2, why: "Permissions within the system — after logging in." },
            ],
        },
        media: {
            intro: `<p>Every transmission medium has strengths and weaknesses:</p>
                <ul>
                    <li><strong>Twisted pair</strong> (copper): cheap, simple, up to 100 m.</li>
                    <li><strong>Fibre</strong>: long distances, very high data rates, immune to interference.</li>
                    <li><strong>Wi-Fi</strong>: mobile, but a shared medium with limited range.</li>
                    <li><strong>LoRaWAN</strong>: radio over kilometres, little power — but only tiny amounts of data.</li>
                </ul>
                <p>Plus: <strong>LAN or WAN</strong> and the areas of <strong>structured cabling</strong>.</p>`,
            sets: {
                media: ["Twisted-pair cable", "Fibre", "Wi-Fi", "LoRaWAN"],
                net: ["LAN", "WAN"],
                cabling: ["Primary (campus)", "Secondary (building)", "Tertiary (floor)"],
            },
            items: [
                { text: "A PC in the classroom needs to connect to the network socket 15 m away.", set: "media", answer: 0, why: "Short distance in the building, cheap, up to 100 m: twisted pair." },
                { text: "Two school buildings on the campus, 450 m apart, need to be connected.", set: "media", answer: 1, why: "Twisted pair only manages 100 m. For longer distances: fibre." },
                { text: "A workshop with welding robots heavily disturbs copper cables (electromagnetic interference).", set: "media", answer: 1, why: "Light is immune to electromagnetic interference." },
                { text: "The class's tablets should be able to move freely around the room.", set: "media", answer: 2, why: "Mobile devices in the building: Wi-Fi." },
                { text: "Soil moisture sensors on a 3 km field send a few bytes once an hour. The battery should last for years.", set: "media", answer: 3, why: "Long range, very little data, very little power: LoRaWAN." },
                { text: "Fill-level sensors on bottle banks all over town report when they are full.", set: "media", answer: 3, why: "Little data over long distances on battery power — typical LoRaWAN." },
                { text: "In the data centre, servers are to be connected to the core switch at 100 Gbit/s.", set: "media", answer: 1, why: "Highest data rates: fibre." },
                { text: "Visitors in the foyer should get onto the guest network with their smartphones.", set: "media", answer: 2, why: "Visitors' mobile devices: Wi-Fi (ideally as a separate guest network)." },
                { text: "A printer is in the office, the switch is two metres away.", set: "media", answer: 0, why: "Short distance, the standard case: twisted-pair cable (patch cable)." },
                { text: "What is the maximum length of a twisted-pair (Ethernet) link?", set: "custom", options: ["100 m", "10 m", "1 km", "10 km"], answer: 0, why: "Ethernet over twisted pair: at most 100 m per link." },
                { text: "The network inside a school building is a …", set: "net", answer: 0, why: "Local Area Network: a spatially limited network (building, site)." },
                { text: "The connection between the branch in Kassel and the head office in Frankfurt is part of a …", set: "net", answer: 1, why: "Wide Area Network: connects sites over long distances." },
                { text: "The internet is the biggest …", set: "net", answer: 1, why: "The internet connects networks worldwide — a WAN." },
                { text: "Structured cabling: the line between two buildings on the school site belongs to the …", set: "cabling", answer: 0, why: "Primary area (campus/site): connects buildings, usually with fibre." },
                { text: "Structured cabling: the lines between the floors of a building belong to the …", set: "cabling", answer: 1, why: "Secondary area (building/riser): from the building distributor to the floor distributors." },
                { text: "Structured cabling: the line from the floor distributor to the network socket in the classroom belongs to the …", set: "cabling", answer: 2, why: "Tertiary area (floor): from the floor distributor to the socket, usually twisted pair." },
            ],
        },
        line: {
            intro: `<p>A few basics of transmission:</p>
                <ul>
                    <li><strong>Symbol rate</strong> (in baud, Bd): how many symbols are sent per second.</li>
                    <li>A symbol with <em>M</em> states carries log<sub>2</sub>(<em>M</em>) bits. <strong>Bit rate</strong> = symbol rate × bits per symbol.</li>
                    <li><strong>Transfer time</strong> = amount of data ÷ bit rate. Careful: 1 byte = 8 bits.</li>
                    <li><strong>Simplex</strong> (one direction), <strong>half duplex</strong> (taking turns), <strong>full duplex</strong> (simultaneous).</li>
                    <li><strong>Information</strong> (meaning) → <strong>message</strong> (characters) → <strong>signal</strong> (physical).</li>
                </ul>`,
            units: { bit: "bits", bps: "bit/s", baud: "Bd", s: "s" },
            decimalSep: ".",
            qBits: "A symbol can take <strong>{m}</strong> different states. How many bits does it carry?",
            eBits: "2<sup>{b}</sup> = {m} → {b} bits per symbol.",
            qRate: "Symbol rate <strong>{baud} Bd</strong>, <strong>{m}</strong> states per symbol. What is the bit rate?",
            eRate: "{baud} Bd × {b} bits = {rate} bit/s.",
            qBaud: "A line should carry <strong>{rate} bit/s</strong>, each symbol has <strong>{m}</strong> states. Which symbol rate is needed?",
            eBaud: "{rate} bit/s ÷ {b} bits = {baud} Bd.",
            qTime: "How many seconds does it take to transfer <strong>{mb} MB</strong> over a <strong>{rate} Mbit/s</strong> line? (1 MB = 8 Mbit, no protocol overhead)",
            eTime: "{mb} MB × 8 = {mbit} Mbit; {mbit} ÷ {rate} = {secs} s.",
            modes: ["Simplex", "Half duplex", "Full duplex"],
            modeItems: [
                { text: "A radio station transmits, the radios only receive.", answer: 0, why: "One direction only: simplex." },
                { text: "With a walkie-talkie only one person talks at a time — whoever speaks presses the button.", answer: 1, why: "Both directions, but taking turns: half duplex." },
                { text: "On the phone both people can talk at the same time.", answer: 2, why: "Both directions at once: full duplex." },
                { text: "A PC is connected to a switch by cable and sends and receives at the same time.", answer: 2, why: "Switch ports work in full duplex — separate wire pairs for each direction." },
                { text: "On Wi-Fi all devices share the same radio channel; only one transmits at a time.", answer: 1, why: "One shared channel, taking turns: half duplex." },
                { text: "A temperature sensor only sends readings to the control centre and can't receive anything.", answer: 0, why: "One direction only: simplex." },
            ],
            nis: ["Message", "Information", "Signal"],
            nisItems: [
                { text: "The voltage curve on the network cable.", answer: 2, why: "The signal is the physical representation (voltage, light, radio wave)." },
                { text: "The light pulses in the fibre.", answer: 2, why: "Light pulses are the physical form — a signal." },
                { text: "The text “Meeting at 8” as a sequence of characters in an email.", answer: 0, why: "A message is information in a transmittable form — characters following an agreement." },
                { text: "The character string “ACK” that a protocol sends back according to fixed rules.", answer: 0, why: "Characters following agreed rules: a message." },
                { text: "What Ben newly learns when he reads the mail: the meeting is at 8.", answer: 1, why: "Information is the meaning — what the recipient now knows." },
                { text: "Realising that the server is back up after the ping was answered.", answer: 1, why: "The meaning the recipient gains from it: information." },
            ],
            bandwidth: {
                q: "What does the <strong>bandwidth</strong> of a line describe in the strict sense?",
                a: "The frequency range it can transmit (in Hz)",
                wrong: ["The length of the cable", "The number of connected devices", "The number of packets per second"],
                why: "Bandwidth = frequency range (Hz). The larger it is, the more symbols per second — and thus more bit/s (line capacity).",
            },
        },
    },
};
