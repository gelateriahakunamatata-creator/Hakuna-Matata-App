import React, { useState, useEffect, useCallback } from "react";
import { Plus, X, Clock, Users, Settings, ChevronLeft, Check, Trash2, Download, Calendar as CalendarIcon, Pencil } from "lucide-react";
import { storage } from "./storage";
const ICON_DATA_URL = "";
const LOGO_DATA_URL = "";
const PATTERN_DATA_URL = "";


// ---- Design tokens (from Hakuna Matata brand assets) ----
// sand: warm honey background, espresso: dark brown ink,
// sky: pattern blue, terracotta: pattern red-orange, maroon: deep accent
const C = {
  sand: "#F3C578",
  sandLight: "#F9DFA8",
  sandDeep: "#E3AE5C",
  espresso: "#2B1810",
  sky: "#4EC1E0",
  terracotta: "#C24A34",
  maroon: "#6B2E28",
};

const STORE_META = {
  origini: { label: "Le Origini", short: "LO" },
  piazza: { label: "In Piazza", short: "IP" },
};

function uid() {
  return Math.random().toString(36).slice(2, 10) + Date.now().toString(36);
}

// Soglia oltre la quale un ingresso senza uscita viene segnalato in Gestione
// come probabile timbratura di uscita dimenticata.
const FORGOTTEN_CLOCKOUT_HOURS = 12;

// Stable per-employee colors for the shift calendar, so the same person always
// gets the same color no matter the order employees were added/removed.
const EMPLOYEE_COLORS = [
  "#4EC1E0", // sky
  "#C24A34", // terracotta
  "#8E6BB0", // lavender
  "#7A8B4C", // olive
  "#D98A3D", // amber
  "#4C6B8B", // slate blue
  "#B0526B", // rose
  "#2E8B7A", // teal
];
function employeeColor(id) {
  let hash = 0;
  for (let i = 0; i < id.length; i++) {
    hash = (hash << 5) - hash + id.charCodeAt(i);
    hash |= 0;
  }
  return EMPLOYEE_COLORS[Math.abs(hash) % EMPLOYEE_COLORS.length];
}

