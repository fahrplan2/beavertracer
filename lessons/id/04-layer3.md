# Lapisan 3: Router, alamat IP, dan subnetting

:::goal
**Tujuan pembelajaran:** Kamu dapat membaca alamat IP dalam bentuk biner, menghitung alamat jaringan dan alamat broadcast, membagi sebuah jaringan menjadi subnet berukuran sama, serta menghubungkan jaringan melalui router dengan tabel routing.
:::

:::osi 3
:::

:::sim
url=/sims/lesson-4.1.btsim
:::

Sampai sekarang, semua perangkat berada dalam *satu* jaringan lokal — terhubung melalui switch dan Access Point. Padahal, internet terdiri dari jutaan jaringan seperti itu: jaringan rumahmu, jaringan sekolah, jaringan penyedia layanan seluler, dan jaringan pusat data besar.

Bagaimana sebuah paket menemukan jalan dari satu jaringan ke jaringan lain? Hal itu ditangani oleh **Lapisan 3**, yaitu lapisan jaringan — dengan **Internet Protocol (IP)**, alamat IP, dan perangkat yang menghubungkan jaringan satu dengan yang lain: **router**.

:::note
IP telah ditetapkan dalam sebuah standar sejak 1981, yaitu **RFC 791**. Versi yang terutama dibahas dalam bab ini disebut **IPv4**. Versi yang lebih baru, **IPv6**, akan kamu kenal di akhir bab.
:::
