# Taman bermain — Markdown & kuis (halaman uji)

[[toc]]

Halaman ini digunakan untuk menguji sintaks Markdown dan jenis soal interaktif.

---

## Sintaks Markdown

### Pemformatan teks

**Tebal**, *miring*, ~~dicoret~~, `Inline-Code`, dan **_gabungan_**.

Paragraf biasa dengan [tautan ke halaman lain](01-einfuehrung.html) dan [tautan eksternal](https://www.beavertracer.eu).

### Judul

Tingkat H2–H4 muncul otomatis di daftar isi (TOC).

#### Ini H4 — tidak muncul di TOC

### Daftar

Tidak berurutan:

- Ethernet
- IP
- TCP
  - HTTP
  - SMTP

Berurutan:

1. Mode Edit: membangun topologi
2. Mode Jalankan: memulai simulasi
3. Mode Jejak: menganalisis paket

### Tabel

| Protokol | Lapisan | Port |
|-----------|---------|------|
| HTTP      | 7       | 80   |
| HTTPS     | 7       | 443  |
| DNS       | 7       | 53   |
| TCP       | 4       | —    |

### Kode

Inline: `ping 192.168.0.1`

Blok:

```
$ ping 192.168.0.2
PING 192.168.0.2: 56 data bytes
64 bytes from 192.168.0.2: icmp_seq=0 ttl=64 time=0.4 ms
```

### Callout

:::note
Ini adalah callout **note** — untuk petunjuk netral dan informasi tambahan.
:::

:::tip
Ini adalah callout **tip** — untuk tips dan rekomendasi yang berguna.
:::

:::warning
Ini adalah callout **warning** — untuk peringatan yang memerlukan perhatian.
:::

:::danger
Ini adalah callout **danger** — untuk sumber kesalahan yang kritis.
:::

:::draft
:::

### Ikon

Font Awesome Solid: :fa-play: :fa-stop: :fa-desktop: :fa-shield-halved: :fa-wifi:

Font Awesome Regular: :far-file: :far-circle:

Simbol perangkat: :router: :switch:

### Simulasi tertanam

:::sim
url=/sims/demo.btsim
:::

### Tugas dengan pemeriksaan perilaku

:::task
title: Menghubungkan PC 1 dan PC 2
Periksa apakah PC 1 (id 9) memiliki IP di jaringan 192.168.0.0/24 dan dapat menjangkau PC 2 (id 11).
check: ip(9, "192.168.0.0/24")
check: pingOk(9, 11)
:::

---

## Model referensi OSI: skema warna

Contoh tabel dengan sorotan warna pelangi (Lapisan 1 di bawah, seperti dalam tumpukan) serta "lampu lalu lintas" di tepi halaman dengan teks yang mengalir di sekitarnya.

### Tabel berwarna

<table class="osi-table">
<thead>
<tr><th>Lapisan</th><th>Nama</th><th>Contoh protokol</th></tr>
</thead>
<tbody>
<tr class="osi-l7"><td>7</td><td>Aplikasi</td><td>HTTP, DNS, SMTP</td></tr>
<tr class="osi-l6"><td>6</td><td>Presentasi</td><td>TLS, JPEG, ASCII</td></tr>
<tr class="osi-l5"><td>5</td><td>Sesi</td><td>RPC, NetBIOS</td></tr>
<tr class="osi-l4"><td>4</td><td>Transport</td><td>TCP, UDP</td></tr>
<tr class="osi-l3"><td>3</td><td>Jaringan</td><td>IP, ICMP</td></tr>
<tr class="osi-l2"><td>2</td><td>Tautan data</td><td>Ethernet, ARP</td></tr>
<tr class="osi-l1"><td>1</td><td>Fisik</td><td>Tembaga, serat optik, WLAN</td></tr>
</tbody>
</table>

### Lampu lalu lintas dengan teks mengalir

Lampu lalu lintas dibuat dengan `:::osi N`, dengan `N` adalah lapisan yang disorot (di sini Lapisan 3). Lampu ini melayang di tepi, dan teks berikutnya mengalir di sekitarnya secara otomatis.

:::osi 3
:::

Lorem ipsum dolor sit amet, consetetur sadipscing elitr, sed diam nonumy eirmod tempor invidunt ut labore et dolore magna aliquyam erat, sed diam voluptua. At vero eos et accusam et justo duo dolores et ea rebum. Stet clita kasd gubergren, no sea takimata sanctus est Lorem ipsum dolor sit amet.

Lorem ipsum dolor sit amet, consetetur sadipscing elitr, sed diam nonumy eirmod tempor invidunt ut labore et dolore magna aliquyam erat, sed diam voluptua. At vero eos et accusam et justo duo dolores et ea rebum, sehingga bagian ini secara isi termasuk dalam Lapisan jaringan (Layer 3) — karena itu tepat kotak ini yang berwarna pada lampu lalu lintas, sedangkan semua yang lain tetap abu-abu.

---

## Bagian 1: Istilah dasar

:::quiz short
Apa notasi CIDR dari subnet mask 255.255.255.0?
= /24
= 24
:::

:::quiz mc
Manakah dari alamat berikut yang merupakan alamat jaringan dari 192.168.1.42/24?
- [ ] 192.168.1.42
- [x] 192.168.1.0
- [ ] 192.168.1.255
- [ ] 192.168.0.0
:::

:::quiz fill
Alamat jaringan diperoleh melalui operasi {AND} bitwise antara alamat IP dan {Netmask}. Alamat tertinggi di subnet adalah alamat {Broadcast}.
:::

:::evaluate
Periksa bagian 1
:::

---

## Bagian 2: Pencocokan — protokol dan tugasnya

:::quiz match
ARP -> Menentukan alamat MAC dari sebuah alamat IP
DNS -> Menerjemahkan hostname menjadi alamat IP
DHCP -> Memberikan alamat IP secara otomatis kepada klien
ICMP -> Digunakan oleh ping dan traceroute
:::

:::evaluate
Periksa bagian 2
:::

---

## Bagian 3: Subnetting

:::quiz short
Berapa banyak alamat host yang dapat digunakan pada subnet /30?
= 2
:::

:::quiz mc
Untuk apa subnet /30 biasanya digunakan?
- [ ] Untuk jaringan kantor besar dengan banyak perangkat
- [ ] Sebagai rentang alamat untuk pool DHCP
- [x] Sebagai jaringan penghubung antara dua router
- [ ] Untuk access point WLAN
:::

:::quiz fill
Subnet /25 memiliki {128} alamat, dan {126} di antaranya dapat digunakan untuk host.
:::

:::quiz match
/24 -> 254 alamat host yang dapat digunakan
/25 -> 126 alamat host yang dapat digunakan
/28 -> 14 alamat host yang dapat digunakan
/30 -> 2 alamat host yang dapat digunakan
:::

:::evaluate
Periksa bagian 3
:::

## Bagian 4: Pilihan ganda majemuk dan soal acak

Pada `:::quiz multi`, sejumlah jawaban apa pun dapat benar — setiap pernyataan dinilai satu per satu:

:::quiz multi
Pernyataan mana tentang ARP yang benar?
- [x] ARP menentukan alamat MAC dari sebuah alamat IP
- [ ] ARP menentukan alamat IP dari sebuah nama
- [x] Permintaan ARP adalah broadcast
- [ ] Balasan ARP adalah broadcast
:::

`:::quiz random <typ>` membuat soal baru setiap kali dipanggil (`count=N` menentukan jumlahnya). Tipe: `bin2dec`, `dec2bin`, `cidr2mask`, `hosts`, `netbcast`, `samenet`, `subnet`.

:::quiz random dec2bin
count=2
:::

:::quiz random netbcast
Hitung untuk alamat berikut:
:::

:::quiz random samenet
count=3
:::

:::quiz random subnet
:::

:::evaluate
Periksa bagian 4
:::

## Bagian 4b: Tabel untuk diisi

`:::quiz table` — tabel Markdown biasa, sel `{Antwort}` menjadi kolom isian (pisahkan varian dengan `|`):

:::quiz table
Bagilah `192.168.42.0/24` menjadi dua subnet:
| Subnet | Alamat jaringan | Alamat broadcast |
|---|---|---|
| 1 | {192.168.42.0} | {192.168.42.127} |
| 2 | {192.168.42.128} | {192.168.42.255} |
:::

:::evaluate
Periksa tabel
:::

## Bagian 5: Mewarnai bit

Untuk bab IP dan subnetting: `[[n|…]]` = Bagian jaringan, `[[e|…]]` = perluasan, `[[h|…]]` = Bagian host — dalam teks mengalir maupun dalam tabel:

[[n|11111111.11111111.11111111]].[[e|11]][[h|000000]] = `255.255.255.192`

Untuk tampilan multibaris, gunakan blok `<pre class="bits-block">` sebagai pengganti ``` (dalam blok kode, warna tidak akan ditampilkan):

<pre class="bits-block">
vorher  (/24):  [[n|NNNNNNNN.NNNNNNNN.NNNNNNNN]].[[h|HHHHHHHH]]
nachher (/26):  [[n|NNNNNNNN.NNNNNNNN.NNNNNNNN]].[[e|EE]][[h|HHHHHH]]
</pre>

## Bagian 6: Diagram urutan

`:::seq` menggambar diagram dengan dua Garis hidup. Nomor SEQ dan ACK serta penghitung pada Garis hidup dihitung dari flag dan data muatan (`"…"`). `-x` sebagai pengganti `->` membuat sebuah segmen hilang, `seq=…` menimpa sebuah nomor (misalnya pada Pengiriman ulang).

:::seq
Client -> Server: SYN
Server -> Client: SYN, ACK
Client -> Server: ACK
Client -> Server: PSH, ACK "Hello World"
Server -> Client: ACK
Client -x Server: PSH, ACK "Hallo"
Client -> Server: PSH, ACK "Hallo" seq=12
Server -> Client: ACK
Client -> Server: FIN, ACK
Server -> Client: ACK
Server -> Client: FIN, ACK
Client -> Server: ACK
:::

Dengan `:::quiz seq`, `?` (sebelum flag, atau `seq=?` / `ack=?`) menjadi kolom isian; `hide: counters` menyembunyikan penghitung:

:::quiz seq
Client -> Server: SYN
Server -> Client: ? SYN, ACK ack=?
Client -> Server: ? ACK ack=?
Client -> Server: PSH, ACK "Hello World"
Server -> Client: ACK ack=?
:::

:::evaluate
Periksa diagram
:::