function fmtTime(ts) {
  return new Date(ts).toLocaleTimeString("it-IT", { hour: "2-digit", minute: "2-digit" });
}
function fmtDate(ts) {
  return new Date(ts).toLocaleDateString("it-IT", { day: "2-digit", month: "2-digit", year: "numeric" });
}
function fmtDur(ms) {
  const totalMin = Math.round(ms / 60000);
  const h = Math.floor(totalMin / 60);
  const m = totalMin % 60;
  return `${h}h ${m.toString().padStart(2, "0")}m`;
}
function startOfWeek(d) {
  const date = new Date(d);
  const day = (date.getDay() + 6) % 7; // Monday = 0
  date.setHours(0, 0, 0, 0);
  date.setDate(date.getDate() - day);
  return date.getTime();
}
function startOfMonth(d) {
  const date = new Date(d);
  return new Date(date.getFullYear(), date.getMonth(), 1).getTime();
}
function daysInMonth(monthStartTs) {
  const d = new Date(monthStartTs);
  return new Date(d.getFullYear(), d.getMonth() + 1, 0).getDate();
}
function monthLabel(monthStartTs) {
  return new Date(monthStartTs).toLocaleDateString("it-IT", { month: "long", year: "numeric" });
}
function dayKey(ts) {
  const d = new Date(ts);
  return `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;
}
function hoursDecimal(ms) {
  return Math.round((ms / 3600000) * 100) / 100;
}
// Pairs up in/out punches (chronological) into completed shifts, splitting any
// shift that crosses midnight so hours land on the correct calendar day.
function shiftsFor(punches, employeeId) {
  const mine = punches.filter((p) => p.employeeId === employeeId).sort((a, b) => a.timestamp - b.timestamp);
  const shifts = [];
  for (let i = 0; i < mine.length; i++) {
    if (mine[i].type === "in" && mine[i + 1] && mine[i + 1].type === "out") {
      shifts.push({ in: mine[i].timestamp, out: mine[i + 1].timestamp });
      i++;
    }
  }
  return shifts;
}
function dailyHoursForMonth(punches, employeeId, monthStartTs) {
  const total = daysInMonth(monthStartTs);
  const byDay = {};
  for (let d = 1; d <= total; d++) byDay[d] = 0;
  const shifts = shiftsFor(punches, employeeId);
  shifts.forEach((s) => {
    let cursor = s.in;
    while (cursor < s.out) {
      const cursorDate = new Date(cursor);
      const dayEnd = new Date(cursorDate.getFullYear(), cursorDate.getMonth(), cursorDate.getDate() + 1).getTime();
      const segEnd = Math.min(s.out, dayEnd);
      const mStart = startOfMonth(cursor);
      if (mStart === monthStartTs) {
        const d = cursorDate.getDate();
        byDay[d] = (byDay[d] || 0) + hoursDecimal(segEnd - cursor);
      }
      cursor = segEnd;
    }
  });
  return byDay;
}
function downloadTextFile(filename, content) {
  const blob = new Blob([content], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
// Parses "HH:MM" into hours as a decimal, handling shifts that cross midnight
// (end time earlier than start time is treated as ending the next day).
function shiftPlannedHours(start, end) {
  const [sh, sm] = start.split(":").map(Number);
  const [eh, em] = end.split(":").map(Number);
  let startMin = sh * 60 + sm;
  let endMin = eh * 60 + em;
  if (endMin <= startMin) endMin += 24 * 60;
  return Math.round(((endMin - startMin) / 60) * 100) / 100;
}
// Actual clock-in / clock-out timestamps per calendar day, from the punches —
// takes the earliest "in" and the latest "out" of that day (keyed to the day the
// shift started on).
function actualBoundsForMonth(punches, employeeId, monthStartTs) {
  const bounds = {};
  shiftsFor(punches, employeeId).forEach((s) => {
    if (startOfMonth(s.in) !== monthStartTs) return;
    const day = new Date(s.in).getDate();
    if (!bounds[day]) {
      bounds[day] = { start: s.in, end: s.out };
    } else {
      bounds[day].start = Math.min(bounds[day].start, s.in);
      bounds[day].end = Math.max(bounds[day].end, s.out);
    }
  });
  return bounds;
}
// Scheduled clock-in / clock-out timestamps per calendar day, from the shifts
// assigned in Gestione → Turni — this is the "orario da calendario" reference.
function scheduledBoundsForMonth(shifts, employeeId, monthStartTs) {
  const bounds = {};
  (shifts || [])
    .filter((s) => s.employeeId === employeeId)
    .forEach((s) => {
      const [y, m, d] = s.day.split("-").map(Number);
      const dayStartTs = dayTs(y, m - 1, d);
      if (startOfMonth(dayStartTs) !== monthStartTs) return;
      const [sh, sm] = s.start.split(":").map(Number);
      const [eh, em] = s.end.split(":").map(Number);
      let startTs = dayStartTs + (sh * 60 + sm) * 60000;
      let endTs = dayStartTs + (eh * 60 + em) * 60000;
      if (endTs <= startTs) endTs += 24 * 60 * 60000;
      if (!bounds[d]) {
        bounds[d] = { start: startTs, end: endTs };
      } else {
        bounds[d].start = Math.min(bounds[d].start, startTs);
        bounds[d].end = Math.max(bounds[d].end, endTs);
      }
    });
  return bounds;
}
// Se in questo momento il dipendente sta lavorando un turno a calendario non
// ancora finito, restituisce l'orario (timestamp) di fine turno — altrimenti
// null. Guarda sia i turni datati oggi sia quelli datati ieri che sconfinano
// oltre mezzanotte, così un turno notturno resta valido anche dopo le 00:00.
function activeScheduledShiftEnd(shifts, employeeId, nowTs) {
  const todayIso = isoDay(nowTs);
  const yesterdayIso = isoDay(nowTs - 24 * 60 * 60000);
  let latestEnd = null;
  (shifts || [])
    .filter((s) => s.employeeId === employeeId && (s.day === todayIso || s.day === yesterdayIso))
    .forEach((s) => {
      const [y, m, d] = s.day.split("-").map(Number);
      const dayStartTs = dayTs(y, m - 1, d);
      const [sh, sm] = s.start.split(":").map(Number);
      const [eh, em] = s.end.split(":").map(Number);
      let startTs = dayStartTs + (sh * 60 + sm) * 60000;
      let endTs = dayStartTs + (eh * 60 + em) * 60000;
      if (endTs <= startTs) endTs += 24 * 60 * 60000;
      if (nowTs >= startTs && nowTs < endTs && (latestEnd === null || endTs > latestEnd)) {
        latestEnd = endTs;
      }
    });
  return latestEnd;
}
// Le ore lavorate si contano SEMPRE a partire dall'orario di inizio turno a
// calendario, mai da un ingresso anticipato: chi timbra prima non fa guadagnare
// né ore standard né straordinario per quei minuti, restano semplicemente fuori
// dal conteggio. Lo straordinario è solo il tempo timbrato dopo l'orario di fine
// turno. Un giorno senza turno a calendario conta interamente come straordinario,
// perché non esiste un orario di riferimento con cui confrontare la timbratura —
// eccetto per i dipendenti a orario libero (es. laboratorio), per cui non esiste
// proprio il concetto di turno: dal martedì al sabato le prime 6 ore timbrate
// sono standard e l'eventuale eccedenza è straordinario; di domenica e lunedì
// è sempre tutto straordinario.
// In entrambi i casi, uno sforamento sotto i 15 minuti di tolleranza viene
// perdonato (conta come standard); da 15 minuti in su scatta per intero.
const FLEXIBLE_DAILY_STANDARD_HOURS = 6;
const OVERTIME_GRACE_HOURS = 15 / 60;
function graceAdjustedOvertime(rawOvertimeHours) {
  return rawOvertimeHours < OVERTIME_GRACE_HOURS ? 0 : rawOvertimeHours;
}
function splitStandardOvertime(actualBounds, scheduledBounds, totalDays, flexible, monthStartTs) {
  const standard = {};
  const overtime = {};
  const monthDate = monthStartTs != null ? new Date(monthStartTs) : null;
  for (let d = 1; d <= totalDays; d++) {
    const act = actualBounds[d];
    const sched = scheduledBounds[d];
    if (!act) {
      standard[d] = 0;
      overtime[d] = 0;
      continue;
    }
    if (flexible) {
      const total = Math.max(0, (act.end - act.start) / 3600000);
      const weekday = new Date(monthDate.getFullYear(), monthDate.getMonth(), d).getDay(); // 0=Dom, 1=Lun, ..., 6=Sab
      const isStandardDay = weekday >= 2 && weekday <= 6; // Mar-Sab
      const rawOt = isStandardDay ? Math.max(0, total - FLEXIBLE_DAILY_STANDARD_HOURS) : total;
      const ot = isStandardDay ? graceAdjustedOvertime(rawOt) : rawOt;
      const std = isStandardDay ? total - ot : 0;
      standard[d] = Math.round(std * 100) / 100;
      overtime[d] = Math.round(ot * 100) / 100;
      continue;
    }
    if (!sched) {
      // Nessun turno a calendario: tutto il tempo timbrato è straordinario.
      const total = Math.max(0, (act.end - act.start) / 3600000);
      standard[d] = 0;
      overtime[d] = Math.round(total * 100) / 100;
      continue;
    }
    // L'inizio del conteggio è il MASSIMO tra l'orario di inizio a calendario e
    // l'ingresso reale: se timbra prima, quei minuti restano fuori.
    const countedStart = Math.max(act.start, sched.start);
    const countedEnd = act.end;
    if (countedEnd <= countedStart) {
      standard[d] = 0;
      overtime[d] = 0;
      continue;
    }
    const rawOt = Math.max(0, (countedEnd - sched.end) / 3600000);
    const ot = graceAdjustedOvertime(rawOt);
    const stdEnd = ot > 0 ? Math.min(countedEnd, sched.end) : countedEnd;
    const std = Math.max(0, (stdEnd - countedStart) / 3600000);
    standard[d] = Math.round(std * 100) / 100;
    overtime[d] = Math.round(ot * 100) / 100;
  }
  return { standard, overtime };
}
// Raggruppa le ore (standard + straordinario) per settimana (Lun-Dom), per
// confrontarle con le ore da contratto settimanali di un dipendente.
function weeklyTotalsForMonth(standard, overtime, monthStartTs, totalDays) {
  const monthDate = new Date(monthStartTs);
  const weeks = {};
  for (let d = 1; d <= totalDays; d++) {
    const ts = dayTs(monthDate.getFullYear(), monthDate.getMonth(), d);
    const weekStart = startOfWeek(ts);
    const total = (standard[d] || 0) + (overtime[d] || 0);
    weeks[weekStart] = (weeks[weekStart] || 0) + total;
  }
  return Object.entries(weeks)
    .map(([weekStart, total]) => ({ weekStart: Number(weekStart), total: Math.round(total * 100) / 100 }))
    .sort((a, b) => a.weekStart - b.weekStart);
}
function exportEmployeeMonthCSV(employee, punches, shifts, monthStartTs) {
  const actualBounds = actualBoundsForMonth(punches, employee.id, monthStartTs);
  const scheduledBounds = scheduledBoundsForMonth(shifts, employee.id, monthStartTs);
  const total = daysInMonth(monthStartTs);
  const { standard, overtime } = splitStandardOvertime(actualBounds, scheduledBounds, total, employee.flexible, monthStartTs);
  const monthDate = new Date(monthStartTs);
  const rows = ["Giorno;Ore standard;Straordinari;Totale"];
  let sumStd = 0;
  let sumOt = 0;
  for (let d = 1; d <= total; d++) {
    const std = standard[d] || 0;
    const ot = overtime[d] || 0;
    sumStd += std;
    sumOt += ot;
    const dateLabel = new Date(monthDate.getFullYear(), monthDate.getMonth(), d).toLocaleDateString("it-IT", {
      day: "2-digit",
      month: "2-digit",
      year: "numeric",
    });
    rows.push(`${dateLabel};${std.toFixed(2).replace(".", ",")};${ot.toFixed(2).replace(".", ",")};${(std + ot).toFixed(2).replace(".", ",")}`);
  }
  rows.push("");
  rows.push(`Totale;${sumStd.toFixed(2).replace(".", ",")};${sumOt.toFixed(2).replace(".", ",")};${(sumStd + sumOt).toFixed(2).replace(".", ",")}`);
  const safeName = employee.name.trim().replace(/[^a-z0-9]+/gi, "-");
  const safeMonth = monthDate.toLocaleDateString("it-IT", { month: "2-digit", year: "numeric" }).replace("/", "-");
  downloadTextFile(`ore-${safeName}-${safeMonth}.csv`, rows.join("\n"));
}

// ---- Giraffe-print background: the real pattern tile supplied by the user ----
function PatternBg() {
  return (
    <div
      className="fixed inset-0 w-full h-full"
      style={{
        zIndex: 0,
        background: PATTERN_DATA_URL ? `url(${PATTERN_DATA_URL})` : C.sand,
        backgroundRepeat: "repeat",
        backgroundSize: "300px auto",
      }}
    />
  );
}

// ---- PIN pad ----
function PinPad({ title, subtitle, length = 4, onSubmit, onCancel, error }) {
  const [val, setVal] = useState("");
  const push = (d) => {
    if (val.length >= length) return;
    const next = val + d;
    setVal(next);
    if (next.length === length) {
      setTimeout(() => onSubmit(next), 120);
    }
  };
  useEffect(() => {
    if (error) setVal("");
  }, [error]);
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4" style={{ background: "rgba(43,24,16,0.55)" }}>
      <div className="w-full max-w-xs rounded-3xl p-6" style={{ background: C.sandLight, border: `3px solid ${C.espresso}` }}>
        <div className="flex items-center justify-between mb-3">
          <div>
            <p className="text-xs uppercase tracking-widest font-normal" style={{ color: "#000" }}>{subtitle}</p>
            <h3 className="text-xl font-normal" style={{ color: "#000" }}>{title}</h3>
          </div>
          <button onClick={onCancel} className="p-1.5 rounded-full" style={{ background: C.sand }}>
            <X size={18} color={C.espresso} />
          </button>
        </div>
        <div className="flex justify-center my-5">
          <div
            className="px-5 py-3 rounded-2xl font-mono text-2xl"
            style={{
              background: "#fff",
              border: `2px solid ${C.sandDeep}`,
              color: "#000",
              minWidth: 160,
              textAlign: "center",
              letterSpacing: "0.3em",
            }}
          >
            {val.padEnd(length, "•")}
          </div>
        </div>
        {error && <p className="text-center text-sm font-normal mb-3" style={{ color: C.terracotta }}>{error}</p>}
        <div className="grid grid-cols-3 gap-2.5">
          {["1", "2", "3", "4", "5", "6", "7", "8", "9", "", "0", "back"].map((k, i) =>
            k === "" ? (
              <div key={i} />
            ) : k === "back" ? (
              <button
                key={i}
                onClick={() => setVal((v) => v.slice(0, -1))}
                className="h-14 rounded-2xl font-normal text-sm"
                style={{ background: C.sand, color: "#000" }}
              >
                ⌫
              </button>
            ) : (
              <button
                key={i}
                onClick={() => push(k)}
                className="h-14 rounded-2xl text-xl font-normal active:scale-95 transition-transform"
                style={{ background: "#fff", color: "#000", border: `2px solid ${C.sandDeep}` }}
              >
                {k}
              </button>
            )
          )}
        </div>
      </div>
    </div>
  );
}

// Dopo il PIN, il dipendente scieglie esplicitamente ingresso o uscita e
// conferma con un Sì/No, invece di lasciare che il sistema indovini il tipo
// dall'ultima timbratura registrata.
function PunchChoice({ employee, type, error, onChooseIn, onChooseOut, onConfirm, onCancelConfirm, onClose }) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4" style={{ background: "rgba(43,24,16,0.55)" }}>
      <div className="w-full max-w-xs rounded-3xl p-6" style={{ background: C.sandLight, border: `3px solid ${C.espresso}` }}>
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-xl font-normal" style={{ color: "#000" }}>{employee.name}</h3>
          <button onClick={onClose} className="p-1.5 rounded-full" style={{ background: C.sand }}>
            <X size={18} color={C.espresso} />
          </button>
        </div>
        {type === null ? (
          <>
            {error && <p className="text-center text-sm font-normal mb-3" style={{ color: C.terracotta }}>{error}</p>}
            <div className="space-y-2.5">
              <button
                onClick={onChooseIn}
                className="w-full py-3.5 rounded-2xl font-normal text-sm"
                style={{ background: C.sky, color: "#000" }}
              >
                Timbra Ingresso
              </button>
              <button
                onClick={onChooseOut}
                className="w-full py-3.5 rounded-2xl font-normal text-sm"
                style={{ background: C.espresso, color: C.sandLight }}
              >
                Timbra Uscita
              </button>
            </div>
          </>
        ) : (
          <>
            <p className="text-center text-sm font-normal mb-4" style={{ color: "#000" }}>
              Vuoi timbrare {type === "in" ? "l'ingresso" : "l'uscita"}?
            </p>
            <div className="flex gap-2.5">
              <button
                onClick={onCancelConfirm}
                className="flex-1 py-2.5 rounded-xl font-normal text-sm"
                style={{ background: C.sand, color: "#000" }}
              >
                No
              </button>
              <button
                onClick={onConfirm}
                className="flex-1 py-2.5 rounded-xl font-normal text-sm"
                style={{ background: C.espresso, color: C.sandLight }}
              >
                Sì
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

function dayTs(y, m, d) {
  return new Date(y, m, d).getTime();
}
function isoDay(ts) {
  const d = new Date(ts);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}
const WEEKDAYS = ["Lun", "Mar", "Mer", "Gio", "Ven", "Sab", "Dom"];

export default function App() {
  const [employees, setEmployees] = useState(null);
  const [punches, setPunches] = useState(null);
  const [shifts, setShifts] = useState(null);
  const [adminPin, setAdminPin] = useState(null);
  const [loading, setLoading] = useState(true);
  const [screen, setScreen] = useState("home"); // home | store | admin | admin-auth | report | schedule | schedule-admin
  const [store, setStore] = useState(null);
  const [scheduleStore, setScheduleStore] = useState("origini");
  const [pinTarget, setPinTarget] = useState(null); // employee being clocked
  const [pinError, setPinError] = useState("");
  const [punchTarget, setPunchTarget] = useState(null); // employee who verified PIN, choosing ingresso/uscita
  const [punchType, setPunchType] = useState(null); // "in" | "out" chosen, awaiting Sì/No confirm
  const [punchChoiceError, setPunchChoiceError] = useState("");
  const [adminAuthed, setAdminAuthed] = useState(false);
  const [adminErr, setAdminErr] = useState("");
  const [toast, setToast] = useState(null);
  const [newEmp, setNewEmp] = useState({ name: "", store: "origini", pin: "", flexible: false, contractHours: "" });
  const [addingEmp, setAddingEmp] = useState(false);
  const [editEmp, setEditEmp] = useState(null); // draft { id, name, store, pin, flexible, contractHours } of employee being edited
  const [myHoursTarget, setMyHoursTarget] = useState(null); // employee whose PIN matched
  const [myHoursPinError, setMyHoursPinError] = useState("");

  const load = useCallback(async () => {
    try {
      const [e, p, a, s] = await Promise.allSettled([
        storage.get("hakuna-employees"),
        storage.get("hakuna-punches"),
        storage.get("hakuna-admin-pin"),
        storage.get("hakuna-shifts"),
      ]);
      setEmployees(e.status === "fulfilled" && e.value ? JSON.parse(e.value.value) : []);
      setPunches(p.status === "fulfilled" && p.value ? JSON.parse(p.value.value) : []);
      setAdminPin(a.status === "fulfilled" && a.value ? a.value.value : "1234");
      setShifts(s.status === "fulfilled" && s.value ? JSON.parse(s.value.value) : []);
    } catch (err) {
      console.error(err);
      setEmployees([]);
      setPunches([]);
      setAdminPin("1234");
      setShifts([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  // Set the home-screen / tab icon to the Hakuna Matata logo
  useEffect(() => {
    if (!ICON_DATA_URL) return;
    const rels = ["apple-touch-icon", "icon", "shortcut icon"];
    const created = [];
    rels.forEach((rel) => {
      const link = document.createElement("link");
      link.rel = rel;
      link.href = ICON_DATA_URL;
      document.head.appendChild(link);
      created.push(link);
    });
    const prevTitle = document.title;
    document.title = "Hakuna Matata · Timbrature";
    return () => {
      created.forEach((l) => l.remove());
      document.title = prevTitle;
    };
  }, []);

  // Load a rounded geometric sans close to the logo's own typeface, used app-wide
  useEffect(() => {
    const link = document.createElement("link");
    link.rel = "stylesheet";
    link.href = "https://fonts.googleapis.com/css2?family=Poppins:wght@400;500&display=swap";
    document.head.appendChild(link);
    return () => link.remove();
  }, []);

  // Ricarica automaticamente un'ora dopo l'apertura, così un tablet/telefono
  // lasciato aperto tutto il giorno scarica sempre l'ultima versione
  // pubblicata invece di restare bloccato su quella vecchia in memoria.
  useEffect(() => {
    const timer = setTimeout(() => {
      window.location.reload();
    }, 60 * 60 * 1000);
    return () => clearTimeout(timer);
  }, []);

  const saveEmployees = async (next) => {
    setEmployees(next);
    try {
      await storage.set("hakuna-employees", JSON.stringify(next));
    } catch (err) {
      console.error("save employees failed", err);
    }
  };
  const savePunches = async (next) => {
    setPunches(next);
    try {
      await storage.set("hakuna-punches", JSON.stringify(next));
    } catch (err) {
      console.error("save punches failed", err);
    }
  };
  const saveAdminPin = async (pin) => {
    setAdminPin(pin);
    try {
      await storage.set("hakuna-admin-pin", pin);
    } catch (err) {
      console.error("save admin pin failed", err);
    }
  };
  const saveShifts = async (next) => {
    setShifts(next);
    try {
      await storage.set("hakuna-shifts", JSON.stringify(next));
    } catch (err) {
      console.error("save shifts failed", err);
    }
  };

  // Lets an admin backfill a clock-in/clock-out pair for a day an employee
  // couldn't punch themselves (e.g. app was down), so it counts in their hours
  // exactly like a normal punch would.
  const addManualPunch = async (employeeId, dayIso, startTime, endTime) => {
    const [y, m, d] = dayIso.split("-").map(Number);
    const dayStart = dayTs(y, m - 1, d);
    const [sh, sm] = startTime.split(":").map(Number);
    const [eh, em] = endTime.split(":").map(Number);
    const inTs = dayStart + (sh * 60 + sm) * 60000;
    let outTs = dayStart + (eh * 60 + em) * 60000;
    if (outTs <= inTs) outTs += 24 * 60 * 60000;
    const inEntry = { id: uid(), employeeId, type: "in", timestamp: inTs };
    const outEntry = { id: uid(), employeeId, type: "out", timestamp: outTs };
    await savePunches([...punches, inEntry, outEntry]);
  };

  const lastPunchFor = (empId) => {
    const mine = punches.filter((p) => p.employeeId === empId).sort((a, b) => b.timestamp - a.timestamp);
    return mine[0] || null;
  };

  const showToast = (msg) => {
    setToast(msg);
    setTimeout(() => setToast(null), 2600);
  };

  const handlePinSubmit = (pin) => {
    const emp = pinTarget;
    if (pin !== emp.pin) {
      setPinError("PIN errato, riprova");
      return;
    }
    setPinError("");
    setPinTarget(null);
    setPunchChoiceError("");
    setPunchType(null);
    setPunchTarget(emp);
  };

  // Il dipendente scegli sempre esplicitamente ingresso o uscita (niente più
  // toggle automatico basato sull'ultima timbratura): elimina l'ambiguità che
  // si crea quando una timbratura di troppo, per errore, lascia lo stato
  // "sbagliato" e la volta dopo il sistema indovina il tipo sbagliato.
  const choosePunchType = (type) => {
    if (type === "out" && !punchTarget.flexible) {
      const shiftEnd = activeScheduledShiftEnd(shifts, punchTarget.id, Date.now());
      if (shiftEnd && Date.now() < shiftEnd) {
        setPunchChoiceError(`Il turno finisce alle ${fmtTime(shiftEnd)}: non puoi ancora timbrare l'uscita`);
        return;
      }
    }
    setPunchChoiceError("");
    setPunchType(type);
  };

  const confirmPunch = async () => {
    const emp = punchTarget;
    const type = punchType;
    const entry = { id: uid(), employeeId: emp.id, type, timestamp: Date.now() };
    await savePunches([...punches, entry]);
    showToast(`${emp.name} — timbrata${type === "in" ? " IN" : " OUT"} alle ${fmtTime(entry.timestamp)}`);
    setPunchTarget(null);
    setPunchType(null);
  };

  const closePunchChoice = () => {
    setPunchTarget(null);
    setPunchType(null);
    setPunchChoiceError("");
  };

  const handleAdminAuth = (pin) => {
    if (pin !== adminPin) {
      setAdminErr("PIN errato");
      return;
    }
    setAdminErr("");
    setAdminAuthed(true);
    setScreen("admin");
  };

  const addEmployee = async () => {
    if (!newEmp.name.trim() || newEmp.pin.length !== 4) return;
    const entry = {
      id: uid(),
      name: newEmp.name.trim(),
      store: newEmp.store,
      pin: newEmp.pin,
      active: true,
      flexible: newEmp.flexible,
      contractHours: newEmp.contractHours ? Number(newEmp.contractHours) : null,
    };
    await saveEmployees([...(employees || []), entry]);
    setNewEmp({ name: "", store: newEmp.store, pin: "", flexible: false, contractHours: "" });
    setAddingEmp(false);
  };

  const removeEmployee = async (id) => {
    await saveEmployees(employees.filter((e) => e.id !== id));
  };

  const updateEmployee = async (id, changes) => {
    await saveEmployees(employees.map((e) => (e.id === id ? { ...e, ...changes } : e)));
  };

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center" style={{ background: C.sand }}>
        <div className="text-center">
          <img src="/icon-mark.png" alt="" className="animate-pulse mx-auto mb-2" style={{ height: 56, width: "auto" }} />
          <p className="font-normal text-sm" style={{ color: "#000" }}>Caricamento…</p>
        </div>
      </div>
    );
  }

  const storeEmployees = store ? employees.filter((e) => e.store === store && e.active !== false) : [];

  return (
    <div className="min-h-screen w-full relative" style={{ fontFamily: "'Poppins', ui-sans-serif, system-ui" }}>
      <PatternBg />
      <div className="relative" style={{ zIndex: 1 }}>
      
      {/* Header */}
      <div className="relative px-5 pt-6 pb-3 flex items-center justify-between" style={{ minHeight: 176 }}>
        {screen !== "home" ? (
          <button
            onClick={() => {
              setScreen("home");
              setStore(null);
              setAdminAuthed(false);
            }}
            className="flex items-center gap-1 px-3 py-1.5 rounded-full text-sm"
            style={{ background: C.sandLight, color: "#000" }}
          >
            <ChevronLeft size={16} /> Indietro
          </button>
        ) : (
          <div style={{ width: 34 }} />
        )}
        {screen === "home" && (
          <img
            src="/logo.png"
            alt="Hakuna Matata"
            style={{ position: "absolute", left: "50%", top: "50%", transform: "translate(-50%, -50%)", height: 64, width: "auto" }}
          />
        )}
        {screen === "home" && (
          <button
            onClick={() => setScreen("admin-auth")}
            className="p-2 rounded-full"
            style={{ background: C.sandLight }}
            aria-label="Gestione"
          >
            <Settings size={18} color={C.espresso} />
          </button>
        )}
      </div>

      {/* HOME */}
      {screen === "home" && (
        <div className="relative px-5 pt-4 pb-10 max-w-md mx-auto">
          <p className="text-center text-sm font-normal mb-6 uppercase tracking-wide" style={{ color: "#000" }}>
            no worries for the rest of your day
          </p>
          <div className="space-y-4">
            {Object.entries(STORE_META).map(([key, meta]) => {
              const count = employees.filter((e) => e.store === key && e.active !== false).length;
              return (
                <button
                  key={key}
                  onClick={() => {
                    setStore(key);
                    setScreen("store");
                  }}
                  className="w-full rounded-3xl p-5 flex items-center justify-between text-left active:scale-[0.98] transition-transform"
                  style={{ background: C.espresso, boxShadow: "0 6px 0 rgba(43,24,16,0.35)" }}
                >
                  <div>
                    <p className="text-2xl font-normal tracking-tight" style={{ color: C.sandLight }}>{meta.label}</p>
                    <p className="text-xs font-normal mt-1" style={{ color: C.sky }}>{count} in squadra</p>
                  </div>
                  <div className="rounded-2xl p-2.5" style={{ background: C.sandLight }}>
                    <Clock size={22} color={C.espresso} />
                  </div>
                </button>
              );
            })}
          </div>
        </div>
      )}

      {/* STORE - clock in/out grid */}
      {screen === "store" && (
        <div className="relative px-5 pb-10 max-w-md mx-auto">
          <div className="flex items-center justify-between mb-1">
            <h2 className="text-2xl font-normal" style={{ color: "#000" }}>{STORE_META[store].label}</h2>
            <div className="flex gap-2">
              <button
                onClick={() => {
                  setMyHoursTarget(null);
                  setMyHoursPinError("");
                  setScreen("my-hours-auth");
                }}
                className="px-3 py-1.5 rounded-full font-normal text-xs flex items-center gap-1"
                style={{ background: C.sandLight, color: "#000" }}
              >
                <Clock size={13} /> Le mie ore
              </button>
              <button
                onClick={() => {
                  setScheduleStore(store);
                  setScreen("schedule");
                }}
                className="px-3 py-1.5 rounded-full font-normal text-xs flex items-center gap-1"
                style={{ background: C.espresso, color: C.sandLight }}
              >
                <CalendarIcon size={13} /> Turni
              </button>
            </div>
          </div>
          <p className="text-xs font-normal mb-5" style={{ color: "#000" }}>Tocca il tuo nome per timbrare</p>
          {storeEmployees.length === 0 ? (
            <div className="rounded-2xl p-6 text-center" style={{ background: C.sandLight, border: `2px dashed ${C.sandDeep}` }}>
              <p className="font-normal text-sm" style={{ color: "#000" }}>Nessun dipendente configurato per questo negozio.</p>
              <p className="text-xs mt-1" style={{ color: "#000" }}>Aggiungilo da Gestione (icona ingranaggio).</p>
            </div>
          ) : (
            <div className="grid grid-cols-2 gap-3">
              {storeEmployees.map((emp) => {
                const last = lastPunchFor(emp.id);
                const isIn = last && last.type === "in";
                return (
                  <button
                    key={emp.id}
                    onClick={() => {
                      setPinTarget(emp);
                      setPinError("");
                    }}
                    className="rounded-2xl p-4 text-left active:scale-95 transition-transform"
                    style={{ background: "#fff", border: `2.5px solid ${isIn ? C.sky : C.sandDeep}` }}
                  >
                    <div
                      className="w-9 h-9 rounded-full flex items-center justify-center font-normal text-sm mb-2"
                      style={{ background: isIn ? C.sky : C.sand, color: "#000" }}
                    >
                      {emp.name.trim().charAt(0).toUpperCase()}
                    </div>
                    <p className="font-normal text-sm leading-tight" style={{ color: "#000" }}>{emp.name}</p>
                    <p className="text-[11px] font-normal mt-1" style={{ color: isIn ? "#2a8ea6" : "#000" }}>
                      {isIn ? `Dentro dalle ${fmtTime(last.timestamp)}` : "Fuori servizio"}
                    </p>
                  </button>
                );
              })}
            </div>
          )}
        </div>
      )}

      {/* ADMIN AUTH */}
      {screen === "admin-auth" && (
        <PinPad
          title="Accesso gestione"
          subtitle="Solo titolare / socio"
          error={adminErr}
          onSubmit={handleAdminAuth}
          onCancel={() => setScreen("home")}
        />
      )}

      {/* ADMIN */}
      {screen === "admin" && adminAuthed && (
        <div className="relative px-5 pb-16 max-w-md mx-auto">
          <div className="flex gap-2 mb-5">
            <button
              onClick={() => setScreen("admin")}
              className="flex-1 py-2 rounded-xl font-normal text-sm flex items-center justify-center gap-1.5"
              style={{ background: C.espresso, color: C.sandLight }}
            >
              <Users size={15} /> Dipendenti
            </button>
            <button
              onClick={() => setScreen("report")}
              className="flex-1 py-2 rounded-xl font-normal text-sm flex items-center justify-center gap-1.5"
              style={{ background: C.sandLight, color: "#000" }}
            >
              <Clock size={15} /> Presenze
            </button>
            <button
              onClick={() => setScreen("schedule-admin")}
              className="flex-1 py-2 rounded-xl font-normal text-sm flex items-center justify-center gap-1.5"
              style={{ background: C.sandLight, color: "#000" }}
            >
              <CalendarIcon size={15} /> Turni
            </button>
          </div>

          {(() => {
            const stuckIn = employees.filter((e) => {
              const last = lastPunchFor(e.id);
              return last && last.type === "in" && Date.now() - last.timestamp > FORGOTTEN_CLOCKOUT_HOURS * 3600000;
            });
            if (stuckIn.length === 0) return null;
            return (
              <div className="rounded-2xl p-3.5 mb-3" style={{ background: "#fff", border: `2px solid ${C.terracotta}` }}>
                <p className="text-xs font-normal mb-1" style={{ color: C.terracotta }}>
                  ⚠ Forse hanno dimenticato di timbrare l'uscita (ancora "dentro" da oltre {FORGOTTEN_CLOCKOUT_HOURS} ore):
                </p>
                {stuckIn.map((e) => (
                  <p key={e.id} className="text-xs font-normal" style={{ color: "#000" }}>
                    {e.name} — dentro dalle {fmtTime(lastPunchFor(e.id).timestamp)} del {fmtDate(lastPunchFor(e.id).timestamp)}
                  </p>
                ))}
              </div>
            );
          })()}

          <div className="space-y-2.5">
            {employees.length === 0 && (
              <p className="text-sm font-normal text-center py-4" style={{ color: "#000" }}>Nessun dipendente ancora. Aggiungine uno qui sotto.</p>
            )}
            {employees.map((emp) =>
              editEmp && editEmp.id === emp.id ? (
                <div key={emp.id} className="rounded-2xl p-4 space-y-3" style={{ background: "#fff", border: `2px solid ${C.sandDeep}` }}>
                  <input
                    autoFocus
                    value={editEmp.name}
                    onChange={(e) => setEditEmp((v) => ({ ...v, name: e.target.value }))}
                    placeholder="Nome"
                    className="w-full px-3 py-2 rounded-xl font-normal text-sm outline-none"
                    style={{ background: C.sand, color: "#000" }}
                  />
                  <div className="flex gap-2">
                    {Object.entries(STORE_META).map(([key, meta]) => (
                      <button
                        key={key}
                        onClick={() => setEditEmp((v) => ({ ...v, store: key }))}
                        className="flex-1 py-2 rounded-xl font-normal text-xs"
                        style={{
                          background: editEmp.store === key ? C.espresso : C.sand,
                          color: editEmp.store === key ? C.sandLight : "#000",
                        }}
                      >
                        {meta.label}
                      </button>
                    ))}
                  </div>
                  <input
                    value={editEmp.pin}
                    onChange={(e) => setEditEmp((v) => ({ ...v, pin: e.target.value.replace(/\D/g, "").slice(0, 4) }))}
                    placeholder="PIN a 4 cifre"
                    inputMode="numeric"
                    className="w-full px-3 py-2 rounded-xl font-normal text-sm outline-none"
                    style={{ background: C.sand, color: "#000" }}
                  />
                  <input
                    value={editEmp.contractHours}
                    onChange={(e) => setEditEmp((v) => ({ ...v, contractHours: e.target.value.replace(/[^0-9.]/g, "") }))}
                    placeholder="Ore da contratto a settimana (facoltativo)"
                    inputMode="decimal"
                    className="w-full px-3 py-2 rounded-xl font-normal text-sm outline-none"
                    style={{ background: C.sand, color: "#000" }}
                  />
                  <label className="flex items-center gap-2.5 px-1 py-1">
                    <input
                      type="checkbox"
                      checked={editEmp.flexible}
                      onChange={(e) => setEditEmp((v) => ({ ...v, flexible: e.target.checked }))}
                      className="w-4 h-4"
                    />
                    <span className="text-xs font-normal" style={{ color: "#000" }}>
                      Orario libero (es. laboratorio): niente turni fissi, le ore timbrate contano sempre come standard
                    </span>
                  </label>
                  <div className="flex gap-2">
                    <button
                      onClick={() => setEditEmp(null)}
                      className="flex-1 py-2 rounded-xl font-normal text-sm"
                      style={{ background: C.sand, color: "#000" }}
                    >
                      Annulla
                    </button>
                    <button
                      onClick={async () => {
                        if (!editEmp.name.trim() || editEmp.pin.length !== 4) return;
                        await updateEmployee(emp.id, {
                          name: editEmp.name.trim(),
                          store: editEmp.store,
                          pin: editEmp.pin,
                          flexible: editEmp.flexible,
                          contractHours: editEmp.contractHours ? Number(editEmp.contractHours) : null,
                        });
                        setEditEmp(null);
                      }}
                      disabled={!editEmp.name.trim() || editEmp.pin.length !== 4}
                      className="flex-1 py-2 rounded-xl font-normal text-sm disabled:opacity-40"
                      style={{ background: C.espresso, color: C.sandLight }}
                    >
                      Salva
                    </button>
                  </div>
                </div>
              ) : (
                <div key={emp.id} className="rounded-2xl p-3.5 flex items-center justify-between" style={{ background: "#fff", border: `2px solid ${C.sandDeep}` }}>
                  <div className="flex items-center gap-2.5">
                    <span
                      className="w-3 h-3 rounded-full flex-shrink-0"
                      style={{ background: employeeColor(emp.id) }}
                    />
                    <div>
                      <p className="font-normal text-sm" style={{ color: "#000" }}>{emp.name}</p>
                      <p className="text-[11px] font-normal" style={{ color: "#000" }}>
                        {STORE_META[emp.store].label} · PIN {emp.pin}
                        {emp.flexible ? " · Orario libero" : ""}
                        {emp.contractHours ? ` · ${emp.contractHours}h/sett. da contratto` : ""}
                      </p>
                    </div>
                  </div>
                  <div className="flex gap-1.5">
                    <button
                      onClick={() => {
                        setAddingEmp(false);
                        setEditEmp({
                          id: emp.id,
                          name: emp.name,
                          store: emp.store,
                          pin: emp.pin,
                          flexible: !!emp.flexible,
                          contractHours: emp.contractHours ? String(emp.contractHours) : "",
                        });
                      }}
                      className="p-2 rounded-full"
                      style={{ background: C.sand }}
                    >
                      <Pencil size={15} color={C.espresso} />
                    </button>
                    <button
                      onClick={() => {
                        if (window.confirm(`Eliminare ${emp.name}? L'operazione non si può annullare.`)) removeEmployee(emp.id);
                      }}
                      className="p-2 rounded-full"
                      style={{ background: C.sand }}
                    >
                      <Trash2 size={15} color={C.terracotta} />
                    </button>
                  </div>
                </div>
              )
            )}
          </div>

          {!addingEmp ? (
            <button
              onClick={() => {
                setEditEmp(null);
                setAddingEmp(true);
              }}
              className="w-full mt-4 py-3 rounded-2xl font-normal text-sm flex items-center justify-center gap-2"
              style={{ background: C.sandLight, color: "#000", border: `2px dashed ${C.sandDeep}` }}
            >
              <Plus size={16} /> Aggiungi dipendente
            </button>
          ) : (
            <div className="mt-4 rounded-2xl p-4 space-y-3" style={{ background: "#fff", border: `2px solid ${C.sandDeep}` }}>
              <input
                autoFocus
                value={newEmp.name}
                onChange={(e) => setNewEmp((v) => ({ ...v, name: e.target.value }))}
                placeholder="Nome"
                className="w-full px-3 py-2 rounded-xl font-normal text-sm outline-none"
                style={{ background: C.sand, color: "#000" }}
              />
              <div className="flex gap-2">
                {Object.entries(STORE_META).map(([key, meta]) => (
                  <button
                    key={key}
                    onClick={() => setNewEmp((v) => ({ ...v, store: key }))}
                    className="flex-1 py-2 rounded-xl font-normal text-xs"
                    style={{
                      background: newEmp.store === key ? C.espresso : C.sand,
                      color: newEmp.store === key ? C.sandLight : "#000",
                    }}
                  >
                    {meta.label}
                  </button>
                ))}
              </div>
              <input
                value={newEmp.pin}
                onChange={(e) => setNewEmp((v) => ({ ...v, pin: e.target.value.replace(/\D/g, "").slice(0, 4) }))}
                placeholder="PIN a 4 cifre"
                inputMode="numeric"
                className="w-full px-3 py-2 rounded-xl font-normal text-sm outline-none"
                style={{ background: C.sand, color: "#000" }}
              />
              <input
                value={newEmp.contractHours}
                onChange={(e) => setNewEmp((v) => ({ ...v, contractHours: e.target.value.replace(/[^0-9.]/g, "") }))}
                placeholder="Ore da contratto a settimana (facoltativo)"
                inputMode="decimal"
                className="w-full px-3 py-2 rounded-xl font-normal text-sm outline-none"
                style={{ background: C.sand, color: "#000" }}
              />
              <label className="flex items-center gap-2.5 px-1 py-1">
                <input
                  type="checkbox"
                  checked={newEmp.flexible}
                  onChange={(e) => setNewEmp((v) => ({ ...v, flexible: e.target.checked }))}
                  className="w-4 h-4"
                />
                <span className="text-xs font-normal" style={{ color: "#000" }}>
                  Orario libero (es. laboratorio): niente turni fissi, le ore timbrate contano sempre come standard
                </span>
              </label>
              <div className="flex gap-2">
                <button
                  onClick={() => setAddingEmp(false)}
                  className="flex-1 py-2 rounded-xl font-normal text-sm"
                  style={{ background: C.sand, color: "#000" }}
                >
                  Annulla
                </button>
                <button
                  onClick={addEmployee}
                  disabled={!newEmp.name.trim() || newEmp.pin.length !== 4}
                  className="flex-1 py-2 rounded-xl font-normal text-sm disabled:opacity-40"
                  style={{ background: C.espresso, color: C.sandLight }}
                >
                  Salva
                </button>
              </div>
            </div>
          )}

          <div className="mt-8 rounded-2xl p-4" style={{ background: C.sandLight, border: `2px solid ${C.sandDeep}` }}>
            <p className="font-normal text-sm mb-2" style={{ color: "#000" }}>PIN di gestione</p>
            <ChangeAdminPin current={adminPin} onSave={saveAdminPin} />
          </div>
        </div>
      )}

      {/* REPORT */}
      {screen === "report" && adminAuthed && (
        <ReportView employees={employees} punches={punches} shifts={shifts} onBackToAdmin={() => setScreen("admin")} onGoToSchedule={() => setScreen("schedule-admin")} onAddManualPunch={addManualPunch} />
      )}

      {/* SCHEDULE - read-only view for employees, opened from the store screen */}
      {screen === "schedule" && (
        <div className="relative px-5 pb-10 max-w-md mx-auto">
          <h2 className="text-2xl font-normal mb-1" style={{ color: "#000" }}>Turni · {STORE_META[store].label}</h2>
          <p className="text-xs font-normal mb-5" style={{ color: "#000" }}>Tocca un giorno per vedere chi lavora</p>
          <ScheduleCalendar
            store={store}
            employees={employees.filter((e) => e.store === store && e.active !== false)}
            shifts={shifts}
            editable={false}
          />
        </div>
      )}

      {/* MY HOURS - PIN check, own personal PIN, then own hours */}
      {screen === "my-hours-auth" && (
        <PinPad
          title="Le mie ore"
          subtitle="Inserisci il tuo PIN personale"
          error={myHoursPinError}
          onSubmit={(pin) => {
            const match = employees.find(
              (e) => e.store === store && e.active !== false && e.pin === pin
            );
            if (!match) {
              setMyHoursPinError("PIN non riconosciuto");
              return;
            }
            setMyHoursPinError("");
            setMyHoursTarget(match);
            setScreen("my-hours");
          }}
          onCancel={() => setScreen("store")}
        />
      )}

      {screen === "my-hours" && myHoursTarget && (
        <MyHoursView
          employee={myHoursTarget}
          punches={punches}
          shifts={shifts}
          onBack={() => {
            setMyHoursTarget(null);
            setScreen("store");
          }}
        />
      )}

      {/* SCHEDULE ADMIN - editable, for Mattia/Gabriele */}
      {screen === "schedule-admin" && adminAuthed && (
        <div className="relative px-5 pb-16 max-w-md mx-auto">
          <div className="flex gap-2 mb-5">
            <button
              onClick={() => setScreen("admin")}
              className="flex-1 py-2 rounded-xl font-normal text-sm flex items-center justify-center gap-1.5"
              style={{ background: C.sandLight, color: "#000" }}
            >
              <Users size={15} /> Dipendenti
            </button>
            <button
              onClick={() => setScreen("report")}
              className="flex-1 py-2 rounded-xl font-normal text-sm flex items-center justify-center gap-1.5"
              style={{ background: C.sandLight, color: "#000" }}
            >
              <Clock size={15} /> Presenze
            </button>
            <button
              className="flex-1 py-2 rounded-xl font-normal text-sm flex items-center justify-center gap-1.5"
              style={{ background: C.espresso, color: C.sandLight }}
            >
              <CalendarIcon size={15} /> Turni
            </button>
          </div>

          <div className="flex gap-2 mb-4">
            {Object.entries(STORE_META).map(([key, meta]) => (
              <button
                key={key}
                onClick={() => setScheduleStore(key)}
                className="flex-1 py-2 rounded-xl font-normal text-xs"
                style={{
                  background: scheduleStore === key ? C.espresso : C.sandLight,
                  color: scheduleStore === key ? C.sandLight : "#000",
                }}
              >
                {meta.label}
              </button>
            ))}
          </div>

          <ScheduleCalendar
            store={scheduleStore}
            employees={employees.filter((e) => e.store === scheduleStore && e.active !== false)}
            shifts={shifts}
            editable={true}
            onAddShift={async (shift) => {
              await saveShifts([...(shifts || []), { id: uid(), ...shift }]);
            }}
            onRemoveShift={async (id) => {
              await saveShifts(shifts.filter((s) => s.id !== id));
            }}
            onAddShifts={async (newShiftsArr) => {
              const withIds = newShiftsArr.map((s) => ({ id: uid(), ...s }));
              await saveShifts([...(shifts || []), ...withIds]);
            }}
          />
        </div>
      )}

      {/* PIN modal for clocking */}
      {pinTarget && (
        <PinPad
          title={pinTarget.name}
          subtitle="Inserisci il tuo PIN"
          error={pinError}
          onSubmit={handlePinSubmit}
          onCancel={() => {
            setPinTarget(null);
            setPinError("");
          }}
        />
      )}

      {/* Scelta ingresso/uscita + conferma, dopo il PIN */}
      {punchTarget && (
        <PunchChoice
          employee={punchTarget}
          type={punchType}
          error={punchChoiceError}
          onChooseIn={() => choosePunchType("in")}
          onChooseOut={() => choosePunchType("out")}
          onConfirm={confirmPunch}
          onCancelConfirm={() => setPunchType(null)}
          onClose={closePunchChoice}
        />
      )}

      {/* Toast */}
      {toast && (
        <div className="fixed bottom-5 left-1/2 -translate-x-1/2 px-5 py-3 rounded-2xl font-normal text-sm flex items-center gap-2 z-50" style={{ background: C.espresso, color: C.sandLight }}>
          <Check size={16} color={C.sky} /> {toast}
        </div>
      )}
      </div>
    </div>
  );
}

