import React, { useState, useEffect } from "react";
import { supabase } from "../supabaseClient";
import { useUser } from "./UserContext";
import { toast } from "react-hot-toast";


const bluePalette = {
  headerBg: "#A8D2F2",
  headerText: "#434344",
  border: "#A8D2F2",
  bandEven: "#fff",
  bandOdd: "#CDE5F4",
};
const orangePalette = {
  headerBg: "#F39200",
  headerText: "#fff",
  border: "#F39200",
  bandEven: "#fff",
  bandOdd: "#CDE5F4",
};

const statusColors = {
  Beklemede: "#F39200",
  Onaylandı: "#50B881",
  Reddedildi: "#E0653A",
  İptal: "#818285",
  Düşüldü: "#1B75BC",
};

const statusLabels = {
  Pending: "Beklemede",
  Approved: "Onaylandı",
  Rejected: "Reddedildi",
  Cancelled: "İptal",
  Deducted: "Düşüldü",
};

const typeLabels = {
  full: "Tam Gün",
  "half-am": "Yarım Gün (Sabah)",
  "half-pm": "Yarım Gün (Öğleden Sonra)",
};

const EDGE_URL = "https://sxinuiwawpruwzxfcgpc.functions.supabase.co";
const EDGE_ENDPOINTS = {
  approve: `${EDGE_URL}/approve-leave`,
  reject: `${EDGE_URL}/reject-leave`,
  deduct: `${EDGE_URL}/deduct-leave`,
  reverse: `${EDGE_URL}/reverse-leave`
};

function formatDateTR(iso) {
  if (!iso) return "";
  const date = typeof iso === "string" ? new Date(iso) : iso;
  if (isNaN(date.getTime())) return "";
  const day = String(date.getDate()).padStart(2, "0");
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const year = date.getFullYear();
  return `${day}/${month}/${year}`;
}

function statusDot(color, label, id) {
  return (
    <span
      key={id}
      style={{
        display: "inline-block",
        width: 16,
        height: 16,
        borderRadius: "50%",
        background: color,
        marginRight: 4,
        verticalAlign: "middle",
      }}
      title={label}
      aria-label={label}
      role="img"
    />
  );
}

// Status legend now includes Düşüldü
function StatusLegend() {
  return (
    <div style={{ marginTop: 14, display: "flex", gap: 14, fontSize: 14, fontFamily: "Urbanist, Arial, sans-serif" }}>
      <span>{statusDot(statusColors["Beklemede"], "Beklemede")} Beklemede</span>
      <span>{statusDot(statusColors["Onaylandı"], "Onaylandı")} Onaylandı</span>
      <span>{statusDot(statusColors["Düşüldü"], "Düşüldü")} Düşüldü</span>
      <span>{statusDot(statusColors["Reddedildi"], "Reddedildi")} Reddedildi</span>
      <span>{statusDot(statusColors["İptal"], "İptal")} İptal</span>
    </div>
  );
}

