# LensDrop

**Passa tutto. Basta uno sguardo.**

LensDrop è un'applicazione web che trasferisce file, cartelle, foto, video, audio e testo tra due dispositivi:
il mittente mostra un codice QR, il destinatario lo inquadra con la fotocamera e i contenuti passano
**direttamente da browser a browser** tramite WebRTC. Nessun upload su un server, nessun account,
nessuna installazione.

- **Demo pubblicata:** <https://valeriomassimodececco.github.io/Progetti/LensDrop/>
- **Codice:** cartella `LensDrop/` del repository `ValerioMassimoDeCecco/Progetti`
- **Licenza:** MIT (vedi `LICENSE`)

---

## 1. Funzionalità

### Flusso principale

| Modalità | Passaggi |
|---|---|
| **Invia** | Scegli i contenuti → viene generato un codice QR (con scadenza) → attendi il destinatario → invio con avanzamento, velocità e tempo stimato |
| **Ricevi** | Attiva la fotocamera → inquadra il QR → verifica la proposta → **confermi** → ricevi con verifica SHA-256 di ogni file → scarichi o condividi |

### Contenuti supportati

- File di qualsiasi tipo ed estensione (il browser non impone filtri: PDF, ZIP, documenti, formati sconosciuti).
- Immagini, video e audio, con anteprima/riproduzione per i formati che il browser sa decodificare.
- Selezioni multiple (fino a 200 elementi per sessione) e cartelle intere (`webkitdirectory` dove disponibile,
  incluse le cartelle trascinate su desktop).
- Testo incollato o digitato: viaggia come file `.txt` leggibile ovunque, con anteprima e pulsante «Copia».
- Invii successivi sulla stessa sessione: terminato un lotto, si possono proporre altri contenuti senza nuovo QR.

### Protocollo e robustezza

- Trasferimento **a blocchi da 16 KB** con controllo di flusso su `bufferedAmount` (nessun file caricato per intero in memoria).
- **SHA-256 incrementale** calcolato in streaming da mittente e destinatario: ogni file viene confermato solo se l'impronta coincide.
- Conferma esplicita del destinatario prima di ricevere un solo byte; possibilità di rifiutare o annullare.
- Codice di sessione monouso con **scadenza a 10 minuti** e conto alla rovescia visibile.
- Gestione di sessioni scadute, connessioni duplicate, dispositivi che si disconnettono, messaggi non validi e blocchi fuori sequenza.
- Nomi file sanificati (niente percorsi, caratteri di controllo o nomi riservati).
- Indicazione del percorso di rete: **diretto P2P** o **relay TURN**, letto dalle statistiche ICE.

### Interfaccia

- Tema **Liquid Glass**: superfici traslucide, riflessi, profondità, animazioni morbide.
- Tema chiaro, scuro o automatico, con preferenza salvata.
- Layout responsive per telefoni, tablet e desktop; target di tocco ≥ 44 px.
- Rispetto di `prefers-reduced-motion`, focus visibile e regioni `aria-live` per gli stati.
- PWA installabile (manifest + service worker) e cronologia locale dei soli metadati.

---

## 2. Architettura

```
┌────────────────────┐        segnalazione (SDP/ICE)        ┌────────────────────┐
│  Telefono A        │ ───────────── PeerServer ──────────▶ │  Telefono B        │
│  (mittente)        │                                      │  (destinatario)    │
│                    │ ═══════ DataChannel WebRTC ═════════ │                    │
│  HostSession       │        file a blocchi + JSON         │  GuestSession      │
│  TransferSender    │        HMAC handshake, SHA-256       │  TransferReceiver  │
└────────────────────┘                                      └────────────────────┘
```

### Perché PeerJS + WebRTC

GitHub Pages ospita solo file statici: non può fare da backend. Per stabilire un collegamento WebRTC serve
comunque uno scambio iniziale di parametri (SDP e candidati ICE), cioè un **servizio di segnalazione**.

Le alternative valutate:

