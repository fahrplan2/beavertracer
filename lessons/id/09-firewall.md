# Firewall: siapa yang boleh masuk, siapa yang boleh keluar?

:::goal
**Tujuan pembelajaran:** Kamu dapat menjelaskan cara kerja filter paket dengan aturan, menyusun aturan sendiri dan mengurutkannya dengan benar, membedakan drop (membuang) dan reject (menolak), menjelaskan perbedaan antara firewall stateless dan stateful, membangun DMZ, serta menemukan kesalahan pada aturan firewall.
:::

:::osi 4
:::

:::sim
url=/sims/lesson-9.btsim
:::

Sekolah Beaver memiliki alamat publik sendiri (`198.51.100.…`): **Schulserver** milik sekolah dapat dijangkau langsung dari internet — tanpa NAT, seperti yang tidak lama lagi akan berlaku di mana-mana dengan IPv6 (bab 7.3). Di antara internet dan **Schulrouter** terdapat sebuah **firewall**, tetapi saat ini firewall tersebut masih meloloskan semuanya.

Di sebelah kiri kamu melihat "internet": sebuah **Internet-PC** dan server web `www.beispiel.de`. Di sebelah kanan terdapat jaringan sekolah dengan **Schulserver** dan **Lehrer-PC**.

## Apa yang dilihat penyerang?

Siapa pun yang ingin menyerang sebuah server akan lebih dulu mencari **port yang terbuka** — yaitu layanan yang menunggu koneksi. Alat untuk itu disebut **port scanner**; yang paling terkenal adalah `nmap`.

Beralihlah ke Mode :fa-play: **Jalankan**, buka :fa-terminal: **Terminal** pada **Internet-PC**, lalu ketik:

```
$ nmap 198.51.100.10
```

`nmap` mencoba membangun koneksi TCP ke 20 port yang paling umum dan melaporkan port mana saja yang terbuka.

:::quiz multi
Port mana saja pada server sekolah yang terbuka dari internet?
- [x] 22 (SSH, pemeliharaan jarak jauh)
- [x] 25 (SMTP)
- [x] 80 (HTTP)
- [x] 110 (POP3)
- [x] 143 (IMAP)
- [ ] 443 (HTTPS)
:::

:::evaluate
Periksa jawaban
:::

Situs web (80) dan penerimaan e-mail (25) memang harus dapat dijangkau dari internet. Namun **pemeliharaan jarak jauh** (22) dan pengambilan e-mail (110, 143) hanya dibutuhkan oleh jaringan sekolah. Setiap port yang terbuka adalah celah serangan yang mungkin: jika layanannya memiliki celah keamanan atau kata sandi yang lemah, penyerang dapat memanfaatkannya dari mana saja di dunia — dan pemindai otomatis di internet mencoba hal itu persis sepanjang waktu.

:::tip Poin penting
Sebuah **firewall** mengontrol lalu lintas data di perbatasan antara dua jaringan dan hanya meloloskan apa yang diizinkan secara tegas. Dengan begitu, layanan yang hanya dibutuhkan secara internal tetap tidak terlihat oleh internet.
:::