export default function LeaveRequestList({ userId, email, title, isManagerView = false }) {
  // All hooks at the top as before
  const { dbUser, loading } = useUser();
  const [requests, setRequests] = useState([]);
  const [fetching, setFetching] = useState(true);
  const [error, setError] = useState("");
  const [cancelId, setCancelId] = useState(null);
  const [sortAsc, setSortAsc] = useState(false);
  const [activeTooltip, setActiveTooltip] = useState(null);
  const [contentVisible, setContentVisible] = useState(false);

  // New for manager actions
  const [processing, setProcessing] = useState(null);
  const [message, setMessage] = useState("");

  const palette = isManagerView ? orangePalette : bluePalette;

  // Figure out who is viewing whose requests
  // "Self" means: the current row is for the logged-in user
  const targetUserId = userId ?? dbUser?.id;
  const isSelf = !!dbUser && targetUserId === dbUser.id;

  useEffect(() => {
    setContentVisible(false);
    const timer = setTimeout(() => setContentVisible(true), 200);
    return () => clearTimeout(timer);
  }, [userId ?? dbUser?.id]);

  useEffect(() => {
    const idToUse = userId ?? dbUser?.id;
    if (!idToUse) {
      setRequests([]);
      setFetching(false);
      return;
    }
    setFetching(true);
    setError("");
    supabase
      .from("leave_requests")
      .select("*")
      .eq("user_id", idToUse)
      .order("start_date", { ascending: false })
      .then(({ data, error }) => {
        if (error) setError(error.message);
        else setRequests(data || []);
        setFetching(false);
      });
  }, [userId, dbUser]);

  async function handleCancel(req) {
  if (!window.confirm("Bu izin talebini iptal etmek istediğinize emin misiniz?")) return;
  setCancelId(req.id);

  const { data: { session } } = await supabase.auth.getSession();
  const token = session?.access_token;

  if (!token) {
    alert("Oturum doğrulanamadı, lütfen tekrar giriş yapın.");
    toast.error("Oturum doğrulanamadı, lütfen tekrar giriş yapın.");
    setCancelId(null);
    return;
  }

  const response = await fetch("https://sxinuiwawpruwzxfcgpc.functions.supabase.co/cancel-leave", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Authorization": `Bearer ${token}`
    },
    body: JSON.stringify({ request_id: req.id }),
  });

  if (response.ok) {
    await supabase.from("logs").insert([{
      user_id: dbUser.id,
      actor_email: dbUser.email,
      action: "cancel_request",
      target_table: "leave_requests",
      target_id: req.id,
      status_before: req.status,
      status_after: "Cancelled",
      details: { start_date: req.start_date, end_date: req.end_date, days: req.days }
    }]);
    setRequests(r =>
      r.map(item => (item.id === req.id ? { ...item, status: "Cancelled" } : item))
    );
    toast.success("İzin talebiniz iptal edildi.");
  } else {
    const result = await response.json();
    alert("İptal başarısız: " + (result?.error || "Bilinmeyen hata"));
    toast.error(result?.error || "İptal başarısız.");
  }
  setCancelId(null);
}

// --- MANAGER ACTIONS BELOW ---

async function handleApprove(req) {
  setProcessing({ id: req.id, type: "approve" });
  const { success } = await callEdgeFunction(EDGE_ENDPOINTS.approve, { request_id: req.id });
  if (success) {
    setRequests(r => r.map(item => item.id === req.id ? { ...item, status: "Approved" } : item));
    toast.success("İzin başarıyla onaylandı!");
  } else {
    toast.error("İzin onaylanamadı!");
  }
  setProcessing(null);
}

async function handleReject(req) {
  const reason = prompt("Reddetme gerekçesi (görünecek):");
  if (!reason) return;
  setProcessing({ id: req.id, type: "reject" });
  const { success } = await callEdgeFunction(EDGE_ENDPOINTS.reject, { request_id: req.id, reason });
  if (success) {
    setRequests(r => r.map(item => item.id === req.id ? { ...item, status: "Rejected" } : item));
    toast.success("Talep reddedildi!");
  } else {
    toast.error("Talep reddedilemedi!");
  }
  setProcessing(null);
}

async function handleDeduct(req) {
  if (!window.confirm("Bu izin talebini düşmek (kullanıldı olarak işaretlemek) istediğinize emin misiniz?")) return;
  setProcessing({ id: req.id, type: "deduct" });
  const { success } = await callEdgeFunction(EDGE_ENDPOINTS.deduct, { request_id: req.id });
  if (success) {
    setRequests(r => r.map(item => item.id === req.id ? { ...item, status: "Deducted" } : item));
    toast.success("İzin başarıyla düşüldü!");
  } else {
    toast.error("İzin düşülemedi!");
  }
  setProcessing(null);
}