function ScheduleCalendar({ store, employees, shifts, editable, onAddShift, onRemoveShift, onAddShifts }) {
  const [monthStart, setMonthStart] = useState(startOfMonth(Date.now()));
  const [selectedDay, setSelectedDay] = useState(null); // timestamp of midnight for that day
  const [formEmp, setFormEmp] = useState("");
  const [formStart, setFormStart] = useState("09:00");
  const [formEnd, setFormEnd] = useState("13:00");
  const [showRecurring, setShowRecurring] = useState(false);
  const [recEmp, setRecEmp] = useState("");
  const [recDays, setRecDays] = useState([]); // 0=Lun ... 6=Dom
  const [recStart, setRecStart] = useState("09:00");
  const [recEnd, setRecEnd] = useState("13:00");

  const total = daysInMonth(monthStart);
  const monthDate = new Date(monthStart);
  const firstWeekday = (new Date(monthDate.getFullYear(), monthDate.getMonth(), 1).getDay() + 6) % 7; // Mon=0

  const shiftsForStore = (shifts || []).filter((s) => s.store === store);
  const shiftsByDay = {};
  shiftsForStore.forEach((s) => {
    shiftsByDay[s.day] = shiftsByDay[s.day] || [];
    shiftsByDay[s.day].push(s);
  });

  const cells = [];
  for (let i = 0; i < firstWeekday; i++) cells.push(null);
  for (let d = 1; d <= total; d++) cells.push(d);

  const selDayIso = selectedDay ? isoDay(selectedDay) : null;
  const selDayShifts = selDayIso ? (shiftsByDay[selDayIso] || []) : [];

  const empName = (id) => (employees.find((e) => e.id === id) || {}).name || "—";

  return (
    <div>
      <div className="flex items-center justify-between mb-3">
        <button
          onClick={() => {
            setMonthStart((m) => startOfMonth(new Date(m).setMonth(new Date(m).getMonth() - 1)));
            setSelectedDay(null);
          }}
          className="px-3 py-1.5 rounded-full font-normal text-xs"
          style={{ background: C.sandLight, color: "#000" }}
        >
          ← mese prec.
        </button>
        <p className="font-normal text-xs capitalize" style={{ color: "#000" }}>{monthLabel(monthStart)}</p>
        <button
          onClick={() => {
            setMonthStart((m) => startOfMonth(new Date(m).setMonth(new Date(m).getMonth() + 1)));
            setSelectedDay(null);
          }}
          className="px-3 py-1.5 rounded-full font-normal text-xs"
          style={{ background: C.sandLight, color: "#000" }}
        >
          mese succ. →
        </button>
      </div>

      {editable && (
        <div className="mb-4">
          {!showRecurring ? (
            <button
              onClick={() => {
                setShowRecurring(true);
                setSelectedDay(null);
              }}
              className="w-full py-2 rounded-xl font-normal text-xs flex items-center justify-center gap-1.5"
              style={{ background: C.sandLight, color: "#000", border: `2px dashed ${C.sandDeep}` }}
            >
              <Plus size={14} /> Turno ricorrente
            </button>
          ) : (
            <div className="rounded-2xl p-4 space-y-3" style={{ background: "#fff", border: `2px solid ${C.sandDeep}` }}>
              <p className="text-sm font-normal" style={{ color: "#000" }}>
                Turno ricorrente — {monthLabel(monthStart)}
              </p>

              <select
                value={recEmp}
                onChange={(e) => setRecEmp(e.target.value)}
                className="w-full px-3 py-2 rounded-xl font-normal text-sm outline-none"
                style={{ background: C.sand, color: "#000" }}
              >
                <option value="">Scegli dipendente…</option>
                {employees.map((e) => (
                  <option key={e.id} value={e.id}>{e.name}</option>
                ))}
              </select>

              <div className="grid grid-cols-7 gap-1">
                {WEEKDAYS.map((w, idx) => {
                  const active = recDays.includes(idx);
                  return (
                    <button
                      key={w}
                      onClick={() =>
                        setRecDays((prev) => (active ? prev.filter((d) => d !== idx) : [...prev, idx]))
                      }
                      className="py-2 rounded-lg font-normal text-[11px]"
                      style={{
                        background: active ? C.espresso : C.sand,
                        color: active ? C.sandLight : "#000",
                      }}
                    >
                      {w}
                    </button>
                  );
                })}
              </div>

              <div className="flex gap-2 items-center">
                <input
                  type="time"
                  value={recStart}
                  onChange={(e) => setRecStart(e.target.value)}
                  className="flex-1 px-3 py-2 rounded-xl font-normal text-sm outline-none"
                  style={{ background: C.sand, color: "#000" }}
                />
                <span className="font-normal text-xs" style={{ color: "#000" }}>–</span>
                <input
                  type="time"
                  value={recEnd}
                  onChange={(e) => setRecEnd(e.target.value)}
                  className="flex-1 px-3 py-2 rounded-xl font-normal text-sm outline-none"
                  style={{ background: C.sand, color: "#000" }}
                />
              </div>

              <p className="text-[11px] font-normal" style={{ color: "#000" }}>
                Verranno creati i turni per ogni {recDays.length === 0 ? "giorno selezionato" : recDays.map((d) => WEEKDAYS[d]).join(", ")} di {monthLabel(monthStart)}.
              </p>

              <div className="flex gap-2">
                <button
                  onClick={() => {
                    setShowRecurring(false);
                    setRecEmp("");
                    setRecDays([]);
                  }}
                  className="flex-1 py-2 rounded-xl font-normal text-sm"
                  style={{ background: C.sand, color: "#000" }}
                >
                  Annulla
                </button>
                <button
                  onClick={() => {
                    if (!recEmp || recDays.length === 0) return;
                    const total = daysInMonth(monthStart);
                    const newShifts = [];
                    for (let d = 1; d <= total; d++) {
                      const ts = dayTs(monthDate.getFullYear(), monthDate.getMonth(), d);
                      const weekday = (new Date(ts).getDay() + 6) % 7; // Mon=0
                      if (recDays.includes(weekday)) {
                        newShifts.push({
                          store,
                          employeeId: recEmp,
                          day: isoDay(ts),
                          start: recStart,
                          end: recEnd,
                        });
                      }
                    }
                    onAddShifts(newShifts);
                    setShowRecurring(false);
                    setRecEmp("");
                    setRecDays([]);
                  }}
                  disabled={!recEmp || recDays.length === 0}
                  className="flex-1 py-2 rounded-xl font-normal text-sm disabled:opacity-40"
                  style={{ background: C.espresso, color: C.sandLight }}
                >
                  Crea turni
                </button>
              </div>
            </div>
          )}
        </div>
      )}

      <div className="grid grid-cols-7 gap-1 mb-1">
        {WEEKDAYS.map((w) => (
          <p key={w} className="text-center text-[10px] font-normal" style={{ color: "#000" }}>{w}</p>
        ))}
      </div>
      <div className="grid grid-cols-7 gap-1 mb-4">
        {cells.map((d, i) => {
          if (d === null) return <div key={i} />;
          const ts = dayTs(monthDate.getFullYear(), monthDate.getMonth(), d);
          const iso = isoDay(ts);
          const dayShifts = shiftsByDay[iso] || [];
          const isSelected = selectedDay === ts;
          return (
            <button
              key={i}
              onClick={() => setSelectedDay(ts)}
              className="aspect-square rounded-xl flex flex-col items-center justify-center relative"
              style={{
                background: isSelected ? C.espresso : "#fff",
                border: `1.5px solid ${C.sandDeep}`,
              }}
            >
              <span className="text-xs font-normal" style={{ color: isSelected ? C.sandLight : "#000" }}>{d}</span>
              {dayShifts.length > 0 && (
                <span className="absolute bottom-1 left-1/2 -translate-x-1/2 flex gap-0.5">
                  {dayShifts.slice(0, 4).map((s) => (
                    <span
                      key={s.id}
                      className="w-1.5 h-1.5 rounded-full"
                      style={{ background: employeeColor(s.employeeId) }}
                    />
                  ))}
                </span>
              )}
            </button>
          );
        })}
      </div>

      {selectedDay !== null && (
        <div className="rounded-2xl p-4" style={{ background: "#fff", border: `2px solid ${C.sandDeep}` }}>
          <p className="font-normal text-sm mb-3" style={{ color: "#000" }}>
            {new Date(selectedDay).toLocaleDateString("it-IT", { weekday: "long", day: "numeric", month: "long" })}
          </p>

          {selDayShifts.length === 0 ? (
            <p className="text-[12px] font-normal mb-3" style={{ color: "#000" }}>Nessun turno assegnato</p>
          ) : (
            <div className="space-y-1.5 mb-3">
              {selDayShifts.map((s) => (
                <div key={s.id} className="flex items-center justify-between rounded-xl px-3 py-2" style={{ background: C.sand }}>
                  <p className="text-xs font-normal flex items-center gap-2" style={{ color: "#000" }}>
                    <span
                      className="inline-block w-2.5 h-2.5 rounded-full flex-shrink-0"
                      style={{ background: employeeColor(s.employeeId) }}
                    />
                    {empName(s.employeeId)} <span className="font-mono font-normal" style={{ color: "#000" }}>· {s.start}–{s.end}</span>
                  </p>
                  {editable && (
                    <button onClick={() => onRemoveShift(s.id)} className="p-1 rounded-full" style={{ background: "#fff" }}>
                      <Trash2 size={13} color={C.terracotta} />
                    </button>
                  )}
                </div>
              ))}
            </div>
          )}

          {editable && employees.length > 0 && (
            <div className="space-y-2 pt-2" style={{ borderTop: `1.5px dashed ${C.sandDeep}` }}>
              <select
                value={formEmp}
                onChange={(e) => setFormEmp(e.target.value)}
                className="w-full px-3 py-2 rounded-xl font-normal text-sm outline-none"
                style={{ background: C.sand, color: "#000" }}
              >
                <option value="">Scegli dipendente…</option>
                {employees.map((e) => (
                  <option key={e.id} value={e.id}>{e.name}</option>
                ))}
              </select>
              <div className="flex gap-2 items-center">
                <input
                  type="time"
                  value={formStart}
                  onChange={(e) => setFormStart(e.target.value)}
                  className="flex-1 px-3 py-2 rounded-xl font-normal text-sm outline-none"
                  style={{ background: C.sand, color: "#000" }}
                />
                <span className="font-normal text-xs" style={{ color: "#000" }}>–</span>
                <input
                  type="time"
                  value={formEnd}
                  onChange={(e) => setFormEnd(e.target.value)}
                  className="flex-1 px-3 py-2 rounded-xl font-normal text-sm outline-none"
                  style={{ background: C.sand, color: "#000" }}
                />
              </div>
              <button
                onClick={() => {
                  if (!formEmp) return;
                  onAddShift({ store, employeeId: formEmp, day: selDayIso, start: formStart, end: formEnd });
                  setFormEmp("");
                }}
                disabled={!formEmp}
                className="w-full py-2 rounded-xl font-normal text-sm flex items-center justify-center gap-1.5 disabled:opacity-40"
                style={{ background: C.espresso, color: C.sandLight }}
              >
                <Plus size={15} /> Aggiungi turno
              </button>
            </div>
          )}
          {editable && employees.length === 0 && (
            <p className="text-[11px] font-normal" style={{ color: "#000" }}>Aggiungi prima almeno un dipendente a questo negozio.</p>
          )}
        </div>
      )}
    </div>
  );
}

