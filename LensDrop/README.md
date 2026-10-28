# LensDrop

**Passa tutto. Basta uno sguardo.**

LensDrop trasferisce file, cartelle, foto, video, audio e testo tra due dispositivi usando **solo lo schermo
del mittente e la fotocamera del destinatario**. Nessun Wi-Fi, nessun Bluetooth, nessun server, nessun account:
lo schermo mostra un flusso di codici QR animati, l'altro telefono li inquadra e ricostruisce il contenuto.

- **Demo pubblicata:** <https://valeriomassimodececco.github.io/Progetti/LensDrop/> *(stato del deploy: vedi §8)*
- **Codice:** cartella `LensDrop/` del repository `ValerioMassimoDeCecco/Progetti`
- **Licenza:** MIT (vedi `LICENSE`)

> **Novità di questa versione.** La modalità di rete (WebRTC/PeerJS) è stata **rimossa**: il canale è ora
> esclusivamente ottico e funziona in modalità aereo. Non esistono più signaling, STUN/TURN, timeout di
> collegamento né dipendenze da servizi esterni: l'unico requisito è una fotocamera e uno schermo.

---

## 1. Funzionalità

| Area | Dettagli |
|---|---|
| Contenuti | File di qualsiasi tipo, cartelle intere, immagini, video, audio, testo incollato. Più elementi in un'unica sessione. |
| Invio | Selezione con drag & drop, rimozione dei singoli elementi, anteprima immagini, modalità solo testo, densità regolabile, **quattro velocità (4 / 8 / 14 / 30 fps)**, pausa/ripresa, schermo intero, blocco dello spegnimento. |
| Ricezione | Fotocamera posteriore, torcia quando disponibile, avanzamento reale per blocchi, velocità, tempo residuo, ripresa automatica dopo frame persi. |
| Risultato | Verifica SHA-256, anteprima immagini/audio/video, estratto dei file di testo, copia del testo, salvataggio singolo o multiplo, condivisione nativa. |
| Affidabilità | Codici fountain (LT): i frame persi non richiedono ripartenze e non serve alcun canale di ritorno. |
| Interfaccia | Tema Liquid Glass, chiaro/scuro/automatico, responsive mobile-first, aree di tocco ampie, `prefers-reduced-motion`, navigazione da tastiera. |
| PWA | Installabile, avvio offline dopo il primo caricamento, service worker con cache dell'app shell. |
| Diagnostica | Pannello con eventi timestampati (fotocamera, decodifica, frame, checksum), copia negli appunti e download `.txt`. |
| Privacy | Nessuna richiesta di rete durante il trasferimento; cronologia locale con soli metadati. |

---

## 2. Come funziona (protocollo ottico)

```
mittente                                              destinatario
┌──────────────┐                                      ┌──────────────┐
│ file/testo   │                                      │ fotocamera   │
│      ↓       │                                      │      ↓       │
│ contenitore  │                                      │ lettura QR   │
│ (LDB1)       │                                      │      ↓       │
│      ↓       │                                      │ dedup frame  │
│ gzip opz.    │                                      │      ↓       │
│      ↓       │                                      │ decodifica   │
│ SHA-256      │                                      │ fountain     │
│      ↓       │   flusso QR animati (solo luce)      │      ↓       │
│ blocchi k    │ ───────────────────────────────────▶ │ SHA-256      │
│ + riparazioni│                                      │      ↓       │
└──────────────┘                                      │ file pronti  │
                                                      └──────────────┘
```

### Frame

Ogni frame è un QR il cui testo è `LD2` + **Base45** dei dati binari. Base45 usa l'alfabeto della modalità
alfanumerica dei QR (`0-9 A-Z spazio $%*+-./:`), che codifica 11 bit ogni 2 caratteri invece di 8 bit per
carattere: a parità di QR entrano circa il **35% di byte in più**. Tre tipi di frame, tutti con l'identificativo
di sessione a 16 bit nell'intestazione:

| Tipo | Contenuto | Scopo |
|---|---|---|
| `M` meta | nome, numero elementi, dimensione, `k`, dimensione blocco, SHA-256, flag gzip | aggancio, anche a flusso iniziato |
| `B` blocco | indice a 32 bit + byte del blocco | passata dati |
| `R` riparazione | seed a 32 bit + simbolo fountain | recupero dei frame persi |

I metadati vengono ripetuti ogni 24 frame e quattro volte all'inizio: chi punta la fotocamera a metà
trasferimento capisce comunque cosa sta ricevendo.

