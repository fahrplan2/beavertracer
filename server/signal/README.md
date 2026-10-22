# beavertracer-signal

Signaling-Dienst für die WebRTC-Brücke zwischen zwei BeaverTracer-Instanzen
(nur Web-Version). Er reicht nur Offer (A→B) und Answer (B→A) über einen
6-stelligen Raumcode weiter; der Simulationsverkehr läuft direkt zwischen den
Browsern. Alles liegt im Arbeitsspeicher, nichts wird protokolliert.

Node ≥ 18, keine Abhängigkeiten. API siehe Kopfkommentar in `server.mjs`.

## Einmalige Einrichtung im Web-Container

```sh
mkdir -p /opt/beavertracer-signal
cp /root/networksim/server/signal/{server.mjs,nginx-signal.conf} /opt/beavertracer-signal/
cp /root/networksim/server/signal/beavertracer-signal.service /etc/systemd/system/
systemctl daemon-reload
systemctl enable --now beavertracer-signal
```

Im nginx-`server`-Block von beavertracer.eu ergänzen:

```nginx
include /opt/beavertracer-signal/nginx-signal.conf;
```

Danach `nginx -t && systemctl reload nginx`. Prüfen:
`curl https://www.beavertracer.eu/signal/health`

Ab dann aktualisiert `scripts/deploy.sh` die Dateien bei jedem Deploy und
startet den Dienst neu (nur wenn die Unit installiert ist).

Falls `DynamicUser=yes` im Container nicht funktioniert, in der Unit durch
`User=www-data` ersetzen.

## Konfiguration (optional)

`/etc/beavertracer-signal.env`:

```sh
STUN_URLS=stun:signal.beavertracer.eu:3478
# erst wenn TURN gebraucht wird (coturn mit use-auth-secret / static-auth-secret):
TURN_URLS=turn:signal.beavertracer.eu:3478?transport=udp,turn:signal.beavertracer.eu:3478?transport=tcp
TURN_SECRET=<gleiches Geheimnis wie static-auth-secret in coturn>
TURN_TTL=3600
```

Ohne `STUN_URLS` liefert `/ice` eine leere Liste (reicht im selben LAN).

## Rate-Limit

Pro Client-IP 60 Anfragen/min, davon max. 10 falsche Raumcodes/min. Die IP
kommt aus `X-Real-IP`, aber nur wenn die Verbindung von localhost kommt (also
über nginx). Fehlt der Header, teilen sich alle Clients ein Limit — dann in
NPM prüfen, dass `X-Real-IP` gesetzt wird.
