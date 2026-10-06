# Lapisan 5–7: lapisan aplikasi

:::goal
**Tujuan pembelajaran:** Kamu dapat mengenali protokol-protokol terpenting pada lapisan aplikasi — HTTP, DNS, SMTP/POP3/IMAP, dan DHCP — di Tracer, menjelaskan alurnya, serta menemukan kesalahan yang umum terjadi.
:::

:::osi 7
:::

:::sim
url=/sims/lesson-6.1.btsim
:::

Di bab 5 kamu sudah melihat: TCP dan UDP mengantarkan data dengan andal (atau cepat) ke program yang tepat — melalui port. *Apa* isi data tersebut ditentukan oleh protokol-protokol **lapisan aplikasi**. Dalam model TCP/IP, ini merupakan satu lapisan, sedangkan dalam model ISO/OSI lapisan ini setara dengan lapisan 5 sampai 7.

Setiap protokol ini memiliki tugasnya sendiri — dan port-nya sendiri:

| Protokol | Tugas | Port | Transport |
|---|---|---|---|
| **HTTP** | mengambil halaman web | 80 | TCP |
| **DNS** | menerjemahkan nama menjadi alamat IP | 53 | umumnya UDP |
| **SMTP** | mengirim e-mail | 25 | TCP |
| **POP3** / **IMAP** | mengambil e-mail | 110 / 143 | TCP |
| **DHCP** | memberikan alamat IP secara otomatis kepada perangkat | 67 / 68 | UDP |

Di bab 1.3 kamu masih membuka halaman web melalui alamat IP-nya. Dalam kehidupan sehari-hari tidak ada orang yang mengetik `192.168.0.20` — dan tidak ada laptop baru yang alamatnya dimasukkan secara manual. Bagaimana semua ini bekerja bersama, akan kamu temukan di bab ini, protokol demi protokol.