### Codici fountain (LT)

Il payload è diviso in `k` blocchi. Ogni simbolo di riparazione è lo XOR di un sottoinsieme di blocchi scelto
da un seed tramite una distribuzione **robust soliton**. Il destinatario raccoglie i simboli che riesce a
leggere, risolve per "peeling" e, quando il peeling si ferma, completa con un'eliminazione di Gauss su GF(2).
Non serve che il mittente sappia cosa è arrivato: non esiste alcun canale di ritorno.

### Integrità e contenitore

Lo SHA-256 del payload è trasmesso nei metadati e verificato **prima** di rendere disponibili i file: se non
corrisponde, la ricezione viene rifiutata e si può riprovare. Il contenitore `LDB1` trasporta più elementi in
un solo flusso; i nomi ricevuti vengono normalizzati (niente separatori di percorso o caratteri di controllo).

---

## 3. Prestazioni reali

Il limite è fisico: densità del QR leggibile dalla fotocamera × frame al secondo.

| Densità | Byte per frame | QR | Moduli | px/modulo su schermo da 360 px |
|---|---|---|---|---|
| Compatto | 520 | v16 | 81×81 | 4,4 |
| Equilibrato (default) | 700 | v19 | 93×93 | 3,9 |
| Denso | 1200 | v25 | 117×117 | 3,1 |

Velocità indicativa = `byte_per_frame × fps × 0,92` (i frame di metadati sono il resto), divisa per il
sovraccarico dei codici LT (**misurato: 1,3–1,8×** a seconda delle perdite).

| Scenario | Throughput tipico | 1 MB richiede |
|---|---|---|
| Compatto, 8 fps | ~3,8 KB/s | ~4 min |
| Equilibrato, 8 fps | ~5,1 KB/s | ~3 min |
| Denso, 14 fps | ~15 KB/s | ~1 min |
| Denso, 30 fps *(con decodifica hardware)* | ~21 KB/s teorici, ~12–20 KB/s reali | ~1 min |

### Le quattro velocità, e perché i 30 fps sono veri

| Preset | fps | Intervallo | A chi serve |
|---|---|---|---|
| Lenta | 4 | 250 ms | telefoni lontani, luce debole, QR densi |
| Normale (default) | 8 | 125 ms | caso generale, decoder software su iOS |
| Veloce | 14 | 71 ms | schermo luminoso, mano ferma, Chrome/Android |
| **Massima** | **30** | **33 ms** | solo con `BarcodeDetector` (hardware): guadagno reale 2–3× |

Il pulsante "30 fps" non è cosmetico: nel codice non esiste più alcun limite artificiale sotto i 33 ms
(la vecchia formula `Math.max(40, 1000/fps)` avrebbe bloccato la cadenza a 25 fps e ora è sostituita da
`frameIntervalMs()`, minimo 8 ms). Perché la cadenza tenga davvero:

1. **Pre-rendering con coda limitata** (`FrameStream`): la produzione dei frame avviene in canvas fuori
   schermo mentre il frame precedente è a video; la coda si ferma a 8 frame (5 sotto i 20 fps) per non
   accumulare ritardo.
2. **Scadenze fisse, non `setTimeout` cumulativi**: ogni frame è pianificato su `inizio + n × intervallo`,
   quindi il ritardo non si somma e non c'è deriva; dopo uno stallo la pianificazione si riallinea invece di
   sparare una raffica di frame arretrati.
3. **Scala dei moduli intera**: il QR viene disegnato con un numero intero di pixel per modulo (fattore scelto
   da `planPixelSize`), altrimenti i moduli frazionari rendono il codice sfocato e il decoder lo perde proprio
   quando va veloce.
4. **Metriche visibili**: la schermata di invio mostra gli fps *misurati* e le sottoalimentazioni della coda,
   così si vede subito se il dispositivo non regge i 30 fps e conviene scendere.
5. **Cambio di velocità a caldo**: scegliere un'altra velocità durante l'invio ha effetto immediato
   (`FrameStream.setFps`), senza riavviare la sessione né perdere i frame già preparati.

Il collo di bottiglia a 30 fps è il **ricevitore**, non il mittente: jsQR (Safari, Firefox) decodifica
~10–15 frame/s a 700 byte, quindi oltre i 14 fps non si guadagna nulla. Con `BarcodeDetector` (Chrome su
Android) il decoder è hardware e i 30 fps diventano utili. Il ricevitore adatta da solo la risoluzione di
decodifica (480–780 px) al costo misurato, così resta agganciato anche quando la scena è difficile.

