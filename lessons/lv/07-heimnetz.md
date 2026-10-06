# Mājas tīkls: maršrutētājs un NAT

:::goal
**Mācību mērķis:** Tu vari nosaukt mājas maršrutētāja uzdevumus, iestatīt mājas maršrutētāju, izskaidrot, kā NAT ļauj daudzām ierīcēm piekļūt internetam, izmantojot vienu publisko adresi, kā arī iestatīt un pārbaudīt portu pāradresāciju.
:::

:::osi 3
:::

:::sim
url=/sims/lesson-7.1.btsim
:::

Mājās tīklā ātri vien ir desmit vai vairāk ierīču: telefoni, klēpjdatori, televizors, spēļu konsole, skaļruņi. Visas saņem adreses, piemēram, `192.168.178.20` — no **privāta** diapazona, kas internetā netiek pārsūtīts vispār (4.2.2. nodaļa). Un tomēr katra no šīm ierīcēm tiek internetā.

To nodrošina neuzkrītoša kastīte: **mājas maršrutētājs**. Uz darbvirsmas kreisajā pusē redzams mājas tīkls ar datoru un planšetdatoru, labajā pusē — „internets": pakalpojumu sniedzēja maršrutētāji, DNS serveris un tīmekļa serveris `www.beispiel.de`.

:::note
Publiskās adreses šajā nodaļā (`203.0.113.…`, `198.51.100.…`, `192.0.2.…`) ir rezervētas piemēriem un mācību materiāliem — tieši tāpat kā `2001:db8::` IPv6 gadījumā.
:::
