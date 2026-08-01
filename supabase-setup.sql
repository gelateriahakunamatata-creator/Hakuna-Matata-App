-- Esegui questo script in Supabase: dal menu a sinistra, "SQL Editor" → "New query"
-- → incolla tutto → "Run". Va fatto una sola volta.

create table if not exists kv_store (
  key text primary key,
  value text not null,
  updated_at timestamptz default now()
);

-- Attiva la sicurezza a livello di riga (obbligatoria su Supabase per le tabelle
-- pubbliche) e poi apri l'accesso in lettura/scrittura a chiunque abbia la
-- chiave "anon" dell'app — è lo stesso livello di protezione che aveva prima
-- lo storage di Claude: chiunque abbia il link dell'app può leggere/scrivere,
-- ma nessuno può farlo senza passare dall'app.
alter table kv_store enable row level security;

create policy "Consenti lettura pubblica" on kv_store
  for select using (true);

create policy "Consenti scrittura pubblica" on kv_store
  for insert with check (true);

create policy "Consenti aggiornamento pubblico" on kv_store
  for update using (true);
