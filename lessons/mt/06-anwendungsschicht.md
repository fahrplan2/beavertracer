# Saff 5–7: Application layer

:::goal
**Għan tat-tagħlim:** Tista' tagħraf il-protokolli l-aktar importanti tal-application layer — HTTP, DNS, SMTP/POP3/IMAP u DHCP — fit-Traċċa, tispjega kif jaħdmu u ssib żbalji tipiċi.
:::

:::osi 7
:::

:::sim
url=/sims/lesson-6.1.btsim
:::

Fil-kapitlu 5 rajt li: TCP u UDP iwasslu d-data b'mod affidabbli (jew malajr) lill-programm it-tajjeb — permezz tal-ports. *X'hemm* f'din id-data jiddeterminawh il-protokolli tal-**application layer**. Fil-mudell TCP/IP din hija layer waħda; fil-mudell ISO/OSI tikkorrispondi għal-layers 5 sa 7.

Kull wieħed minn dawn il-protokolli għandu l-kompitu tiegħu — u l-port tiegħu stess:

| Protokoll | Kompitu | Port | Transport |
|---|---|---|---|
| **HTTP** | jġib il-websites | 80 | TCP |
| **DNS** | jittraduċi l-ismijiet f'IP addresses | 53 | l-aktar UDP |
| **SMTP** | jibgħat l-e-mails | 25 | TCP |
| **POP3** / **IMAP** | jiġbor l-e-mails | 110 / 143 | TCP |
| **DHCP** | jagħti IP address lil apparat awtomatikament | 67 / 68 | UDP |

Fil-kapitlu 1.3 int ftaħt websajt billi użajt l-IP address tagħha. Fil-ħajja ta' kuljum ħadd ma jittajpja `192.168.0.20` — u ebda laptop ġdid ma jkollu l-address tiegħu mdaħħla bl-idejn. Kif dan kollu jaħdem flimkien se tiskopri f'dan il-kapitlu, protokoll wara protokoll.
