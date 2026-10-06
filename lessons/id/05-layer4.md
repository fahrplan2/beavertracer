# Lapisan 4: Lapisan transport

:::goal
**Tujuan pembelajaran:** Kamu dapat menyebutkan tugas-tugas lapisan transport, menggambarkan alur sebuah koneksi TCP (pembentukan, pengiriman data, pemutusan) sebagai diagram urutan, menjelaskan port serta nomor urut dan nomor konfirmasi, dan menjelaskan kapan UDP digunakan menggantikan TCP.
:::

:::osi 4
:::

:::sim
url=/sims/lesson-5.1.btsim
:::

Sekilas kilas balik ke Bab 4: **Internet Protocol** di lapisan 3 membawa sebuah paket ke *komputer* yang tepat — bahkan melewati banyak router. Namun, IP tidak menjanjikan lebih dari itu:

- Pada sebuah komputer, banyak program berjalan secara bersamaan: peramban, program surel, aplikasi pesan instan. Paket itu ditujukan untuk program yang mana? Hal itu tidak tercantum di header IP.
- Jika sebuah paket hilang di tengah jalan, IP tidak menyadarinya. Paket juga bisa tiba dua kali atau dengan urutan yang salah. Dikatakan: IP hanya mengirim dengan upaya terbaik (*best effort*).

Celah-celah ini ditutup oleh **lapisan 4**, yaitu lapisan transport. Di area kerja kamu melihat sebuah **Client-PC** dan sebuah **Server** — pada keduanya kamu akan memeriksa dua protokol terpenting di lapisan 4 dalam bab ini: **TCP** dan **UDP**.

:::note
TCP telah distandarkan sejak 1981 (**RFC 793**, kini **RFC 9293**), sedangkan UDP bahkan sejak 1980 (**RFC 768**).
:::
