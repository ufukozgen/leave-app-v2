// src/components/AdminBackups.jsx
import { useEffect, useMemo, useState } from "react";
import { supabase } from "../supabaseClient";

// --- Styling helpers (brand colors) ---
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

// --- Export helpers ---
function downloadBlob(filename, payload, type="text/plain") {
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

const addUtf8Bom = (text) => "\uFEFF" + text; // for Excel + Turkish chars

// --- Core component ---
export default function AdminBackups() {
  const [loading, setLoading] = useState(false);
  const [monthISO, setMonthISO] = useState(() => {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,"0")}`;
  });
  const [backups, setBackups] = useState([]);
  const [logs, setLogs] = useState([]);
  const [search, setSearch] = useState("");
  const [selected, setSelected] = useState(null);
  const [leaveTypes, setLeaveTypes] = useState([]);
  const [usersById, setUsersById] = useState({});

  const [sortField, setSortField] = useState("created_at_ts"); // "created_at_ts" | "user_name" | "user_email"
  const [sortAsc, setSortAsc] = useState(false);

  const startEnd = useMemo(() => {
    if (!monthISO) return {};
    const [y,m] = monthISO.split("-").map(Number);
    const start = new Date(Date.UTC(y, m-1, 1, 0,0,0));
    const end = new Date(Date.UTC(y, m, 1, 0,0,0)); // exclusive
    return { start: start.toISOString(), end: end.toISOString() };
  }, [monthISO]);

  useEffect(() => {
    const fetchAll = async () => {
      setLoading(true);
      try {
        // 1) Leave types (for pretty names in balances)
        const { data: lt } = await supabase.from("leave_types").select("id,name");
        setLeaveTypes(lt ?? []);

        // 2) Backups for selected month (normalized view with timestamptz)
        const { data: b, error: be } = await supabase
          .from("v_leave_balance_backups")
          .select("id, created_at_ts, user_id, user_name, user_email, balances")
          .gte("created_at_ts", startEnd.start)
          .lt("created_at_ts",  startEnd.end)
          .order("created_at_ts", { ascending: false });

        if (be) throw be;
        setBackups(b ?? []);

        // 3) Logs for selected month (normalized view with timestamptz)
        const { data: l, error: le } = await supabase
          .from("v_leave_backup_logs")
          .select("id, created_at_ts, status, details, row_count")
          .gte("created_at_ts", startEnd.start)
          .lt("created_at_ts",  startEnd.end)
          .order("created_at_ts", { ascending: false });

        if (le) throw le;

        // 4) Normalize / set logs
        const logsNorm = (l ?? []).map(row => ({
          ...row,
          details: row.details
        }));
        setLogs(logsNorm);

        // 5) Quick user map (optional)
        const byId = {};
        (b ?? []).forEach(row => {
          byId[row.user_id] = { name: row.user_name, email: row.user_email };
        });
        setUsersById(byId);

      } catch (e) {
        console.error(e);
        alert("Failed to load backups/logs. Check console for details.");
      } finally {
        setLoading(false);
      }
    };

    fetchAll();
  }, [startEnd.start, startEnd.end]);

  const leaveTypeName = (id) => leaveTypes.find(x=>x.id===id)?.name || id;

  // Filter (search by name/email)
  const filtered = useMemo(() => {
    if (!search.trim()) return backups;
    const s = search.toLowerCase();
    return backups.filter(r =>
      (r.user_name || "").toLowerCase().includes(s) ||
      (r.user_email || "").toLowerCase().includes(s)
    );
  }, [backups, search]);

  // Sort (on top of filtered)
  const sorted = useMemo(() => {
    const arr = [...filtered];
    arr.sort((a,b) => {
      const va = sortField === "created_at_ts" ? new Date(a.created_at_ts).getTime() : ((a[sortField] || "") + "");
      const vb = sortField === "created_at_ts" ? new Date(b.created_at_ts).getTime() : ((b[sortField] || "") + "");
      if (va < vb) return sortAsc ? -1 : 1;
      if (va > vb) return sortAsc ?  1 : -1;
      return 0;
    });
    return arr;
  }, [filtered, sortField, sortAsc]);

  // --- Exports ---
  const exportMonthCSV = () => {
    const rows = sorted.map(r => ({
      created_at: new Date(r.created_at_ts).toISOString().replace(".000Z","Z"),
      user_name: r.user_name,
      user_email: r.user_email,
      balances: Object
        .entries(r.balances || {})
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
      created_at: new Date(row.created_at_ts).toISOString().replace(".000Z","Z"),
      user_name: row.user_name,
      user_email: row.user_email,
      ...Object.fromEntries(Object.entries(row.balances||{}).map(([k,v]) => [leaveTypeName(k), v])),
    }];
    const csv = jsonToCsv(rows);
    downloadBlob(
      `leave-backup-${row.user_email}-${row.created_at_ts}.csv`,
      addUtf8Bom(csv),
      "text/csv;charset=utf-8"
    );
  };

  const exportOneJSON = (row) => {
    downloadBlob(
      `leave-backup-${row.user_email}-${row.created_at_ts}.json`,
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
        <div style={{display:"grid", gridTemplateColumns:"220px 1fr 160px 140px", gap:0, background:COLORS.veryLightBlue, padding:"10px 12px", fontWeight:600, fontFamily:"Urbanist"}}>
          <div>
            <button
              onClick={() => { setSortAsc(sortField==="user_name" ? !sortAsc : true); setSortField("user_name"); }}
              style={{border:"none", background:"transparent", fontWeight:600, cursor:"pointer"}}
            >
              User {sortField==="user_name" ? (sortAsc ? "▲" : "▼") : ""}
            </button>
          </div>
          <div>Balances (by leave type)</div>
          <div>
            <button
              onClick={() => { setSortAsc(sortField==="created_at_ts" ? !sortAsc : false); setSortField("created_at_ts"); }}
              style={{border:"none", background:"transparent", fontWeight:600, cursor:"pointer"}}
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
          <div key={row.id} style={{display:"grid", gridTemplateColumns:"220px 1fr 160px 140px", gap:0, padding:"10px 12px", borderTop:"1px solid #eee", alignItems:"center"}}>
            <div style={{display:"flex", flexDirection:"column"}}>
              <strong style={{fontFamily:"Urbanist"}}>{row.user_name || "(no name)"}</strong>
              <span style={{fontFamily:"Calibri, system-ui", fontSize:12, color:COLORS.gray}}>{row.user_email}</span>
            </div>

            <div style={{fontFamily:"Calibri, system-ui", fontSize:14}}>
              {Object.keys(row.balances||{}).length === 0 && <span style={{color:COLORS.gray}}>(empty)</span>}
              {Object.entries(row.balances||{}).map(([k,v]) => (
                <Pill key={k} tone="info">{leaveTypeName(k)}: <strong style={{marginLeft:4}}>{v}</strong></Pill>
              ))}
            </div>

            <div style={{fontFamily:"Urbanist, system-ui", fontSize:13}}>{new Date(row.created_at_ts).toISOString().replace(".000Z","Z")}</div>

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
            style={{background:"#fff", borderRadius:12, maxWidth:720, width:"100%", padding:16, border:`2px solid ${COLORS.lightBlue}`}}
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
              <div><strong>Created:</strong> {new Date(selected.created_at_ts).toISOString().replace(".000Z","Z")}</div>
            </div>
            <div style={{background:COLORS.veryLightBlue, padding:12, borderRadius:8, fontFamily:"Calibri, system-ui"}}>
              {Object.entries(selected.balances||{}).map(([k,v])=>(
                <div key={k} style={{marginBottom:6}}>
                  <strong>{leaveTypeName(k)}</strong>: {v}
                </div>
              ))}
              {(!selected.balances || Object.keys(selected.balances).length===0) && <em>(No balances)</em>}
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
