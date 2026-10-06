# Shtresat 5–7: Shtresa e aplikacionit

:::goal
**Objektivi i të nxënit:** Ti di t'i dallosh në Tracer protokollet kryesore të shtresës së aplikacionit — HTTP, DNS, SMTP/POP3/IMAP dhe DHCP —, t'i shpjegosh ecurinë e tyre dhe të gjesh gabimet tipike.
:::

:::osi 7
:::

:::sim
url=/sims/lesson-6.1.btsim
:::

Në kapitullin 5 pe: TCP dhe UDP i dorëzojnë të dhënat në mënyrë të besueshme (ose të shpejtë) te programi i duhur — nëpërmjet porteve. *Çfarë* përmbahet në këto të dhëna, e përcaktojnë protokollet e **shtresës së aplikacionit**. Në modelin TCP/IP kjo është një shtresë, ndërsa në modelin ISO/OSI i përgjigjet shtresave 5 deri në 7.

Secili nga këto protokolle ka detyrën e vet — dhe portën e vet:

| Protokolli | Detyra | Porta | Transporti |
|---|---|---|---|
| **HTTP** | marrja e faqeve të internetit | 80 | TCP |
| **DNS** | përkthimi i emrave në adresa IP | 53 | zakonisht UDP |
| **SMTP** | dërgimi i e-maileve | 25 | TCP |
| **POP3** / **IMAP** | marrja e e-maileve | 110 / 143 | TCP |
| **DHCP** | dhënia automatike e një adrese IP një pajisjeje | 67 / 68 | UDP |

Në kapitullin 1.3 e hape ende një faqe interneti nëpërmjet adresës së saj IP. Në jetën e përditshme askush nuk shkruan `192.168.0.20` — dhe asnjë laptop i ri nuk e merr adresën e vet të futur me dorë. Se si funksionon e gjithë kjo së bashku, do ta zbulosh në këtë kapitull, protokoll pas protokolli.
