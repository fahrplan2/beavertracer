# Brandvägg: vem får komma in, vem får gå ut?

:::goal
**Lärandemål:** Du kan förklara hur ett paketfilter arbetar med regler, ställa upp regler själv och lägga dem i rätt ordning, skilja mellan att kasta (drop) och att avvisa (reject), förklara skillnaden mellan en tillståndslös och en tillståndsbaserad brandvägg, bygga upp en DMZ och hitta fel i brandväggsregler.
:::

:::osi 4
:::

:::sim
url=/sims/lesson-9.btsim
:::

Beaver-skolan har egna publika adresser (`198.51.100.…`): Dess **Schulserver** går att nå direkt från internet — utan NAT, så som det snart kommer att vara överallt med IPv6 (kapitel 7.3). Mellan internet och **Schulrouter** sitter en **brandvägg**, som just nu ändå släpper igenom allt.

Till vänster ser du ”internet”: en **Internet-PC** och webbservern `www.beispiel.de`. Till höger finns skolans nätverk med **Schulserver** och **Lehrer-PC**.

## Vad ser en angripare?

Den som vill angripa en server letar först efter **öppna portar** — alltså efter tjänster som väntar på anslutningar. Verktyget för detta kallas **portskanner**; den mest kända är `nmap`.

Växla till :fa-play: **Kör**-läget (Körläge), öppna :fa-terminal: **Terminal** på **Internet-PC** och skriv:

```
$ nmap 198.51.100.10
```

`nmap` försöker upprätta en TCP-anslutning till de 20 vanligaste portarna och rapporterar vilka som är öppna.

:::quiz multi
Vilka portar på skolservern är öppna från internet?
- [x] 22 (SSH, fjärradministration)
- [x] 25 (SMTP)
- [x] 80 (HTTP)
- [x] 110 (POP3)
- [x] 143 (IMAP)
- [ ] 443 (HTTPS)
:::

:::evaluate
Kontrollera svar
:::

Webbplatsen (80) och mottagandet av e-post (25) ska vara nåbara från internet. Men **fjärradministrationen** (22) och hämtningen av e-post (110, 143) behövs bara i skolans nätverk. Varje öppen port är en möjlig angreppsyta: Om tjänsten har en säkerhetslucka eller ett svagt lösenord kan en angripare utnyttja den var som helst i världen — och automatiska skannrar på internet försöker just det dygnet runt.

:::tip Att komma ihåg
En **brandvägg** kontrollerar trafiken vid gränsen mellan två nätverk och släpper bara igenom det som uttryckligen är tillåtet. På så sätt förblir tjänster som bara behövs internt osynliga för internet.
:::
