# Firewall: kto może wejść, a kto wyjść?

:::goal
**Cel lekcji:** Potrafisz wyjaśnić, jak filtr pakietów działa na podstawie reguł, samodzielnie tworzyć reguły i ustawiać je w odpowiedniej kolejności, odróżniać odrzucanie (drop) od odrzucania z odpowiedzią (reject), wyjaśnić różnicę między zaporą bezstanową a stanową, zbudować strefę DMZ oraz znajdować błędy w regułach zapory.
:::

:::osi 4
:::

:::sim
url=/sims/lesson-9.btsim
:::

Szkoła Beaver ma własne adresy publiczne (`198.51.100.…`): jej **Schulserver** jest dostępny bezpośrednio z internetu — bez NAT, tak jak wkrótce będzie wszędzie dzięki IPv6 (rozdział 7.3). Między internetem a **Schulrouter** znajduje się **zapora sieciowa (firewall)**, która na razie przepuszcza jednak wszystko.

Po lewej widzisz „internet": **Internet-PC** i serwer WWW `www.beispiel.de`. Po prawej znajduje się sieć szkolna z **Schulserver** i **Lehrer-PC**.

## Co widzi atakujący?

Kto chce zaatakować serwer, szuka najpierw **otwartych portów** — czyli usług, które czekają na połączenia. Narzędzie do tego nazywa się **skaner portów**; najbardziej znanym jest `nmap`.

Przełącz się w tryb uruchamiania :fa-play: **Uruchom**, otwórz na **Internet-PC** :fa-terminal: **Terminal** i wpisz:

```
$ nmap 198.51.100.10
```

`nmap` próbuje nawiązać połączenie TCP z 20 najczęściej używanymi portami i zgłasza, które z nich są otwarte.

:::quiz multi
Które porty na serwerze szkolnym są otwarte z internetu?
- [x] 22 (SSH, zdalna administracja)
- [x] 25 (SMTP)
- [x] 80 (HTTP)
- [x] 110 (POP3)
- [x] 143 (IMAP)
- [ ] 443 (HTTPS)
:::

:::evaluate
Sprawdź odpowiedź
:::

Strona internetowa (80) i odbieranie e-maili (25) mają być dostępne z internetu. Ale **zdalna administracja** (22) i pobieranie poczty (110, 143) są potrzebne tylko w sieci szkolnej. Każdy otwarty port to potencjalna powierzchnia ataku: jeśli usługa ma lukę w zabezpieczeniach lub słabe hasło, atakujący może to wykorzystać z dowolnego miejsca na świecie — a automatyczne skanery w internecie próbują dokładnie tego przez całą dobę.

:::tip Zapamiętaj
**Zapora sieciowa (firewall)** kontroluje ruch na granicy między dwiema sieciami i przepuszcza tylko to, co jest wyraźnie dozwolone. Dzięki temu usługi, które są potrzebne tylko wewnętrznie, pozostają niewidoczne dla internetu.
:::
