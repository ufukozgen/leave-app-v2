// ManagerPanel.jsx

import React, { useState, useEffect } from "react";
import { supabase } from "../supabaseClient";
import { useUser } from "./UserContext";
import { CSSTransition, SwitchTransition } from "react-transition-group";
import "../tabfade.css"; // (or wherever your fade CSS is)
import { useRef } from "react";

function formatDateTR(iso) {
  if (!iso) return "";
  const date = typeof iso === "string" ? new Date(iso) : iso;
  if (isNaN(date.getTime())) return "";
  const day = String(date.getDate()).padStart(2, "0");
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const year = date.getFullYear();
  return `${day}/${month}/${year}`;
}

function trimEmail(email) {
  // Remove @terralab.com.tr or any domain, return the local part
  return email ? email.split("@")[0] : "";
}

// Compact/ellipsis for long location/note
function ellipsis(str, max = 16) {
  if (!str) return "-";
  return str.length > max ? str.slice(0, max - 1) + "…" : str;
}

// ---- Status Colors and Labels ----
const statusColors = {
  Pending: "#F0B357",
  Approved: "#50B881",
  Deducted: "#74B4DE",
  Rejected: "#E0653A",
  Cancelled: "#818285"
};

const statusLabelsTr = {
  Pending: "Beklemede",
  Approved: "Onaylandı",
  Deducted: "Düşüldü",
  Rejected: "Reddedildi",
  Cancelled: "İptal Edildi"
};

const actionLabels = {
  approve: "Onaylanıyor...",
  reject: "Reddediliyor...",
  deduct: "Düşülüyor...",
  reverse: "Geri alınıyor..."
};



// ---- Edge Function URLs ----
const EDGE_URL = "https://sxinuiwawpruwzxfcgpc.functions.supabase.co";
const EDGE_ENDPOINTS = {
  approve: `${EDGE_URL}/approve-leave`,
  reject: `${EDGE_URL}/reject-leave`,
  deduct: `${EDGE_URL}/deduct-leave`,
  reverse: `${EDGE_URL}/reverse-leave`
};

const tabStatus = {
  pending: "Pending",
  approved: "Approved",
  deducted: "Deducted",
  rejected: "Rejected",
  cancelled: "Cancelled"
};

