# Einführung in BeaverTracer

[[toc]]

## Was ist BeaverTracer?

BeaverTracer ist eine interaktive Netzwerksimulation für den Unterricht. Du kannst damit
Netzwerke aufbauen, Pakete beobachten und Protokolle wie DHCP, DNS oder HTTP live verfolgen.

## Erste Schritte

Um zu starten, brauchst du nur einen Browser. Keine Installation notwendig.

1. Öffne BeaverTracer
2. Lege einen PC und einen Router auf der Arbeitsfläche ab
3. Verbinde sie mit einem Kabel
4. Drücke **Ausführen**

## Die Oberfläche

| Bereich | Funktion |
|---|---|
| Toolbar oben | Modi wechseln, Simulation steuern |
| Arbeitsfläche | Geräte platzieren und verbinden |
| Seitenleiste | Eigenschaften des ausgewählten Geräts |
| Paketverfolger | Netzwerkpakete aufzeichnen und analysieren |

## Simulation ausprobieren

Hier siehst du eine einfache Simulation mit zwei PCs und einem Switch:

:::sim
url=https://example.com/lessons/01-intro.btsim
height=480px
:::

## Codebeispiel: IP-Adresse

Eine IPv4-Adresse hat vier Oktette, getrennt durch Punkte:

```
192.168.1.1
^   ^   ^ ^
|   |   | └── Hostanteil
|   |   └──── Subnetz
└───┴──────── Netzanteil
```

> **Tipp:** Mit der Subnetzmaske `255.255.255.0` gehören alle Adressen von
> `192.168.1.1` bis `192.168.1.254` zum selben Netzwerk.

## Weiterführende Links

- [Wikipedia: IP-Adresse](https://de.wikipedia.org/wiki/IP-Adresse)
