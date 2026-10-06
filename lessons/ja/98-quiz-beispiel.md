# プレイグラウンド — Markdown とクイズ(テストページ)

[[toc]]

このページは、Markdown 構文とインタラクティブな問題形式をテストするためのものです。

---

## Markdown 構文

### テキストの書式

**太字**、*斜体*、~~取り消し線~~、`Inline-Code`、そして **_組み合わせ_**。

[別のページへのリンク](01-einfuehrung.html)と[外部リンク](https://www.beavertracer.eu)を含む通常の段落です。

### 見出し

H2〜H4 のレベルは自動的に目次(TOC)に表示されます。

#### これは H4 です — 目次には表示されません

### リスト

順序なし:

- Ethernet
- IP
- TCP
  - HTTP
  - SMTP

順序あり:

1. 編集モード: トポロジーを構築する
2. 実行モード: シミュレーションを開始する
3. トレースモード: パケットを分析する

### 表

| プロトコル | 層 | ポート |
|-----------|---------|------|
| HTTP      | 7       | 80   |
| HTTPS     | 7       | 443  |
| DNS       | 7       | 53   |
| TCP       | 4       | —    |

### コード

インライン: `ping 192.168.0.1`

ブロック:

```
$ ping 192.168.0.2
PING 192.168.0.2: 56 data bytes
64 bytes from 192.168.0.2: icmp_seq=0 ttl=64 time=0.4 ms
```

### コールアウト

:::note
これは **note** コールアウトです — 中立的な注意事項や補足情報に使います。
:::

:::tip
これは **tip** コールアウトです — 役立つヒントやおすすめに使います。
:::

:::warning
これは **warning** コールアウトです — 注意が必要な警告に使います。
:::

:::danger
これは **danger** コールアウトです — 重大なエラーの原因に使います。
:::

:::draft
:::

### アイコン

Font Awesome Solid: :fa-play: :fa-stop: :fa-desktop: :fa-shield-halved: :fa-wifi:

Font Awesome Regular: :far-file: :far-circle:

機器アイコン: :router: :switch:

### 埋め込みシミュレーション

:::sim
url=/sims/demo.btsim
:::

### 動作チェック付きのタスク

:::task
title: PC 1 と PC 2 を接続する
PC 1(id 9)がネットワーク 192.168.0.0/24 内の IP アドレスを持ち、PC 2(id 11)に到達できるかを確認しましょう。
check: ip(9, "192.168.0.0/24")
check: pingOk(9, 11)
:::

---

## OSI参照モデル: 配色

虹色で強調表示した表の例(層1が下、実際のスタックと同じ並び)と、テキストの回り込みがある余白の「信号機」の例です。

### カラー表

<table class="osi-table">
<thead>
<tr><th>層</th><th>名称</th><th>プロトコルの例</th></tr>
</thead>
<tbody>
<tr class="osi-l7"><td>7</td><td>アプリケーション</td><td>HTTP, DNS, SMTP</td></tr>
<tr class="osi-l6"><td>6</td><td>プレゼンテーション</td><td>TLS, JPEG, ASCII</td></tr>
<tr class="osi-l5"><td>5</td><td>セッション</td><td>RPC, NetBIOS</td></tr>
<tr class="osi-l4"><td>4</td><td>トランスポート</td><td>TCP, UDP</td></tr>
<tr class="osi-l3"><td>3</td><td>ネットワーク</td><td>IP, ICMP</td></tr>
<tr class="osi-l2"><td>2</td><td>データリンク</td><td>Ethernet, ARP</td></tr>
<tr class="osi-l1"><td>1</td><td>物理</td><td>銅線、光ファイバー、無線LAN</td></tr>
</tbody>
</table>

### テキストが回り込む信号機

信号機は `:::osi N` で作成します。`N` は強調表示する層です(ここでは層3)。信号機は余白に浮かんで表示され、後続のテキストは自動的にその横を回り込みます。

:::osi 3
:::

Lorem ipsum dolor sit amet, consetetur sadipscing elitr, sed diam nonumy eirmod tempor invidunt ut labore et dolore magna aliquyam erat, sed diam voluptua. At vero eos et accusam et justo duo dolores et ea rebum. Stet clita kasd gubergren, no sea takimata sanctus est Lorem ipsum dolor sit amet.

Lorem ipsum dolor sit amet, consetetur sadipscing elitr, sed diam nonumy eirmod tempor invidunt ut labore et dolore magna aliquyam erat, sed diam voluptua. At vero eos et accusam et justo duo dolores et ea rebum、そのためこのセクションは内容的にネットワーク層(レイヤー3)に対応しています — だからこそ、信号機ではこのボックスだけに色が付き、他はすべてグレーのままです。

---

## セクション1: 基本用語

:::quiz short
サブネットマスク 255.255.255.0 の CIDR 表記は何ですか?
= /24
= 24
:::

:::quiz mc
次のアドレスのうち、192.168.1.42/24 のネットワークアドレスはどれですか?
- [ ] 192.168.1.42
- [x] 192.168.1.0
- [ ] 192.168.1.255
- [ ] 192.168.0.0
:::

:::quiz fill
ビット単位の{AND}演算によって、IPアドレスと{サブネットマスク}からネットワークアドレスが得られます。サブネット内の最大のアドレスが{ブロードキャスト}アドレスです。
:::

:::evaluate
セクション1を確認
:::

---

## セクション2: 対応づけ — プロトコルとその役割

:::quiz match
ARP -> IPアドレスに対応するMACアドレスを調べる
DNS -> ホスト名をIPアドレスに解決する
DHCP -> クライアントにIPアドレスを自動的に割り当てる
ICMP -> pingやtracerouteで使われる
:::

:::evaluate
セクション2を確認
:::

---

## セクション3: サブネット化

:::quiz short
/30 のサブネットで使用可能なホストアドレスはいくつですか?
= 2
:::

:::quiz mc
/30 のサブネットは一般的に何に使われますか?
- [ ] 多数の機器がある大規模なオフィスネットワーク
- [ ] DHCP プールのアドレス範囲
- [x] 2台のルーター間を接続するネットワーク
- [ ] 無線LANのアクセスポイント
:::

:::quiz fill
/25 のサブネットには{128}個のアドレスがあり、そのうち{126}個がホストに使用できます。
:::

:::quiz match
/24 -> 使用可能なホストアドレス254個
/25 -> 使用可能なホストアドレス126個
/28 -> 使用可能なホストアドレス14個
/30 -> 使用可能なホストアドレス2個
:::

:::evaluate
セクション3を確認
:::

## セクション4: 複数選択とランダム問題

`:::quiz multi` では、正解はいくつあってもかまいません — 各選択肢が個別に採点されます:

:::quiz multi
ARP について正しい記述はどれですか?
- [x] ARP は IP アドレスに対応する MAC アドレスを調べる
- [ ] ARP は名前に対応する IP アドレスを調べる
- [x] ARP 要求はブロードキャストである
- [ ] ARP 応答はブロードキャストである
:::

`:::quiz random <typ>` は、呼び出すたびに新しい問題を生成します(`count=N` で問題数を指定)。タイプ: `bin2dec`, `dec2bin`, `cidr2mask`, `hosts`, `netbcast`, `samenet`, `subnet`。

:::quiz random dec2bin
count=2
:::

:::quiz random netbcast
次のアドレスについて計算しましょう:
:::

:::quiz random samenet
count=3
:::

:::quiz random subnet
:::

:::evaluate
セクション4を確認
:::

## セクション4b: 穴埋め表

`:::quiz table` — 通常の Markdown 表で、`{Antwort}` のセルが入力欄になります(別解は `|` で区切ります):

:::quiz table
`192.168.42.0/24` を2つのサブネットに分割しましょう:
| サブネット | ネットワークアドレス | ブロードキャストアドレス |
|---|---|---|
| 1 | {192.168.42.0} | {192.168.42.127} |
| 2 | {192.168.42.128} | {192.168.42.255} |
:::

:::evaluate
表を確認
:::

## セクション5: ビットの色分け

IP とサブネット化の章向け: `[[n|…]]` = ネットワーク部、`[[e|…]]` = 拡張部分、`[[h|…]]` = ホスト部 — 本文中でも表の中でも使えます:

[[n|11111111.11111111.11111111]].[[e|11]][[h|000000]] = `255.255.255.192`

複数行で表示するには、``` の代わりに `<pre class="bits-block">` ブロックを使います(コードブロックでは色が表示されません):

<pre class="bits-block">
変更前 (/24):  [[n|NNNNNNNN.NNNNNNNN.NNNNNNNN]].[[h|HHHHHHHH]]
変更後 (/26):  [[n|NNNNNNNN.NNNNNNNN.NNNNNNNN]].[[e|EE]][[h|HHHHHH]]
</pre>

## セクション6: シーケンス図

`:::seq` は2本のライフラインを持つ図を描きます。SEQ 番号と ACK 番号、およびライフライン上のカウンターは、フラグとペイロード(`"…"`)から計算されます。`->` の代わりに `-x` を使うとセグメントが失われ、`seq=…` で番号を上書きできます(例: 再送の場合)。

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

`:::quiz seq` では、`?`(フラグの前、または `seq=?` / `ack=?`)が入力欄になります。`hide: counters` でカウンターを非表示にできます:

:::quiz seq
Client -> Server: SYN
Server -> Client: ? SYN, ACK ack=?
Client -> Server: ? ACK ack=?
Client -> Server: PSH, ACK "Hello World"
Server -> Client: ACK ack=?
:::

:::evaluate
図を確認
:::
