# 练习场 — Markdown 与测验（测试页）

[[toc]]

本页用于测试 Markdown 语法和交互式题型。

---

## Markdown 语法

### 文本格式

**粗体**、*斜体*、~~删除线~~、`Inline-Code`，以及 **_组合_**。

普通段落，包含一个[指向其他页面的链接](01-einfuehrung.html)和一个[外部链接](https://www.beavertracer.eu)。

### 标题

H2–H4 级标题会自动出现在目录（TOC）中。

#### 这是 H4 — 不会出现在目录中

### 列表

无序列表：

- Ethernet
- IP
- TCP
  - HTTP
  - SMTP

有序列表：

1. 编辑模式：搭建拓扑
2. 运行模式：启动模拟
3. 追踪模式：分析数据包

### 表格

| 协议 | 层 | 端口 |
|-----------|---------|------|
| HTTP      | 7       | 80   |
| HTTPS     | 7       | 443  |
| DNS       | 7       | 53   |
| TCP       | 4       | —    |

### 代码

行内：`ping 192.168.0.1`

代码块：

```
$ ping 192.168.0.2
PING 192.168.0.2: 56 data bytes
64 bytes from 192.168.0.2: icmp_seq=0 ttl=64 time=0.4 ms
```

### 提示框

:::note
这是一个 **note** 提示框 — 用于中性提示和补充信息。
:::

:::tip
这是一个 **tip** 提示框 — 用于有用的技巧和建议。
:::

:::warning
这是一个 **warning** 提示框 — 用于需要注意的警告。
:::

:::danger
这是一个 **danger** 提示框 — 用于关键的错误来源。
:::

:::draft
:::

### 图标

Font Awesome Solid: :fa-play: :fa-stop: :fa-desktop: :fa-shield-halved: :fa-wifi:

Font Awesome Regular: :far-file: :far-circle:

设备图标：:router: :switch:

### 嵌入式模拟

:::sim
url=/sims/demo.btsim
:::

### 带行为检查的任务

:::task
title: 连接 PC 1 和 PC 2
请检查 PC 1（id 9）是否在网络 192.168.0.0/24 中拥有一个 IP，并且能否访问 PC 2（id 11）。
check: ip(9, "192.168.0.0/24")
check: pingOk(9, 11)
:::

---

## OSI 参考模型：配色方案

这是一个彩虹色高亮表格的示例（第 1 层在底部，与协议栈一致），以及页面边缘带文字环绕的“红绿灯”。

### 彩色表格

<table class="osi-table">
<thead>
<tr><th>层</th><th>名称</th><th>示例协议</th></tr>
</thead>
<tbody>
<tr class="osi-l7"><td>7</td><td>应用层</td><td>HTTP, DNS, SMTP</td></tr>
<tr class="osi-l6"><td>6</td><td>表示层</td><td>TLS, JPEG, ASCII</td></tr>
<tr class="osi-l5"><td>5</td><td>会话层</td><td>RPC, NetBIOS</td></tr>
<tr class="osi-l4"><td>4</td><td>传输层</td><td>TCP, UDP</td></tr>
<tr class="osi-l3"><td>3</td><td>网络层</td><td>IP, ICMP</td></tr>
<tr class="osi-l2"><td>2</td><td>数据链路层</td><td>Ethernet, ARP</td></tr>
<tr class="osi-l1"><td>1</td><td>物理层</td><td>铜缆、光纤、WLAN</td></tr>
</tbody>
</table>

### 带文字环绕的红绿灯

红绿灯通过 `:::osi N` 生成，其中 `N` 是要高亮的层（此处为第 3 层）。它悬浮在页面边缘，后面的文字会自动绕过它。

:::osi 3
:::

Lorem ipsum dolor sit amet, consetetur sadipscing elitr, sed diam nonumy eirmod tempor invidunt ut labore et dolore magna aliquyam erat, sed diam voluptua. At vero eos et accusam et justo duo dolores et ea rebum. Stet clita kasd gubergren, no sea takimata sanctus est Lorem ipsum dolor sit amet.

Lorem ipsum dolor sit amet, consetetur sadipscing elitr, sed diam nonumy eirmod tempor invidunt ut labore et dolore magna aliquyam erat, sed diam voluptua. At vero eos et accusam et justo duo dolores et ea rebum，因此本段在内容上属于网络层（第 3 层）——所以红绿灯中恰好这一格是彩色的，其余的都保持灰色。

---

## 第 1 节：基本概念

:::quiz short
子网掩码 255.255.255.0 的 CIDR 表示法是什么？
= /24
= 24
:::

:::quiz mc
下列哪个地址是 192.168.1.42/24 的网络地址？
- [ ] 192.168.1.42
- [x] 192.168.1.0
- [ ] 192.168.1.255
- [ ] 192.168.0.0
:::

:::quiz fill
网络地址是通过对 IP 地址和{子网掩码}进行按位{AND}运算得到的。子网中最高的地址是{广播}地址。
:::

:::evaluate
检查第 1 节
:::

---

## 第 2 节：匹配 — 协议及其作用

:::quiz match
ARP -> 根据 IP 地址获取对应的 MAC 地址
DNS -> 将主机名解析为 IP 地址
DHCP -> 自动为客户端分配 IP 地址
ICMP -> 被 ping 和 traceroute 使用
:::

:::evaluate
检查第 2 节
:::

---

## 第 3 节：子网划分

:::quiz short
一个 /30 子网有多少个可用主机地址？
= 2
:::

:::quiz mc
/30 子网通常用于什么？
- [ ] 用于拥有大量设备的大型办公网络
- [ ] 作为 DHCP 地址池的地址范围
- [x] 作为两台路由器之间的互联网络
- [ ] 用于 WLAN 接入点
:::

:::quiz fill
一个 /25 子网有 {128} 个地址，其中 {126} 个可用于主机。
:::

:::quiz match
/24 -> 254 个可用主机地址
/25 -> 126 个可用主机地址
/28 -> 14 个可用主机地址
/30 -> 2 个可用主机地址
:::

:::evaluate
检查第 3 节
:::

## 第 4 节：多选题与随机题

使用 `:::quiz multi` 时，可以有任意数量的答案是正确的 — 每条陈述会单独评分：

:::quiz multi
关于 ARP 的哪些说法是正确的？
- [x] ARP 根据 IP 地址获取对应的 MAC 地址
- [ ] ARP 根据名称获取对应的 IP 地址
- [x] ARP 请求是广播
- [ ] ARP 应答是广播
:::

`:::quiz random <typ>` 每次调用都会生成新的题目（`count=N` 指定数量）。类型：`bin2dec`、`dec2bin`、`cidr2mask`、`hosts`、`netbcast`、`samenet`、`subnet`。

:::quiz random dec2bin
count=2
:::

:::quiz random netbcast
请为下面的地址计算：
:::

:::quiz random samenet
count=3
:::

:::quiz random subnet
:::

:::evaluate
检查第 4 节
:::

## 第 4b 节：填空表格

`:::quiz table` — 一个普通的 Markdown 表格，`{Antwort}` 单元格会变成输入框（不同的写法用 `|` 分隔）：

:::quiz table
将 `192.168.42.0/24` 划分为两个子网：
| 子网 | 网络地址 | 广播地址 |
|---|---|---|
| 1 | {192.168.42.0} | {192.168.42.127} |
| 2 | {192.168.42.128} | {192.168.42.255} |
:::

:::evaluate
检查表格
:::

## 第 5 节：为比特着色

适用于 IP 和子网划分章节：`[[n|…]]` = 网络部分，`[[e|…]]` = 扩展部分，`[[h|…]]` = 主机部分 — 可用于正文和表格中：

[[n|11111111.11111111.11111111]].[[e|11]][[h|000000]] = `255.255.255.192`

对于多行显示，请使用 `<pre class="bits-block">` 块，而不是 ```（在代码块中不会显示颜色）：

<pre class="bits-block">
之前  (/24):  [[n|NNNNNNNN.NNNNNNNN.NNNNNNNN]].[[h|HHHHHHHH]]
之后  (/26):  [[n|NNNNNNNN.NNNNNNNN.NNNNNNNN]].[[e|EE]][[h|HHHHHH]]
</pre>

## 第 6 节：时序图

`:::seq` 会绘制一个带有两条生命线的图。SEQ 和 ACK 编号以及生命线上的计数器，是根据标志位和有效载荷（`"…"`）计算出来的。用 `-x` 代替 `->` 会使一个报文段丢失，`seq=…` 会覆盖某个编号（例如在重传时）。

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

使用 `:::quiz seq` 时，`?`（位于标志位之前，或 `seq=?` / `ack=?`）会变成输入框；`hide: counters` 会隐藏计数器：

:::quiz seq
Client -> Server: SYN
Server -> Client: ? SYN, ACK ack=?
Client -> Server: ? ACK ack=?
Client -> Server: PSH, ACK "Hello World"
Server -> Client: ACK ack=?
:::

:::evaluate
检查时序图
:::
