# Tulemüür: kes tohib sisse, kes välja?

:::goal
**Õpieesmärk:** Sa oskad selgitada, kuidas pakettfilter reeglitega töötab, koostada reegleid ise ja panna need õigesse järjekorda, eristada pakettide hülgamist (drop) ja tagasilükkamist (reject), selgitada vahet olekuta ja olekupõhise tulemüüri vahel, ehitada DMZ-i ning leida tulemüürireeglitest vigu.
:::

:::osi 4
:::

:::sim
url=/sims/lesson-9.btsim
:::

Beaveri koolil on oma avalikud aadressid (`198.51.100.…`): tema **Schulserver** on internetist otse kättesaadav — ilma NAT-ita, nii nagu IPv6-ga varsti kõikjal on (peatükk 7.3). Interneti ja **Schulrouteri** vahel asub **tulemüür**, mis praegu veel kõik läbi laseb.

Vasakul näed „internetti“: **Internet-PC**-d ja veebiserverit `www.beispiel.de`. Paremal on koolivõrk, kus on **Schulserver** ja **Lehrer-PC**.

## Mida näeb ründaja?

Kes tahab serverit rünnata, otsib kõigepealt **avatud porte** ehk teenuseid, mis ootavad ühendusi. Selle tööriista nimi on **pordiskanner**; kõige tuntum on `nmap`.

Lülitu :fa-play: **Käivita** režiimi (käivitusrežiimi), ava **Internet-PC** peal :fa-terminal: **Terminalis** ja sisesta:

```
$ nmap 198.51.100.10
```

`nmap` proovib luua TCP-ühenduse 20 kõige sagedasema pordiga ja teatab, millised neist on avatud.

:::quiz multi
Millised pordid on koolserveril internetist vaadates avatud?
- [x] 22 (SSH, kaughooldus)
- [x] 25 (SMTP)
- [x] 80 (HTTP)
- [x] 110 (POP3)
- [x] 143 (IMAP)
- [ ] 443 (HTTPS)
:::

:::evaluate
Kontrolli vastust
:::

Veebileht (80) ja e-kirjade vastuvõtt (25) peavad olema internetist kättesaadavad. Aga **kaughooldus** (22) ja kirjade kättesaamine (110, 143) on vajalikud ainult koolivõrgus. Iga avatud port on võimalik ründepind: kui teenusel on turvaauk või nõrk parool, saab ründaja seda kasutada kõikjalt maailmast — ja automaatsed skannerid internetis proovivad just seda ööpäevaringselt.

:::tip Pea meeles
**Tulemüür** kontrollib andmeliiklust kahe võrgu piiril ja laseb läbi ainult selle, mis on selgesõnaliselt lubatud. Nii jäävad teenused, mida vaja on ainult sisemiselt, internetile nähtamatuks.
:::