| Strategia | Esito |
|---|---|
| **PeerJS Cloud** (PeerServer pubblico) + WebRTC DataChannel | **Scelta.** Libreria matura (MIT), signaling pronto, nessuna chiave, nessun dato dei file sul server. |
| SDP dentro il QR | Scartata: l'offer è troppo grande per un QR leggibile e servirebbe un secondo QR di risposta (due scansioni). |
| Backend di signaling proprio | Supportato come opzione, ma GitHub Pages non può ospitarlo: richiederebbe un hosting aggiuntivo. |

PeerJS gestisce solo la segnalazione (poche centinaia di byte): **i contenuti non transitano dal server**.
Se la rete impedisce il collegamento diretto, entra in gioco un relay **TURN** e in quel caso il traffico passa
dal relay (cifrato con DTLS). L'app mostra il percorso effettivamente selezionato da ICE.

### Moduli

```
src/
├── config.ts          costanti (blocchi, limiti, TTL, server ICE)
├── core/
│   ├── base32.ts      codice di sessione leggibile (12 caratteri, 60 bit)
│   ├── crypto.ts      HKDF, HMAC, nonce, SHA-256 nativo, confronto a tempo costante
│   ├── sha256.ts      SHA-256 incrementale in TypeScript (streaming su file grandi)
│   ├── auth.ts        handshake reciproco challenge/response
│   ├── protocol.ts    messaggi JSON tipizzati, validazione, frame binari, nomi file
│   ├── channel.ts     astrazione del canale + Messenger (validazione e coda)
│   ├── session.ts     PeerJS: PeerChannel, HostSession, GuestSession, percorso ICE
│   ├── transfer.ts    motore di invio/ricezione: blocchi, backpressure, hash, annullamento
│   ├── files.ts       formati, download, Web Share, drag & drop di cartelle
│   └── settings.ts    preferenze locali e configurazione ICE/segnalazione
├── ui/                schermate, routing hash, QR, scanner, tema, cronologia
└── styles/            base.css (token e vetro), screens.css (componenti)
```

### Protocollo applicativo (versione 1)

Messaggi di controllo (JSON, validati campo per campo):

| Messaggio | Direzione | Scopo |
|---|---|---|
| `hello` / `welcome` | mittente → destinatario → mittente | sfida e risposta HMAC con nonce freschi |
| `offer` | mittente → destinatario | elenco file (id, nome, dimensione, MIME) e totale |
| `accept` / `reject` | destinatario → mittente | conferma o rifiuto esplicito |
| `start` / `end` | mittente → destinatario | inizio file e fine con byte e SHA-256 |
| `verified` | destinatario → mittente | esito della verifica di integrità |
| `done` | mittente → destinatario | lotto completato |
| `cancel` | entrambi | annullamento con motivo |
| `ping` / `pong` | entrambi | controllo di vitalità |

I contenuti viaggiano come frame binari con intestazione di 12 byte: indice file, numero di sequenza, lunghezza.
Un blocco duplicato, fuori ordine o con lunghezza incoerente interrompe il trasferimento.

### Sicurezza del codice di sessione

1. Il codice di 12 caratteri Base32 (60 bit casuali) **non viene mai trasmesso**.
2. Da esso si deriva con HKDF-SHA256 una chiave HMAC non estraibile.
3. Il mittente invia un nonce casuale firmato; il destinatario risponde firmando il nonce del mittente + il proprio.
   Solo chi conosce il codice può farlo: un estraneo che scopre l'ID PeerJS non può né inviare né ricevere.
4. I nonce sono nuovi a ogni connessione: il replay di messaggi catturati non funziona.
5. La semplice scansione del QR non avvia nulla: serve la conferma del destinatario e i file li sceglie il mittente.

---

## 3. Esecuzione locale

Requisiti: **Node.js ≥ 22** e npm.

```bash
cd LensDrop
npm ci

npm run dev        # http://localhost:5173
npm run typecheck  # controllo tipi TypeScript
npm run lint       # ESLint (flat config)
npm test           # test unitari + integrazione protocollo + smoke UI (vitest)
npm run build      # build di produzione in dist/
npm run preview    # anteprima della build
```