export default function ManagerPanel({ pendingCount, approvedCount, refreshCounts }) {
  const nodeRef = useRef(null);

  const [activeTooltip, setActiveTooltip] = useState(null);

function statusDot(color, label, rowId) {
  return (
    <span
      style={{
        display: "inline-block",
        width: 16,
        height: 16,
        borderRadius: "50%",
        background: color,
        margin: "0 auto",
        cursor: "pointer",
        verticalAlign: "middle"
      }}
      title={label}
      tabIndex={0}
      aria-label={label}
      onTouchStart={e => {
        e.stopPropagation();
        setActiveTooltip(rowId);
        setTimeout(() => setActiveTooltip(null), 1300);
      }}
      onMouseLeave={() => setActiveTooltip(null)}
      onBlur={() => setActiveTooltip(null)}
      onFocus={() => setActiveTooltip(rowId)}
    />
  );
}
  const { dbUser } = useUser();
  const [tab, setTab] = useState("pending");
  const [requests, setRequests] = useState([]);
  const [loading, setLoading] = useState(true);
  const [sortField, setSortField] = useState("start_date");
  const [sortAsc, setSortAsc] = useState(true);
  const [processing, setProcessing] = useState(null);
  const [message, setMessage] = useState("");

useEffect(() => {
  if (!dbUser?.email) return;
  setLoading(true);

  // 1. Fetch all requests for the current manager & tab
  supabase
    .from("leave_requests")
    .select("*")
    .eq("manager_email", dbUser.email)
    .eq("status", tabStatus[tab])
    .then(async ({ data: requests, error }) => {
      if (error || !requests) {
        setRequests([]);
        setLoading(false);
        return;
      }

      // 2. Get unique user_ids from these requests
      const userIds = [...new Set(requests.map(r => r.user_id))];
      if (userIds.length === 0) {
        setRequests(requests); // Just in case, but should be empty already
        setLoading(false);
        return;
      }

      // 3. Fetch leave_balances for these users
      const { data: balances } = await supabase
        .from("leave_balances")
        .select("user_id, remaining")
        .in("user_id", userIds);

      // 4. Attach balance info to each request
      const withBalances = requests.map(req => {
        const bal = balances?.find(b => b.user_id === req.user_id);
        return {
          ...req,
          remaining_days: bal?.remaining ?? 0,
        };
      });

      setRequests(withBalances);
      setLoading(false);
    });
}, [dbUser, tab]);


  async function callEdgeFunction(endpoint, bodyObj) {
    setMessage("");
    try {
      const { data } = await supabase.auth.getSession();
      const token = data?.session?.access_token;
      if (!token) throw new Error("Oturum bulunamadı!");
      const res = await fetch(endpoint, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Authorization": `Bearer ${token}`
        },
        body: JSON.stringify(bodyObj)
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || "Bir hata oluştu.");
      return { success: true, data: json };
    } catch (e) {
      setMessage(e.message);
      return { success: false };
    }
  }

  async function handleApprove(req) {
    if (req.days > (req.remaining_days ?? 0)) {
      const ok = window.confirm(
        `Dikkat: Talep edilen izin (${req.days} gün), çalışanın mevcut kalan izninden (${req.remaining_days ?? 0} gün) fazla.\n\nOnaylarsanız, çalışanın izni eksi bakiyeye düşecek. Yine de devam etmek istiyor musunuz?`
      );
      if (!ok) return;
    }
    setProcessing({ id: req.id, type: "approve" });
    const { success } = await callEdgeFunction(EDGE_ENDPOINTS.approve, { request_id: req.id });
    if (success) {
      setMessage("İzin başarıyla onaylandı.");
      setRequests(r => r.filter(x => x.id !== req.id));
      refreshCounts && refreshCounts();
    }
    setProcessing(null);
  }

  async function handleReject(req) {
    const reason = prompt("Reddetme gerekçesi (görünecek):");
    if (!reason) return;
    setProcessing({ id: req.id, type: "reject" });
    const { success } = await callEdgeFunction(EDGE_ENDPOINTS.reject, { request_id: req.id, reason });
    if (success) {
      setMessage("Talep reddedildi.");
      setRequests(r => r.filter(x => x.id !== req.id));
      refreshCounts && refreshCounts();
    }
    setProcessing(null);
  }

  async function handleDeduct(req) {
    const ok = window.confirm(
      "Bu izin talebini düşmek (kullanıldı olarak işaretlemek) istediğinize emin misiniz?\nDevam etmek istiyor musunuz?"
    );
    if (!ok) return;
    setProcessing({ id: req.id, type: "deduct" });
    const { success } = await callEdgeFunction(EDGE_ENDPOINTS.deduct, { request_id: req.id });
    if (success) {
      setMessage("İzin başarıyla düşüldü.");
      setRequests(r => r.filter(x => x.id !== req.id));
      refreshCounts && refreshCounts();
    }
    setProcessing(null);
  }

  async function handleReverse(req) {
    const ok = window.confirm(
      "Bu izin hareketini geri almak istediğinize emin misiniz?\nBu işlem, izin bakiyesini ve durumu eski haline döndürecektir."
    );
    if (!ok) return;
    setProcessing({ id: req.id, type: "reverse" });
    const { success } = await callEdgeFunction(EDGE_ENDPOINTS.reverse, { request_id: req.id });
    if (success) {
      setMessage("İzin başarıyla geri alındı.");
      setRequests(r => r.filter(x => x.id !== req.id));
      refreshCounts && refreshCounts();
    }
    setProcessing(null);
  }

  function TabBtn({ active, children, onClick, ...props }) {
    return (
      <button
        {...props}
        onClick={onClick}
        className="manager-tab-btn"
        style={{
          background: active ? "#F0B357" : "#A8D2F2",   // alternate brand yellow for active, light blue for inactive
          color: active ? "#fff" : "#434344",
          fontWeight: 700,
          fontFamily: "Urbanist, Arial, sans-serif",
          fontSize: 18,
          border: "none",
          borderRadius: 10,
          padding: "10px 10px",
          boxShadow: active ? "0 2px 8px #F0B35744" : "none",
          cursor: "pointer",
          position: "relative",
          outline: active ? "2px solid #F39200" : "none",
        }}
      >
        {children}
      </button>
    );
  }
