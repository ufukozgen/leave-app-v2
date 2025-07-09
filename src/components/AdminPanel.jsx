import React, { useState, useEffect } from "react";
import { supabase } from "../supabaseClient";
import { useUser } from "./UserContext";

const EDGE_FUNCTION_URL = "https://sxinuiwawpruwzxfcgpc.supabase.co/functions/v1/update-leave-balance";


function formatDateTR(dateStr) {
  if (!dateStr) return "";
  const date = new Date(dateStr);
  if (isNaN(date)) return "";
  const day = String(date.getDate()).padStart(2, "0");
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const year = date.getFullYear();
  return `${day}/${month}/${year}`;
}

export default function AdminPanel() {
  const { dbUser, loading } = useUser();
  const [users, setUsers] = useState([]);
  const [annualType, setAnnualType] = useState(null);
  const [balances, setBalances] = useState([]);
  const [editing, setEditing] = useState({});
  const [message, setMessage] = useState("");
  const [savingUserId, setSavingUserId] = useState(null);
  const [confirmingUser, setConfirmingUser] = useState(null);
  const [adminNote, setAdminNote] = useState("");
  const [holidays, setHolidays] = useState([]);
  const [newHolidayDate, setNewHolidayDate] = useState("");
  const [newHolidayName, setNewHolidayName] = useState("");
  const [addingHoliday, setAddingHoliday] = useState(false);
  const [deletingHolidayId, setDeletingHolidayId] = useState(null);
  const [loadingAnnualType, setLoadingAnnualType] = useState(true);
  const [isHalfDay, setIsHalfDay] = useState(false);
  const [half, setHalf] = useState("afternoon"); // default to afternoon (Arife)



  // Load data
  useEffect(() => {
    async function fetchAll() {
      const { data: usersData } = await supabase.from("users").select("id, name, email");
      setUsers(usersData || []);
      const { data: typeData } = await supabase
        .from("leave_types")
        .select("*")
        .eq("name", "Annual")
        .maybeSingle();
      setAnnualType(typeData);
      if (typeData) {
        const { data: balData } = await supabase
          .from("leave_balances")
          .select("*")
          .eq("leave_type_id", typeData.id);
        setBalances(balData || []);
      }
      // Holidays
      const { data: holData } = await supabase
        .from("holidays")
        .select("*")
        .order("date");
      setHolidays(holData || []);
      setLoadingAnnualType(false);
    }
    fetchAll();
  }, []);

  function onEdit(user_id, field, value) {
    setEditing((prev) => ({
      ...prev,
      [`${user_id}_${field}`]: value,
    }));
  }

  function getBal(user_id) {
    if (!annualType) return {};
    return balances.find(b => b.user_id === user_id && b.leave_type_id === annualType.id) || {};
  }

  function onSaveClick(user) {
    setConfirmingUser(user);
    setAdminNote("");
    setMessage("");
  }

  // The main difference is here: use getSession for access token
  async function onConfirmSave() {
    if (!confirmingUser) return;
    setConfirmingUser(null);
    setAdminNote("");
    setSavingUserId(confirmingUser.id);
    setMessage("");
    const bal = getBal(confirmingUser?.id);
    const key = (field) => `${confirmingUser.id}_${field}`;
    const parseOrZero = val => isNaN(Number(val)) || val === "" ? 0 : Number(val);
    const remaining = parseOrZero(editing[key("remaining")] ?? getBal(confirmingUser?.id)?.remaining ?? "");

    let token = "";
    try {
      const { data } = await supabase.auth.getSession();
      token = data?.session?.access_token;
    } catch {}
    if (!token) {
      setMessage("Oturum bulunamadı, lütfen tekrar giriş yapın.");
      setSavingUserId(null);
      setConfirmingUser(null);
      setAdminNote("");
      return;
    }

    try {
      const res = await fetch(EDGE_FUNCTION_URL, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Authorization": `Bearer ${token}`,
        },
        body: JSON.stringify({
          user_id: confirmingUser.id,
          remaining,
          admin_email: dbUser.email,
          admin_name: dbUser.name,
          note: adminNote,
        }),
      });
      const data = await res.json();
      if (!data.success) {
        setMessage(data.error || "Kaydetme işlemi başarısız oldu.");
      } else {
        setBalances((prev) => {
          let found = false;
          const updated = prev.map(bal => {
            if (bal.user_id === confirmingUser.id && bal.leave_type_id === annualType.id) {
              found = true;
              return {
                ...bal,
                remaining,
                last_updated: new Date().toISOString(),
              };
            }
            return bal;
          });
          if (!found) {
            updated.push({
              user_id: confirmingUser.id,
              leave_type_id: annualType.id,
              remaining,
              last_updated: new Date().toISOString(),
            });
          }
          return updated;
        });
        setMessage("Kaydedildi ve bildirim gönderildi.");
      }
    } catch (err) {
      setMessage("Kaydetme sırasında hata oluştu.");
    }
    setSavingUserId(null);
  }

  function onCancelConfirm() {
    setConfirmingUser(null);
    setAdminNote("");
  }

  // Holiday CRUD
  async function handleAddHoliday(e) {
  e.preventDefault();
  setAddingHoliday(true);
  const newRow = {
    date: newHolidayDate,
    name: newHolidayName,
    is_half_day: isHalfDay,
    half: isHalfDay ? half : null
  };
  const { data, error } = await supabase.from("holidays").insert([newRow]).select();
  if (!error && data && data[0]) {
    setHolidays([...holidays, data[0]]);
    setNewHolidayDate("");
    setNewHolidayName("");
    setIsHalfDay(false);
    setHalf("afternoon");
  }
  setAddingHoliday(false);
}


  async function onDeleteHoliday(h) {
    if (!window.confirm("Silmek istediğinize emin misiniz?")) return;
    setDeletingHolidayId(h.id);
    await supabase.from("holidays").delete().eq("id", h.id);
    setHolidays(holidays.filter(hol => hol.id !== h.id));
    setDeletingHolidayId(null);
  }

  if (loading || typeof annualType === "undefined" || !dbUser) {
  return <div style={{ fontFamily: "Urbanist" }}>Yükleniyor…</div>;
}
if (!annualType) {
  return <div style={{ fontFamily: "Urbanist" }}>'Yıllık' izin tipi tanımlı değil.</div>;
}


  return (
    <div
      style={{
        maxWidth: 900,
        margin: "2em auto",
        padding: "30px 24px",
        background: "#fff",
        borderRadius: 18,
        boxShadow: "0 0 20px #cde5f4",
        fontFamily: "'Urbanist', Arial, sans-serif",
      }}
    >
      <h2 style={{ fontWeight: 700, marginBottom: 24, color: "#434344" }}>Yıllık İzin Bakiyeleri (Yönetici)</h2>
{message && (
  <div style={{
    color: "#468847",
    fontWeight: 700,
    marginBottom: 18
  }}>
    {message}
  </div>
)}
<table style={{ width: "100%", fontSize: 16, borderSpacing: 0 }}>
  <thead>
    <tr style={{ background: "#CDE5F4", color: "#434344" }}>
      <th style={th}>Kullanıcı</th>
      <th style={th}>E-posta</th>
      <th style={th}>Kalan</th>
      <th style={th}></th>
    </tr>
  </thead>
  <tbody>
    {users.map(user => {
      const bal = getBal(user.id);
      const key = (field) => `${user.id}_${field}`;
      const remaining = editing[key("remaining")] ?? bal.remaining ?? "";

      return (
        <tr key={user.id}>
          <td style={td}>{user.name || user.email}</td>
          <td style={td}>{user.email}</td>
          <td style={td}>
            <input
              type="number"
              value={remaining}
              onChange={e => onEdit(user.id, "remaining", e.target.value)}
              style={inputStyle}
              min={0}
            />
          </td>
          <td style={td}>
            <button
              style={{
                background: "#F39200",
                color: "#fff",
                border: "none",
                borderRadius: 7,
                padding: "5px 12px",
                fontWeight: 600,
                cursor: savingUserId === user.id ? "not-allowed" : "pointer",
                minWidth: 90,
                position: "relative"
              }}
              disabled={savingUserId === user.id}
              onClick={() => onSaveClick(user)}
            >
              {savingUserId === user.id ? (
                <>
                  <span
                    className="spinner"
                    style={{
                      width: 16,
                      height: 16,
                      border: "2px solid #fff",
                      borderTop: "2px solid #F0B357",
                      borderRadius: "50%",
                      display: "inline-block",
                      marginRight: 6,
                      animation: "spin 1s linear infinite",
                      verticalAlign: "middle"
                    }}
                  />
                  Kaydediliyor…
                </>
              ) : "Kaydet"}
            </button>
          </td>
        </tr>
      );
    })}
  </tbody>
</table>


      {/* Confirmation Modal/Dialog */}
      {confirmingUser && (
        <div
          style={{
            position: "fixed", left: 0, top: 0, width: "100vw", height: "100vh",
            background: "rgba(33,47,62,0.22)", zIndex: 999,
            display: "flex", alignItems: "center", justifyContent: "center"
          }}
        >
          <div
            style={{
              background: "#fff",
              borderRadius: 12,
              padding: "32px 28px",
              boxShadow: "0 4px 28px #a8d2f285",
              minWidth: 360
            }}
          >
            <h3 style={{ color: "#F39200", marginBottom: 8, fontWeight: 700, fontSize: 22 }}>Kaydı Onayla</h3>
            <div style={{ marginBottom: 16, color: "#434344", fontWeight: 500 }}>
              <div>
                <b>{confirmingUser.name || confirmingUser.email}</b> kullanıcısının bakiyesi güncellenecek.
              </div>
              <div style={{ fontSize: 15, margin: "10px 0 2px 0" }}>
                Bu işlem çalışana ve yöneticisine e-posta bildirimi gönderir.
              </div>
            </div>
            <div style={{ marginBottom: 18 }}>
              <label htmlFor="admin-note" style={{ fontSize: 15, fontWeight: 500 }}>Açıklama (gönderilecek e-postada gösterilecek):</label>
              <textarea
                id="admin-note"
                value={adminNote}
                onChange={e => setAdminNote(e.target.value)}
                placeholder="İsteğe bağlı açıklama girin"
                style={{
                  width: "100%",
                  fontFamily: "Urbanist, Arial, sans-serif",
                  borderRadius: 7,
                  border: "1px solid #CDE5F4",
                  padding: "8px",
                  minHeight: 38,
                  marginTop: 4,
                  fontSize: 15,
                }}
              />
            </div>
            <div style={{ display: "flex", gap: 10, justifyContent: "flex-end" }}>
              <button
                style={{
                  background: "#E0653A",
                  color: "#fff",
                  fontWeight: 600,
                  border: "none",
                  borderRadius: 7,
                  padding: "7px 22px",
                  fontSize: 17,
                  cursor: "pointer"
                }}
                onClick={onCancelConfirm}
              >İptal</button>
              <button
                style={{
                  background: "#F39200",
                  color: "#fff",
                  fontWeight: 700,
                  border: "none",
                  borderRadius: 7,
                  padding: "7px 22px",
                  fontSize: 17,
                  cursor: "pointer"
                }}
                onClick={onConfirmSave}
              >Onayla ve Kaydet</button>
            </div>
          </div>
        </div>
      )}

      {/* HOLIDAY MANAGEMENT */}
      <h2 style={{ color: "#F39200", marginTop: 42, marginBottom: 10, fontWeight: 700 }}>
        Resmi Tatil Yönetimi
      </h2>
      <form onSubmit={handleAddHoliday} style={{ marginBottom: 18, display: "flex", gap: 8, alignItems: "center" }}>
  <input
    type="date"
    required
    value={newHolidayDate}
    onChange={e => setNewHolidayDate(e.target.value)}
    style={{ fontSize: 15, padding: 5, borderRadius: 6, border: "1px solid #CDE5F4" }}
  />
  <input
    type="text"
    required
    placeholder="Tatil Adı"
    value={newHolidayName}
    onChange={e => setNewHolidayName(e.target.value)}
    style={{ fontSize: 15, padding: 5, borderRadius: 6, border: "1px solid #CDE5F4" }}
  />
  <label style={{ display: "flex", alignItems: "center", gap: 4, fontSize: 15 }}>
    <input
      type="checkbox"
      checked={isHalfDay}
      onChange={e => setIsHalfDay(e.target.checked)}
      style={{ marginRight: 5 }}
    />
    Yarım Gün
  </label>
  {isHalfDay && (
    <select
      value={half}
      onChange={e => setHalf(e.target.value)}
      style={{ fontSize: 15, borderRadius: 6, border: "1px solid #CDE5F4" }}
    >
      <option value="morning">Sabah</option>
      <option value="afternoon">Öğleden Sonra</option>
    </select>
  )}
  <button type="submit" disabled={addingHoliday} style={{
    background: "#F39200",
    color: "#fff",
    border: "none",
    borderRadius: 7,
    padding: "5px 18px",
    fontWeight: 600,
    cursor: addingHoliday ? "not-allowed" : "pointer"
  }}>
    {addingHoliday ? "Ekleniyor…" : "Ekle"}
  </button>
</form>


      <table style={{ width: "100%", background: "#F8FBFD", borderRadius: 10, fontSize: 16 }}>
        <thead>
          <tr>
            <th style={{ padding: 10 }}>Tarih</th>
            <th>Adı</th>
            <th>Yarım Gün</th>
            <th style={{ width: 60 }}>İşlem</th>
          </tr>
        </thead>
        <tbody>
          {holidays.map((h, i) => (
            <tr key={h.id || i}>
              <td>{formatDateTR(h.date)}</td>
              <td>{h.name}</td>
              <td>
                {h.is_half_day
                  ? (h.half === "morning" ? "Sabah" : "Öğleden Sonra")
                  : "Tam"}</td>
              <td>
                <button
                  onClick={() => onDeleteHoliday(h)}
                  disabled={deletingHolidayId === h.id}
                  title="Sil"
                  style={{
                    background: "none",
                    border: "none",
                    fontSize: 20,
                    cursor: deletingHolidayId === h.id ? "not-allowed" : "pointer"
                  }}>
                  {deletingHolidayId === h.id ? "…" : "🗑"}
                </button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>

      {/* Spinner CSS in the component for completeness */}
      <style>
        {`
        @keyframes spin {
          to { transform: rotate(360deg); }
        }
        `}
      </style>
    </div>
  );
}

// --- Styles ---
const th = {
  padding: "8px 10px",
  fontWeight: 700,
  borderBottom: "2px solid #e8eef3",
  textAlign: "center",
  letterSpacing: 1,
};

const td = {
  padding: "6px 7px",
  borderBottom: "1px solid #e8eef3",
  verticalAlign: "top",
  textAlign: "center",
};

const inputStyle = {
  width: 70,
  fontSize: 15,
  fontFamily: "Urbanist, Arial, sans-serif",
  border: "1px solid #CDE5F4",
  borderRadius: 6,
  padding: "5px 4px",
  outline: "none",
  background: "#F9FBFC",
  color: "#434344",
};
