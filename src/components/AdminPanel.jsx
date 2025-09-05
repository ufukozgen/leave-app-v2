// src/components/AdminPanel.jsx
import React, { useState, useEffect } from "react";
import { supabase } from "../supabaseClient";
import { useUser } from "./UserContext";
import { toast } from "react-hot-toast";
import AdminBackups from "./AdminBackups.jsx"; // <-- new tab

// --- Brand palette (matches app spec) ---
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

// Edge Function URLs (as in your current file)
const BASE_FUNCTION_URL = "https://sxinuiwawpruwzxfcgpc.supabase.co/functions/v1";
const EDGE_FUNCTION_URL = `${BASE_FUNCTION_URL}/update-leave-balance`;
const ASSIGN_MANAGER_URL = `${BASE_FUNCTION_URL}/assign-manager`;
const ASSIGN_ROLE_URL = `${BASE_FUNCTION_URL}/assign-role`;

// --- Small UI bits ---
function Section({ title, children, right }) {
  return (
    <div style={{ marginTop: 8 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", margin: "10px 0 14px" }}>
        <h2 style={{ fontFamily: "Urbanist, system-ui", fontWeight: 700, color: COLORS.grayDark, margin: 0 }}>{title}</h2>
        {right}
      </div>
      {children}
    </div>
  );
}

function Pill({ tone = "info", children }) {
  const border = { info: COLORS.blue, warn: COLORS.yellow, error: COLORS.red, ok: "#2e7d32" }[tone] || COLORS.blue;
  return (
    <span style={{
      display: "inline-block",
      border: `1px solid ${border}`,
      background: COLORS.veryLightBlue,
      borderRadius: 999,
      padding: "3px 8px",
      fontSize: 12,
      fontFamily: "Urbanist, system-ui",
      color: COLORS.grayDark,
      marginLeft: 6
    }}>{children}</span>
  );
}

// --- Utilities ---
function formatDateTR(dateStr) {
  if (!dateStr) return "";
  const date = new Date(dateStr);
  if (isNaN(date)) return "";
  const day = String(date.getDate()).padStart(2, "0");
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const year = date.getFullYear();
  return `${day}/${month}/${year}`;
}

// --- Table styles (kept from your current file) ---
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

export default function AdminPanel() {
  const { dbUser, loading } = useUser();

  // --- NEW: tabs
  const TABS = [
    { key: "users", label: "Kullanıcılar" },
    { key: "settings", label: "Ayarlar" },
    { key: "holidays", label: "Resmi Tatiller" },
    { key: "backups", label: "Yedekler" },
  ];
  const [active, setActive] = useState("users");

  // --- Existing state from your file
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
  const [half, setHalf] = useState("afternoon");
  const [allowRetroactiveLeave, setAllowRetroactiveLeave] = useState(false);
  const [refreshingUserId, setRefreshingUserId] = useState(null);
  const [recentlyRefreshedUserId, setRecentlyRefreshedUserId] = useState(null);

  // Fetch all users, balances, holidays, etc.  (kept from your flow)
  useEffect(() => {
    async function fetchAll() {
      const { data: usersData } = await supabase.from("users").select("id, name, email, role, manager_email, initials");
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

      const { data: holData } = await supabase
        .from("holidays")
        .select("*")
        .order("date");
      setHolidays(holData || []);

      // Settings (retroactive flag)
      const { data: settings } = await supabase
        .from("settings")
        .select("allow_retroactive_leave")
        .eq("id", 1)
        .maybeSingle();
      if (settings && typeof settings.allow_retroactive_leave === "boolean") {
        setAllowRetroactiveLeave(settings.allow_retroactive_leave);
      }

      setLoadingAnnualType(false);
    }
    fetchAll();
  }, []);

  // --- Handlers from your file (unchanged in behavior)
  function onEdit(user_id, field, value) {
    setEditing((prev) => ({ ...prev, [`${user_id}_${field}`]: value }));
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

  function onCancelConfirm() {
    setConfirmingUser(null);
    setAdminNote("");
    toast("İşlem iptal edildi.");
  }

  async function onConfirmSave() {
    if (!confirmingUser) return;
    setConfirmingUser(null);
    setAdminNote("");
    setSavingUserId(confirmingUser.id);
    setMessage("");
    const bal = getBal(confirmingUser?.id);
    const key = (field) => `${confirmingUser.id}_${field}`;
    const parseOrZero = val => isNaN(Number(val)) || val === "" ? 0 : Number(val);
    const remaining = parseOrZero(editing[key("remaining")] ?? bal?.remaining ?? "");

    let token = "";
    try {
      const { data } = await supabase.auth.getSession();
      token = data?.session?.access_token;
    } catch {}
    if (!token) {
      setMessage("Oturum bulunamadı, lütfen tekrar giriş yapın.");
      toast.error("Oturum bulunamadı, lütfen tekrar giriş yapın.");
      setSavingUserId(null);
      setConfirmingUser(null);
      setAdminNote("");
      return;
    }

    try {
      const res = await fetch(EDGE_FUNCTION_URL, {
        method: "POST",
        headers: { "Content-Type": "application/json", "Authorization": `Bearer ${token}` },
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
        toast.error(data.error || "Kaydetme işlemi başarısız oldu.");
      } else {
        setBalances((prev) => {
          let found = false;
          const updated = prev.map(bal => {
            if (bal.user_id === confirmingUser.id && bal.leave_type_id === annualType.id) {
              found = true;
              return { ...bal, remaining, last_updated: new Date().toISOString() };
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
        toast.success("Bakiye güncellendi ve e-posta gönderildi!");
      }
    } catch (err) {
      setMessage("Kaydetme sırasında hata oluştu.");
      toast.error("Kaydetme sırasında hata oluştu.");
    }
    setSavingUserId(null);
  }

  async function handleManagerChange(userId, newManagerEmail) {
    setMessage("");
    let token = "";
    try {
      const { data } = await supabase.auth.getSession();
      token = data?.session?.access_token;
    } catch {}
    if (!token) {
      setMessage("Oturum bulunamadı, lütfen tekrar giriş yapın.");
      toast.error("Oturum bulunamadı, lütfen tekrar giriş yapın.");
      return;
    }
    try {
      const res = await fetch(ASSIGN_MANAGER_URL, {
        method: "POST",
        headers: { "Content-Type": "application/json", "Authorization": `Bearer ${token}` },
        body: JSON.stringify({ user_id: userId, manager_email: newManagerEmail }),
      });
      const data = await res.json();
      if (!data.success) {
        setMessage(data.error || "Yönetici atama başarısız.");
        toast.error(data.error || "Yönetici atama başarısız.");
      } else {
        setUsers(users => users.map(u => u.id === userId ? { ...u, manager_email: newManagerEmail } : u));
        setMessage("Yönetici değiştirildi.");
        toast.success("Yönetici değiştirildi.");
      }
    } catch (err) {
      setMessage("Yönetici atama sırasında hata oluştu.");
      toast.error("Yönetici atama sırasında hata oluştu.");
    }
  }

  async function onSaveUserInfo(user) {
    setSavingUserId(user.id);
    setMessage("");
    let token = "";
    try {
      const { data } = await supabase.auth.getSession();
      token = data?.session?.access_token;
    } catch {}
    if (!token) {
      setMessage("Oturum bulunamadı, lütfen tekrar giriş yapın.");
      toast.error("Oturum bulunamadı, lütfen tekrar giriş yapın.");
      setSavingUserId(null);
      return;
    }

    const name = editing[`${user.id}_name`] ?? user.name ?? "";
    let initials = (editing[`${user.id}_initials`] ?? user.initials ?? "");
    if (initials.length >= 2) {
      initials = initials[0].toUpperCase() + initials[1].toUpperCase() + (initials[2] || "");
    } else {
      initials = initials.toUpperCase();
    }

    if (!/^[A-ZÇĞİÖŞÜ]{2}[a-zçğıöşüA-ZÇĞİÖŞÜ]?$/.test(initials)) {
      setMessage("Baş harflerin ilk 2 karakteri büyük olmalı (maks 3 karakter, TR destekli).");
      toast.error("Baş harfler formatı hatalı.");
      setSavingUserId(null);
      return;
    }
    if (!name.trim()) {
      setMessage("Ad alanı boş olamaz.");
      toast.error("Ad alanı boş olamaz.");
      setSavingUserId(null);
      return;
    }

    try {
      const res = await fetch(`${BASE_FUNCTION_URL}/update-user-info`, {
        method: "POST",
        headers: { "Content-Type": "application/json", "Authorization": `Bearer ${token}` },
        body: JSON.stringify({ user_id: user.id, name, initials }),
      });
      const data = await res.json();
      if (!data.success) {
        setMessage(data.error || "Kaydetme işlemi başarısız oldu.");
        toast.error(data.error || "Kaydetme işlemi başarısız oldu.");
      } else {
        setUsers(users => users.map(u => (u.id === user.id ? { ...u, name, initials } : u)));
        setMessage("Kullanıcı adı ve baş harfler güncellendi.");
        toast.success("Kullanıcı adı ve baş harfler güncellendi!");
        setEditing(ed => {
          const next = { ...ed };
          delete next[`${user.id}_name`];
          delete next[`${user.id}_initials`];
          return next;
        });
      }
    } catch {
      setMessage("Kaydetme sırasında hata oluştu.");
      toast.error("Kaydetme sırasında hata oluştu.");
    }
    setSavingUserId(null);
  }

  async function handleRoleChange(userId, newRole) {
    setMessage("");
    let token = "";
    try {
      const { data } = await supabase.auth.getSession();
      token = data?.session?.access_token;
    } catch {}
    if (!token) {
      setMessage("Oturum bulunamadı, lütfen tekrar giriş yapın.");
      toast.error("Oturum bulunamadı, lütfen tekrar giriş yapın.");
      return;
    }
    try {
      const res = await fetch(ASSIGN_ROLE_URL, {
        method: "POST",
        headers: { "Content-Type": "application/json", "Authorization": `Bearer ${token}` },
        body: JSON.stringify({ user_id: userId, role: newRole }),
      });
      const data = await res.json();
      if (!data.success) {
        setMessage(data.error || "Rol atama başarısız.");
        toast.error(data.error || "Rol atama başarısız.");
      } else {
        setUsers(users => users.map(u => (u.id === userId ? { ...u, role: newRole } : u)));
        setMessage("Rol güncellendi.");
        toast.success("Rol güncellendi.");
      }
    } catch {
      setMessage("Rol atama sırasında hata oluştu.");
      toast.error("Rol atama sırasında hata oluştu.");
    }
  }

  async function handleRefreshUser(userId) {
    setRefreshingUserId(userId);
    setMessage("");
    const { data: updatedUser, error } = await supabase
      .from("users")
      .select("id, name, email, role, manager_email, initials")
      .eq("id", userId)
      .maybeSingle();
    if (error || !updatedUser) {
      setMessage("Kullanıcı bilgisi güncellenemedi.");
      toast.error("Kullanıcı bilgisi güncellenemedi.");
      setRefreshingUserId(null);
      return;
    }
    setUsers(users => users.map(u => (u.id === userId ? { ...u, ...updatedUser } : u)));
    setMessage("Kullanıcı bilgisi yenilendi.");
    toast.success("Kullanıcı bilgisi yenilendi.");
    setRefreshingUserId(null);
    setRecentlyRefreshedUserId(userId);
    setTimeout(() => setRecentlyRefreshedUserId(null), 1000);
  }

  async function handleAddHoliday(e) {
    e.preventDefault();
    setAddingHoliday(true);
    const newRow = { date: newHolidayDate, name: newHolidayName, is_half_day: isHalfDay, half: isHalfDay ? half : null };
    const { data, error } = await supabase.from("holidays").insert([newRow]).select();
    if (!error && data && data[0]) {
      setHolidays([...holidays, data[0]]);
      setNewHolidayDate("");
      setNewHolidayName("");
      setIsHalfDay(false);
      setHalf("afternoon");
      toast.success("Tatil eklendi!");
    } else {
      toast.error(error?.message || "Tatil eklenemedi.");
    }
    setAddingHoliday(false);
  }

  async function onDeleteHoliday(h) {
    if (!window.confirm("Silmek istediğinize emin misiniz?")) return;
    setDeletingHolidayId(h.id);
    const { error } = await supabase.from("holidays").delete().eq("id", h.id);
    if (!error) {
      setHolidays(holidays.filter(hol => hol.id !== h.id));
      toast.success("Tatil silindi.");
    } else {
      toast.error("Tatil silinirken hata oluştu.");
    }
    setDeletingHolidayId(null);
  }

  async function handleToggleRetroactive() {
    const { error } = await supabase
      .from("settings")
      .update({ allow_retroactive_leave: !allowRetroactiveLeave })
      .eq("id", 1);
    if (!error) {
      setAllowRetroactiveLeave(!allowRetroactiveLeave);
      toast.success(`Retroaktif izin ${!allowRetroactiveLeave ? "açıldı" : "kapatıldı"}.`);
    } else {
      toast.error("Retroaktif izin ayarı güncellenemedi.");
    }
  }

  // --- Loading guards (kept)
  if (loading || loadingAnnualType || typeof annualType === "undefined" || !dbUser) {
    return <div style={{ fontFamily: "Urbanist" }}>Yükleniyor…</div>;
  }
  if (!annualType) {
    return <div style={{ fontFamily: "Urbanist" }}>'Yıllık' izin tipi tanımlı değil.</div>;
  }

  return (
    <div
      style={{
        maxWidth: 1100,
        margin: "2em auto",
        padding: "24px 20px",
        background: "#fff",
        borderRadius: 18,
        boxShadow: "0 0 20px #cde5f4",
        fontFamily: "Urbanist, Arial, sans-serif",
      }}
    >
      {/* Header */}
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12 }}>
        <h1 style={{ margin: 0, fontSize: 22, color: COLORS.grayDark, fontWeight: 800 }}>Yönetici Paneli</h1>
        {message && (
          <div style={{
            color: message.includes("hata") || message.includes("başarısız") ? COLORS.red : "#1C6234",
            fontWeight: 700
          }}>
            {message}
          </div>
        )}
      </div>

      {/* Tab bar */}
      <div
        role="tablist"
        aria-label="Admin Tabs"
        style={{
          display: "flex",
          gap: 8,
          background: COLORS.veryLightBlue,
          border: `1px solid ${COLORS.lightBlue}`,
          padding: 6,
          borderRadius: 12,
          marginBottom: 14,
        }}
      >
        {TABS.map(t => {
          const activeTab = active === t.key;
          return (
            <button
              key={t.key}
              role="tab"
              aria-selected={activeTab}
              onClick={() => setActive(t.key)}
              style={{
                padding: "8px 14px",
                borderRadius: 10,
                border: `1px solid ${activeTab ? COLORS.orange : "transparent"}`,
                background: activeTab ? "#FFF2DC" : "#fff",
                color: activeTab ? COLORS.orange : COLORS.grayDark,
                fontWeight: 700,
                cursor: "pointer",
                outline: "none",
              }}
            >
              {t.label}
            </button>
          );
        })}
      </div>

      {/* USERS TAB */}
      {active === "users" && (
        <Section title="Kullanıcılar & Bakiyeler">
          <div style={{ overflowX: "auto" }}>
            <table style={{ width: "100%", fontSize: 16, borderSpacing: 0, minWidth: 820 }}>
              <thead>
                <tr style={{ background: COLORS.veryLightBlue, color: COLORS.grayDark }}>
                  <th></th>
                  <th style={th}>Ad / Başh.</th>
                  <th style={th}>@terralab.com.tr</th>
                  <th style={th}>Rol</th>
                  <th style={th}>Yön.</th>
                  <th style={{ ...th, borderLeft: `2px solid ${COLORS.veryLightBlue}` }}>Kalan</th>
                  <th style={th}>İşlem</th>
                </tr>
              </thead>
              <tbody>
                {[...users].sort((a, b) => a.email.localeCompare(b.email)).map(user => {
                  const key = (field) => `${user.id}_${field}`;
                  const name = editing[key("name")] ?? user.name ?? "";
                  const initials = editing[key("initials")] ?? user.initials ?? "";
                  const remaining = editing[key("remaining")] ?? getBal(user.id).remaining ?? "";
                  const username = user.email.replace("@terralab.com.tr", "");
                  const highlight = recentlyRefreshedUserId === user.id;

                  return (
                    <tr
                      key={user.id}
                      style={{
                        transition: "background 0.5s, opacity 0.5s",
                        background: highlight ? "#e9faf5" : undefined,
                        opacity: refreshingUserId === user.id ? 0.5 : 1
                      }}
                    >
                      {/* refresh */}
                      <td style={{ ...td, width: 36, textAlign: "center", background: "#F8FBFD" }}>
                        <button
                          style={{
                            background: "#F8FBFD",
                            border: "none",
                            borderRadius: 7,
                            width: 28,
                            height: 30,
                            fontSize: 15,
                            color: COLORS.gray,
                            padding: 0,
                            cursor: refreshingUserId === user.id ? "not-allowed" : "pointer"
                          }}
                          title="Satırı yenile"
                          onClick={() => handleRefreshUser(user.id)}
                          disabled={refreshingUserId === user.id}
                        >
                          🔄
                        </button>
                      </td>

                      {/* name + initials */}
                      <td style={{ ...td, textAlign: "left", minWidth: 120, maxWidth: 220, display: "flex", alignItems: "center", gap: 8 }}>
                        <input
                          type="text"
                          value={name}
                          onChange={e => onEdit(user.id, "name", e.target.value)}
                          style={{ ...inputStyle, width: 130, fontWeight: 600, fontSize: 15, marginRight: 2 }}
                          maxLength={60}
                          placeholder="Ad Soyad"
                          autoComplete="off"
                        />
                        <input
                          type="text"
                          value={initials}
                          onChange={e => {
                            let val = e.target.value.replace(/[^A-Za-zÇĞİÖŞÜçğıöşü]/g, "").slice(0, 3);
                            if (val.length >= 2) {
                              val = val[0].toUpperCase() + val[1].toUpperCase() + (val[2] || "");
                            } else {
                              val = val.toUpperCase();
                            }
                            onEdit(user.id, "initials", val);
                          }}
                          style={{
                            ...inputStyle,
                            width: 42,
                            textAlign: "center",
                            fontWeight: 700,
                            fontSize: 14,
                            background: "#FFF2DC",
                            color: COLORS.orange
                          }}
                          maxLength={3}
                          minLength={2}
                          placeholder="İLK."
                          autoComplete="off"
                        />
                      </td>

                      {/* username */}
                      <td style={{ ...td, fontSize: 14, maxWidth: 130, overflow: "hidden", textOverflow: "ellipsis" }}>
                        {username}
                      </td>

                      {/* role */}
                      <td style={td}>
                        {user.role === "admin" ? (
                          <Pill tone="ok">Admin</Pill>
                        ) : (
                          <select value={user.role} onChange={e => handleRoleChange(user.id, e.target.value)} style={{ ...inputStyle, width: 112 }}>
                            <option value="user">Kullanıcı</option>
                            <option value="manager">Yönetici</option>
                          </select>
                        )}
                      </td>

                      {/* manager + blue check (fixed positioning) */}
                      <td style={{ ...td, position: "relative", minWidth: 180, textAlign: "left", paddingRight: 42 }}>
                        <div style={{ display: "flex", alignItems: "center" }}>
                          {user.role === "admin" ? (
                            users.find(u => u.email === user.manager_email)?.name || user.manager_email || "-"
                          ) : (
                            <select
                              value={user.manager_email || ""}
                              onChange={e => handleManagerChange(user.id, e.target.value)}
                              style={{ ...inputStyle, width: 180, marginRight: 8 }}
                            >
                              <option value="">Yok</option>
                              {[...users]
                                .filter(u => u.email !== user.email)
                                .sort((a, b) => a.email.localeCompare(b.email))
                                .map(mgr => (
                                  <option key={mgr.email} value={mgr.email}>
                                    {mgr.name || mgr.email}
                                  </option>
                                ))}
                            </select>
                          )}
                          <div style={{ flex: 1 }} />
                        </div>
                        <button
                          onClick={() => onSaveUserInfo(user)}
                          title="Yönetici kaydet"
                          style={{
                            position: "absolute",
                            right: 6,
                            top: "50%",
                            transform: "translateY(-50%)",
                            background: COLORS.blue,
                            border: "none",
                            borderRadius: 7,
                            width: 30,
                            height: 30,
                            color: "#fff",
                            fontWeight: 900,
                            fontSize: 19,
                            display: "flex",
                            alignItems: "center",
                            justifyContent: "center",
                            boxShadow: "0 1px 3px #cde5f470",
                            cursor: "pointer",
                            transition: "background 0.18s",
                            outline: "none",
                            zIndex: 2
                          }}
                          tabIndex={0}
                          onKeyDown={e => { if (e.key === "Enter" || e.key === " ") onSaveUserInfo(user); }}
                        >
                          ✔
                        </button>
                      </td>

                      {/* remaining */}
                      <td style={{ ...td, borderLeft: `2px solid ${COLORS.veryLightBlue}`, background: "#f8fbfd", width: 62 }}>
                        <input
                          type="number"
                          value={remaining}
                          onChange={e => onEdit(user.id, "remaining", e.target.value)}
                          style={{ ...inputStyle, width: 60, fontSize: 15 }}
                          min={0}
                        />
                      </td>

                      {/* save */}
                      <td style={{ ...td, background: "#f8fbfd", width: 46 }}>
                        <button
                          style={{
                            background: COLORS.orange,
                            color: "#fff",
                            border: "none",
                            borderRadius: 7,
                            width: 34,
                            height: 30,
                            fontSize: 17,
                            marginRight: 2,
                            padding: 0,
                            cursor: savingUserId === user.id ? "not-allowed" : "pointer"
                          }}
                          disabled={savingUserId === user.id}
                          onClick={() => onSaveClick(user)}
                          title="Bakiyeyi Kaydet (E-posta gönderir)"
                        >
                          💾
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          {/* Confirm modal */}
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
                  minWidth: 360,
                  border: `1px solid ${COLORS.veryLightBlue}`
                }}
              >
                <h3 style={{ color: COLORS.orange, marginBottom: 8, fontWeight: 700, fontSize: 22 }}>Kaydı Onayla</h3>
                <div style={{ marginBottom: 16, color: COLORS.grayDark, fontWeight: 500 }}>
                  <div>
                    <b>{confirmingUser.name || confirmingUser.email}</b> kullanıcısının bakiyesi güncellenecek.
                  </div>
                  <div style={{ fontSize: 15, margin: "10px 0 2px 0" }}>
                    Bu işlem çalışana ve yöneticisine e-posta bildirimi gönderir.
                  </div>
                </div>
                <div style={{ marginBottom: 18 }}>
                  <label htmlFor="admin-note" style={{ fontSize: 15, fontWeight: 500 }}>Açıklama (e-postada gösterilecek):</label>
                  <textarea
                    id="admin-note"
                    value={adminNote}
                    onChange={e => setAdminNote(e.target.value)}
                    placeholder="İsteğe bağlı açıklama girin"
                    style={{
                      width: "100%",
                      fontFamily: "Urbanist, Arial, sans-serif",
                      borderRadius: 7,
                      border: `1px solid ${COLORS.veryLightBlue}`,
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
                      background: COLORS.red,
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
                      background: COLORS.orange,
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
        </Section>
      )}

      {/* SETTINGS TAB */}
      {active === "settings" && (
        <Section title="Ayarlar">
          <div style={{ margin: "12px 0", padding: 12, background: "#F8FBFD", borderRadius: 10, border: `1px solid ${COLORS.veryLightBlue}` }}>
            <label style={{ fontSize: 17, fontWeight: 600, display: "flex", alignItems: "center", gap: 16 }}>
              <span>Kullanıcılar geçmiş tarihler için izin talep edebilsin (retroaktif izin)</span>
              <div
                onClick={handleToggleRetroactive}
                style={{
                  width: 48, height: 26, borderRadius: 18,
                  background: allowRetroactiveLeave ? COLORS.red : COLORS.blue,
                  position: "relative", cursor: "pointer",
                  transition: "background 0.25s",
                  boxShadow: allowRetroactiveLeave ? "0 0 6px #E0653A44" : "0 0 6px #A8D2F2",
                  border: allowRetroactiveLeave ? `1.5px solid ${COLORS.red}` : `1.5px solid ${COLORS.blue}`
                }}
                tabIndex={0}
                role="button"
                aria-pressed={allowRetroactiveLeave}
                onKeyDown={e => { if (e.key === " " || e.key === "Enter") handleToggleRetroactive(); }}
                title={allowRetroactiveLeave ? "Açık" : "Kapalı"}
              >
                <span
                  style={{
                    position: "absolute",
                    left: allowRetroactiveLeave ? 24 : 2,
                    top: 2,
                    width: 22, height: 22,
                    borderRadius: "50%",
                    background: "#fff",
                    boxShadow: "0 1px 4px #8883",
                    transition: "left 0.25s"
                  }}
                />
              </div>
              <span style={{ fontWeight: 700, color: allowRetroactiveLeave ? COLORS.red : COLORS.blue, minWidth: 68 }}>
                {allowRetroactiveLeave ? "Açık" : "Kapalı"}
              </span>
            </label>
          </div>
        </Section>
      )}

      {/* HOLIDAYS TAB */}
      {active === "holidays" && (
        <Section
          title="Resmi Tatil Yönetimi"
          right={null}
        >
          <form onSubmit={handleAddHoliday} style={{ marginBottom: 18, display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
            <input
              type="date"
              required
              value={newHolidayDate}
              onChange={e => setNewHolidayDate(e.target.value)}
              style={{ fontSize: 15, padding: 5, borderRadius: 6, border: `1px solid ${COLORS.veryLightBlue}` }}
            />
            <input
              type="text"
              required
              placeholder="Tatil Adı"
              value={newHolidayName}
              onChange={e => setNewHolidayName(e.target.value)}
              style={{ fontSize: 15, padding: 5, borderRadius: 6, border: `1px solid ${COLORS.veryLightBlue}`, minWidth: 200 }}
            />
            <label style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 15 }}>
              <input type="checkbox" checked={isHalfDay} onChange={e => setIsHalfDay(e.target.checked)} />
              Yarım Gün
            </label>
            {isHalfDay && (
              <select value={half} onChange={e => setHalf(e.target.value)} style={{ fontSize: 15, borderRadius: 6, border: `1px solid ${COLORS.veryLightBlue}` }}>
                <option value="morning">Sabah</option>
                <option value="afternoon">Öğleden Sonra</option>
              </select>
            )}
            <button type="submit" disabled={addingHoliday} style={{
              background: COLORS.orange, color: "#fff", border: "none", borderRadius: 8,
              padding: "6px 18px", fontWeight: 700, cursor: addingHoliday ? "not-allowed" : "pointer"
            }}>
              {addingHoliday ? "Ekleniyor…" : "Ekle"}
            </button>
          </form>

          <div style={{ overflowX: "auto" }}>
            <table style={{ width: "100%", background: "#F8FBFD", borderRadius: 10, fontSize: 16, border: `1px solid ${COLORS.veryLightBlue}` }}>
              <thead>
                <tr style={{ background: COLORS.veryLightBlue }}>
                  <th style={{ padding: 10 }}>Tarih</th>
                  <th>Adı</th>
                  <th>Yarım Gün</th>
                  <th style={{ width: 60 }}>İşlem</th>
                </tr>
              </thead>
              <tbody>
                {holidays.map((h, i) => (
                  <tr key={h.id || i}>
                    <td style={{ textAlign: "center", padding: 8 }}>{formatDateTR(h.date)}</td>
                    <td style={{ padding: 8 }}>{h.name}</td>
                    <td style={{ padding: 8 }}>
                      {h.is_half_day ? (h.half === "morning" ? "Sabah" : "Öğleden Sonra") : "Tam"}
                    </td>
                    <td style={{ textAlign: "center" }}>
                      <button
                        onClick={() => onDeleteHoliday(h)}
                        disabled={deletingHolidayId === h.id}
                        title="Sil"
                        style={{ background: "none", border: "none", fontSize: 20, cursor: deletingHolidayId === h.id ? "not-allowed" : "pointer" }}
                      >
                        {deletingHolidayId === h.id ? "…" : "🗑"}
                      </button>
                    </td>
                  </tr>
                ))}
                {holidays.length === 0 && (
                  <tr>
                    <td colSpan={4} style={{ padding: 12, color: COLORS.gray, fontFamily: "Urbanist, system-ui" }}>
                      Kayıtlı tatil bulunmuyor.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </Section>
      )}

      {/* BACKUPS TAB */}
      {active === "backups" && (
        <Section
          title="Leave Balance Backups"
          right={<Pill tone="info">Aylık snapshot + dışa aktarım</Pill>}
        >
          <AdminBackups />
        </Section>
      )}

      {/* Minor CSS for spinner (kept) */}
      <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
    </div>
  );
}