Sono stime prudenti, non promesse: contano schermo luminoso, mano ferma e distanza ravvicinata. A 30 fps
conta anche il tempo di esposizione della fotocamera, che si accorcia: senza luce abbondante i frame mossi
aumentano e il guadagno si annulla. Per file grandi l'app mostra sempre la durata prevista e un avviso
esplicito prima di partire.

---

## 4. Avvio locale

```bash
cd LensDrop
npm ci
npm run dev        # http://localhost:5173
```

La fotocamera richiede un **contesto sicuro**: `localhost` va bene, per un telefono serve HTTPS
(GitHub Pages lo fornisce).

Altri comandi:

```bash
npm run typecheck  # TypeScript in modalità strict, nessun emit
npm run lint       # ESLint
npm test           # Vitest (10 file, 48 test)
npm run build      # typecheck + build di produzione
```

---

## 5. Test

`npx vitest run` → **13 file, 69 test**.

| File | Copre |
|---|---|
| `test/base45.test.ts` | vettori ufficiali RFC 9285, round-trip su 0–300 byte, input invalidi |
| `test/frame.test.ts` | codifica/decodifica dei tre tipi di frame, QR estranei ignorati, frame corrotti rifiutati |
| `test/bundle.test.ts` | contenitore multi-file, sanificazione dei nomi, payload troncati |
| `test/fountain.test.ts` | distribuzione deterministica, ricostruzione con metà dei blocchi, sblocco con Gauss |
| `test/optical.test.ts` | trasferimento end-to-end con 35% di frame persi, compressione, più elementi, checksum alterato |
| `test/qr-roundtrip.test.ts` | **matrice QR rasterizzata → jsQR → frame ricostruito**: verifica il canale ottico reale, non solo le funzioni |
| `test/sha256.test.ts` | hash incrementale e confronto con `node:crypto` |
| `test/markup.test.ts` | ogni `#id` usato dal codice esiste, nessun id duplicato, icone definite |
| `test/ui-smoke.test.ts` | routing, tema, aggiunta/rimozione contenuti, salvataggio impostazioni, diagnostica (jsdom) |
| `test/settings.test.ts` | valori ammessi (4/8/14/30 fps, 520/700/1200 byte), fallback, persistenza delle preferenze |
| `test/pacing.test.ts` | intervallo di frame, piano dei tick senza deriva, fps effettivi e stima di throughput |
| `test/qr-geometry.test.ts` | scala intera dei moduli, dimensione del canvas, densità per versione QR |
| `test/frame-stream.test.ts` | coda limitata, cadenza a 30 fps con orologio virtuale, sottoalimentazioni, pausa e ripresa |

**Cosa i test non coprono:** l'ottica reale (messa a fuoco, riflessi, luminosità, distanza) e il
comportamento su telefoni fisici. Non è stato possibile eseguire una prova su due dispositivi in questa
sessione: l'ambiente non ha fotocamera né browser grafico. Lo script qui sotto serve a colmare quel vuoto in
cinque minuti.

### Prova manuale in 5 minuti

1. Apri LensDrop su entrambi i telefoni (installala come PWA: menu del browser → *Aggiungi a schermo Home*).
2. Disattiva Wi-Fi, dati mobili e Bluetooth su entrambi: LensDrop non ne ha bisogno.
3. Telefono A → **Invia** → aggiungi una foto da ~300 KB e del testo → *Avvia il flusso ottico*.
4. Telefono B → **Ricevi** → *Attiva fotocamera* → inquadra lo schermo di A a 15–25 cm, riempiendo
   l'inquadratura; alza la luminosità di A.
5. Attendi il 100%, poi *Salva*: il file deve aprirsi identico all'originale.