Note:

- La **fotocamera** richiede un contesto sicuro: `http://localhost` è considerato sicuro, un IP di rete locale no.
  Per provare da un telefono in LAN serve HTTPS (es. tunnel) oppure la versione pubblicata su GitHub Pages.
- Le sessioni usano Internet per la segnalazione PeerJS: senza rete il QR si genera ma il secondo dispositivo
  non riesce a collegarsi (l'app mostra l'errore e propone di riprovare).

---

## 4. Build e deploy su GitHub Pages

Il repository pubblica LensDrop con GitHub Actions (`.github/workflows/lensdrop-pages.yml`):

1. Su ogni push su `main` che tocca `LensDrop/**` (o manualmente con *workflow_dispatch*):
   installazione, typecheck, lint, test, build.
2. La build usa `VITE_BASE=/Progetti/LensDrop/`, così tutti gli asset e il service worker puntano al
   sottopercorso corretto.
3. L'artefatto viene preparato in `_site/LensDrop/` e pubblicato con `actions/deploy-pages`,
   così l'app risponde su `/Progetti/LensDrop/` (radice del sito del repository: `/Progetti/`).

Configurazione necessaria una tantum nel repository:
**Settings → Pages → Source: GitHub Actions** (oppure via API, `build_type: "workflow"`).

