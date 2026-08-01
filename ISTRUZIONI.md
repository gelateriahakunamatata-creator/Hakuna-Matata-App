# Come mettere online l'app — passo per passo

Segui questi passaggi in ordine. Non serve saper programmare, sono tutti click
su interfacce web.

## 1. Crea il database su Supabase

1. Vai su **supabase.com** → Registrati (va bene con Google)
2. **New project** → dagli un nome, es. "hakuna-timbrature" → scegli una
   password per il database e **salvala da qualche parte** → crea
3. Aspetta 1-2 minuti che si attivi
4. Nel menu a sinistra: **SQL Editor** → **New query**
5. Apri il file `supabase-setup.sql` (incluso in questo progetto), copia tutto
   il contenuto, incollalo nell'editor → premi **Run**
6. Nel menu a sinistra: **Project Settings** (icona ingranaggio) → **API**
7. Copia questi due valori, ti serviranno tra poco:
   - **Project URL** (tipo `https://xxxxx.supabase.co`)
   - **anon public key** (una stringa lunga)

## 2. Carica il progetto su GitHub

1. Se non hai un account, vai su **github.com** → Registrati
2. **New repository** → nome a piacere (es. "hakuna-timbrature") → **Create**
3. Sulla pagina del nuovo repository vuoto, usa il pulsante **"uploading an
   existing file"** e trascina **tutti i file di questo progetto** (tutta la
   cartella, struttura inclusa)
4. **Commit changes** in fondo alla pagina

## 3. Pubblica su Vercel

1. Vai su **vercel.com** → Registrati (meglio se con lo stesso account
   GitHub del passo precedente, così si collegano da soli)
2. **Add New → Project**
3. Seleziona il repository che hai appena creato → **Import**
4. Prima di premere "Deploy", apri **Environment Variables** e aggiungi:
   - `VITE_SUPABASE_URL` → incolla il Project URL copiato prima
   - `VITE_SUPABASE_ANON_KEY` → incolla la anon public key copiata prima
5. Premi **Deploy**
6. Dopo 1-2 minuti ti dà un link tipo `hakuna-timbrature.vercel.app` —
   **quello è il link definitivo**, non cambia più

## 4. Salvalo sul telefono

Apri quel link da Safari (iPhone) o Chrome (Android) → condividi/menu →
**"Aggiungi a Home"**. Fallo fare anche a Gabriele e a ogni dipendente.

---

## Se in futuro vuoi cambiare qualcosa nel codice

Ogni volta che modifichi i file nella cartella e li ricarichi su GitHub
(sostituendo i vecchi), Vercel pubblica da solo la nuova versione in
automatico nello stesso link, in 1-2 minuti — non devi rifare nessuno dei
passaggi sopra, sono un'unica volta.

## Per rimettere logo e sfondo veri

Qui non c'è più nessun limite di Claude: puoi mettere le immagini vere.
Nella cartella `public/` di questo progetto, aggiungi i file immagine
(es. `logo.png`, `sfondo.jpg`, `icon.png`) e poi richiamale nel codice con un
indirizzo semplice tipo `/logo.png` — funzionano senza incorporarle come testo
lunghissimo nel codice. Se vuoi, torna da me quando sei a questo punto e ti
sistemo io i riferimenti nel codice.
