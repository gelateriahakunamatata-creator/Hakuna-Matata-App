-- Da eseguire UNA VOLTA in Supabase: "SQL Editor" → "New query" → incolla
-- tutto → "Run". Serve a risolvere il problema delle timbrature che a volte
-- si perdevano quando due dispositivi (es. un tablet per negozio) timbravano
-- quasi nello stesso momento: prima tutte le timbrature erano un unico blocco
-- di testo, e il secondo salvataggio poteva sovrascrivere il primo. Ora ogni
-- timbratura è una riga a sé nella tabella "punches", quindi non si perdono
-- più a vicenda.

create table if not exists punches (
  id text primary key,
  employee_id text not null,
  type text not null check (type in ('in', 'out')),
  timestamp bigint not null,
  created_at timestamptz default now()
);

alter table punches enable row level security;

create policy "Consenti lettura pubblica" on punches
  for select using (true);

create policy "Consenti scrittura pubblica" on punches
  for insert with check (true);

create policy "Consenti aggiornamento pubblico" on punches
  for update using (true);

create policy "Consenti cancellazione pubblica" on punches
  for delete using (true);

-- Recupera le timbrature già esistenti (quelle salvate finora nel vecchio
-- formato) e le copia nella nuova tabella, così non si perde la storia.
insert into punches (id, employee_id, type, timestamp)
select
  (elem->>'id')::text,
  (elem->>'employeeId')::text,
  (elem->>'type')::text,
  (elem->>'timestamp')::bigint
from kv_store, jsonb_array_elements(value::jsonb) as elem
where key = 'hakuna-punches'
on conflict (id) do nothing;
