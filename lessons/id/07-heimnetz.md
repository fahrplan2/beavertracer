# Jaringan rumah: router dan NAT

:::goal
**Tujuan pembelajaran:** Kamu dapat menyebutkan tugas-tugas router rumah, menyiapkan router rumah, menjelaskan bagaimana NAT membuat banyak perangkat terhubung ke internet melalui satu alamat publik, serta menyiapkan dan menguji penerusan port.
:::

:::osi 3
:::

:::sim
url=/sims/lesson-7.1.btsim
:::

Di rumah, dengan cepat ada sepuluh perangkat atau lebih di dalam jaringan: ponsel, laptop, TV, konsol game, speaker. Semuanya mendapat alamat seperti `192.168.178.20` — dari rentang **privat** yang sama sekali tidak diteruskan di internet (bab 4.2.2). Namun, setiap perangkat ini tetap bisa terhubung ke internet.

Yang memungkinkan hal ini adalah sebuah kotak kecil yang tidak mencolok: **router rumah**. Di Area kerja kamu melihat jaringan rumah di sebelah kiri dengan sebuah PC dan sebuah tablet, dan di sebelah kanan "internet" — router milik penyedia layanan, sebuah server DNS, dan server web `www.beispiel.de`.

:::note
Alamat publik dalam bab ini (`203.0.113.…`, `198.51.100.…`, `192.0.2.…`) dicadangkan untuk contoh dan materi pembelajaran — sama seperti `2001:db8::` pada IPv6.
:::