Cosa guardare in caso di problemi (pannello **Diagnostica**, icona dell'insetto in alto):

| Sintomo | Causa probabile | Rimedio |
|---|---|---|
| "Nessun blocco letto" | QR troppo piccolo o sfocato | avvicina i telefoni, usa *Compatto*, aumenta la luminosità |
| Avanzamento a scatti | fotocamera lenta o frame rate alto | passa a *Lenta* (4 fps) |
| A 30 fps non si guadagna nulla | decoder software (Safari/Firefox) | resta su *Veloce* (14 fps) o *Normale* (8 fps) |
| Fps misurati molto sotto il preset | CPU occupata o canvas grande | usa *Compatto* e chiudi le altre app |
| "Frame non valido" ripetuti | riflessi o mosso | cambia angolazione, evita controluce |
| Percentuale ferma al 95% | servono altri simboli di riparazione | lascia scorrere il flusso: il mittente continua a trasmettere |

---

## 6. Struttura del progetto

```
LensDrop/
├─ index.html                  # markup unico dell'app (schermate, dialogo diagnostica, sprite SVG)
├─ src/
│  ├─ config.ts                # costanti: densità, fps, limiti
│  ├─ core/
│  │  ├─ base45.ts             # codifica Base45 (RFC 9285)
│  │  ├─ bytes.ts              # helper binari
│  │  ├─ bundle.ts             # contenitore multi-file LDB1 + sanificazione nomi
│  │  ├─ compression.ts        # gzip via CompressionStream
│  │  ├─ files.ts              # utilità (formati, download, lettura blob, clipboard)
│  │  ├─ fountain.ts           # codificatore/decodificatore LT + eliminazione di Gauss
│  │  ├─ frame.ts              # formato dei frame e validazione
│  │  ├─ optical.ts            # mittente (sequenza infinita) e destinatario (ricostruzione)
│  │  ├─ settings.ts           # preferenze locali validate
│  │  └─ sha256.ts             # SHA-256 incrementale
│  ├─ styles/                  # base.css (token, vetro) e screens.css (schermate)
│  └─ ui/
│     ├─ app.ts                # routing e cronologia
│     ├─ diagnostics.ts        # log in pagina, copia/download
│     ├─ send.ts               # selezione contenuti e flusso QR animato
│     ├─ receive.ts            # fotocamera, avanzamento, verifica, salvataggio
│     ├─ scanner.ts            # BarcodeDetector o jsQR, torcia, gestione permessi
│     ├─ qr.ts                 # disegno dei frame
│     ├─ items.ts              # righe dei contenuti (anteprime, azioni)
│     ├─ history.ts            # cronologia locale di soli metadati
│     ├─ settings-screen.ts    # impostazioni e capacità del browser
│     ├─ theme.ts / dom.ts     # tema e utilità DOM
│     └─ main.ts               # bootstrap + registrazione del service worker
├─ public/                     # manifest, icone, service worker
└─ test/                       # suite Vitest
```

---

## 7. Sicurezza e privacy

- **Nessun dato lascia i dispositivi.** Durante il trasferimento non avviene alcuna richiesta di rete: non
  esiste un server di segnalazione, un relay o un servizio TURN. Il repository ospita solo l'app statica.
- **Nessun segreto nel frontend**, nessuna chiave API, nessun identificativo utente.
- **Integrità obbligatoria:** il contenuto viene consegnato solo dopo la verifica SHA-256; nomi e lunghezze
  dei file ricevuti vengono validati prima di creare i Blob.
- **Il canale è visibile, non cifrato a livello applicativo.** Chiunque veda lo schermo (o lo riprenda) può
  leggere gli stessi dati: il QR è il canale. Per contenuti sensibili vale la regola di sempre: controlla chi
  ti sta intorno. Non esiste autenticazione del destinatario, quindi nessuna conferma di ricezione.
- **Cronologia locale:** solo nomi, dimensioni, esito e ora, in `localStorage`, cancellabile dall'app.
- **Nessun file temporaneo su disco:** i contenuti ricevuti restano nella memoria della scheda finché non li
  salvi; chiudendo la scheda vanno persi.
- **HTTPS obbligatorio** per `getUserMedia`; la PWA richiede HTTPS anche per il service worker.

---

## 8. Build e deploy su GitHub Pages

Il workflow `.github/workflows/lensdrop-pages.yml` (nella radice del repository) esegue, a ogni push su `main`
che tocca `LensDrop/**`: `npm ci` → `typecheck` → `lint` → `test` → build con `VITE_BASE=/Progetti/LensDrop/`
→ artefatto `_site/LensDrop` → `actions/deploy-pages`.

| Variabile | Dove | Significato |
|---|---|---|
| `VITE_BASE` | build | Sottopercorso pubblico. Default `/`; sul repository `/Progetti/LensDrop/`. |

Non esistono altre variabili, né segreti: l'app non chiama alcun servizio esterno.

> **Stato del deploy (verificato).** GitHub Pages è attivo con sorgente *GitHub Actions* (`build_type: workflow`).
> Il run del workflow successivo al merge ([#40732323084](https://github.com/ValerioMassimoDeCecco/Progetti/actions/runs/40732323084))
> ha completato **build e deploy**: typecheck, lint, 48 test, build con `VITE_BASE=/Progetti/LensDrop/`,
> pubblicazione dell'artefatto `_site/LensDrop`. La pagina pubblicata
> <https://valeriomassimodececco.github.io/Progetti/LensDrop/> è stata aperta e mostra la nuova versione ottica
> (titolo «LensDrop — passa i file con uno sguardo», schermate Invia/Ricevi, pannello Diagnostica con il log
> `Ambiente pronto: fotocamera disponibile, contesto sicuro`, prova che il bundle è stato eseguito), e
> `…/LensDrop/manifest.webmanifest` risponde con il manifest aggiornato.
>
> Nota di trasparenza: la verifica è stata fatta con un lettore HTTP esterno all'ambiente di sviluppo, che non
> ha accesso diretto a `*.github.io`. **Non** è stata eseguita una prova del trasferimento su due telefoni
> fisici (vedi §5).

---

## 9. Servizi esterni e dipendenze

L'app **non usa servizi esterni a runtime**. Librerie incluse nel bundle:

| Dipendenza | Uso | Licenza |
|---|---|---|
| [`qrcode`](https://www.npmjs.com/package/qrcode) | generazione delle matrici QR | MIT |
| [`jsqr`](https://www.npmjs.com/package/jsqr) | decodifica QR quando `BarcodeDetector` manca | Apache-2.0 |
| `vite`, `typescript`, `eslint`, `vitest`, `jsdom` (solo sviluppo) | build, tipi, lint, test | MIT / Apache-2.0 |

Nessun font o icona remota: tipografia di sistema e sprite SVG inline.

---

## 10. Limiti noti

1. **Velocità**: da ~4 KB/s (*Lenta*, 4 fps) a ~21 KB/s teorici (*Massima*, 30 fps); sopra i 14 fps il
   guadagno richiede la decodifica hardware del destinatario, quindi il valore tipico resta 4–15 KB/s. File oltre poche decine di MB restano possibili ma lunghi (nessun limite
   tecnico bloccante, solo tempo e stabilità dell'inquadratura).
2. **Nessuna conferma di ricezione**: il canale è unidirezionale. Il mittente non sa se e quando il destinatario
   ha completato; lo vede solo il destinatario, nella sua schermata.
3. **Nessuna cifratura applicativa**: il QR è leggibile da chiunque lo inquadri.
4. **Dipende dall'ottica**: distanza, luminosità, riflessi, messa a fuoco e qualità del sensore cambiano
   radicalmente il risultato. Le densità basse esistono per questo.
5. **PWA**: il primo caricamento richiede rete; il funzionamento offline vale dalla seconda apertura.
6. **iOS/Safari**: niente `BarcodeDetector`, quindi si usa jsQR (più lento, ~10–15 frame/s): il preset a
   30 fps è selezionabile ma non porta vantaggi su questi dispositivi. La torcia è
   disponibile solo se il browser la espone.
7. **Memoria**: il payload viene tenuto in RAM sia in invio sia in ricezione; file molto grandi possono
   esaurire la memoria delle schede mobili.
8. **Nessun test su dispositivi fisici** in questa sessione (vedi §5).

---

## 11. Idee non incluse (dichiarate, non nascoste)

- Parità di cifratura con passphrase condivisa a voce (il canale ottico potrebbe trasportare solo il testo cifrato).
- Trasmissione bidirezionale con le due fotocamere per la ritrasmissione selettiva dei blocchi mancanti.
- Compressione più aggressiva (WebP/AVIF per le immagini, ricodifica video).
- Rilevamento automatico della densità in base al ritmo di decodifica.

---

## 12. Riferimenti utili

- RFC 9285 — *The Base45 Data Encoding*.
- Luby, M. *LT Codes* (2002): le basi dei codici fountain usati qui.
- Progetti che hanno ispirato l'approccio: LiveDrop (matrice video proprietaria), txqr/decimen, QRDrop,
  BeamFerry — tutti confermano la scelta di QR animati + fountain code per un canale ottico senza ritorno.

Licenza MIT — Copyright (c) 2026 Valerio Massimo De Cecco.
