// src/components/AdminBackups.jsx
import { useEffect, useMemo, useState } from "react";
import { supabase } from "../supabaseClient";
import { toast } from "react-hot-toast";

// --- Brand colors ---
const COLORS = {
  orange: "#F39200",
  lightBlue: "#A8D2F2",
  veryLightBlue: "#CDE5F4",
  red: "#E0653A",
  blue: "#74B4DE",
  grayDark: "#434344",
  gray: "#818285",
  yellow: "#F0B357",
};

const BASE_FUNCTION_URL = "https://sxinuiwawpruwzxfcgpc.supabase.co/functions/v1";
const DISPATCH_BACKUP_URL = `${BASE_FUNCTION_URL}/dispatch-backup-workflow`;


// --- UI bits ---
function SectionHeader({ title, right }) {
  return (
    <div style={{display:"flex", alignItems:"center", justifyContent:"space-between", margin:"16px 0"}}>
      <h2 style={{fontFamily:"Urbanist, system-ui, sans-serif", fontWeight:700, color:COLORS.grayDark, margin:0}}>{title}</h2>
      <div>{right}</div>
    </div>
  );
}

function Pill({ children, tone="info" }) {
  const map = {
    info: COLORS.blue,
    warn: COLORS.yellow,
    error: COLORS.red,
    ok: "#2e7d32",
  };
  return (
    <span style={{
      background: (tone==="warn"||tone==="error") ? "#fff" : COLORS.veryLightBlue,
      border: `1px solid ${map[tone]}`,
      color: COLORS.grayDark,
      padding:"4px 8px",
      borderRadius: 999,
      fontSize:12,
      fontFamily:"Urbanist, system-ui, sans-serif",
      marginLeft:8
    }}>{children}</span>
  );
}

