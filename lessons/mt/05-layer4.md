# Layer 4: Transport layer

:::goal
**Għan tat-tagħlim:** Tista' tsemmi l-kompiti tat-transport layer, turi l-andament ta' konnessjoni TCP (setup, data, teardown) bħala sequence diagram, tispjega l-ports kif ukoll is-sequence numbers u l-acknowledgement numbers, u tispjega meta jintuża UDP minflok TCP.
:::

:::osi 4
:::

:::sim
url=/sims/lesson-5.1.btsim
:::

Ħarsa lura qasira lejn il-kapitlu 4: l-**Internet Protocol** fuq layer 3 iwassal packet lejn il-*kompjuter* t-tajjeb — anki minn ġo ħafna routers. Iżda IP ma jwiegħed xejn aktar minn hekk:

- Fuq kompjuter jaħdmu ħafna programmi fl-istess ħin: browser, programm tal-mail, messenger. Għal liema minnhom hu maħsub packet? Dan ma jidhirx fl-header tal-IP.
- Jekk packet jintilef matul it-triq, l-IP ma jinduna xejn. Il-packets jistgħu jaslu wkoll darbtejn jew f'ordni żbaljata. Wieħed jgħid: l-IP jgħaddi biss bl-aħjar sforz (*best effort*).

Dawn il-lakuni jagħlaqhom **layer 4**, it-transport layer. Fuq il-workspace tara **Client-PC** u **Server** — fuqhom, f'dan il-kapitlu, se tistudja ż-żewġ protokolli l-aktar importanti ta' layer 4: **TCP** u **UDP**.

:::note
It-TCP huwa standardizzat mill-1981 (**RFC 793**, illum **RFC 9293**), u l-UDP anki mill-1980 (**RFC 768**).
:::