function ChangeAdminPin({ current, onSave }) {
  const [val, setVal] = useState("");
  return (
    <div className="flex gap-2">
      <input
        value={val}
        onChange={(e) => setVal(e.target.value.replace(/\D/g, "").slice(0, 4))}
        placeholder={`Attuale: ${current}`}
        inputMode="numeric"
        className="flex-1 px-3 py-2 rounded-xl font-normal text-sm outline-none"
        style={{ background: "#fff", color: "#000" }}
      />
      <button
        onClick={() => {
          if (val.length === 4) {
            onSave(val);
            setVal("");
          }
        }}
        disabled={val.length !== 4}
        className="px-4 py-2 rounded-xl font-normal text-sm disabled:opacity-40"
        style={{ background: C.espresso, color: C.sandLight }}
      >
        Cambia
      </button>
    </div>
  );
}

// Confronta, settimana per settimana, le ore timbrate con le ore da contratto
// di un dipendente — usato sia nella vista admin (Presenze) sia in quella
// personale (Le mie ore). Non mostra nulla se il dipendente non ha ore da
// contratto impostate.
function WeeklyContractComparison({ standard, overtime, monthStart, total, contractHours }) {
  if (!contractHours) return null;
  const weeks = weeklyTotalsForMonth(standard, overtime, monthStart, total);
  return (
    <div className="mt-3 pt-3" style={{ borderTop: `1.5px dashed ${C.sandDeep}` }}>
      <p className="text-[10px] font-normal mb-1" style={{ color: C.maroon }}>
        Ore a settimana vs contratto ({contractHours}h/sett.)
      </p>
      {weeks.map((w) => {
        const delta = Math.round((w.total - contractHours) * 100) / 100;
        return (
          <div key={w.weekStart} className="flex items-center justify-between text-[11px] font-mono font-normal" style={{ color: "#000" }}>
            <span>Sett. dal {new Date(w.weekStart).toLocaleDateString("it-IT", { day: "2-digit", month: "2-digit" })}</span>
            <span style={{ color: delta < 0 ? C.terracotta : delta > 0 ? C.sky : "#000" }}>
              {w.total.toFixed(2).replace(".", ",")}h ({delta >= 0 ? "+" : ""}{delta.toFixed(2).replace(".", ",")})
            </span>
          </div>
        );
      })}
    </div>
  );
}