// --- Helpers ---
const toDateOnly = (iso) => (iso ? iso.slice(0, 10) : "");
function downloadBlob(filename, payload, type="text/plain;charset=utf-8") {
  const blob = new Blob([payload], { type });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url; a.download = filename; a.click();
  URL.revokeObjectURL(url);
}
function jsonToCsv(rows) {
  if (!rows?.length) return "";
  const headers = Object.keys(rows[0]);
  const escape = (v) => {
    if (v === null || v === undefined) return "";
    const s = typeof v === "string" ? v : JSON.stringify(v);
    return /[",\n]/.test(s) ? `"${s.replace(/"/g,'""')}"` : s;
  };
  const head = headers.map(escape).join(",");
  const body = rows.map(r => headers.map(h => escape(r[h])).join(",")).join("\n");
  return head + "\n" + body;
}
const addUtf8Bom = (text) => "\uFEFF" + text; // Excel-friendly for Turkish chars

// --- Component ---
export default function AdminBackups() {
  const [loading, setLoading] = useState(false);
  const [monthISO, setMonthISO] = useState(() => {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,"0")}`;
  });

  const [backups, setBackups] = useState([]);   // rows from v_leave_backups_with_approvals
  const [logs, setLogs] = useState([]);         // rows from v_leave_backup_logs
  const [search, setSearch] = useState("");
  const [selected, setSelected] = useState(null);
  const [leaveTypes, setLeaveTypes] = useState([]);
  const [usersById, setUsersById] = useState({});
  const [dispatching, setDispatching] = useState(false);


  // Sorting — default by run_ts/created_at_ts (so manual backups on same date sort correctly)
  const [sortField, setSortField] = useState("created_at_ts"); // "created_at_ts" | "user_name" | "user_email" | "snapshot_date"
  const [sortAsc, setSortAsc] = useState(false);

  // Month bounds (UTC) and date-only bounds for DATE column filters
  const startEnd = useMemo(() => {
    if (!monthISO) return {};
    const [y,m] = monthISO.split("-").map(Number);
    const start = new Date(Date.UTC(y, m-1, 1, 0,0,0));
    const end = new Date(Date.UTC(y, m, 1, 0,0,0)); // exclusive
    return {
      start: start.toISOString(),
      end: end.toISOString(),
      startD: toDateOnly(start.toISOString()),
      endD: toDateOnly(end.toISOString())
    };
  }, [monthISO]);

  useEffect(() => {
    const fetchAll = async () => {
      setLoading(true);
      try {
        // 1) Leave types (for pretty labels)
        const { data: lt } = await supabase.from("leave_types").select("id,name");
        setLeaveTypes(lt ?? []);

        // 2) Backups for month: filter by snapshot_date (DATE), include approvals json
        const { data: b, error: be } = await supabase
          .from("v_leave_backups_with_approvals")
          .select("id, snapshot_date, created_at_ts, run_ts, user_id, user_name, user_email, balances, approvals")
          .gte("snapshot_date", startEnd.startD)
          .lt("snapshot_date",  startEnd.endD)
          .order("snapshot_date", { ascending: false })
          .order("run_ts", { ascending: false, nullsFirst: false });

        if (be) throw be;
        setBackups(b ?? []);

        // 3) Logs for month (timestamp filters OK)
        const { data: l, error: le } = await supabase
          .from("v_leave_backup_logs")
          .select("id, created_at_ts, status, details, row_count")
          .gte("created_at_ts", startEnd.start)
          .lt("created_at_ts",  startEnd.end)
          .order("created_at_ts", { ascending: false });

        if (le) throw le;

        const logsNorm = (l ?? []).map(row => ({ ...row, details: row.details }));
        setLogs(logsNorm);

        // 4) Quick map (optional)
        const byId = {};
        (b ?? []).forEach(row => { byId[row.user_id] = { name: row.user_name, email: row.user_email }; });
        setUsersById(byId);

      } catch (e) {
        console.error(e);
        alert("Failed to load backups/logs. Check console for details.");
      } finally {
        setLoading(false);
      }
    };

    fetchAll();
  }, [startEnd.start, startEnd.end, startEnd.startD, startEnd.endD]);

  const leaveTypeName = (id) => leaveTypes.find(x=>x.id===id)?.name || id;

  // Search filter
  const filtered = useMemo(() => {
    if (!search.trim()) return backups;
    const s = search.toLowerCase();
    return backups.filter(r =>
      (r.user_name || "").toLowerCase().includes(s) ||
      (r.user_email || "").toLowerCase().includes(s)
    );
  }, [backups, search]);

  // Sorter — for time, prefer run_ts, fallback to created_at_ts
  const sorted = useMemo(() => {
    const arr = [...filtered];
    arr.sort((a,b) => {
      let va, vb;
      if (sortField === "created_at_ts") {
        va = new Date(a.run_ts || a.created_at_ts).getTime();
        vb = new Date(b.run_ts || b.created_at_ts).getTime();
      } else if (sortField === "snapshot_date") {
        va = a.snapshot_date || "";
        vb = b.snapshot_date || "";
      } else {
        va = ((a[sortField] || "") + "");
        vb = ((b[sortField] || "") + "");
      }
      if (va < vb) return sortAsc ? -1 : 1;
      if (va > vb) return sortAsc ?  1 : -1;
      return (a.id || "").localeCompare(b.id || ""); // stable tiebreaker
    });
    return arr;
  }, [filtered, sortField, sortAsc]);

const runBackupNow = async () => {
  if (dispatching) return;

  setDispatching(true);
  try {
    const { data } = await supabase.auth.getSession();
    const token = data?.session?.access_token;

    if (!token) {
      toast.error("No session found. Please log in again.");
      return;
    }

    const res = await fetch(DISPATCH_BACKUP_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({}),
    });

    const payload = await res.json().catch(() => ({}));

    if (!res.ok || payload?.ok !== true) {
      throw new Error(payload?.error || "Failed to trigger backup workflow");
    }

    toast.success("Backup workflow triggered on GitHub.");
  } catch (e) {
    console.error(e);
    toast.error(e.message || "Failed to trigger backup workflow");
  } finally {
    setDispatching(false);
  }
};


  // --- Exports ---
  const exportMonthCSV = () => {
    const rows = sorted.map(r => ({
      snapshot_date: r.snapshot_date,
      run_time_utc: r.run_ts ? new Date(r.run_ts).toISOString().replace(".000Z","Z") : "",
      user_name: r.user_name,
      user_email: r.user_email,
      balances: Object.entries(r.balances || {})
        .map(([k,v]) => `${leaveTypeName(k)}: ${v}`)
        .join(" | "),
      approvals_not_deducted: Object.entries(r.approvals || {})
        .map(([k,v]) => `${leaveTypeName(k)}: ${v}`)
        .join(" | "),
    }));
    const csv = jsonToCsv(rows);
    downloadBlob(`leave-backups-${monthISO}.csv`, addUtf8Bom(csv), "text/csv;charset=utf-8");
  };

  const exportMonthJSON = () => {
    downloadBlob(
      `leave-backups-${monthISO}.json`,
      JSON.stringify(sorted, null, 2),
      "application/json;charset=utf-8"
    );
  };

  const exportOneCSV = (row) => {
    const rows = [{
      snapshot_date: row.snapshot_date,
      run_time_utc: row.run_ts ? new Date(row.run_ts).toISOString().replace(".000Z","Z") : "",
      user_name: row.user_name,
      user_email: row.user_email,
      // Wide columns: balances by friendly leave type name
      ...Object.fromEntries(Object.entries(row.balances||{}).map(([k,v]) => [leaveTypeName(k), v])),
      // And approvals as "<Leave Type> (approved)"
      ...Object.fromEntries(Object.entries(row.approvals||{}).map(([k,v]) => [`${leaveTypeName(k)} (approved)`, v])),
    }];
    const csv = jsonToCsv(rows);
    // include time to make filename unique when same snapshot_date has multiple runs
    const timeSuffix = row.run_ts ? "_" + new Date(row.run_ts).toISOString().slice(11,19).replace(/:/g,"") : "";
    downloadBlob(
      `leave-backup-${row.user_email}-${row.snapshot_date}${timeSuffix}.csv`,
      addUtf8Bom(csv),
      "text/csv;charset=utf-8"
    );
  };

  const exportOneJSON = (row) => {
    const timeSuffix = row.run_ts ? "_" + new Date(row.run_ts).toISOString().slice(11,19).replace(/:/g,"") : "";
    downloadBlob(
      `leave-backup-${row.user_email}-${row.snapshot_date}${timeSuffix}.json`,
      JSON.stringify(row, null, 2),
      "application/json;charset=utf-8"
    );
  };

  return (
    <div style={{padding:"16px"}}>
      <SectionHeader
        title="Leave Balance Backups"
        right={
          <div style={{display:"flex", gap:8, alignItems:"center"}}>
            <input
              type="month"
              value={monthISO}
              onChange={e=>setMonthISO(e.target.value)}
              style={{border:"1px solid #ddd", borderRadius:8, padding:"6px 10px", fontFamily:"Urbanist, system-ui, sans-serif"}}
              aria-label="Filter by month"
              title="Filter by month"
            />
            <input
              placeholder="Search name or email…"
              value={search}
              onChange={e=>setSearch(e.target.value)}
              style={{border:"1px solid #ddd", borderRadius:8, padding:"6px 10px", fontFamily:"Urbanist, system-ui, sans-serif", minWidth:240}}
            />
            <button
  onClick={runBackupNow}
  disabled={dispatching}
  style={{
    padding: "8px 12px",
    borderRadius: 8,
    border: `1px solid ${COLORS.red}`,
    background: dispatching ? COLORS.veryLightBlue : "#fff",
    color: COLORS.grayDark,
    fontFamily: "Urbanist, system-ui",
    opacity: dispatching ? 0.7 : 1,
    cursor: dispatching ? "not-allowed" : "pointer",
  }}
  title="Trigger the GitHub Action manually"
>
  {dispatching ? "Triggering…" : "Run Backup Now"}
</button>
<button
              onClick={exportMonthCSV}
              style={{padding:"8px 12px", borderRadius:8, border:`1px solid ${COLORS.orange}`, background:"#fff", color:COLORS.grayDark, fontFamily:"Urbanist, system-ui"}}
              title="Export current view as CSV"
            >
              Export CSV
            </button>
            <button
              onClick={exportMonthJSON}
              style={{padding:"8px 12px", borderRadius:8, border:`1px solid ${COLORS.blue}`, background:"#fff", color:COLORS.grayDark, fontFamily:"Urbanist, system-ui"}}
              title="Export current view as JSON"
            >
              Export JSON
            </button>
          </div>
        }
      />

      <div style={{background: "#fff", border:`1px solid ${COLORS.lightBlue}`, borderRadius:12, overflow:"hidden"}}>
        <div style={{display:"grid", gridTemplateColumns:"220px 1fr 1fr 160px 140px", gap:0, background:COLORS.veryLightBlue, padding:"10px 12px", fontWeight:600, fontFamily:"Urbanist"}}>
          <div>
            <button
              onClick={() => { setSortAsc(sortField==="user_name" ? !sortAsc : true); setSortField("user_name"); }}
              style={{border:"none", background:"transparent", fontWeight:600, cursor:"pointer"}}
            >
              User {sortField==="user_name" ? (sortAsc ? "▲" : "▼") : ""}
            </button>
          </div>
          <div>Balances (by leave type)</div>
          <div>Approved (not deducted)</div>
          <div>
            <button
              onClick={() => { setSortAsc(sortField==="created_at_ts" ? !sortAsc : false); setSortField("created_at_ts"); }}
              style={{border:"none", background:"transparent", fontWeight:600, cursor:"pointer"}}
              title="Sort by run time (or snapshot time)"
            >
              Created At {sortField==="created_at_ts" ? (sortAsc ? "▲" : "▼") : ""}
            </button>
          </div>
          <div style={{textAlign:"right"}}>Actions</div>
        </div>

        {loading && <div style={{padding:16, fontFamily:"Urbanist"}}>Loading…</div>}

        {!loading && sorted.length === 0 && (
          <div style={{padding:16, fontFamily:"Urbanist", color:COLORS.gray}}>No backups found for this period.</div>
        )}

        {!loading && sorted.map(row => (
          <div key={row.id} style={{display:"grid", gridTemplateColumns:"220px 1fr 1fr 160px 140px", gap:0, padding:"10px 12px", borderTop:"1px solid #eee", alignItems:"center"}}>
            <div style={{display:"flex", flexDirection:"column"}}>
              <strong style={{fontFamily:"Urbanist"}}>{row.user_name || "(no name)"}</strong>
              <span style={{fontFamily:"Calibri, system-ui", fontSize:12, color:COLORS.gray}}>{row.user_email}</span>
            </div>

            {/* Balances */}
            <div style={{fontFamily:"Calibri, system-ui", fontSize:14}}>
              {Object.keys(row.balances||{}).length === 0 && <span style={{color:COLORS.gray}}>(empty)</span>}
              {Object.entries(row.balances||{}).map(([k,v]) => (
                <Pill key={k} tone="info">{leaveTypeName(k)}: <strong style={{marginLeft:4}}>{v}</strong></Pill>
              ))}
            </div>

            {/* Approved (not deducted) */}
            <div style={{fontFamily:"Calibri, system-ui", fontSize:14}}>
              {Object.keys(row.approvals||{}).length === 0 && <span style={{color:COLORS.gray}}>(none)</span>}
              {Object.entries(row.approvals||{}).map(([k,v]) => (
                <Pill key={k} tone="warn">{leaveTypeName(k)}: <strong style={{marginLeft:4}}>{v}</strong></Pill>
              ))}
            </div>

            {/* Snapshot date with run time subtext */}
            <div style={{fontFamily:"Urbanist, system-ui", fontSize:13}} title={row.run_ts ? `Run: ${new Date(row.run_ts).toISOString()}` : undefined}>
              {row.snapshot_date}
              {row.run_ts && (
                <div style={{fontSize:12, opacity:0.7}}>
                  ({new Date(row.run_ts).toISOString().slice(11,19)}Z)
                </div>
              )}
            </div>

            <div style={{display:"flex", justifyContent:"flex-end", gap:8}}>
              <button
                onClick={()=>setSelected(row)}
                style={{padding:"6px 10px", borderRadius:8, border:`1px solid ${COLORS.blue}`, background:"#fff", fontFamily:"Urbanist"}}
                title="View snapshot details"
              >
                View
              </button>
              <button
                onClick={()=>exportOneCSV(row)}
                style={{padding:"6px 10px", borderRadius:8, border:`1px solid ${COLORS.orange}`, background:"#fff", fontFamily:"Urbanist"}}
                title="Export snapshot (CSV)"
              >
                CSV
              </button>
              <button
                onClick={()=>exportOneJSON(row)}
                style={{padding:"6px 10px", borderRadius:8, border:`1px solid ${COLORS.gray}`, background:"#fff", fontFamily:"Urbanist"}}
                title="Export snapshot (JSON)"
              >
                JSON
              </button>
            </div>
          </div>
        ))}
      </div>

      <SectionHeader title="Backup Run Logs" />
      <div style={{background:"#fff", border:`1px solid ${COLORS.lightBlue}`, borderRadius:12, overflow:"hidden", marginBottom:24}}>
        <div style={{display:"grid", gridTemplateColumns:"180px 120px 1fr", gap:0, background:COLORS.veryLightBlue, padding:"10px 12px", fontWeight:600, fontFamily:"Urbanist"}}>
          <div>Timestamp (UTC)</div>
          <div>Status</div>
          <div>Details</div>
        </div>
        {logs.length===0 && <div style={{padding:16, fontFamily:"Urbanist", color:COLORS.gray}}>No logs for this period.</div>}
        {logs.map(log => (
          <div key={log.id} style={{display:"grid", gridTemplateColumns:"180px 120px 1fr", gap:0, padding:"10px 12px", borderTop:"1px solid #eee"}}>
            <div style={{fontFamily:"Urbanist"}}>{new Date(log.created_at_ts).toISOString().replace(".000Z","Z")}</div>
            <div>
              {log.status === "success" && <Pill tone="ok">success</Pill>}
              {log.status === "error" && <Pill tone="error">error</Pill>}
              {!["success","error"].includes(log.status) && <Pill tone="warn">{log.status}</Pill>}
            </div>
            <div style={{fontFamily:"Calibri, system-ui", fontSize:14, whiteSpace:"pre-wrap"}}>
              {log.row_count != null && <div><strong>Rows:</strong> {log.row_count}</div>}
              {typeof log.details === "string" ? log.details : JSON.stringify(log.details)}
            </div>
          </div>
        ))}
      </div>

      {/* Modal */}
      {selected && (
        <div
          role="dialog"
          aria-modal="true"
          onClick={()=>setSelected(null)}
          style={{
            position:"fixed", inset:0, background:"rgba(0,0,0,0.35)",
            display:"flex", alignItems:"center", justifyContent:"center", padding:16, zIndex:50
          }}
        >
          <div
            onClick={(e)=>e.stopPropagation()}
            style={{background:"#fff", borderRadius:12, maxWidth:780, width:"100%", padding:16, border:`2px solid ${COLORS.lightBlue}`}}
          >
            <div style={{display:"flex", justifyContent:"space-between", alignItems:"center", marginBottom:8}}>
              <h3 style={{margin:0, fontFamily:"Urbanist"}}>Snapshot Details</h3>
              <button
                onClick={()=>setSelected(null)}
                style={{padding:"6px 10px", borderRadius:8, border:`1px solid ${COLORS.gray}`, background:"#fff", fontFamily:"Urbanist"}}
              >Close</button>
            </div>
            <div style={{fontFamily:"Urbanist", marginBottom:12, color:COLORS.grayDark}}>
              <div><strong>User:</strong> {selected.user_name} &lt;{selected.user_email}&gt;</div>
              <div><strong>Snapshot date:</strong> {selected.snapshot_date}</div>
              <div><strong>Run time (UTC):</strong> {new Date(selected.run_ts || selected.created_at_ts).toISOString().replace(".000Z","Z")}</div>
            </div>

            <h4 style={{margin:"8px 0 6px 0", fontFamily:"Urbanist", color:COLORS.grayDark}}>Balances</h4>
            <div style={{background:COLORS.veryLightBlue, padding:12, borderRadius:8, fontFamily:"Calibri, system-ui"}}>
              {Object.entries(selected.balances||{}).map(([k,v])=>(
                <div key={k} style={{marginBottom:6}}>
                  <strong>{leaveTypeName(k)}</strong>: {v}
                </div>
              ))}
              {(!selected.balances || Object.keys(selected.balances).length===0) && <em>(No balances)</em>}
            </div>

            <h4 style={{margin:"12px 0 6px 0", fontFamily:"Urbanist", color:COLORS.grayDark}}>Approved (not deducted)</h4>
            <div style={{background:"#fff", border:`1px dashed ${COLORS.lightBlue}`, padding:12, borderRadius:8, fontFamily:"Calibri, system-ui"}}>
              {Object.entries(selected.approvals||{}).map(([k,v])=>(
                <div key={k} style={{marginBottom:6}}>
                  <strong>{leaveTypeName(k)}</strong>: {v}
                </div>
              ))}
              {(!selected.approvals || Object.keys(selected.approvals).length===0) && <em>(None)</em>}
            </div>

            <div style={{display:"flex", gap:8, marginTop:12}}>
              <button
                onClick={()=>exportOneCSV(selected)}
                style={{padding:"8px 12px", borderRadius:8, border:`1px solid ${COLORS.orange}`, background:"#fff", fontFamily:"Urbanist"}}
              >Export CSV</button>
              <button
                onClick={()=>exportOneJSON(selected)}
                style={{padding:"8px 12px", borderRadius:8, border:`1px solid ${COLORS.blue}`, background:"#fff", fontFamily:"Urbanist"}}
              >Export JSON</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
