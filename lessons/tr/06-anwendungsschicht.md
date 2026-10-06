# Katman 5–7: Uygulama katmanı

:::goal
**Öğrenme hedefi:** Uygulama katmanının en önemli protokollerini — HTTP, DNS, SMTP/POP3/IMAP ve DHCP — Tracer'da tanıyabilir, işleyişlerini açıklayabilir ve tipik hataları bulabilirsin.
:::

:::osi 7
:::

:::sim
url=/sims/lesson-6.1.btsim
:::

5. bölümde şunu gördün: TCP ve UDP verileri portlar aracılığıyla doğru programa güvenilir bir şekilde (ya da hızlı bir şekilde) teslim eder. Bu verilerin *içinde ne olduğunu* ise **uygulama katmanı** protokolleri belirler. TCP/IP modelinde bu tek bir katmandır, ISO/OSI modelinde ise 5. ile 7. katmanlara karşılık gelir.

Bu protokollerin her birinin kendine ait bir görevi — ve kendine ait bir portu vardır:

| Protokol | Görev | Port | Taşıma |
|---|---|---|---|
| **HTTP** | web sayfalarını getirmek | 80 | TCP |
| **DNS** | adları IP adreslerine çevirmek | 53 | çoğunlukla UDP |
| **SMTP** | e-posta göndermek | 25 | TCP |
| **POP3** / **IMAP** | e-postaları almak | 110 / 143 | TCP |
| **DHCP** | bir cihaza otomatik olarak IP adresi vermek | 67 / 68 | UDP |

1.3. bölümde bir web sayfasını hâlâ IP adresi üzerinden açmıştın. Günlük hayatta kimse `192.168.0.20` yazmaz — ve hiçbir yeni dizüstü bilgisayarın adresi elle girilmez. Bunların hepsinin nasıl birlikte çalıştığını bu bölümde, protokol protokol keşfedeceksin.