function MyHoursView({ employee, punches, shifts, onBack }) {
  const [monthStart, setMonthStart] = useState(startOfMonth(Date.now()));
  const actualBounds = actualBoundsForMonth(punches, employee.id, monthStart);
  const scheduledBounds = scheduledBoundsForMonth(shifts, employee.id, monthStart);
  const total = daysInMonth(monthStart);
  const { standard, overtime } = splitStandardOvertime(actualBounds, scheduledBounds, total, employee.flexible, monthStart);
  const workedDays = Array.from({ length: total }, (_, i) => i + 1).filter(
    (d) => (standard[d] || 0) > 0 || (overtime[d] || 0) > 0
  );
  const sumStd = Object.values(standard).reduce((a, b) => a + b, 0);
  const sumOt = Object.values(overtime).reduce((a, b) => a + b, 0);

  return (
    <div className="relative px-5 pb-10 max-w-md mx-auto">
      <button
        onClick={onBack}
        className="mb-4 px-3 py-1.5 rounded-full font-normal text-xs flex items-center gap-1"
        style={{ background: C.sandLight, color: "#000" }}
      >
        <ChevronLeft size={14} /> {STORE_META[employee.store].label}
      </button>

      <h2 className="text-2xl font-normal mb-1" style={{ color: "#000" }}>{employee.name}</h2>
      <p className="text-xs font-normal mb-5" style={{ color: "#000" }}>Le tue ore lavorate</p>

      <div className="flex items-center justify-between mb-4">
        <button
          onClick={() => setMonthStart((m) => startOfMonth(new Date(m).setMonth(new Date(m).getMonth() - 1)))}
          className="px-3 py-1.5 rounded-full font-normal text-xs"
          style={{ background: C.sandLight, color: "#000" }}
        >
          ← mese prec.
        </button>
        <p className="font-normal text-xs capitalize" style={{ color: "#000" }}>{monthLabel(monthStart)}</p>
        <button
          onClick={() => setMonthStart((m) => startOfMonth(new Date(m).setMonth(new Date(m).getMonth() + 1)))}
          className="px-3 py-1.5 rounded-full font-normal text-xs"
          style={{ background: C.sandLight, color: "#000" }}
        >
          mese succ. →
        </button>
      </div>

      <div className="rounded-2xl p-4" style={{ background: "#fff", border: `2px solid ${C.sandDeep}` }}>
        <div className="flex items-center justify-between mb-2">
          <p className="text-sm font-normal" style={{ color: "#000" }}>Totale del mese</p>
          <div className="text-right">
            <p className="font-normal text-lg" style={{ color: C.sky }}>{sumStd.toFixed(2).replace(".", ",")} h</p>
            {sumOt > 0 && (
              <p className="font-normal text-xs" style={{ color: C.terracotta }}>+{sumOt.toFixed(2).replace(".", ",")} h straord.</p>
            )}
          </div>
        </div>
        {workedDays.length === 0 ? (
          <p className="text-[11px] font-normal" style={{ color: "#000" }}>Nessuna ora registrata questo mese</p>
        ) : (
          <>
            <div className="grid grid-cols-3 gap-x-2 text-[10px] font-normal mb-1" style={{ color: C.maroon }}>
              <span>Giorno</span>
              <span className="text-right">Standard</span>
              <span className="text-right">Straord.</span>
            </div>
            {workedDays.map((d) => (
              <div key={d} className="grid grid-cols-3 gap-x-2 text-[11px] font-mono font-normal" style={{ color: "#000" }}>
                <span>Giorno {d}</span>
                <span className="text-right">{(standard[d] || 0).toFixed(2).replace(".", ",")}</span>
                <span className="text-right" style={{ color: overtime[d] > 0 ? C.terracotta : "#000" }}>
                  {(overtime[d] || 0).toFixed(2).replace(".", ",")}
                </span>
              </div>
            ))}
          </>
        )}
        <WeeklyContractComparison
          standard={standard}
          overtime={overtime}
          monthStart={monthStart}
          total={total}
          contractHours={employee.contractHours}
        />
      </div>
    </div>
  );
}

