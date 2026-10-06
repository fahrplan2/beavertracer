# Oyun alanı — Markdown ve quiz (test sayfası)

[[toc]]

Bu sayfa, Markdown sözdizimini ve etkileşimli soru türlerini test etmek için kullanılır.

---

## Markdown sözdizimi

### Metin biçimlendirme

**Kalın**, *italik*, ~~üstü çizili~~, `Inline-Code` ve **_birleşik_**.

Normal bir paragraf: [başka bir sayfaya bağlantı](01-einfuehrung.html) ve [harici bir bağlantı](https://www.beavertracer.eu).

### Başlıklar

H2–H4 seviyeleri içindekiler tablosunda (TOC) otomatik olarak görünür.

#### Bu bir H4 — TOC'de görünmez

### Listeler

Sırasız:

- Ethernet
- IP
- TCP
  - HTTP
  - SMTP

Sıralı:

1. Düzenleme modu: Topolojiyi oluştur
2. Çalıştırma modu: Simülasyonu başlat
3. İzleme modu: Paketleri analiz et

### Tablo

| Protokol | Katman | Port |
|-----------|---------|------|
| HTTP      | 7       | 80   |
| HTTPS     | 7       | 443  |
| DNS       | 7       | 53   |
| TCP       | 4       | —    |

### Kod

Satır içi: `ping 192.168.0.1`

Blok:

```
$ ping 192.168.0.2
PING 192.168.0.2: 56 data bytes
64 bytes from 192.168.0.2: icmp_seq=0 ttl=64 time=0.4 ms
```

### Callout'lar

:::note
Bu bir **note** callout'udur — tarafsız notlar ve ek bilgiler için.
:::

:::tip
Bu bir **tip** callout'udur — faydalı ipuçları ve öneriler için.
:::

:::warning
Bu bir **warning** callout'udur — dikkat gerektiren uyarılar için.
:::

:::danger
Bu bir **danger** callout'udur — kritik hata kaynakları için.
:::

:::draft
:::

### Simgeler

Font Awesome Solid: :fa-play: :fa-stop: :fa-desktop: :fa-shield-halved: :fa-wifi:

Font Awesome Regular: :far-file: :far-circle:

Cihaz simgeleri: :router: :switch:

### Gömülü simülasyon

:::sim
url=/sims/demo.btsim
:::

### Davranış kontrollü görev

:::task
title: PC 1 ve PC 2'yi bağla
PC 1'in (id 9) 192.168.0.0/24 ağında bir IP'ye sahip olup olmadığını ve PC 2'ye (id 11) ulaşıp ulaşamadığını kontrol et.
check: ip(9, "192.168.0.0/24")
check: pingOk(9, 11)
:::

---

## OSI referans modeli: renk şeması

Gökkuşağı renkleriyle vurgulanmış bir tablo örneği (Katman 1 altta, yığındaki gibi) ve kenarda metnin etrafından aktığı bir "trafik ışığı".

### Renkli tablo

<table class="osi-table">
<thead>
<tr><th>Katman</th><th>Ad</th><th>Örnek protokoller</th></tr>
</thead>
<tbody>
<tr class="osi-l7"><td>7</td><td>Uygulama</td><td>HTTP, DNS, SMTP</td></tr>
<tr class="osi-l6"><td>6</td><td>Sunum</td><td>TLS, JPEG, ASCII</td></tr>
<tr class="osi-l5"><td>5</td><td>Oturum</td><td>RPC, NetBIOS</td></tr>
<tr class="osi-l4"><td>4</td><td>Taşıma</td><td>TCP, UDP</td></tr>
<tr class="osi-l3"><td>3</td><td>Ağ</td><td>IP, ICMP</td></tr>
<tr class="osi-l2"><td>2</td><td>Veri bağlantısı</td><td>Ethernet, ARP</td></tr>
<tr class="osi-l1"><td>1</td><td>Fiziksel</td><td>Bakır, fiber optik, WLAN</td></tr>
</tbody>
</table>

### Metin akışlı trafik ışığı

Trafik ışığı `:::osi N` ile oluşturulur; burada `N` vurgulanacak katmandır (burada Katman 3). Kenarda yüzer, sonraki metin otomatik olarak onun yanından akar.

:::osi 3
:::

Lorem ipsum dolor sit amet, consetetur sadipscing elitr, sed diam nonumy eirmod tempor invidunt ut labore et dolore magna aliquyam erat, sed diam voluptua. At vero eos et accusam et justo duo dolores et ea rebum. Stet clita kasd gubergren, no sea takimata sanctus est Lorem ipsum dolor sit amet.

Lorem ipsum dolor sit amet, consetetur sadipscing elitr, sed diam nonumy eirmod tempor invidunt ut labore et dolore magna aliquyam erat, sed diam voluptua. At vero eos et accusam et justo duo dolores et ea rebum; bu nedenle bu bölüm içerik olarak ağ katmanına (Katman 3) atanmıştır — trafik ışığında tam olarak bu kutunun renkli olmasının nedeni budur, diğerlerinin hepsi gri kalır.

---

## Bölüm 1: Temel kavramlar

:::quiz short
255.255.255.0 alt ağ maskesinin CIDR gösterimi nedir?
= /24
= 24
:::

:::quiz mc
Aşağıdaki adreslerden hangisi 192.168.1.42/24 için ağ adresidir?
- [ ] 192.168.1.42
- [x] 192.168.1.0
- [ ] 192.168.1.255
- [ ] 192.168.0.0
:::

:::quiz fill
Ağ adresi, IP adresi ile {alt ağ maskesinin} bit düzeyinde {AND} işlemiyle elde edilir. Alt ağdaki en yüksek adres {yayın} adresidir.
:::

:::evaluate
Bölüm 1'i kontrol et
:::

---

## Bölüm 2: Eşleştirme — protokoller ve görevleri

:::quiz match
ARP -> Bir IP adresine ait MAC adresini bulur
DNS -> Ana makine adlarını IP adreslerine çözümler
DHCP -> İstemcilere otomatik olarak IP adresi atar
ICMP -> ping ve traceroute tarafından kullanılır
:::

:::evaluate
Bölüm 2'yi kontrol et
:::

---

## Bölüm 3: Alt ağ oluşturma

:::quiz short
Bir /30 alt ağında kaç kullanılabilir ana makine adresi vardır?
= 2
:::

:::quiz mc
/30 alt ağı tipik olarak ne için kullanılır?
- [ ] Çok sayıda cihaza sahip büyük ofis ağları için
- [ ] DHCP havuzları için adres aralığı olarak
- [x] İki yönlendirici arasındaki bağlantı ağı olarak
- [ ] WLAN erişim noktaları için
:::

:::quiz fill
Bir /25 alt ağında {128} adres vardır, bunların {126} tanesi ana makineler için kullanılabilir.
:::

:::quiz match
/24 -> 254 kullanılabilir ana makine adresi
/25 -> 126 kullanılabilir ana makine adresi
/28 -> 14 kullanılabilir ana makine adresi
/30 -> 2 kullanılabilir ana makine adresi
:::

:::evaluate
Bölüm 3'ü kontrol et
:::

## Bölüm 4: Çoklu seçim ve rastgele görevler

`:::quiz multi` ile istenen sayıda cevap doğru olabilir — her ifade ayrı ayrı değerlendirilir:

:::quiz multi
ARP hakkında hangi ifadeler doğrudur?
- [x] ARP, bir IP adresine ait MAC adresini bulur
- [ ] ARP, bir ada ait IP adresini bulur
- [x] Bir ARP isteği yayındır (broadcast)
- [ ] Bir ARP yanıtı yayındır (broadcast)
:::

`:::quiz random <typ>` her çağrıda yeni görevler üretir (`count=N` sayıyı belirler). Türler: `bin2dec`, `dec2bin`, `cidr2mask`, `hosts`, `netbcast`, `samenet`, `subnet`.

:::quiz random dec2bin
count=2
:::

:::quiz random netbcast
Aşağıdaki adres için hesapla:
:::

:::quiz random samenet
count=3
:::

:::quiz random subnet
:::

:::evaluate
Bölüm 4'ü kontrol et
:::

## Bölüm 4b: Doldurulacak tablo

`:::quiz table` — normal bir Markdown tablosu; `{Antwort}` hücreleri giriş alanlarına dönüşür (varyantları `|` ile ayır):

:::quiz table
`192.168.42.0/24` ağını iki alt ağa böl:
| Alt ağ | Ağ adresi | Yayın adresi |
|---|---|---|
| 1 | {192.168.42.0} | {192.168.42.127} |
| 2 | {192.168.42.128} | {192.168.42.255} |
:::

:::evaluate
Tabloyu kontrol et
:::

## Bölüm 5: Bitleri renklendirme

IP ve alt ağ oluşturma bölümleri için: `[[n|…]]` = ağ kısmı, `[[e|…]]` = genişletme, `[[h|…]]` = ana makine kısmı — akan metinde ve tablolarda:

[[n|11111111.11111111.11111111]].[[e|11]][[h|000000]] = `255.255.255.192`

Çok satırlı gösterimler için ``` yerine bir `<pre class="bits-block">` bloğu kullan (kod bloklarında renkler gösterilmez):

<pre class="bits-block">
önce    (/24):  [[n|NNNNNNNN.NNNNNNNN.NNNNNNNN]].[[h|HHHHHHHH]]
sonra   (/26):  [[n|NNNNNNNN.NNNNNNNN.NNNNNNNN]].[[e|EE]][[h|HHHHHH]]
</pre>

## Bölüm 6: Sıralama diyagramı

`:::seq` iki yaşam çizgisine sahip bir diyagram çizer. SEQ ve ACK numaraları ile yaşam çizgilerindeki sayaçlar, bayraklardan ve yük verilerinden (`"…"`) hesaplanır. `->` yerine `-x` bir segmentin kaybolmasına neden olur, `seq=…` bir numaranın üzerine yazar (ör. yeniden iletimde).

:::seq
Client -> Server: SYN
Server -> Client: SYN, ACK
Client -> Server: ACK
Client -> Server: PSH, ACK "Hello World"
Server -> Client: ACK
Client -x Server: PSH, ACK "Hallo"
Client -> Server: PSH, ACK "Hallo" seq=12
Server -> Client: ACK
Client -> Server: FIN, ACK
Server -> Client: ACK
Server -> Client: FIN, ACK
Client -> Server: ACK
:::

`:::quiz seq` ile `?` (bayrakların önünde ya da `seq=?` / `ack=?`) giriş alanlarına dönüşür; `hide: counters` sayaçları gizler:

:::quiz seq
Client -> Server: SYN
Server -> Client: ? SYN, ACK ack=?
Client -> Server: ? ACK ack=?
Client -> Server: PSH, ACK "Hello World"
Server -> Client: ACK ack=?
:::

:::evaluate
Diyagramı kontrol et
:::
