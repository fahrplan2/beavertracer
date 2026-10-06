# 練習場 — Markdown 與測驗（測試頁）

[[toc]]

這個頁面用來測試 Markdown 語法和互動式題型。

---

## Markdown 語法

### 文字格式

**粗體**、*斜體*、~~刪除線~~、`Inline-Code`，以及 **_組合_**。

一般段落，含一個[連結到另一頁](01-einfuehrung.html)和一個[外部連結](https://www.beavertracer.eu)。

### 標題

H2–H4 層級會自動出現在目錄（TOC）中。

#### 這是 H4 — 不會出現在 TOC 中

### 清單

無序：

- Ethernet
- IP
- TCP
  - HTTP
  - SMTP

有序：

1. 編輯模式：建立拓樸
2. 執行模式：開始模擬
3. 追蹤模式：分析封包

### 表格

| 協定 | 層 | 連接埠 |
|-----------|---------|------|
| HTTP      | 7       | 80   |
| HTTPS     | 7       | 443  |
| DNS       | 7       | 53   |
| TCP       | 4       | —    |

### 程式碼

行內：`ping 192.168.0.1`

區塊：

```
$ ping 192.168.0.2
PING 192.168.0.2: 56 data bytes
64 bytes from 192.168.0.2: icmp_seq=0 ttl=64 time=0.4 ms
```

### 提示框

:::note
這是 **note** 提示框 — 用於中性的提示和補充資訊。
:::

:::tip
這是 **tip** 提示框 — 用於實用的小技巧和建議。
:::

:::warning
這是 **warning** 提示框 — 用於需要留意的警告。
:::

:::danger
這是 **danger** 提示框 — 用於關鍵的錯誤來源。
:::

:::draft
:::

### 圖示

Font Awesome Solid: :fa-play: :fa-stop: :fa-desktop: :fa-shield-halved: :fa-wifi:

Font Awesome Regular: :far-file: :far-circle:

裝置圖示：:router: :switch:

### 內嵌模擬

:::sim
url=/sims/demo.btsim
:::

### 含行為檢查的任務

:::task
title: 連接 PC 1 和 PC 2
檢查 PC 1（id 9）在網路 192.168.0.0/24 中是否有一個 IP，並且能否連到 PC 2（id 11）。
check: ip(9, "192.168.0.0/24")
check: pingOk(9, 11)
:::

---

## OSI 參考模型：配色方案

這裡有一個彩虹色標示的表格範例（第 1 層在最下方，如同協定堆疊），以及一個位於頁面邊緣、文字環繞的「紅綠燈」。

### 彩色表格

<table class="osi-table">
<thead>
<tr><th>層</th><th>名稱</th><th>範例協定</th></tr>
</thead>
<tbody>
<tr class="osi-l7"><td>7</td><td>應用層</td><td>HTTP, DNS, SMTP</td></tr>
<tr class="osi-l6"><td>6</td><td>表現層</td><td>TLS, JPEG, ASCII</td></tr>
<tr class="osi-l5"><td>5</td><td>會議層</td><td>RPC, NetBIOS</td></tr>
<tr class="osi-l4"><td>4</td><td>傳輸層</td><td>TCP, UDP</td></tr>
<tr class="osi-l3"><td>3</td><td>網路層</td><td>IP, ICMP</td></tr>
<tr class="osi-l2"><td>2</td><td>資料連結層</td><td>Ethernet, ARP</td></tr>
<tr class="osi-l1"><td>1</td><td>實體層</td><td>銅線、光纖、WLAN</td></tr>
</tbody>
</table>

### 文字環繞的紅綠燈

紅綠燈透過 `:::osi N` 產生，其中 `N` 是要標示的層（這裡是第 3 層）。它會浮動在頁面邊緣，後面的文字會自動環繞它。

:::osi 3
:::

Lorem ipsum dolor sit amet, consetetur sadipscing elitr, sed diam nonumy eirmod tempor invidunt ut labore et dolore magna aliquyam erat, sed diam voluptua. At vero eos et accusam et justo duo dolores et ea rebum. Stet clita kasd gubergren, no sea takimata sanctus est Lorem ipsum dolor sit amet.

Lorem ipsum dolor sit amet, consetetur sadipscing elitr, sed diam nonumy eirmod tempor invidunt ut labore et dolore magna aliquyam erat, sed diam voluptua. At vero eos et accusam et justo duo dolores et ea rebum，因此這一段在內容上屬於網路層（Layer 3）— 所以紅綠燈中正好這一格有顏色，其他的都保持灰色。

---

## 單元 1：基本概念

:::quiz short
子網路遮罩 255.255.255.0 的 CIDR 表示法是什麼？
= /24
= 24
:::

:::quiz mc
下列哪個位址是 192.168.1.42/24 的網路位址？
- [ ] 192.168.1.42
- [x] 192.168.1.0
- [ ] 192.168.1.255
- [ ] 192.168.0.0
:::

:::quiz fill
將 IP 位址與{子網路遮罩}進行逐位元的 {AND} 運算，就能得到網路位址。子網路中最高的位址是{廣播}位址。
:::

:::evaluate
檢查單元 1
:::

---

## 單元 2：配對 — 協定及其功能

:::quiz match
ARP -> 找出 IP 位址對應的 MAC 位址
DNS -> 將主機名稱解析為 IP 位址
DHCP -> 自動將 IP 位址分配給用戶端
ICMP -> 由 ping 和 traceroute 使用
:::

:::evaluate
檢查單元 2
:::

---

## 單元 3：子網路劃分

:::quiz short
/30 子網路有多少個可用的主機位址？
= 2
:::

:::quiz mc
/30 子網路通常用於什麼？
- [ ] 用於有大量裝置的大型辦公室網路
- [ ] 作為 DHCP 位址池的位址範圍
- [x] 作為兩台路由器之間的連接網路
- [ ] 用於 WLAN 無線接取點
:::

:::quiz fill
/25 子網路有 {128} 個位址，其中 {126} 個可供主機使用。
:::

:::quiz match
/24 -> 254 個可用主機位址
/25 -> 126 個可用主機位址
/28 -> 14 個可用主機位址
/30 -> 2 個可用主機位址
:::

:::evaluate
檢查單元 3
:::

## 單元 4：複選題與隨機題

使用 `:::quiz multi` 時，可以有任意數量的答案是正確的 — 每個敘述會單獨評分：

:::quiz multi
關於 ARP 的哪些敘述是正確的？
- [x] ARP 會找出 IP 位址對應的 MAC 位址
- [ ] ARP 會找出名稱對應的 IP 位址
- [x] ARP 請求是廣播
- [ ] ARP 回應是廣播
:::

`:::quiz random <typ>` 每次開啟都會產生新的題目（`count=N` 指定題數）。類型：`bin2dec`、`dec2bin`、`cidr2mask`、`hosts`、`netbcast`、`samenet`、`subnet`。

:::quiz random dec2bin
count=2
:::

:::quiz random netbcast
請針對下列位址進行計算：
:::

:::quiz random samenet
count=3
:::

:::quiz random subnet
:::

:::evaluate
檢查單元 4
:::

## 單元 4b：填空表格

`:::quiz table` — 一般的 Markdown 表格，`{Antwort}` 儲存格會變成輸入欄位（不同的寫法用 `|` 分隔）：

:::quiz table
將 `192.168.42.0/24` 劃分為兩個子網路：
| 子網路 | 網路位址 | 廣播位址 |
|---|---|---|
| 1 | {192.168.42.0} | {192.168.42.127} |
| 2 | {192.168.42.128} | {192.168.42.255} |
:::

:::evaluate
檢查表格
:::

## 單元 5：位元上色

適用於 IP 和子網路劃分的章節：`[[n|…]]` = 網路部分，`[[e|…]]` = 擴充部分，`[[h|…]]` = 主機部分 — 可用於內文和表格中：

[[n|11111111.11111111.11111111]].[[e|11]][[h|000000]] = `255.255.255.192`

多行顯示時，請使用 `<pre class="bits-block">` 區塊，而不是 ```（在程式碼區塊中不會顯示顏色）：

<pre class="bits-block">
之前 (/24):  [[n|NNNNNNNN.NNNNNNNN.NNNNNNNN]].[[h|HHHHHHHH]]
之後 (/26):  [[n|NNNNNNNN.NNNNNNNN.NNNNNNNN]].[[e|EE]][[h|HHHHHH]]
</pre>

## 單元 6：序列圖

`:::seq` 會繪製一個有兩條生命線的圖。SEQ 和 ACK 編號以及生命線上的計數器，是根據旗標和資料負載（`"…"`）計算出來的。用 `-x` 取代 `->` 會讓一個區段遺失，`seq=…` 會覆寫編號（例如用於重傳）。

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

使用 `:::quiz seq` 時，`?`（置於旗標前，或寫成 `seq=?` / `ack=?`）會變成輸入欄位；`hide: counters` 會隱藏計數器：

:::quiz seq
Client -> Server: SYN
Server -> Client: ? SYN, ACK ack=?
Client -> Server: ? ACK ack=?
Client -> Server: PSH, ACK "Hello World"
Server -> Client: ACK ack=?
:::

:::evaluate
檢查序列圖
:::