function ReportView({ employees, punches, shifts, onBackToAdmin, onGoToSchedule, onAddManualPunch }) {
  const [monthStart, setMonthStart] = useState(startOfMonth(Date.now()));
  const [showManual, setShowManual] = useState(false);
  const [manualEmp, setManualEmp] = useState("");
  const [manualDay, setManualDay] = useState(isoDay(Date.now() - 24 * 60 * 60000));
  const [manualStart, setManualStart] = useState("09:00");
  const [manualEnd, setManualEnd] = useState("13:00");

  return (
    <div className="relative px-5 pb-16 max-w-md mx-auto">
      <div className="flex gap-2 mb-5">
        <button
          onClick={onBackToAdmin}
          className="flex-1 py-2 rounded-xl font-normal text-sm flex items-center justify-center gap-1.5"
          style={{ background: C.sandLight, color: "#000" }}
        >
          <Users size={15} /> Dipendenti
        </button>
        <button
          className="flex-1 py-2 rounded-xl font-normal text-sm flex items-center justify-center gap-1.5"
          style={{ background: C.espresso, color: C.sandLight }}
        >
          <Clock size={15} /> Presenze
        </button>
        <button
          onClick={onGoToSchedule}
          className="flex-1 py-2 rounded-xl font-normal text-sm flex items-center justify-center gap-1.5"
          style={{ background: C.sandLight, color: "#000" }}
        >
          <CalendarIcon size={15} /> Turni
        </button>
      </div>

      <div className="flex items-center justify-between mb-4">
        <button
          onClick={() => setMonthStart((m) => startOfMonth(new Date(m).setMonth(new Date(m).getMonth() - 1)))}
          className="px-3 py-1.5 rounded-full font-normal text-xs"
          style={{ background: C.sandLight, color: "#000" }}
        >
          ← mese prec.
        </button>
        <p className="font-normal text-xs capitalize" style={{ color: "#000" }}>{monthLabel(monthStart)}</p>
        <button
          onClick={() => setMonthStart((m) => startOfMonth(new Date(m).setMonth(new Date(m).getMonth() + 1)))}
          className="px-3 py-1.5 rounded-full font-normal text-xs"
          style={{ background: C.sandLight, color: "#000" }}
        >
          mese succ. →
        </button>
      </div>

      {!showManual ? (
        <button
          onClick={() => setShowManual(true)}
          className="w-full mb-4 py-2.5 rounded-xl font-normal text-xs flex items-center justify-center gap-1.5"
          style={{ background: C.sandLight, color: "#000", border: `2px dashed ${C.sandDeep}` }}
        >
          <Plus size={14} /> Aggiungi timbratura manuale
        </button>
      ) : (
        <div className="mb-4 rounded-2xl p-4 space-y-3" style={{ background: "#fff", border: `2px solid ${C.sandDeep}` }}>
          <p className="text-sm font-normal" style={{ color: "#000" }}>
            Aggiungi timbratura manuale
          </p>
          <p className="text-[11px] font-normal" style={{ color: "#000" }}>
            Usalo quando qualcuno non ha potuto timbrare: aggiunge ingresso e uscita come se li avesse fatti lui.
          </p>
          <select
            value={manualEmp}
            onChange={(e) => setManualEmp(e.target.value)}
            className="w-full px-3 py-2 rounded-xl font-normal text-sm outline-none"
            style={{ background: C.sand, color: "#000" }}
          >
            <option value="">Scegli dipendente…</option>
            {employees.map((e) => (
              <option key={e.id} value={e.id}>{e.name} · {STORE_META[e.store].label}</option>
            ))}
          </select>
          <input
            type="date"
            value={manualDay}
            onChange={(e) => setManualDay(e.target.value)}
            className="w-full px-3 py-2 rounded-xl font-normal text-sm outline-none"
            style={{ background: C.sand, color: "#000" }}
          />
          <div className="flex gap-2 items-center">
            <input
              type="time"
              value={manualStart}
              onChange={(e) => setManualStart(e.target.value)}
              className="flex-1 px-3 py-2 rounded-xl font-normal text-sm outline-none"
              style={{ background: C.sand, color: "#000" }}
            />
            <span className="font-normal text-xs" style={{ color: "#000" }}>–</span>
            <input
              type="time"
              value={manualEnd}
              onChange={(e) => setManualEnd(e.target.value)}
              className="flex-1 px-3 py-2 rounded-xl font-normal text-sm outline-none"
              style={{ background: C.sand, color: "#000" }}
            />
          </div>
          <div className="flex gap-2">
            <button
              onClick={() => setShowManual(false)}
              className="flex-1 py-2 rounded-xl font-normal text-sm"
              style={{ background: C.sand, color: "#000" }}
            >
              Annulla
            </button>
            <button
              onClick={async () => {
                if (!manualEmp || !manualDay) return;
                await onAddManualPunch(manualEmp, manualDay, manualStart, manualEnd);
                setShowManual(false);
                setManualEmp("");
              }}
              disabled={!manualEmp || !manualDay}
              className="flex-1 py-2 rounded-xl font-normal text-sm disabled:opacity-40"
              style={{ background: C.espresso, color: C.sandLight }}
            >
              Aggiungi
            </button>
          </div>
        </div>
      )}

      <div className="space-y-3">
        {employees.length === 0 && (
          <p className="text-sm font-normal text-center py-4" style={{ color: "#000" }}>Nessun dipendente configurato.</p>
        )}
        {employees.map((emp) => {
          const actualBounds = actualBoundsForMonth(punches, emp.id, monthStart);
          const scheduledBounds = scheduledBoundsForMonth(shifts, emp.id, monthStart);
          const total = daysInMonth(monthStart);
          const { standard, overtime } = splitStandardOvertime(actualBounds, scheduledBounds, total, emp.flexible, monthStart);
          const workedDays = Array.from({ length: total }, (_, i) => i + 1).filter(
            (d) => (standard[d] || 0) > 0 || (overtime[d] || 0) > 0
          );
          const sumStd = Object.values(standard).reduce((a, b) => a + b, 0);
          const sumOt = Object.values(overtime).reduce((a, b) => a + b, 0);
          return (
            <div key={emp.id} className="rounded-2xl p-4" style={{ background: "#fff", border: `2px solid ${C.sandDeep}` }}>
              <div className="flex items-center justify-between mb-2">
                <div>
                  <p className="font-normal text-sm" style={{ color: "#000" }}>{emp.name}</p>
                  <p className="text-[11px] font-normal" style={{ color: "#000" }}>{STORE_META[emp.store].label}</p>
                </div>
                <div className="text-right">
                  <p className="font-normal text-lg" style={{ color: C.sky }}>{sumStd.toFixed(2).replace(".", ",")} h</p>
                  {sumOt > 0 && (
                    <p className="font-normal text-xs" style={{ color: C.terracotta }}>+{sumOt.toFixed(2).replace(".", ",")} h straord.</p>
                  )}
                </div>
              </div>

              {workedDays.length === 0 ? (
                <p className="text-[11px] font-normal mb-3" style={{ color: "#000" }}>Nessuna ora registrata questo mese</p>
              ) : (
                <div className="mb-3">
                  <div className="grid grid-cols-3 gap-x-2 text-[10px] font-normal mb-1" style={{ color: C.maroon }}>
                    <span>Giorno</span>
                    <span className="text-right">Standard</span>
                    <span className="text-right">Straord.</span>
                  </div>
                  {workedDays.map((d) => (
                    <div key={d} className="grid grid-cols-3 gap-x-2 text-[11px] font-mono font-normal" style={{ color: "#000" }}>
                      <span>Giorno {d}</span>
                      <span className="text-right">{(standard[d] || 0).toFixed(2).replace(".", ",")}</span>
                      <span className="text-right" style={{ color: overtime[d] > 0 ? C.terracotta : "#000" }}>
                        {(overtime[d] || 0).toFixed(2).replace(".", ",")}
                      </span>
                    </div>
                  ))}
                </div>
              )}

              <WeeklyContractComparison
                standard={standard}
                overtime={overtime}
                monthStart={monthStart}
                total={total}
                contractHours={emp.contractHours}
              />

              <button
                onClick={() => exportEmployeeMonthCSV(emp, punches, shifts, monthStart)}
                className="w-full py-2 rounded-xl font-normal text-xs flex items-center justify-center gap-1.5"
                style={{ background: C.sand, color: "#000" }}
              >
                <Download size={13} /> Esporta CSV del mese
              </button>
            </div>
          );
        })}
      </div>
    </div>
  );
}
