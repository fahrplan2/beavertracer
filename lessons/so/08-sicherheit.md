# Amniga: sirta-qarinta (encryption) iyo certificates

:::goal
**Hadafka waxbarashada:** Waxaad awooddaa inaad sharaxdo saddexda hadaf ee amniga: sir-ilaalinta (confidentiality), dhammaystirnaanta xogta (integrity) iyo run-ahaanshaha (authenticity); inaad kala saarto symmetric iyo asymmetric encryption; inaad meel u dhigto hash values iyo digital signatures; inaad akhrisato oo adigu naftaada samayso certificates; inaad dejiso HTTPS oo aad fahamto digniinaha caadiga ah ee certificate-ka.
:::

Cutubyadii hore, Tracer-ka waxaad ku akhrisan kartay ku dhawaad wax walba:

- **Cutubka 3.3.2:** Wi-Fi-ga, qalab kasta oo ku jira masaafada wuxuu helaa dhammaan radio packets-ka.
- **Cutubka 6.1.2:** Marka la isticmaalo HTTP, codsiga iyo bogga webka waxay ku jiraan packet-ka sidii qoraal caadi ah (plain text).
- **Cutubka 6.3.2:** Marka la isticmaalo SMTP iyo POP3, username-ka iyo password-ka waxay ku dhawaad ah qoraal caadi ah oo mid xariiqda marta — `AUTH PLAIN` waa Base64 oo kaliya.

Cidda xariiqda dhegaysata ama isla Wi-Fi-ga ku jirta waxay aragtaa passwords, dhibcaha imtixaanka, fariimaha iyo xogta bangiga. Wuxuuna sameyn karaa wax ka badan: wuxuu **bedeli karaa** packets ama wuxuu isu **dhigi karaa** qof kale.

## Saddex hadaf oo amniga ah

Cryptography waxay naga caawisaa khataraha kuwan. Waxaa la kala saaraa saddex **hadaf oo amni**:

| Hadafka amniga | Su'aal | Tusaale weerar |
|---|---|---|
| **Confidentiality (sir-ilaalin)** | Ma receiver-ka saxda ah oo keliya ayaa akhrin kara xogta? | Qof ayaa Wi-Fi-ga kula akhriyay password-kaaga. |
| **Integrity (dhammaystirnaan)** | Ma xogta isbeddel la'aan ayey timid? | Qof ayaa lacag wareejin ku bedelay qaddarka. |
| **Authenticity (run-ahaansho)** | Ma xogtu runtii waxay ka timid sender-ka la sheegay? | Boggaga bangi ee been abuurka ah ayaa weydiinaya PIN-kaaga. |

Cutubkan waxaad ku baranaysaa qalabka lagu gaadho saddexdan hadaf — iyo sida ay ugu wada shaqeeyaan **HTTPS**, astaanta quful-ka ee Browser-ka.

:::quiz match
Qof ayaa Wi-Fi-ga kula akhriyay password-kaaga -> Confidentiality
Qof ayaa jidka dhexdiisa ku bedelay qaddarka lacag wareejin -> Integrity
Boggaga been abuurka ah ayaa isu dhigaya bangigaaga -> Authenticity
:::

:::evaluate
Hubi isku-xigxigga
:::
