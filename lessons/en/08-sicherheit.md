# Security: Encryption and Certificates

:::goal
**Learning goal:** You can explain the three security goals confidentiality, integrity and authenticity, tell symmetric and asymmetric encryption apart, place hashes and digital signatures, read and issue certificates yourself, set up HTTPS and interpret typical certificate warnings.
:::

In the last chapters you could read almost everything in the tracer:

- **Chapter 3.3.2:** On Wi-Fi, every device in range receives all radio packets.
- **Chapter 6.1.2:** With HTTP, request and web page are in plain text inside the packet.
- **Chapter 6.3.2:** With SMTP and POP3, user name and password travel almost in plain text — `AUTH PLAIN` is only Base64.

Anyone listening on a cable or on the same Wi-Fi sees passwords, grades, messages and bank details. And they can do even more: **change** packets or **pretend** to be someone else.

## Three security goals

Cryptography is meant to protect against these dangers. There are three **security goals**:

| Security goal | Question | Example of an attack |
|---|---|---|
| **Confidentiality** | Can only the right recipient read the data? | Someone on the Wi-Fi reads your password. |
| **Integrity** | Did the data arrive unchanged? | Someone changes the amount in a bank transfer. |
| **Authenticity** | Does the data really come from the stated sender? | A fake bank website asks for your PIN. |

In this chapter you get to know the tools that achieve these three goals — and how they work together in **HTTPS**, the padlock symbol in the browser.

:::quiz match
Someone reads your password on the Wi-Fi -> Confidentiality
Someone changes the amount of a bank transfer on the way -> Integrity
A fake website pretends to be your bank -> Authenticity
:::

:::evaluate
Check matches
:::
