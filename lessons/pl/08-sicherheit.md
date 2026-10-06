# Bezpieczeństwo: szyfrowanie i certyfikaty

:::goal
**Cel lekcji:** Potrafisz wyjaśnić trzy cele ochrony: poufność, integralność i autentyczność, odróżnić szyfrowanie symetryczne od asymetrycznego, rozpoznać rolę skrótów (hashy) i podpisów cyfrowych, odczytywać certyfikaty i samodzielnie je wystawiać, skonfigurować HTTPS oraz zinterpretować typowe ostrzeżenia o certyfikatach.
:::

W poprzednich rozdziałach w Tracerze mogłeś odczytać niemal wszystko:

- **Rozdział 3.3.2:** W sieci Wi-Fi każde urządzenie w zasięgu odbiera wszystkie pakiety radiowe.
- **Rozdział 6.1.2:** W HTTP zapytanie i strona internetowa znajdują się w pakiecie jawnym tekstem.
- **Rozdział 6.3.2:** W SMTP i POP3 nazwa użytkownika i hasło przesyłane są niemal jawnym tekstem — `AUTH PLAIN` to tylko Base64.

Kto podsłuchuje na łączu albo w tej samej sieci Wi-Fi, widzi więc hasła, oceny, wiadomości i dane bankowe. A może zrobić jeszcze więcej: **zmieniać** pakiety albo **podszywać się** pod kogoś innego.

## Trzy cele ochrony

Przed tymi zagrożeniami ma chronić kryptografia. Wyróżnia się trzy **cele ochrony**:

| Cel ochrony | Pytanie | Przykład ataku |
|---|---|---|
| **Poufność** | Czy tylko właściwy odbiorca może odczytać dane? | Ktoś w sieci Wi-Fi podsłuchuje twoje hasło. |
| **Integralność** | Czy dane dotarły w niezmienionej postaci? | Ktoś zmienia kwotę w przelewie. |
| **Autentyczność** | Czy dane naprawdę pochodzą od podanego nadawcy? | Fałszywa strona banku pyta o twój PIN. |

W tym rozdziale poznasz narzędzia, za pomocą których osiąga się te trzy cele — oraz to, jak współdziałają w **HTTPS**, czyli w symbolu kłódki w przeglądarce.

:::quiz match
Ktoś podsłuchuje twoje hasło w sieci Wi-Fi -> Poufność
Ktoś po drodze zmienia kwotę przelewu -> Integralność
Fałszywa strona podaje się za twój bank -> Autentyczność
:::

:::evaluate
Sprawdź przyporządkowanie
:::
