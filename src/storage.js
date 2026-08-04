import { createClient } from "@supabase/supabase-js";

// Le due variabili arrivano dal file .env (vedi .env.example) — mai scrivere
// qui i valori veri, altrimenti finiscono nel codice pubblicato.
const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY;

export const supabase = createClient(supabaseUrl, supabaseAnonKey);

// Stessa "forma" di window.storage (get/set che restituiscono { key, value }),
// così il resto dell'app (App.jsx) non ha dovuto essere riscritto: usa una
// singola tabella "kv_store" con due colonne, key (testo) e value (testo),
// esattamente come le chiavi già usate prima: hakuna-employees, hakuna-punches,
// hakuna-shifts, hakuna-admin-pin. Il contenuto resta JSON dentro "value",
// non è normalizzato in tabelle separate — più semplice da mantenere per un
// progetto di questa dimensione.
export const storage = {
  async get(key) {
    const { data, error } = await supabase
      .from("kv_store")
      .select("key, value")
      .eq("key", key)
      .maybeSingle();
    if (error) throw error;
    if (!data) return null;
    return { key: data.key, value: data.value };
  },

  async set(key, value) {
    const { error } = await supabase
      .from("kv_store")
      .upsert({ key, value, updated_at: new Date().toISOString() });
    if (error) throw error;
    return { key, value };
  },

  // Le timbrature vivono nella loro tabella dedicata "punches", una riga per
  // timbratura — non più un unico blocco JSON in kv_store. Con un blocco unico,
  // due dispositivi che timbrano quasi nello stesso istante (es. un tablet per
  // negozio) potevano sovrascriversi a vicenda e far perdere una timbratura:
  // con righe singole ogni inserimento/modifica/cancellazione è indipendente.
  async listPunches() {
    const { data, error } = await supabase
      .from("punches")
      .select("id, employee_id, type, timestamp")
      .order("timestamp", { ascending: true });
    if (error) throw error;
    return (data || []).map((p) => ({ id: p.id, employeeId: p.employee_id, type: p.type, timestamp: p.timestamp }));
  },

  async insertPunch(punch) {
    const { error } = await supabase
      .from("punches")
      .insert({ id: punch.id, employee_id: punch.employeeId, type: punch.type, timestamp: punch.timestamp });
    if (error) throw error;
  },

  async insertPunches(punchList) {
    const { error } = await supabase
      .from("punches")
      .insert(punchList.map((p) => ({ id: p.id, employee_id: p.employeeId, type: p.type, timestamp: p.timestamp })));
    if (error) throw error;
  },

  async updatePunchTimestamp(id, timestamp) {
    const { error } = await supabase.from("punches").update({ timestamp }).eq("id", id);
    if (error) throw error;
  },

  async deletePunch(id) {
    const { error } = await supabase.from("punches").delete().eq("id", id);
    if (error) throw error;
  },
};
