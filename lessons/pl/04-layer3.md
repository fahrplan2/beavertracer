# Warstwa 3: router, adresy IP i podział na podsieci

:::goal
**Cel lekcji:** Potrafisz odczytywać adresy IP w zapisie dwójkowym, obliczać adresy sieci i adresy rozgłoszeniowe, dzielić sieć na podsieci o jednakowej wielkości oraz łączyć sieci za pomocą routerów z tablicami routingu.
:::

:::osi 3
:::

:::sim
url=/sims/lesson-4.1.btsim
:::

Dotychczas wszystkie urządzenia znajdowały się w *jednej* sieci lokalnej — połączone przez switche i punkty dostępu. Internet składa się jednak z milionów takich sieci: twojej sieci domowej, sieci szkolnej, sieci twojego operatora komórkowego, sieci wielkich centrów danych.

Jak pakiet znajduje drogę z jednej sieci do drugiej? Zajmuje się tym **warstwa 3**, czyli warstwa sieciowa — z **Internet Protocol (IP)**, adresami IP i urządzeniami, które łączą sieci ze sobą: **routerami**.

:::note
IP jest określony w standardzie od 1981 roku, w dokumencie **RFC 791**. Wersja, której dotyczy głównie ten rozdział, nazywa się **IPv4**. Nowszą wersję, **IPv6**, poznasz na końcu rozdziału.
:::
