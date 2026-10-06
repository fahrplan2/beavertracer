# Warstwa 4: warstwa transportowa

:::goal
**Cel lekcji:** Potrafisz wymienić zadania warstwy transportowej, przedstawić przebieg połączenia TCP (nawiązanie, przesyłanie danych, zakończenie) na diagramie komunikacji, wyjaśnić porty oraz numery sekwencyjne i numery potwierdzenia, a także uzasadnić, kiedy zamiast TCP stosuje się UDP.
:::

:::osi 4
:::

:::sim
url=/sims/lesson-5.1.btsim
:::

Krótkie przypomnienie rozdziału 4: **Internet Protocol** w warstwie 3 dostarcza pakiet do właściwego *komputera* — także przez wiele routerów. Więcej IP jednak nie obiecuje:

- Na komputerze działa jednocześnie wiele programów: przeglądarka, program pocztowy, komunikator. Dla którego z nich przeznaczony jest pakiet? Tego nie ma w nagłówku IP.
- Jeśli pakiet zginie po drodze, IP tego nie zauważa. Pakiety mogą też dotrzeć podwójnie lub w złej kolejności. Mówi się: IP dostarcza dane tylko w trybie „najlepszych starań" (*best effort*).

Te luki wypełnia **warstwa 4**, czyli warstwa transportowa. Na obszarze roboczym widzisz **Client-PC** i **Server** — na nich w tym rozdziale zbadasz dwa najważniejsze protokoły warstwy 4: **TCP** i **UDP**.

:::note
TCP jest znormalizowany od 1981 roku (**RFC 793**, obecnie **RFC 9293**), UDP już od 1980 roku (**RFC 768**).
:::