function SortableHeader({ label, field }) {
  const isActive = sortField === field;
  const arrow = isActive ? (sortAsc ? "▲" : "▼") : "";

  return (
    <th
      onClick={() => handleSort(field)}
      style={{ ...th, cursor: "pointer", userSelect: "none" }}
    >
      {label} {arrow}
    </th>
  );
}

  // Spinner Component
  function Spinner() {
    return (
      <span style={{
        display: "inline-block",
        verticalAlign: "middle",
        marginRight: 7,
        width: 18,
        height: 18
      }}>
        <span style={{
          display: "inline-block",
          width: 16,
          height: 16,
          border: "3px solid #fff",
          borderTop: "3px solid #F39200",
          borderRadius: "50%",
          animation: "spin360 1s linear infinite"
        }} />
        <style>
          {`
            @keyframes spin360 {
              0% { transform: rotate(0deg);}
              100% { transform: rotate(360deg);}
            }
          `}
        </style>
      </span>
    );
  }

const sortedRequests = [...requests].sort((a, b) => {
  const valA = a[sortField];
  const valB = b[sortField];

  if (!valA || !valB) return 0;

  if (typeof valA === "string") {
    return sortAsc ? valA.localeCompare(valB) : valB.localeCompare(valA);
  }

  return sortAsc ? valA - valB : valB - valA;
});


  // ---- Render ----
  return (
<div className="main-content" style={{ minHeight: 580 }}>
  {/* Centered tab bar, not animated */}
  <div style={{
    display: "flex",
    justifyContent: "center",
    gap: 12,
    marginBottom: 18,
  }}>
    <TabBtn active={tab === "pending"} onClick={() => setTab("pending")}>
      Bekleyen ({pendingCount})
    </TabBtn>
    <TabBtn active={tab === "approved"} onClick={() => setTab("approved")}>
      Onaylanan ({approvedCount})
    </TabBtn>
    <TabBtn active={tab === "deducted"} onClick={() => setTab("deducted")}>
      Düşülen
    </TabBtn>
    <TabBtn active={tab === "rejected"} onClick={() => setTab("rejected")}>
      Reddedilen
    </TabBtn>
    <TabBtn active={tab === "cancelled"} onClick={() => setTab("cancelled")}>
      İptal Edilen
    </TabBtn>
  </div>

  {/* Only the body content below fades! */}
  <SwitchTransition mode="out-in">
    <CSSTransition key={tab} nodeRef={nodeRef} timeout={200} classNames="tabfade" unmountOnExit>
      <div ref={nodeRef}>
        {message && (
          <div style={{
            background: "#CDE5F4",
            color: "#434344",
            borderRadius: 8,
            padding: "8px 18px",
            fontWeight: 700,
            marginBottom: 16
          }}>{message}</div>
        )}

        {loading ? (
          <div>Yükleniyor...</div>
        ) : requests.length === 0 ? (
          <div>Gösterilecek talep yok.</div>
        ) : (
          <table style={{
            width: "100%",
            fontSize: 15,
            borderSpacing: 0,
            tableLayout: "fixed",
            minWidth: 640,
            background: "#fff"
          }}>
            <thead>
              <tr style={{ background: "#F39200", color: "#fff" }}>
                <th style={{ ...th, width: 90 }}>Kullanıcı</th>
                <SortableHeader label="Başlangıç" field="start_date" />
                <SortableHeader label="Bitiş" field="end_date" />
                <SortableHeader label="Gün" field="days" />
                <SortableHeader label="Lokasyon" field="location" />
                <SortableHeader label="Not" field="note" />
                <SortableHeader label="Talep" field="request_date" />

                <th style={{ ...th, width: 38, textAlign: "center", whiteSpace: "nowrap", fontSize: 13 }}>Durum</th>
                <th style={{ ...th, width: 44, textAlign: "center" }}>İşlem</th>
              </tr>
            </thead>
            <tbody>
              {sortedRequests.map(req => (
                <tr key={req.id} style={{
                  background: req.status === "Cancelled" ? "#f8f8f8" : "#fff",
                  borderBottom: "1px solid #eee",
                }}>
                  <td style={{ ...td, whiteSpace: "nowrap" }}>
                    {trimEmail(req.email)}
                  </td>
                  <td style={{ ...td, whiteSpace: "nowrap" }}>{formatDateTR(req.start_date)}</td>
                  <td style={{ ...td, whiteSpace: "nowrap" }}>{formatDateTR(req.end_date)}</td>
                  <td style={{ ...td, textAlign: "center" }}>{req.days}</td>
                  <td style={{
                    ...td,
                    maxWidth: 80,
                    overflow: "hidden",
                    textOverflow: "ellipsis",
                    whiteSpace: "nowrap"
                  }}
                    title={req.location}
                  >
                    {ellipsis(req.location, 16)}
                  </td>
                  <td style={{
                    ...td,
                    maxWidth: 80,
                    overflow: "hidden",
                    textOverflow: "ellipsis",
                    whiteSpace: "nowrap"
                  }}
                    title={req.note}
                  >
                    {ellipsis(req.note, 16)}
                  </td>
                  <td style={{ ...td, whiteSpace: "nowrap" }}>
                      {formatDateTR(req.request_date)}
                    </td>
                    <td style={{ ...td, textAlign: "center", position: "relative" }}>
                    {statusDot(
                      statusColors[req.status] || "#818285",
                      statusLabelsTr[req.status] || req.status,
                      req.id
                    )}
                    {activeTooltip === req.id && (
                      <div
                        style={{
                          position: "absolute",
                          left: "50%",
                          top: 18,
                          transform: "translateX(-50%)",
                          background: "#fff",
                          color: "#434344",
                          border: "1px solid #A8D2F2",
                          borderRadius: 7,
                          padding: "2px 10px",
                          fontSize: 13,
                          boxShadow: "0 2px 8px #CDE5F488",
                          whiteSpace: "nowrap",
                          zIndex: 5,
                        }}
                      >
                        {statusLabelsTr[req.status] || req.status}
                      </div>
                    )}
                  </td>
                  <td style={{
                    ...td,
                    textAlign: "center",
                    minWidth: 90,
                    position: "relative",
                    whiteSpace: "nowrap"
                  }}>
                    {processing?.id === req.id ? (
                      <div
                        style={{
                          position: "relative",
                          display: "inline-block",
                          color: actionSymbolColor(processing.type),
                          fontWeight: 700,
                          fontSize: 14,
                          minWidth: 70,
                          userSelect: "none",
                        }}
                        aria-live="polite"
                      >
                        <span
                          className="loading-spinner"
                          style={{
                            position: "absolute",
                            top: "50%",
                            left: "50%",
                            width: 20,
                            height: 20,
                            marginTop: -10,
                            marginLeft: -10,
                            opacity: 0.25,
                            zIndex: 0,
                          }}
                        />
                        <span style={{ position: "relative", zIndex: 1 }}>
                          {actionLabels[processing.type] || "İşlemde..."}
                        </span>
                      </div>
                    ) : (
                      <>
                        {tab === "pending" && (
                          <>
                            <button
                              onClick={() => handleApprove(req)}
                              disabled={!!processing}
                              style={{
                                ...actionBtn("#50B881"),
                                marginRight: 5,
                                width: 28,
                                height: 28,
                                padding: 0,
                                fontSize: 20,
                                borderRadius: "50%",
                                display: "inline-flex",
                                alignItems: "center",
                                justifyContent: "center",
                                cursor: "pointer",
                                userSelect: "none",
                              }}
                              title="Onayla"
                              aria-label="Onayla"
                            >
                              ✔
                            </button>
                            <button
                              onClick={() => handleReject(req)}
                              disabled={!!processing}
                              style={{
                                ...actionBtn("#E0653A"),
                                marginRight: 5,
                                width: 28,
                                height: 28,
                                padding: 0,
                                fontSize: 22,
                                borderRadius: "50%",
                                display: "inline-flex",
                                alignItems: "center",
                                justifyContent: "center",
                                cursor: "pointer",
                                userSelect: "none",
                              }}
                              title="Reddet"
                              aria-label="Reddet"
                            >
                              ×
                            </button>
                          </>
                        )}
                        {tab === "approved" && (
                          <>
                            <button
                              onClick={() => handleDeduct(req)}
                              disabled={!!processing}
                              style={{
                                ...actionBtn("#74B4DE"),
                                marginRight: 5,
                                width: 28,
                                height: 28,
                                padding: 0,
                                fontSize: 18,
                                borderRadius: "50%",
                                display: "inline-flex",
                                alignItems: "center",
                                justifyContent: "center",
                                cursor: "pointer",
                                userSelect: "none",
                              }}
                              title="Düş"
                              aria-label="Düş"
                            >
                              ↓
                            </button>
                            <button
                              onClick={() => handleReverse(req)}
                              disabled={!!processing}
                              style={{
                                ...actionBtn("#818285"),
                                width: 28,
                                height: 28,
                                padding: 0,
                                fontSize: 19,
                                borderRadius: "50%",
                                display: "inline-flex",
                                alignItems: "center",
                                justifyContent: "center",
                                cursor: "pointer",
                                userSelect: "none",
                              }}
                              title="Geri Al"
                              aria-label="Geri Al"
                            >
                              ↩
                            </button>
                          </>
                        )}
                        {tab === "deducted" && (
                          <button
                            onClick={() => handleReverse(req)}
                            disabled={!!processing}
                            style={{
                              ...actionBtn("#818285"),
                              width: 28,
                              height: 28,
                              padding: 0,
                              fontSize: 19,
                              borderRadius: "50%",
                              display: "inline-flex",
                              alignItems: "center",
                              justifyContent: "center",
                              cursor: "pointer",
                              userSelect: "none",
                            }}
                            title="Geri Al"
                            aria-label="Geri Al"
                          >
                            ↩
                          </button>
                        )}
                      </>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </CSSTransition>
  </SwitchTransition>
</div>

    
  );
}

// ---- styles ----
const th = {
  padding: "10px 8px",
  textAlign: "left",
  fontWeight: 700,
  fontSize: 16,
  background: "#F39200",
  color: "#fff"
};
const td = {
  padding: "8px 6px",
  verticalAlign: "middle"
};
function actionBtn(color) {
  return {
    background: color,
    color: "#fff",
    fontWeight: 700,
    padding: "6px 16px",
    border: "none",
    borderRadius: 7,
    fontSize: 16,
    marginRight: 8,
    cursor: "pointer"
  };
}

function actionSymbolColor(type) {
  switch (type) {
    case "approve":
      return "#50B881"; // green for approve
    case "reject":
      return "#E0653A"; // red for reject
    case "deduct":
      return "#74B4DE"; // blue for deduct
    case "reverse":
      return "#818285"; // gray for reverse
    default:
      return "#F39200"; // fallback orange
  }
}
