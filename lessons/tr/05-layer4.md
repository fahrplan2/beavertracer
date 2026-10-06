# Katman 4: Taşıma katmanı

:::goal
**Öğrenme hedefi:** Taşıma katmanının görevlerini sayabilir, bir TCP bağlantısının akışını (kurulum, veri, sonlandırma) sıralama diyagramı olarak gösterebilir, portları ile sıra ve onay numaralarını açıklayabilir ve UDP'nin ne zaman TCP yerine kullanıldığını gerekçelendirebilirsin.
:::

:::osi 4
:::

:::sim
url=/sims/lesson-5.1.btsim
:::

Bölüm 4'e kısa bir geri dönüş: Katman 3'teki **Internet Protocol**, bir paketi doğru *bilgisayara* ulaştırır; üstelik birçok yönlendirici üzerinden geçerek. IP'nin vaadi ise bundan ibarettir:

- Bir bilgisayarda aynı anda birçok program çalışır: tarayıcı, e-posta programı, anlık mesajlaşma uygulaması. Bir paket bunlardan hangisi için gönderilmiştir? Bu bilgi IP başlığında yer almaz.
- Yolda bir paket kaybolursa IP bunu fark etmez. Paketler ayrıca çift gelebilir veya yanlış sırada ulaşabilir. Bu nedenle IP'nin yalnızca elinden gelenin en iyisini yaptığı söylenir (*best effort*).

Bu boşlukları **Katman 4**, yani taşıma katmanı kapatır. Çalışma alanında bir **Client-PC** ve bir **Server** görüyorsun. Bu bölümde katman 4'ün en önemli iki protokolünü, **TCP** ve **UDP**'yi bunlar üzerinde inceleyeceksin.

:::note
TCP 1981'den beri standartlaştırılmıştır (**RFC 793**, bugün **RFC 9293**), UDP ise daha 1980'den beri (**RFC 768**).
:::
