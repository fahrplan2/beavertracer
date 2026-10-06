# Kiht 4: transpordikiht

:::goal
**Õpieesmärk:** Sa oskad nimetada transpordikihi ülesandeid, kujutada TCP-ühenduse kulgu (loomine, andmed, lõpetamine) järjestusdiagrammina, selgitada porte ning järje- ja kinnitusnumbreid ning põhjendada, millal kasutatakse TCP asemel UDP-d.
:::

:::osi 4
:::

:::sim
url=/sims/lesson-5.1.btsim
:::

Lühike tagasivaade 4. peatükile: **Internet Protocol** viib kihil 3 paketi õige *arvutini* — ka üle paljude ruuterite. Rohkemat IP aga ei luba:

- Arvutis töötab korraga palju programme: brauser, meiliprogramm, sõnumirakendus. Millele neist pakett on mõeldud? Seda IP päises ei ole.
- Kui pakett läheb teel kaduma, IP ei märka seda. Paketid võivad saabuda ka kahekordselt või vales järjekorras. Öeldakse: IP toimetab kohale ainult parima pingutuse põhimõttel (*best effort*).

Need lüngad täidab **kiht 4**, transpordikiht. Tööalal näed **Client-PC** ja **Server** — nende abil uurid selles peatükis kahte kihi 4 kõige olulisemat protokolli: **TCP** ja **UDP**.

:::note
TCP on standardiseeritud alates 1981. aastast (**RFC 793**, praegu **RFC 9293**), UDP juba alates 1980. aastast (**RFC 768**).
:::
