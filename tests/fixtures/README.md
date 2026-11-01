# Test fixtures

`interop-p256.*.pem` — self-signed ECDSA P-256 certificate and its PKCS#8 key,
generated with OpenSSL. **Test-only**, never use outside the test suite. Used
by the TLS interop tests against `node:tls` (OpenSSL), because certificates
created by `TlsCertificate.generate()` are not yet strict X.509 (OpenSSL
rejects them). Regenerate with:

    openssl ecparam -name prime256v1 -genkey -noout -out k.pem
    openssl pkcs8 -topk8 -nocrypt -in k.pem -out interop-p256.pkcs8.pem
    openssl req -new -x509 -key interop-p256.pkcs8.pem -sha256 -days 36500 \
      -subj "/CN=interop.test" -addext "subjectAltName=DNS:interop.test" \
      -out interop-p256.cert.pem
