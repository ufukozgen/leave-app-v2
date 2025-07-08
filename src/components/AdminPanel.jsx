import React, { useState, useEffect } from "react";
import { supabase } from "../supabaseClient";
import { useUser } from "./UserContext";

export default function AdminPanel() {
  const { dbUser, loading } = useUser();
  const [users, setUsers] = useState([]);
  const [annualType, setAnnualType] = useState(null);
  const [balances, setBalances] = useState([]);
  const [editing, setEditing] = useState({});
  const [message, setMessage] = useState("");

  // Kullanıcıları ve Yıllık izin tipini yükle
  useEffect(() => {
    async function fetchAll() {
      const { data: usersData } = await supabase.from("users").select("id, name, email");
      setUsers(usersData || []);
      const { data: typeData } = await supabase.from("leave_types").select("*").eq("name", "Annual").maybeSingle();
      setAnnualType(typeData);
      if (typeData) {
        const { data: balData } = await supabase
          .from("leave_balances")
          .select("*")
          .eq("leave_type_id", typeData.id);
        setBalances(balData || []);
      }
    }
    fetchAll();
  }, []);

  function onEdit(user_id, field, value) {
    setEditing({
      ...editing,
      [`${user_id}_${field}`]: value,
    });
  }

  async function onSave(user) {
    setMessage("");
    if (!annualType) return;
    const key = (field) => `${user.id}_${field}`;
    const accrued = parseFloat(editing[key("accrued")]);
    const used = parseFloat(editing[key("used")]);
    const remaining = parseFloat(editing[key("remaining")]);
    let bal = balances.find(b => b.user_id === user.id && b.leave_type_id === annualType.id);

    if (!bal) {
      const { data, error } = await supabase.from("leave_balances").insert([{
        user_id: user.id,
        leave_type_id: annualType.id,
        accrued: accrued || 0,
        used: used || 0,
        remaining: remaining || 0,
        last_updated: new Date().toISOString(),
      }]).select();
      if (error) {
        setMessage("Bakiyeyi oluştururken hata: " + error.message);
        return;
      }
      bal = data && data[0];
      setBalances(bs => [...bs, bal]);
    } else {
      const { error } = await supabase.from("leave_balances").update({
        accrued: !isNaN(accrued) ? accrued : bal.accrued,
        used: !isNaN(used) ? used : bal.used,
        remaining: !isNaN(remaining) ? remaining : bal.remaining,
        last_updated: new Date().toISOString(),
      }).eq("id", bal.id);
      if (error) {
        setMessage("Bakiyeyi güncellerken hata: " + error.message);
        return;
      }
      setBalances(bs =>
        bs.map(row =>
          row.id === bal.id
            ? {
                ...row,
                accrued: !isNaN(accrued) ? accrued : bal.accrued,
                used: !isNaN(used) ? used : bal.used,
                remaining: !isNaN(remaining) ? remaining : bal.remaining,
                last_updated: new Date().toISOString(),
              }
            : row
        )
      );
    }

    // Log kaydı
    await supabase.from("logs").insert([{
      user_id: dbUser.id,
      actor_email: dbUser.email,
      action: bal ? "admin_update_balance" : "admin_create_balance",
      target_table: "leave_balances",
      target_id: bal ? bal.id : null,
      status_before: bal
        ? JSON.stringify({
            accrued: bal.accrued,
            used: bal.used,
            remaining: bal.remaining,
          })
        : null,
      status_after: JSON.stringify({
        accrued,
        used,
        remaining,
      }),
      details: {
        user_email: user.email,
        leave_type: "Annual",
      }
    }]);
    setMessage("Kaydedildi!");
  }

  function getBal(user_id) {
    if (!annualType) return {};
    return balances.find(b => b.user_id === user_id && b.leave_type_id === annualType.id) || {};
  }

  if (loading) return <div style={{ fontFamily: "Urbanist" }}>Yükleniyor…</div>;
  if (!annualType) return <div style={{ fontFamily: "Urbanist" }}>'Yıllık' izin tipi tanımlı değil.</div>;

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
          color: message.startsWith("Bakiyeyi") ? "#E0653A" : "#468847",
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
            <th style={th}>Kazandırılan</th>
            <th style={th}>Kullanılan</th>
            <th style={th}>Kalan</th>
            <th style={th}></th>
          </tr>
        </thead>
        <tbody>
          {users.map(user => {
            const bal = getBal(user.id);
            const key = (field) => `${user.id}_${field}`;
            return (
              <tr key={user.id}>
                <td style={td}>{user.name || user.email}</td>
                <td style={td}>{user.email}</td>
                <td style={td}>
                  <input
                    type="number"
                    value={editing[key("accrued")] ?? bal.accrued ?? ""}
                    onChange={e => onEdit(user.id, "accrued", e.target.value)}
                    style={inputStyle}
                  />
                </td>
                <td style={td}>
                  <input
                    type="number"
                    value={editing[key("used")] ?? bal.used ?? ""}
                    onChange={e => onEdit(user.id, "used", e.target.value)}
                    style={inputStyle}
                  />
                </td>
                <td style={td}>
                  <input
                    type="number"
                    value={editing[key("remaining")] ?? bal.remaining ?? ""}
                    onChange={e => onEdit(user.id, "remaining", e.target.value)}
                    style={inputStyle}
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
                      cursor: "pointer",
                    }}
                    onClick={() => onSave(user)}
                  >
                    Kaydet
                  </button>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

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
