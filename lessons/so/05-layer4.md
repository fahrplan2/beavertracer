# Layer 4: transport layer

:::goal
**Hadafka waxbarashada:** Waxaad awoodaa inaad magacawdo hawlaha transport layer, inaad u muujiso socodka TCP connection (connection setup, xogta, xidhitaanka) sidii sequence diagram, inaad sharaxdo ports iyo sequence number iyo acknowledgement number, kana jawaabto goorta UDP loo isticmaalo halkii TCP.
:::

:::osi 4
:::

:::sim
url=/sims/lesson-5.1.btsim
:::

Dib-u-eegis kooban oo ku saabsan cutubka 4: **Internet Protocol** ee layer 3 wuxuu packet u geeyaa *kombuyuutarka* saxda ah — xitaa isagoo dhex mara router badan. Laakiin IP wax ka badan ma ballanqaado:

- Kombuyuutar kaliya waxaa isla mar ka shaqeeya barnaamijyo badan: Browser, barnaamijka email-ka, messenger. Kee ayuu packet-ku u socdaa? Tani kuma qoran IP header.
- Haddii packet jidka ku lumo, IP ma ogaado. Packets waxay kaloo imaan karaan laba jeer ama isku-xigsi qaldan. Waxaa la yidhaa: IP wuxuu keenaa kaliya *best effort* (dadaal ugu fiican).

Farqigan buuxiya **Layer 4**, transport layer. Goobta shaqada waxaad ku aragtaa **Client-PC** iyo **Server** — kuwaas ayaad cutubkan ku baadhaysaa labada protocol ee ugu muhiimsan layer 4: **TCP** iyo **UDP**.

:::note
TCP waxaa la heshiiyey sannadka 1981 (**RFC 793**, maanta **RFC 9293**), UDP-na ilaa 1980 (**RFC 768**).
:::