> **Stato del deploy (28 ottobre 2026).** Il primo run del workflow
> ([#40726422561](https://github.com/ValerioMassimoDeCecco/Progetti/actions/runs/40726422561))
> ha completato con successo typecheck, lint, test e build, poi si è fermato allo step
> *Configura Pages* con `Resource not accessible by integration (403)`: il token dell'integrazione
> GitHub usato in questa sessione non ha i permessi di amministrazione necessari per creare il sito
> Pages. Appena il proprietario del repository abilita Pages (vedi sopra), il workflow arriva al
> deploy senza altre modifiche. Fino a quel momento
> <https://valeriomassimodececco.github.io/Progetti/LensDrop/> non è raggiungibile.
> L'URL non è stato verificabile dall'ambiente di sviluppo di questa sessione, che non ha accesso
> di rete al dominio `*.github.io`.

### Variabili d'ambiente

| Variabile | Dove | Significato |
|---|---|---|
| `VITE_BASE` | build | Sottopercorso pubblico. Default `/`. Sul repo è `/Progetti/LensDrop/`. |

Non esistono segreti, chiavi o token nel frontend: il servizio di segnalazione predefinito è pubblico e non
richiede credenziali. Eventuali credenziali TURN inserite dall'utente restano nel `localStorage` del suo browser
e non vengono mai inviate altrove se non al proprio relay.

---

## 5. Servizi esterni

| Servizio | Uso | Condizioni |
|---|---|---|
| **PeerJS Cloud** (`0.peerjs.com`) | solo segnalazione (SDP/ICE) | servizio pubblico gratuito, **senza SLA né garanzie di disponibilità**; adatto a uso personale/demo. Configurabile un server proprio nelle impostazioni. |
| **STUN Google** (`stun.l.google.com:19302`) | scoperta dell'indirizzo pubblico | server STUN pubblico e gratuito. |
| **TURN demo PeerJS** (`eu-0`/`us-0.turn.peerjs.com`) | relay quando il P2P diretto fallisce | credenziali di test distribuite con PeerJS, nessuna garanzia di uptime né di capacità. Per uso intensivo configurare un TURN proprio. |

### Server di segnalazione proprio

Con Node installato:

```bash
npm install -g peer
peerjs --port 9000 --path /myapp
# con TLS: --sslkey /path/key.pem --sslcert /path/cert.pem
```

Poi in **Impostazioni → Segnalazione → Server proprio**: host, porta, path, key e «Usa WSS/HTTPS».

### TURN proprio

In **Impostazioni → Relay TURN** si possono inserire URL multipli, username e credenziale (es. coturn).
Gli URL non validi vengono scartati; il traffico passerebbe dal relay configurato.

---

## 6. Test

Comandi e risultati dell'ultima esecuzione locale (Node 22, Linux):

| Comando | Risultato |
|---|---|
| `npm run typecheck` (`tsc --noEmit`, strict) | ✅ nessun errore |
| `npm run lint` (`eslint .`) | ✅ nessun errore/avviso |
| `npm test` (vitest) | ✅ **9 file, 60 test** superati |
| `npm run build` | ✅ build di produzione generata |

Copertura dei test automatici:

- **SHA-256 incrementale** confrontato con `node:crypto` su dimensioni e suddivisioni diverse, più vettori noti.
- **Codice Base32**: generazione, normalizzazione tollerante, lunghezze, round-trip.
- **Crypto**: derivazione HKDF, HMAC deterministico per codice uguale e diverso per codice diverso, chiave non estraibile.
- **Protocollo**: validazione di offerte, sequenze, hash, frame binari, nomi pericolosi, payload malevoli.
- **Handshake**: autenticazione reciproca, rifiuto di chi non conosce il codice, replay di `welcome` respinto.
- **Trasferimento end-to-end su canale in memoria**: più file (anche vuoti), file da 1 MB, backpressure,
  annullamento, payload alterato rilevato dallo SHA-256, blocchi duplicati, secondo lotto sulla stessa sessione,
  rifiuto della proposta, coda dei messaggi, chiusura su messaggi non validi.
- **Smoke UI in jsdom sul markup reale**: avvio, routing tra tutte le schermate, tema, inserimento testo,
  rimozione dalla selezione, salvataggio impostazioni, link di invito valido/scaduto/non valido.
- **Controlli statici sul markup**: ogni selettore usato dal codice esiste, nessun id duplicato, tutte le icone
  referenziate sono definite, manifest e meta essenziali presenti.
- **Recupero di una sfida persa**: l'handshake va a buon fine anche se il primo `hello` arriva prima che il
  destinatario sia in ascolto.

### Cosa **non** è stato possibile verificare

- **Nessun test tra due dispositivi fisici** è stato eseguito: l'ambiente di sviluppo non dispone di browser
  grafico né di accesso alla rete del servizio PeerJS. I test automatici validano protocollo, crittografia e
  UI, ma **non sostituiscono** una prova reale su due telefoni.
- La resa visiva (blur, riflessi, animazioni) va verificata su dispositivi reali: i test DOM non applicano il CSS.
- La disponibilità effettiva del servizio PeerJS Cloud e del TURN demo non è garantita e non è stata misurata.

### Prova manuale consigliata (5 minuti)

1. Apri il link pubblico su due telefoni (uno Android e uno iPhone, se possibile).
2. Telefono A: **Invia** → aggiungi una foto e un file PDF → «Genera codice di sessione».
3. Telefono B: **Ricevi** → «Attiva fotocamera» → inquadra il QR → verifica elenco → «Accetta e ricevi».
4. Controlla: percentuale, velocità, esito «SHA-256» su ogni file, download o condivisione.
5. Prova: rifiuto, annullamento, codice scaduto (attendere 10 minuti), codice errato in inserimento manuale,
   foto scattata al QR e importata con «Da immagine», secondo lotto di file dopo il primo.

---

## 7. Limiti noti e miglioramenti possibili

- **Ripresa dopo interruzione**: non implementata. Se la connessione cade, i file già ricevuti vengono scartati
  (per non consegnare file parziali non verificati) e si riparte con una nuova sessione.
- **Memoria per file molto grandi**: i dati ricevuti sono assemblati in `Blob` (il browser li sposta su disco),
  ma su iOS file da diversi GB possono esaurire la memoria. Non esiste scrittura progressiva portabile:
  `showSaveFilePicker` è solo Chromium.
- **Download multipli**: iOS Safari può aprire un solo download alla volta; l'app avvisa e offre la condivisione
  nativa quando disponibile.
- **Background**: se il telefono sospende la pagina durante il trasferimento, il canale può interrompersi.
  Tenere lo schermo acceso; il wake lock non è implementato.
- **Cartelle**: su iOS il selettore cartelle non esiste; su desktop si possono trascinare cartelle.
  La struttura delle sottocartelle viene appiattita nei nomi dei file.
- **TURN**: senza un relay affidabile alcune reti aziendali/4G molto restrittive non riescono a collegarsi.
- **Segnalazione**: dipende da un servizio esterno; per uso continuativo conviene un PeerServer proprio.
- **Accessibilità**: base curata, ma non è stato eseguito un audit formale con screen reader.
- **Miglioramenti**: ripresa a offset con scrittura progressiva dove supportata, wake lock, compilazione WASM di
  SHA-256, trasferimento in background con service worker, audit WCAG, test E2E in browser reali (Playwright).

---

## 8. Privacy e modello di sicurezza

- I file **non vengono mai caricati su un server**: viaggiano su un DataChannel WebRTC cifrato (DTLS).
  Il server di segnalazione vede solo metadati di connessione (ID di sessione temporanei e indirizzi ICE).
- Se interviene un relay TURN, il traffico passa dal relay: resta cifrato end-to-end a livello DTLS/SRTP,
  ma il relay vede gli indirizzi IP e i volumi. L'app dichiara il percorso usato.
- Il codice di sessione sta nel **fragment** dell'URL: non viene inviato nei riferimenti HTTP.
- Nessun contenuto, codice o token viene scritto in `console` o in log applicativi.
- La cronologia locale contiene solo nomi, dimensioni e esito, mai i contenuti, ed è cancellabile.
- I file ricevuti vivono in memoria come `Blob`: alla chiusura della pagina vengono rilasciati.
- Le credenziali TURN sono salvate solo nel browser dell'utente; il repository non contiene segreti.
- Limiti dichiarati: il QR può essere fotografato e usato entro la sua validità; la conferma del destinatario
  e l'autenticazione HMAC impediscono invii non voluti a chi non possiede il codice.

---

## 9. Dipendenze principali e licenze

| Dipendenza | Versione | Licenza | Ruolo |
|---|---|---|---|
| [peerjs](https://github.com/peers/peerjs) | 1.5.x | MIT | signaling e DataConnection |
| [qrcode](https://github.com/soldair/node-qrcode) | 1.5.x | MIT | generazione QR |
| [jsqr](https://github.com/cozmo/jsQR) | 1.4.x | Apache-2.0 | lettura QR dai frame della fotocamera |
| [vite](https://vite.dev/) | 8.x | MIT | dev server e build |
| [typescript](https://www.typescriptlang.org/) | 5.9.x | Apache-2.0 | tipi |
| [vitest](https://vitest.dev/) | 5.x | MIT | test |
| [eslint](https://eslint.org/) + [typescript-eslint](https://typescript-eslint.io/) | 10.x / 8.x | MIT | lint |
| [jsdom](https://github.com/jsdom/jsdom) | 27.x | MIT | ambiente DOM per gli smoke test |

Le librerie QR e il decoder sono caricati **solo quando servono** (code splitting), così l'avvio resta leggero.

---

## 10. Struttura del progetto

```
LensDrop/
├── index.html                 interfaccia completa (markup statico, nessun template dinamico insicuro)
├── src/                       codice TypeScript (core + ui + stili)
├── public/                    manifest PWA, service worker, icone
├── test/                      test unitari, integrazione e smoke UI
├── vite.config.ts             base path, dev server
├── vitest.config.ts           ambiente di test
├── eslint.config.js           flat config
└── README.md
```

---

## 11. Crediti

Progetto realizzato per il repository `Progetti` di Valerio Massimo De Cecco.
Design ispirato al linguaggio visivo «Liquid Glass» di Apple, senza asset proprietari.
Nessun codice copiato da altri progetti: sono state riutilizzate solo librerie open source con licenza compatibile.
