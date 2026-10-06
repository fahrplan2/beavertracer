# Güvenlik: Şifreleme ve sertifikalar

:::goal
**Öğrenme hedefi:** Gizlilik, bütünlük ve kimlik doğrulama (özgünlük) olmak üzere üç güvenlik hedefini açıklayabilir, simetrik ve asimetrik şifrelemeyi ayırt edebilir, özet değerlerini (hash) ve dijital imzaları yerlerine oturtabilir, sertifikaları okuyabilir ve kendin düzenleyebilir, HTTPS'i kurabilir ve tipik sertifika uyarılarını yorumlayabilirsin.
:::

Son bölümlerde İzleyici'de neredeyse her şeyi okuyabiliyordun:

- **Bölüm 3.3.2:** Kablosuz ağda (WLAN) menzil içindeki her cihaz tüm telsiz paketlerini alır.
- **Bölüm 6.1.2:** HTTP'de istek ve web sayfası pakette düz metin olarak bulunur.
- **Bölüm 6.3.2:** SMTP ve POP3'te kullanıcı adı ve parola neredeyse düz metin olarak hattan geçer — `AUTH PLAIN` yalnızca Base64'tür.

Bir hattı ya da aynı kablosuz ağı dinleyen kişi; parolaları, notları, mesajları ve banka bilgilerini görebilir. Üstelik daha fazlasını da yapabilir: Paketleri **değiştirebilir** ya da kendini başkası gibi **gösterebilir**.

## Üç güvenlik hedefi

Kriptografi bu tehlikelere karşı yardımcı olmalıdır. **Güvenlik hedefleri** üç tanedir:

| Güvenlik hedefi | Soru | Saldırı örneği |
|---|---|---|
| **Gizlilik** | Verileri yalnızca doğru alıcı okuyabilir mi? | Biri kablosuz ağda parolanı okur. |
| **Bütünlük** | Veriler değişmeden mi ulaştı? | Biri bir havalede tutarı değiştirir. |
| **Özgünlük (kimlik doğrulama)** | Veriler gerçekten belirtilen göndericiden mi geliyor? | Sahte bir banka web sitesi PIN'ini sorar. |

Bu bölümde bu üç hedefe ulaşmayı sağlayan araçları ve bunların tarayıcıdaki kilit simgesi olan **HTTPS** içinde nasıl birlikte çalıştığını öğreneceksin.

:::quiz match
Biri kablosuz ağda parolanı okuyor -> Gizlilik
Biri yolda bir havalenin tutarını değiştiriyor -> Bütünlük
Sahte bir web sitesi kendini bankan gibi gösteriyor -> Özgünlük
:::

:::evaluate
Eşleştirmeyi kontrol et
:::