async function handleReverse(req) {
  if (!window.confirm("Bu izin hareketini geri almak istediğinize emin misiniz?")) return;
  setProcessing({ id: req.id, type: "reverse" });
  const { success } = await callEdgeFunction(EDGE_ENDPOINTS.reverse, { request_id: req.id });
  if (success) {
    setRequests(r => r.map(item => item.id === req.id ? { ...item, status: "Pending" } : item));
    toast.success("İzin başarıyla geri alındı!");
  } else {
    toast.error("İzin geri alınamadı!");
  }
  setProcessing(null);
}


  // ----------- Render -----------
  if (!contentVisible) {
    return null;
  }

  return (
    <div>
      <h2
        style={{
          fontWeight: 700,
          marginBottom: 24,
          color: palette.headerBg,
          fontFamily: "Urbanist, Arial, sans-serif",
        }}
      >
        {title || "İzin Taleplerim"}
      </h2>

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

      {fetching && <p>Yükleniyor...</p>}
      {error && <p style={{ color: "#E0653A" }}>{error}</p>}

      {!fetching && requests.length === 0 && (
        <div style={{ color: "#818285", fontSize: 18 }}>
          Henüz izin talebiniz yok.
        </div>
      )}

      {!fetching && requests.length > 0 && (
        <div style={{ width: "100%", overflowX: "auto" }}>
          <table
            style={{
              width: "100%",
              fontSize: 15,
              borderSpacing: 0,
              tableLayout: "fixed",
              minWidth: 520,
              border: `2px solid ${palette.border}`,
              borderRadius: 16,
              overflow: "hidden",
            }}
          >
            <thead>
              <tr
                style={{
                  color: palette.headerText,
                  fontWeight: 600,
                  background: palette.headerBg,
                  borderBottom: `2px solid ${palette.border}`,
                }}
              >
                <th
                  style={{ width: 76, cursor: "pointer" }}
                  onClick={() => setSortAsc((v) => !v)}
                  title="Talep Tarihi ile sırala"
                >
                  Talep&nbsp;
                  <span
                    style={{
                      fontSize: 13,
                      color:
                        palette.headerText === "#fff" ? "#E0653A" : "#818285",
                    }}
                  >
                    {sortAsc ? "▲" : "▼"}
                  </span>
                </th>
                <th style={{ width: 88 }}>Başlangıç</th>
                <th style={{ width: 88 }}>Bitiş</th>
                <th style={{ width: 90 }}>Tip</th>
                <th style={{ width: 40, textAlign: "center" }}>Gün</th>
                <th style={{ width: 88 }}>Dönüş</th>
                <th style={{ width: 48, textAlign: "center" }}>Durum</th>
                <th style={{ width: 36, textAlign: "center" }}>İşlem</th>
              </tr>
            </thead>
            <tbody>
              {[...requests]
                .sort((a, b) => {
                  const aTime = new Date(a.request_date).getTime();
                  const bTime = new Date(b.request_date).getTime();
                  return sortAsc ? aTime - bTime : bTime - aTime;
                })
                .map((req, idx) => (
                  <tr
                    key={req.id}
                    style={{
                      background: idx % 2 === 0 ? palette.bandEven : palette.bandOdd,
                      borderBottom: `1px solid ${palette.border}`,
                    }}
                  >
                    <td style={{ whiteSpace: "nowrap" }}>
                      {formatDateTR(req.request_date)}
                    </td>
                    <td style={{ whiteSpace: "nowrap" }}>
                      {formatDateTR(req.start_date)}
                    </td>
                    <td style={{ whiteSpace: "nowrap" }}>
                      {formatDateTR(req.end_date)}
                    </td>
                    <td>{typeLabels[req.duration_type] || ""}</td>
                    <td style={{ textAlign: "center", whiteSpace: "nowrap" }}>
                      {req.days}
                    </td>
                    <td style={{ whiteSpace: "nowrap" }}>
                      {formatDateTR(req.return_date)}
                    </td>
                    <td style={{ textAlign: "center", position: "relative" }}>
                      {statusDot(
                        statusColors[statusLabels[req.status] || req.status] ||
                          "#818285",
                        statusLabels[req.status] || req.status,
                        req.id
                      )}
                      {activeTooltip === req.id && (
                        <div
                          style={{
                            position: "absolute",
                            left: "50%",
                            top: 20,
                            transform: "translateX(-50%)",
                            background: "#fff",
                            color: "#434344",
                            border: "1px solid #A8D2F2",
                            borderRadius: 7,
                            padding: "2px 10px",
                            fontSize: 14,
                            boxShadow: "0 2px 8px #CDE5F488",
                            whiteSpace: "nowrap",
                            zIndex: 5,
                          }}
                        >
                          {statusLabels[req.status] || req.status}
                        </div>
                      )}
                    </td>
                    <td style={{ textAlign: "center" }}>
                      {/* EMPLOYEE (SELF) VIEW: only cancel */}
                      {isSelf && (req.status === "Pending" || req.status === "Approved") && (
                        <button
                          className="cancel-button"
                          onClick={() => handleCancel(req)}
                          disabled={cancelId === req.id}
                          style={{
                            background: "none",
                            border: "none",
                            cursor: "pointer",
                            padding: 0,
                            margin: 0,
                            fontSize: 19,
                            color: "#E0653A",
                            width: 22,
                            height: 22,
                            display: "inline-flex",
                            alignItems: "center",
                            justifyContent: "center",
                            borderRadius: "50%",
                            transition: "background 0.1s",
                            verticalAlign: "middle",
                            outline: "none"
                          }}
                          title="Talebi İptal Et"
                          aria-label="Talebi İptal Et"
                        >
                          {cancelId === req.id ? (
                            <span
                              className="loading-spinner"
                              style={{
                                width: 16,
                                height: 16,
                                border: "3px solid #fff",
                                borderTop: "3px solid #E0653A",
                                borderRadius: "50%",
                                animation: "spin 0.7s linear infinite",
                              }}
                            />
                          ) : (
                            <span
                              style={{
                                fontSize: 21,
                                fontWeight: "bold",
                                lineHeight: 1,
                                display: "inline-block",
                                verticalAlign: "middle",
                                position: "relative",
                                top: 2,
                              }}
                            >
                              ×
                            </span>
                          )}
                        </button>
                      )}

                      {/* MANAGER VIEW: only for requests NOT your own */}
                      {!isSelf && isManagerView && (
                        <>
                          {req.status === "Pending" && (
                            <>
                              <button
                                onClick={() => handleApprove(req)}
                                disabled={!!processing}
                                style={{
                                  background: "#50B881",
                                  color: "#fff",
                                  border: "none",
                                  borderRadius: 7,
                                  marginRight: 6,
                                  padding: "2px 8px",
                                  fontWeight: 700,
                                  cursor: "pointer"
                                }}
                                title="Onayla"
                              >✔</button>
                              <button
                                onClick={() => handleReject(req)}
                                disabled={!!processing}
                                style={{
                                  background: "#E0653A",
                                  color: "#fff",
                                  border: "none",
                                  borderRadius: 7,
                                  marginRight: 6,
                                  padding: "2px 8px",
                                  fontWeight: 700,
                                  cursor: "pointer"
                                }}
                                title="Reddet"
                              >×</button>
                            </>
                          )}
                          {req.status === "Approved" && (
                            <>
                              <button
                                onClick={() => handleDeduct(req)}
                                disabled={!!processing}
                                style={{
                                  background: "#74B4DE",
                                  color: "#fff",
                                  border: "none",
                                  borderRadius: 7,
                                  marginRight: 6,
                                  padding: "2px 8px",
                                  fontWeight: 700,
                                  cursor: "pointer"
                                }}
                                title="Düş"
                              >↓</button>
                              <button
                                onClick={() => handleReverse(req)}
                                disabled={!!processing}
                                style={{
                                  background: "#818285",
                                  color: "#fff",
                                  border: "none",
                                  borderRadius: 7,
                                  marginRight: 6,
                                  padding: "2px 8px",
                                  fontWeight: 700,
                                  cursor: "pointer"
                                }}
                                title="Geri Al"
                              >↩</button>
                            </>
                          )}
                          {req.status === "Deducted" && (
                            <button
                              onClick={() => handleReverse(req)}
                              disabled={!!processing}
                              style={{
                                background: "#818285",
                                color: "#fff",
                                border: "none",
                                borderRadius: 7,
                                marginRight: 6,
                                padding: "2px 8px",
                                fontWeight: 700,
                                cursor: "pointer"
                              }}
                              title="Geri Al"
                            >↩</button>
                          )}
                        </>
                      )}
                    </td>
                  </tr>
                ))}
            </tbody>
          </table>
          <StatusLegend />
        </div>
      )}
    </div>
  );
}
