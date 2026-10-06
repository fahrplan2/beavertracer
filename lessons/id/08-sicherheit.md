# Keamanan: enkripsi dan sertifikat

:::goal
**Tujuan pembelajaran:** Kamu dapat menjelaskan tiga tujuan keamanan, yaitu kerahasiaan, integritas, dan autentisitas, membedakan enkripsi simetris dan asimetris, memahami peran nilai hash dan tanda tangan digital, membaca dan membuat sertifikat sendiri, menyiapkan HTTPS, serta menafsirkan peringatan sertifikat yang umum.
:::

Di bab-bab sebelumnya, kamu bisa membaca hampir semuanya di Tracer:

- **Bab 3.3.2:** Di WLAN, setiap perangkat dalam jangkauan menerima semua paket radio.
- **Bab 6.1.2:** Pada HTTP, permintaan dan halaman web berada dalam bentuk teks biasa di dalam paket.
- **Bab 6.3.2:** Pada SMTP dan POP3, nama pengguna dan kata sandi hampir berupa teks biasa saat melewati kabel — `AUTH PLAIN` hanyalah Base64.

Siapa pun yang menyadap pada sebuah kabel atau di WLAN yang sama dapat melihat kata sandi, nilai, pesan, dan data bank. Dan penyadap bisa melakukan lebih dari itu: **mengubah** paket atau **menyamar** sebagai orang lain.

## Tiga tujuan keamanan

Kriptografi bertujuan melindungi dari bahaya-bahaya ini. Ada tiga **tujuan keamanan**:

| Tujuan keamanan | Pertanyaan | Contoh serangan |
|---|---|---|
| **Kerahasiaan** | Apakah hanya penerima yang tepat yang dapat membaca data? | Seseorang membaca kata sandimu di WLAN. |
| **Integritas** | Apakah data sampai tanpa perubahan? | Seseorang mengubah jumlah uang pada sebuah transfer. |
| **Autentisitas** | Apakah data benar-benar berasal dari pengirim yang disebutkan? | Situs web bank palsu menanyakan PIN-mu. |

Di bab ini kamu akan mengenal alat-alat yang digunakan untuk mencapai ketiga tujuan ini — dan bagaimana semuanya bekerja sama dalam **HTTPS**, yaitu simbol gembok di peramban.

:::quiz match
Seseorang membaca kata sandimu di WLAN -> Kerahasiaan
Seseorang mengubah jumlah uang pada transfer di tengah jalan -> Integritas
Situs web palsu menyamar sebagai bankmu -> Autentisitas
:::

:::evaluate
Periksa pasangan
:::
