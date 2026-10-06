# 놀이터 — 마크다운 & 퀴즈 (테스트 페이지)

[[toc]]

이 페이지는 마크다운 문법과 인터랙티브 문제 유형을 테스트하기 위한 페이지다.

---

## 마크다운 문법

### 텍스트 서식

**굵게**, *기울임*, ~~취소선~~, `Inline-Code`, 그리고 **_조합_**.

[다른 페이지로 가는 링크](01-einfuehrung.html)와 [외부 링크](https://www.beavertracer.eu)가 포함된 일반 문단.

### 제목

H2–H4 단계는 자동으로 목차(TOC)에 나타난다.

#### 이것은 H4 — 목차에는 나타나지 않는다

### 목록

순서 없는 목록:

- Ethernet
- IP
- TCP
  - HTTP
  - SMTP

순서 있는 목록:

1. 편집 모드: 토폴로지 구성하기
2. 실행 모드: 시뮬레이션 시작하기
3. 추적 모드: 패킷 분석하기

### 표

| 프로토콜 | 계층 | 포트 |
|-----------|---------|------|
| HTTP      | 7       | 80   |
| HTTPS     | 7       | 443  |
| DNS       | 7       | 53   |
| TCP       | 4       | —    |

### 코드

인라인: `ping 192.168.0.1`

블록:

```
$ ping 192.168.0.2
PING 192.168.0.2: 56 data bytes
64 bytes from 192.168.0.2: icmp_seq=0 ttl=64 time=0.4 ms
```

### 콜아웃

:::note
이것은 **note** 콜아웃이다 — 중립적인 안내와 보충 정보를 위한 것이다.
:::

:::tip
이것은 **tip** 콜아웃이다 — 유용한 팁과 권장 사항을 위한 것이다.
:::

:::warning
이것은 **warning** 콜아웃이다 — 주의가 필요한 경고를 위한 것이다.
:::

:::danger
이것은 **danger** 콜아웃이다 — 치명적인 오류 원인을 위한 것이다.
:::

:::draft
:::

### 아이콘

Font Awesome Solid: :fa-play: :fa-stop: :fa-desktop: :fa-shield-halved: :fa-wifi:

Font Awesome Regular: :far-file: :far-circle:

장치 아이콘: :router: :switch:

### 삽입된 시뮬레이션

:::sim
url=/sims/demo.btsim
:::

### 동작 확인이 있는 작업

:::task
title: PC 1과 PC 2 연결하기
PC 1(id 9)이 네트워크 192.168.0.0/24의 IP를 가지고 있고 PC 2(id 11)에 도달할 수 있는지 확인해 보자.
check: ip(9, "192.168.0.0/24")
check: pingOk(9, 11)
:::

---

## OSI 참조 모델: 색상 체계

무지개색으로 강조한 표(스택에서처럼 1계층이 아래)와, 페이지 가장자리에 텍스트가 감싸듯 흐르는 "신호등"의 예시이다.

### 색상이 있는 표

<table class="osi-table">
<thead>
<tr><th>계층</th><th>이름</th><th>예시 프로토콜</th></tr>
</thead>
<tbody>
<tr class="osi-l7"><td>7</td><td>응용</td><td>HTTP, DNS, SMTP</td></tr>
<tr class="osi-l6"><td>6</td><td>표현</td><td>TLS, JPEG, ASCII</td></tr>
<tr class="osi-l5"><td>5</td><td>세션</td><td>RPC, NetBIOS</td></tr>
<tr class="osi-l4"><td>4</td><td>전송</td><td>TCP, UDP</td></tr>
<tr class="osi-l3"><td>3</td><td>네트워크</td><td>IP, ICMP</td></tr>
<tr class="osi-l2"><td>2</td><td>데이터 링크</td><td>Ethernet, ARP</td></tr>
<tr class="osi-l1"><td>1</td><td>물리</td><td>구리선, 광섬유, 무선 LAN</td></tr>
</tbody>
</table>

### 텍스트가 감싸는 신호등

신호등은 `:::osi N`으로 만들며, 여기서 `N`은 강조할 계층이다(여기서는 3계층). 신호등은 가장자리에 떠 있고, 뒤따르는 텍스트는 자동으로 그 옆을 따라 흐른다.

:::osi 3
:::

Lorem ipsum dolor sit amet, consetetur sadipscing elitr, sed diam nonumy eirmod tempor invidunt ut labore et dolore magna aliquyam erat, sed diam voluptua. At vero eos et accusam et justo duo dolores et ea rebum. Stet clita kasd gubergren, no sea takimata sanctus est Lorem ipsum dolor sit amet.

Lorem ipsum dolor sit amet, consetetur sadipscing elitr, sed diam nonumy eirmod tempor invidunt ut labore et dolore magna aliquyam erat, sed diam voluptua. At vero eos et accusam et justo duo dolores et ea rebum, 그래서 이 절은 내용상 네트워크 계층(Layer 3)에 해당한다 — 그렇기 때문에 신호등에서 바로 이 칸만 색이 칠해지고 나머지는 모두 회색으로 남는다.

---

## 절 1: 기본 개념

:::quiz short
서브넷 마스크 255.255.255.0의 CIDR 표기는 무엇인가?
= /24
= 24
:::

:::quiz mc
다음 중 192.168.1.42/24의 네트워크 주소는 어느 것인가?
- [ ] 192.168.1.42
- [x] 192.168.1.0
- [ ] 192.168.1.255
- [ ] 192.168.0.0
:::

:::quiz fill
네트워크 주소는 IP 주소와 {서브넷 마스크}의 비트 단위 {AND} 연산으로 얻는다. 서브넷에서 가장 높은 주소는 {브로드캐스트} 주소이다.
:::

:::evaluate
절 1 확인
:::

---

## 절 2: 짝짓기 — 프로토콜과 그 역할

:::quiz match
ARP -> IP 주소에 해당하는 MAC 주소를 알아낸다
DNS -> 호스트 이름을 IP 주소로 변환한다
DHCP -> 클라이언트에 IP 주소를 자동으로 할당한다
ICMP -> ping과 traceroute에서 사용된다
:::

:::evaluate
절 2 확인
:::

---

## 절 3: 서브넷팅

:::quiz short
/30 서브넷에는 사용 가능한 호스트 주소가 몇 개 있는가?
= 2
:::

:::quiz mc
/30 서브넷은 일반적으로 어디에 사용하는가?
- [ ] 장치가 많은 대규모 사무실 네트워크용
- [ ] DHCP 풀의 주소 범위로
- [x] 라우터 두 대 사이의 연결용 네트워크로
- [ ] 무선 LAN 액세스 포인트용
:::

:::quiz fill
/25 서브넷에는 주소가 {128}개 있으며, 그중 {126}개를 호스트에 사용할 수 있다.
:::

:::quiz match
/24 -> 사용 가능한 호스트 주소 254개
/25 -> 사용 가능한 호스트 주소 126개
/28 -> 사용 가능한 호스트 주소 14개
/30 -> 사용 가능한 호스트 주소 2개
:::

:::evaluate
절 3 확인
:::

## 절 4: 복수 선택과 무작위 문제

`:::quiz multi`에서는 정답이 몇 개든 될 수 있다 — 각 문장이 개별적으로 채점된다:

:::quiz multi
ARP에 대한 설명 중 맞는 것은?
- [x] ARP는 IP 주소에 해당하는 MAC 주소를 알아낸다
- [ ] ARP는 이름에 해당하는 IP 주소를 알아낸다
- [x] ARP 요청은 브로드캐스트이다
- [ ] ARP 응답은 브로드캐스트이다
:::

`:::quiz random <typ>`은 호출할 때마다 새로운 문제를 만든다(`count=N`으로 개수를 정한다). 유형: `bin2dec`, `dec2bin`, `cidr2mask`, `hosts`, `netbcast`, `samenet`, `subnet`.

:::quiz random dec2bin
count=2
:::

:::quiz random netbcast
다음 주소에 대해 계산해 보자:
:::

:::quiz random samenet
count=3
:::

:::quiz random subnet
:::

:::evaluate
절 4 확인
:::

## 절 4b: 빈칸을 채우는 표

`:::quiz table` — 일반 마크다운 표이며, `{Antwort}` 셀은 입력 필드가 된다(변형 답은 `|`로 구분한다):

:::quiz table
`192.168.42.0/24`를 두 개의 서브넷으로 나누어 보자:
| 서브넷 | 네트워크 주소 | 브로드캐스트 주소 |
|---|---|---|
| 1 | {192.168.42.0} | {192.168.42.127} |
| 2 | {192.168.42.128} | {192.168.42.255} |
:::

:::evaluate
표 확인
:::

## 절 5: 비트에 색 입히기

IP 및 서브넷팅 장을 위해: `[[n|…]]` = 네트워크 부분, `[[e|…]]` = 확장, `[[h|…]]` = 호스트 부분 — 본문과 표에서 사용할 수 있다:

[[n|11111111.11111111.11111111]].[[e|11]][[h|000000]] = `255.255.255.192`

여러 줄 표시에는 ``` 대신 `<pre class="bits-block">` 블록을 사용한다(코드 블록에서는 색이 표시되지 않는다):

<pre class="bits-block">
vorher  (/24):  [[n|NNNNNNNN.NNNNNNNN.NNNNNNNN]].[[h|HHHHHHHH]]
nachher (/26):  [[n|NNNNNNNN.NNNNNNNN.NNNNNNNN]].[[e|EE]][[h|HHHHHH]]
</pre>

## 절 6: 시퀀스 다이어그램

`:::seq`는 라이프라인 두 개가 있는 다이어그램을 그린다. SEQ 및 ACK 번호와 라이프라인의 카운터는 플래그와 페이로드(`"…"`)로부터 계산된다. `->` 대신 `-x`를 쓰면 세그먼트가 손실되고, `seq=…`는 번호를 덮어쓴다(예: 재전송 시).

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

`:::quiz seq`에서는 `?`(플래그 앞, 또는 `seq=?` / `ack=?`)가 입력 필드가 되고, `hide: counters`는 카운터를 숨긴다:

:::quiz seq
Client -> Server: SYN
Server -> Client: ? SYN, ACK ack=?
Client -> Server: ? ACK ack=?
Client -> Server: PSH, ACK "Hello World"
Server -> Client: ACK ack=?
:::

:::evaluate
다이어그램 확인
:::
