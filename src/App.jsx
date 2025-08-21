import React, { useEffect, useMemo, useRef, useState } from "react";
import { createClient } from "@supabase/supabase-js";

/** ---------- Supabase client ---------- **/
const supabase = createClient(
  import.meta.env.VITE_SUPABASE_URL,
  import.meta.env.VITE_SUPABASE_ANON
);

/** ---------- DATE HELPERS (UTC-safe, string only) ---------- **/
const ymdToday = () => {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const da = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${da}`;
};
const parseYMD = (s) => {
  const [y, m, d] = s.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d));
};
const addDaysStr = (s, n) => {
  const d = parseYMD(s);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
};
const weekdayOfStr = (s) => parseYMD(s).getUTCDay();
const isWeekendStr = (s) => {
  const wd = weekdayOfStr(s);
  return wd === 0 || wd === 6;
};
const lastDOMForStr = (s) => {
  const d = parseYMD(s);
  d.setUTCMonth(d.getUTCMonth() + 1, 0);
  return d.getUTCDate();
};
const WEEKDAY = [
  "Sunday",
  "Monday",
  "Tuesday",
  "Wednesday",
  "Thursday",
  "Friday",
  "Saturday",
];

/** ---------- CONSTANTS ---------- **/
const PEOPLE = ["UNASSIGNED", "BRYCE", "JUSTIN", "COLE"];
const titleOf = (p) =>
  p === "UNASSIGNED" ? "Unassigned" : p[0] + p.slice(1).toLowerCase();
const sortByPri = (a, b) =>
  (a.priority ?? 999) - (b.priority ?? 999) ||
  String(a.created_at).localeCompare(String(b.created_at));

/** ---------- Recurrence rule check ---------- **/
function appliesOnDate(rule, dStr) {
  if (!rule?.type) return false;
  const wd = weekdayOfStr(dStr); // 0..6
  switch (rule.type) {
    case "daily":
      return true;
    case "weekdays":
      return wd >= 1 && wd <= 5;
    case "weekdays_set":
      return (rule.daysOfWeek || []).includes(wd);
    case "first_of_month":
      return parseInt(dStr.slice(8, 10), 10) === 1;
    case "last_of_month":
      return parseInt(dStr.slice(8, 10), 10) === lastDOMForStr(dStr);
    case "day_of_month":
      return (
        parseInt(dStr.slice(8, 10), 10) === Number(rule.dayOfMonth || 0)
      );
    default:
      return false;
  }
}

/** ---------- APP ---------- **/
export default function App() {
  // Gate 2420
  const [ok, setOk] = useState(
    () => localStorage.getItem("trelevate_gate_ok") === "1"
  );
  const [code, setCode] = useState("");

  const [date, setDate] = useState(ymdToday());
  const [typedDate, setTypedDate] = useState(ymdToday());
  const [rows, setRows] = useState([]); // tasks for current date
  const [recur, setRecur] = useState([]); // recurring templates
  const [hideCompleted, setHideCompleted] = useState({
    UNASSIGNED: false,
    BRYCE: false,
    JUSTIN: false,
    COLE: false,
  });
  const [editing, setEditing] = useState(null);
  const [showAudit, setShowAudit] = useState(false);
  const auditRef = useRef([]);

  // --- realtime subscription (tasks table) ---
  useEffect(() => {
    const channel = supabase
      .channel("trelevate-tasks")
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "tasks" },
        () => {
          // re-fetch current day when anything changes
          fetchFor(date);
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [date]);

  // load data for selected date + templates
  useEffect(() => {
    fetchTemplates();
    fetchFor(date).then(() => materialize(date));
    // eslint-disable-next-line
  }, [date]);

  async function fetchTemplates() {
    const { data, error } = await supabase
      .from("recurring")
      .select("*")
      .order("title", { ascending: true });
    if (!error) setRecur(data || []);
  }

  async function fetchFor(dStr) {
    const { data, error } = await supabase
      .from("tasks")
      .select("*")
      .eq("work_date", dStr)
      .order("assignee", { ascending: true })
      .order("priority", { ascending: true, nullsFirst: false });
    if (!error) setRows(data || []);
    return !error;
  }

  function log(action, details = {}) {
    const entry = { action, at: new Date().toISOString(), details };
    auditRef.current = [entry, ...auditRef.current].slice(0, 500);
  }

  const getNextPriority = (who) =>
    rows.filter((t) => t.assignee === who).length + 1;

  // ---------- materialize recurrence (future only) ----------
  async function materialize(dStr) {
    // ensure each matching template has a task that day
    for (const tpl of recur) {
      if (tpl.start_from && dStr < tpl.start_from) continue;
      if (tpl.recur_end && dStr > tpl.recur_end) continue;
      if (!appliesOnDate(tpl.recur_rule, dStr)) continue;

      const exists = rows.some(
        (t) => t.title === tpl.title && t.assignee === tpl.assignee
      );
      if (!exists) {
        await supabase.from("tasks").insert({
          title: tpl.title,
          assignee: tpl.assignee,
          work_date: dStr,
          due_date: null,
          priority: getNextPriority(tpl.assignee),
          completed: false,
          notes: "",
          recur_template_id: tpl.id,
          recur_rule: null,
          recur_end: null,
        });
        log("recurrence_instance", { day: dStr, template: tpl.id });
      }
    }
  }

  // ---------- CRUD ----------
  async function createTask() {
    const title = prompt("Task title?");
    if (!title) return;
    await supabase.from("tasks").insert({
      title,
      assignee: "UNASSIGNED",
      work_date: date,
      priority: getNextPriority("UNASSIGNED"),
      completed: false,
    });
    log("create");
  }

  async function removeTask(t) {
    if (!confirm("Delete this task?")) return;
    await supabase.from("tasks").delete().eq("id", t.id);
    log("delete", { id: t.id });
  }

  async function updateTask(id, patch) {
    const { data } = await supabase
      .from("tasks")
      .update({ ...patch, updated_at: new Date().toISOString() })
      .eq("id", id)
      .select()
      .single();
    return data;
  }

  async function reindexColumn(who, d = date) {
    const { data } = await supabase
      .from("tasks")
      .select("*")
      .eq("work_date", d)
      .eq("assignee", who);
    const col = (data || []).sort(sortByPri);
    for (let i = 0; i < col.length; i++) {
      const t = col[i];
      if (t.priority !== i + 1)
        await supabase.from("tasks").update({ priority: i + 1 }).eq("id", t.id);
    }
  }

  async function assignTask(task, who) {
    if (task.assignee === who) return;
    await updateTask(task.id, { assignee: who, priority: 999 });
    await reindexColumn(who);
    await reindexColumn(task.assignee);
    log("assign", { id: task.id, to: who });
  }

  async function moveDate(task, newDate) {
    await updateTask(task.id, {
      work_date: newDate,
      priority: 999,
    });
    await reindexColumn(task.assignee, newDate);
    await reindexColumn(task.assignee, date);
    log("move_date", { id: task.id, to: newDate });
  }

  async function reorder(task, dir) {
    const col = rows
      .filter((t) => t.assignee === task.assignee)
      .sort(sortByPri);
    const idx = col.findIndex((x) => x.id === task.id);
    if (idx < 0) return;
    if (dir === "up" && idx > 0) [col[idx - 1], col[idx]] = [col[idx], col[idx - 1]];
    if (dir === "down" && idx < col.length - 1)
      [col[idx + 1], col[idx]] = [col[idx], col[idx + 1]];
    for (let i = 0; i < col.length; i++) {
      await supabase.from("tasks").update({ priority: i + 1 }).eq("id", col[i].id);
    }
    log("reorder", { id: task.id, dir });
  }

  async function setPriorityExact(task, n) {
    const desired = Math.max(1, parseInt(n, 10) || 999);
    const col = rows
      .filter((t) => t.assignee === task.assignee && t.id !== task.id)
      .sort(sortByPri);
    const pos = Math.min(desired - 1, col.length);
    col.splice(pos, 0, task);
    for (let i = 0; i < col.length; i++) {
      await supabase.from("tasks").update({ priority: i + 1 }).eq("id", col[i].id);
    }
    log("reorder_set", { id: task.id, to: desired });
  }

  // ---- Recurring templates ----
  async function saveRecurringTemplate(fromTask) {
    if (!fromTask.recur_rule?.type || !fromTask.recurring) return;
    const s1 = fromTask.work_date || date;
    const s2 = ymdToday();
    const start_from = s1 > s2 ? s1 : s2;

    if (fromTask.recur_template_id) {
      await supabase
        .from("recurring")
        .update({
          title: fromTask.title,
          assignee: fromTask.assignee,
          recur_rule: fromTask.recur_rule,
          recur_end: fromTask.recur_end || null,
          start_from,
        })
        .eq("id", fromTask.recur_template_id);
    } else {
      const { data } = await supabase
        .from("recurring")
        .insert({
          title: fromTask.title,
          assignee: fromTask.assignee,
          recur_rule: fromTask.recur_rule,
          recur_end: fromTask.recur_end || null,
          start_from,
        })
        .select()
        .single();
      await updateTask(fromTask.id, { recur_template_id: data.id });
    }
    fetchTemplates();
  }

  async function removeRecurringTemplate(task) {
    if (!task.recur_template_id) return;
    await supabase.from("recurring").delete().eq("id", task.recur_template_id);
    fetchTemplates();
  }

  async function endRecurringNow(task) {
    const keyMatch = (x) =>
      task.recur_template_id
        ? x.recur_template_id === task.recur_template_id
        : x.title === task.title && x.assignee === task.assignee;

    const cutoffStr = task.work_date || ymdToday();
    const cutoffUTC = parseYMD(cutoffStr).getTime();

    // remove template
    if (task.recur_template_id)
      await supabase.from("recurring").delete().eq("id", task.recur_template_id);
    else
      await supabase
        .from("recurring")
        .delete()
        .match({ title: task.title, assignee: task.assignee });

    // delete only today+future instances
    const { data } = await supabase
      .from("tasks")
      .select("id, work_date, title, assignee, recur_template_id");
    for (const t of data || []) {
      const tUTC = parseYMD(t.work_date).getTime();
      if (tUTC >= cutoffUTC && keyMatch(t)) {
        await supabase.from("tasks").delete().eq("id", t.id);
      }
    }
  }

  // -------- Columns / filters --------
  const columns = useMemo(() => {
    const all = rows.slice();
    return {
      UNASSIGNED: all.filter((t) => t.assignee === "UNASSIGNED").sort(sortByPri),
      BRYCE: all.filter((t) => t.assignee === "BRYCE").sort(sortByPri),
      JUSTIN: all.filter((t) => t.assignee === "JUSTIN").sort(sortByPri),
      COLE: all.filter((t) => t.assignee === "COLE").sort(sortByPri),
    };
  }, [rows]);

  const filtered = (list, who) =>
    hideCompleted[who] ? list.filter((t) => !t.completed) : list;

  const prevDay = () => {
    const d = addDaysStr(date, -1);
    setDate(d);
    setTypedDate(d);
  };
  const nextDay = () => {
    const d = addDaysStr(date, 1);
    setDate(d);
    setTypedDate(d);
  };

  if (!ok) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-neutral-100">
        <div className="max-w-sm w-full bg-white p-6 rounded-2xl shadow">
          <h1 className="text-2xl font-bold mb-4">Trelevate</h1>
          <p className="mb-3 text-sm text-gray-600">Enter access code to continue.</p>
          <input
            className="w-full border rounded-xl px-3 py-2 mb-3"
            type="password"
            placeholder="Access code"
            value={code}
            onChange={(e) => setCode(e.target.value)}
          />
          <button
            className="w-full rounded-xl px-3 py-2 bg-red-800 text-white"
            onClick={() => {
              if (code === "2420") {
                localStorage.setItem("trelevate_gate_ok", "1");
                setOk(true);
              } else alert("Incorrect code");
            }}
          >
            Enter
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-neutral-100">
      <header className="px-4 py-3 bg-white shadow flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="w-9 h-9 rounded-full bg-red-800 text-white flex items-center justify-center font-bold">
            T
          </div>
          <div>
            <div className="font-semibold">Trelevate</div>
            <div className="text-xs text-gray-500">Elevate Plumbers — Realtime</div>
          </div>
        </div>

        <div className="flex items-center gap-4 pr-6">
          <button className="rounded-xl px-2 py-1 border" onClick={prevDay}>
            ◀
          </button>
          <input
            type="date"
            className="border rounded-xl px-2 py-1"
            value={date}
            onChange={(e) => {
              setDate(e.target.value);
              setTypedDate(e.target.value);
            }}
          />
        <input
            className="border rounded-xl px-2 py-1"
            value={typedDate}
            onChange={(e) => setTypedDate(e.target.value)}
            placeholder="YYYY-MM-DD"
          />
          <button
            className="rounded-xl px-2 py-1 border"
            onClick={() => {
              if (typedDate) setDate(typedDate);
            }}
          >
            Go
          </button>
          <button className="rounded-xl px-2 py-1 border" onClick={nextDay}>
            ▶
          </button>
          <button
            className="rounded-xl px-3 py-1.5 border"
            onClick={() => {
              const t = ymdToday();
              setDate(t);
              setTypedDate(t);
            }}
          >
            Today
          </button>

          <span className="ml-3 text-base font-semibold text-red-800">
            {WEEKDAY[weekdayOfStr(date)]}
          </span>
        </div>

        <div className="flex items-center gap-2">
          <button className="rounded-xl px-3 py-1.5 border" onClick={createTask}>
            New Task
          </button>
          <button
            className="rounded-xl px-3 py-1.5 border"
            onClick={() => setShowAudit(true)}
          >
            Audit Log
          </button>
        </div>
      </header>

      <main className="p-4">
        <div className="grid grid-cols-4 gap-3">
          {PEOPLE.map((p) => (
            <Column
              key={p}
              who={p}
              items={filtered(columns[p], p)}
              hide={hideCompleted[p]}
              setHide={(v) => setHideCompleted((s) => ({ ...s, [p]: v }))}
              onOpen={setEditing}
              onAssign={(t, who) => assignTask(t, who)}
              onMoveDate={(t, d) => moveDate(t, d)}
              onDelete={(t) => removeTask(t)}
              onToggle={async (t) =>
                updateTask(t.id, { completed: !t.completed })
              }
              onShift={(t, dir) => reorder(t, dir)}
              onSetPriority={(t, n) => setPriorityExact(t, n)}
            />
          ))}
        </div>
      </main>

      {editing && (
        <TaskModal
          task={editing}
          onClose={() => setEditing(null)}
          onSave={async (patch) => {
            const t = await updateTask(editing.id, patch);
            if (t.recurring && t.recur_rule?.type) await saveRecurringTemplate(t);
            if (!t.recurring && t.recur_template_id)
              await removeRecurringTemplate(t);
            setEditing(null);
            return t;
          }}
          onDelete={async () => {
            await removeTask(editing);
            setEditing(null);
          }}
          onEndRecurringNow={() => endRecurringNow(editing)}
        />
      )}

      {showAudit && (
        <AuditDrawer rows={auditRef.current} onClose={() => setShowAudit(false)} />
      )}
    </div>
  );
}

/** ---------- UI pieces (same look/feel) ---------- **/
function Column({
  who,
  items,
  hide,
  setHide,
  onOpen,
  onAssign,
  onMoveDate,
  onDelete,
  onToggle,
  onShift,
  onSetPriority,
}) {
  return (
    <div className="bg-white rounded-2xl shadow p-3 min-h-[70vh] flex flex-col">
      <div className="flex items-center justify-between mb-2">
        <h2 className="text-lg font-semibold">{titleOf(who)}</h2>
        <div className="text-sm flex items-center gap-2">
          <input
            id={`hide-${who}`}
            type="checkbox"
            checked={hide}
            onChange={(e) => setHide(e.target.checked)}
          />
          <label htmlFor={`hide-${who}`}>Hide completed</label>
        </div>
      </div>
      <div className="space-y-2 overflow-y-auto">
        {items.map((t) => (
          <TaskRow
            key={t.id}
            t={t}
            onOpen={() => onOpen(t)}
            onAssign={(p) => onAssign(t, p)}
            onMoveDate={(d) => onMoveDate(t, d)}
            onDelete={() => onDelete(t)}
            onToggle={() => onToggle(t)}
            onShift={(dir) => onShift(t, dir)}
            onSetPriority={(n) => onSetPriority(t, n)}
          />
        ))}
        {items.length === 0 && (
          <div className="text-sm text-gray-500">No tasks</div>
        )}
      </div>
    </div>
  );
}

function TaskRow({
  t,
  onOpen,
  onAssign,
  onMoveDate,
  onDelete,
  onToggle,
  onShift,
  onSetPriority,
}) {
  const [menu, setMenu] = useState(false);
  return (
    <div className={`border rounded-xl p-2 ${t.completed ? "opacity-60 line-through" : ""}`}>
      <div className="flex items-center gap-2">
        <input id={`done-${t.id}`} type="checkbox" checked={t.completed} onChange={onToggle} />
        <button className="text-left flex-1" onClick={onOpen}>
          <div className="font-medium">{t.title}</div>
          <div className="text-xs text-gray-500">Due: {t.due_date || "-"}</div>
        </button>
        <div className="flex items-center gap-1">
          <button aria-label="Move up" className="text-xs border rounded px-2" onClick={() => onShift("up")}>↑</button>
          <button aria-label="Move down" className="text-xs border rounded px-2" onClick={() => onShift("down")}>↓</button>
        </div>
        <div className="relative">
          <button className="px-2 text-xl leading-none" onClick={() => setMenu((s) => !s)} aria-label="Task menu">⋯</button>
          {menu && (
            <div className="absolute right-0 mt-1 w-48 bg-white border rounded-xl shadow p-1 z-10">
              <div className="px-2 py-1 text-xs text-gray-500">Assign</div>
              {PEOPLE.map((p) => (
                <button key={p} className="w-full text-left px-2 py-1 hover:bg-neutral-100 rounded"
                        onClick={() => { onAssign(p); setMenu(false); }}>
                  {p}
                </button>
              ))}
              <div className="px-2 py-1 text-xs text-gray-500">Move date</div>
              <button className="w-full text-left px-2 py-1 hover:bg-neutral-100 rounded"
                      onClick={() => { const d = prompt("New date YYYY-MM-DD", t.work_date); if (d) onMoveDate(d); setMenu(false); }}>
                Set date…
              </button>
              <div className="border-t my-1"></div>
              <button className="w-full text-left px-2 py-1 hover:bg-red-50 text-red-700 rounded"
                      onClick={() => { onDelete(); setMenu(false); }}>
                Delete
              </button>
            </div>
          )}
        </div>
      </div>
      <div className="flex items-center gap-2 mt-2">
        <label className="text-xs text-gray-600" htmlFor={`pri-${t.id}`}>Priority:</label>
        <input
          id={`pri-${t.id}`}
          name="priority"
          key={t.id + ":" + (t.priority ?? 999)}
          className="border rounded px-2 py-0.5 w-20"
          type="number"
          defaultValue={t.priority ?? 999}
          onBlur={(e) => onSetPriority(e.target.value)}
        />
      </div>
    </div>
  );
}

function TaskModal({ task, onClose, onSave, onDelete, onEndRecurringNow }) {
  const [t, setT] = useState(task);
  useEffect(() => setT(task), [task?.id]);
  const patch = (next) => setT((prev) => ({ ...prev, ...next }));

  return (
    <div className="fixed inset-0 bg-black/30 flex items-center justify-center" onClick={onClose}>
      <div className="w-full max-w-2xl bg-white rounded-2xl shadow p-4" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between mb-3">
          <h3 className="text-lg font-semibold">Task properties</h3>
          <div className="flex items-center gap-2">
            <button className="border rounded-xl px-3 py-1" onClick={onClose}>Close</button>
            <button className="rounded-xl px-3 py-1.5 bg-red-800 text-white" onClick={() => onSave(t)}>Save</button>
          </div>
        </div>

        <div className="grid grid-cols-2 gap-3">
          <div className="col-span-2">
            <label className="text-sm">Title</label>
            <input className="w-full border rounded-xl px-3 py-2" value={t.title || ""} onChange={(e) => patch({ title: e.target.value })} />
          </div>
          <div>
            <label className="text-sm">Assignee</label>
            <select className="w-full border rounded-xl px-3 py-2" value={t.assignee} onChange={(e) => patch({ assignee: e.target.value })}>
              {PEOPLE.map((p) => <option key={p} value={p}>{p}</option>)}
            </select>
          </div>
          <div>
            <label className="text-sm">Work date</label>
            <input type="date" className="w-full border rounded-xl px-3 py-2" value={t.work_date || ""} onChange={(e) => patch({ work_date: e.target.value })} />
          </div>
          <div>
            <label className="text-sm">Due date</label>
            <input type="date" className="w-full border rounded-xl px-3 py-2" value={t.due_date || ""} onChange={(e) => patch({ due_date: e.target.value })} />
          </div>
          <div>
            <label className="text-sm">Priority</label>
            <input type="number" className="w-full border rounded-xl px-3 py-2" value={t.priority ?? 999} onChange={(e) => patch({ priority: parseInt(e.target.value || "0", 10) })} />
          </div>

          <div className="col-span-2">
            <label className="text-sm">Notes</label>
            <textarea className="w-full border rounded-xl px-3 py-2 min-h-[100px]" value={t.notes || ""} onChange={(e) => patch({ notes: e.target.value })} />
          </div>

          <div className="col-span-2 border rounded-xl p-3">
            <div className="flex items-center justify-between">
              <label className="font-medium">Recurrence</label>
              {t.recurring && (
                <button className="text-sm underline" onClick={onEndRecurringNow}>
                  End recurring now (delete future)
                </button>
              )}
            </div>
            <div className="mt-2 grid grid-cols-2 gap-3">
              <label className="flex items-center gap-2">
                <input type="checkbox" checked={t.recurring || false} onChange={(e) => patch({ recurring: e.target.checked })} />
                Enable recurrence (future only)
              </label>
              <div>
                <label className="text-sm">Type</label>
                <select className="border rounded-xl px-2 py-1 w-full" value={t.recur_rule?.type || ""} onChange={(e) => patch({ recur_rule: { ...(t.recur_rule || {}), type: e.target.value } })}>
                  <option value="">-- Select type --</option>
                  <option value="daily">Daily</option>
                  <option value="weekdays">Weekdays (Mon–Fri)</option>
                  <option value="weekdays_set">Specific weekdays</option>
                  <option value="first_of_month">First of month</option>
                  <option value="last_of_month">Last of month</option>
                  <option value="day_of_month">Specific day of month</option>
                </select>
              </div>
              {t.recur_rule?.type === "weekdays_set" && (
                <WeekdayPicker value={t.recur_rule?.daysOfWeek || []} onChange={(v) => patch({ recur_rule: { ...(t.recur_rule || {}), daysOfWeek: v } })} />
              )}
              {t.recur_rule?.type === "day_of_month" && (
                <div>
                  <label className="text-sm">Day (1–31)</label>
                  <input type="number" min={1} max={31} className="w-full border rounded-xl px-2 py-1" value={t.recur_rule?.dayOfMonth || 1} onChange={(e) => patch({ recur_rule: { ...(t.recur_rule || {}), dayOfMonth: parseInt(e.target.value || "1", 10) } })} />
                </div>
              )}
              <div>
                <label className="text-sm">End date (optional)</label>
                <input type="date" className="w-full border rounded-xl px-2 py-1" value={t.recur_end || ""} onChange={(e) => patch({ recur_end: e.target.value })} />
              </div>
            </div>
          </div>
        </div>

        <div className="mt-4 flex items-center justify-between">
          <button className="text-red-700 underline" onClick={onDelete}>Delete task…</button>
          <div className="text-xs text-gray-500">ID: {t.id}</div>
        </div>
      </div>
    </div>
  );
}

function WeekdayPicker({ value, onChange }) {
  const days = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
  const toggle = (i) => {
    const set = new Set(value || []);
    set.has(i) ? set.delete(i) : set.add(i);
    onChange(Array.from(set).sort());
  };
  return (
    <div className="col-span-2 flex gap-2 flex-wrap">
      {days.map((d, i) => (
        <button
          key={i}
          type="button"
          className={`px-2 py-1 rounded border ${
            value?.includes(i) ? "bg-red-800 text-white" : "bg-white"
          }`}
          onClick={() => toggle(i)}
        >
          {d}
        </button>
      ))}
    </div>
  );
}

function AuditDrawer({ rows, onClose }) {
  return (
    <div className="fixed inset-0 bg-black/30 flex" onClick={onClose}>
      <div className="ml-auto h-full w-[520px] bg-white p-4 overflow-y-auto" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between mb-3">
          <h3 className="text-lg font-semibold">Audit Log</h3>
          <button className="border rounded-xl px-3 py-1" onClick={onClose}>Close</button>
        </div>
        <div className="space-y-2">
          {rows.map((r, i) => (
            <div key={i} className="border rounded-xl p-2">
              <div className="text-sm">
                <span className="font-semibold">{r.action}</span> ·{" "}
                <span className="text-gray-600">{new Date(r.at).toLocaleString()}</span>
              </div>
              {r.details && (
                <pre className="text-xs whitespace-pre-wrap mt-1 bg-neutral-50 p-2 rounded">
                  {JSON.stringify(r.details, null, 2)}
                </pre>
              )}
            </div>
          ))}
          {rows.length === 0 && <div className="text-sm text-gray-600">No entries yet.</div>}
        </div>
      </div>
    </div>
  );
}
