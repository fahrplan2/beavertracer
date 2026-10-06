# Katman 3: Yönlendirici, IP adresleri ve alt ağlara bölme

:::goal
**Öğrenme hedefi:** IP adreslerini ikili sistemde okuyabilir, ağ adresini ve yayın adresini hesaplayabilir, bir ağı eşit büyüklükte alt ağlara bölebilir ve ağları yönlendirme tablolarıyla yönlendiriciler üzerinden birbirine bağlayabilirsin.
:::

:::osi 3
:::

:::sim
url=/sims/lesson-4.1.btsim
:::

Şimdiye kadar tüm cihazlar *tek bir* yerel ağdaydı; anahtarlar (switch) ve Erişim Noktası cihazları üzerinden birbirine bağlanıyordu. İnternet ise bu tür milyonlarca ağdan oluşur: Ev ağın, okul ağı, mobil operatörünün ağı, büyük veri merkezlerinin ağları.

Bir paket bir ağdan başka bir ağa giden yolu nasıl bulur? Bununla **Katman 3**, yani ağ katmanı ilgilenir. Bu katmanda **İnternet Protokolü (IP)**, IP adresleri ve ağları birbirine bağlayan cihazlar, yani **yönlendiriciler (router)** yer alır.

:::note
IP, 1981'den beri bir standartta tanımlıdır: **RFC 791**. Bu bölümde ağırlıklı olarak ele alınan sürüm **IPv4**'tür. Daha yeni olan **IPv6** sürümünü bölümün sonunda tanıyacaksın.
:::
