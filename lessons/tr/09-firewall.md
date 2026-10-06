# Güvenlik duvarı: Kim içeri girebilir, kim dışarı çıkabilir?

:::goal
**Öğrenme hedefi:** Bir paket filtresinin kurallarla nasıl çalıştığını açıklayabilir, kendin kurallar oluşturup bunları doğru sıraya koyabilir, paketi sessizce bırakma (drop) ile reddetme (reject) arasındaki farkı ayırt edebilir, durumsuz (stateless) ve durum denetimli (stateful) güvenlik duvarı arasındaki farkı açıklayabilir, bir DMZ kurabilir ve güvenlik duvarı kurallarındaki hataları bulabilirsin.
:::

:::osi 4
:::

:::sim
url=/sims/lesson-9.btsim
:::

Beaver okulunun kendi genel adresleri vardır (`198.51.100.…`): **Schulserver**'ına doğrudan internetten erişilebilir — NAT olmadan, IPv6 ile yakında her yerde olacağı gibi (Bölüm 7.3). İnternet ile **Schulrouter** arasında bir **güvenlik duvarı** (firewall) bulunur, ancak şu anda her şeyi geçirmektedir.

Solda "interneti" görürsün: bir **Internet-PC** ve `www.beispiel.de` web sunucusu. Sağda ise **Schulserver** ve **Lehrer-PC** ile okul ağı yer alır.

## Bir saldırgan ne görür?

Bir sunucuya saldırmak isteyen kişi önce **açık portları** arar — yani bağlantı bekleyen hizmetleri. Bunun için kullanılan araca **port tarayıcı** denir; en bilineni `nmap`'tir.

:fa-play: **Çalıştır** moduna geç, **Internet-PC** üzerinde :fa-terminal: **Terminal**'i aç ve şunu gir:

```
$ nmap 198.51.100.10
```

`nmap`, en sık kullanılan 20 porta TCP bağlantısı kurmayı dener ve hangilerinin açık olduğunu bildirir.

:::quiz multi
Okul sunucusunda internetten hangi portlar açıktır?
- [x] 22 (SSH, uzaktan bakım)
- [x] 25 (SMTP)
- [x] 80 (HTTP)
- [x] 110 (POP3)
- [x] 143 (IMAP)
- [ ] 443 (HTTPS)
:::

:::evaluate
Cevabı kontrol et
:::

Web sitesine (80) ve e-posta almaya (25) internetten erişilebilmesi istenir. Ancak **uzaktan bakıma** (22) ve e-postaları almaya (110, 143) yalnızca okul ağının ihtiyacı vardır. Açık olan her port olası bir saldırı yüzeyidir: Hizmetin bir güvenlik açığı veya zayıf bir parolası varsa, bir saldırgan bunu dünyanın her yerinden istismar edebilir — ve internetteki otomatik tarayıcılar tam olarak bunu günün her saati dener.

:::tip Anahtar nokta
Bir **güvenlik duvarı**, iki ağ arasındaki sınırda veri trafiğini denetler ve yalnızca açıkça izin verilenleri geçirir. Böylece yalnızca dahili olarak ihtiyaç duyulan hizmetler internete görünmez kalır.
:::
