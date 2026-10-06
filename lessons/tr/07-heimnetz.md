# Ev ağı: yönlendirici ve NAT

:::goal
**Öğrenme hedefi:** Bir ev yönlendiricisinin görevlerini sıralayabilir, bir ev yönlendiricisini kurabilir, NAT'ın birçok cihazı tek bir genel adres üzerinden nasıl internete çıkardığını açıklayabilir ve bir port yönlendirme kurup test edebilirsin.
:::

:::osi 3
:::

:::sim
url=/sims/lesson-7.1.btsim
:::

Evde ağa çok çabuk on veya daha fazla cihaz bağlanır: telefonlar, dizüstü bilgisayarlar, televizyon, oyun konsolu, hoparlörler. Hepsi `192.168.178.20` gibi adresler alır — internette hiç yönlendirilmeyen **özel** bir aralıktan (Bölüm 4.2.2). Yine de bu cihazların her biri internete çıkabilir.

Bunu gösterişsiz görünen küçük bir kutu sağlar: **ev yönlendiricisi**. Çalışma alanında solda bir PC ve bir tabletten oluşan bir ev ağını, sağda ise "interneti" görürsün — bir sağlayıcının yönlendiricileri, bir DNS sunucusu ve `www.beispiel.de` web sunucusu.

:::note
Bu bölümdeki genel adresler (`203.0.113.…`, `198.51.100.…`, `192.0.2.…`) örnekler ve eğitim materyalleri için ayrılmıştır — tıpkı IPv6'daki `2001:db8::` gibi.
:::
