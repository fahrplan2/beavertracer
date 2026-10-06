# Straturile 5–7: stratul aplicație

:::goal
**Obiectiv de învățare:** Poți recunoaște în Tracer cele mai importante protocoale ale stratului aplicație — HTTP, DNS, SMTP/POP3/IMAP și DHCP —, poți explica modul lor de funcționare și poți găsi erorile tipice.
:::

:::osi 7
:::

:::sim
url=/sims/lesson-6.1.btsim
:::

În capitolul 5 ai văzut: TCP și UDP livrează datele fiabil (sau rapid) la programul potrivit — prin intermediul porturilor. *Ce* conțin aceste date stabilesc protocoalele **stratului aplicație**. În modelul TCP/IP acesta este un singur strat, iar în modelul ISO/OSI corespunde straturilor 5–7.

Fiecare dintre aceste protocoale are propria sarcină — și propriul port:

| Protocol | Sarcină | Port | Transport |
|---|---|---|---|
| **HTTP** | preluarea paginilor web | 80 | TCP |
| **DNS** | traducerea numelor în adrese IP | 53 | de obicei UDP |
| **SMTP** | trimiterea e-mailurilor | 25 | TCP |
| **POP3** / **IMAP** | preluarea e-mailurilor | 110 / 143 | TCP |
| **DHCP** | atribuirea automată a unei adrese IP unui dispozitiv | 67 / 68 | UDP |

În capitolul 1.3 ai accesat încă o pagină web folosind adresa ei IP. În viața de zi cu zi nimeni nu tastează `192.168.0.20` — și niciun laptop nou nu primește adresa introdusă manual. Cum funcționează toate acestea împreună vei descoperi în acest capitol, protocol cu protocol.
