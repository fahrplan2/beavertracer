# Warstwy 5–7: warstwa aplikacji

:::goal
**Cel lekcji:** Potrafisz rozpoznać najważniejsze protokoły warstwy aplikacji — HTTP, DNS, SMTP/POP3/IMAP i DHCP — w Tracerze, wyjaśnić ich przebieg i znaleźć typowe błędy.
:::

:::osi 7
:::

:::sim
url=/sims/lesson-6.1.btsim
:::

W rozdziale 5 zobaczyłeś(-aś): TCP i UDP dostarczają dane niezawodnie (albo szybko) do właściwego programu — za pomocą portów. To, *co* znajduje się w tych danych, określają protokoły **warstwy aplikacji**. W modelu TCP/IP jest to jedna warstwa, w modelu ISO/OSI odpowiada ona warstwom od 5 do 7.

Każdy z tych protokołów ma swoje własne zadanie — i swój własny port:

| Protokół | Zadanie | Port | Transport |
|---|---|---|---|
| **HTTP** | pobieranie stron internetowych | 80 | TCP |
| **DNS** | zamiana nazw na adresy IP | 53 | najczęściej UDP |
| **SMTP** | wysyłanie e-maili | 25 | TCP |
| **POP3** / **IMAP** | pobieranie e-maili | 110 / 143 | TCP |
| **DHCP** | automatyczne przydzielanie urządzeniu adresu IP | 67 / 68 | UDP |

W rozdziale 1.3 stronę internetową otwierałeś(-aś) jeszcze przez jej adres IP. W codziennym życiu nikt nie wpisuje `192.168.0.20` — i żaden nowy laptop nie ma adresu wpisywanego ręcznie. Jak to wszystko ze sobą współgra, odkryjesz w tym rozdziale, protokół po protokole.
