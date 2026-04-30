// src/components/AdminPanel.jsx
import React, { useState, useEffect, useMemo } from "react";
import { supabase } from "../supabaseClient";
import { useUser } from "./UserContext";
import { toast } from "react-hot-toast";
import AdminBackups from "./AdminBackups.jsx";

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
  green: "#2e7d32",
};

// Edge Function URLs
const BASE_FUNCTION_URL = "https://sxinuiwawpruwzxfcgpc.supabase.co/functions/v1";
const EDGE_FUNCTION_URL = `${BASE_FUNCTION_URL}/update-leave-balance`;
const ASSIGN_MANAGER_URL = `${BASE_FUNCTION_URL}/assign-manager`;
const ASSIGN_ROLE_URL = `${BASE_FUNCTION_URL}/assign-role`;
const UPDATE_USER_INFO_URL = `${BASE_FUNCTION_URL}/update-user-info`;
const BULK_COMPANY_LEAVE_URL = `${BASE_FUNCTION_URL}/bulk-company-leave`;

// --- Small UI bits ---
function Section({ title, children, right }) {
  return (
    <div style={{ marginTop: 8 }}>
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          margin: "10px 0 14px",
          gap: 10,
          flexWrap: "wrap",
        }}
      >
        <h2
          style={{
            fontFamily: "Urbanist, system-ui",
            fontWeight: 700,
            color: COLORS.grayDark,
            margin: 0,
          }}
        >
          {title}
        </h2>
        {right}
      </div>
      {children}
    </div>
  );
}

function Pill({ tone = "info", children }) {
  const border =
    { info: COLORS.blue, warn: COLORS.yellow, error: COLORS.red, ok: COLORS.green }[tone] || COLORS.blue;

  return (
    <span
      style={{
        display: "inline-block",
        border: `1px solid ${border}`,
        background: COLORS.veryLightBlue,
        borderRadius: 999,
        padding: "3px 8px",
        fontSize: 12,
        fontFamily: "Urbanist, system-ui",
        color: COLORS.grayDark,
        marginLeft: 6,
      }}
    >
      {children}
    </span>
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

function normalizeInitialsTR(input) {
  const raw = String(input ?? "");
  const lettersOnly = raw.replace(/[^A-Za-zÇĞİÖŞÜçğıöşü]/g, "").slice(0, 3);
  return lettersOnly.toLocaleUpperCase("tr-TR");
}

function todayISO() {
  const d = new Date();
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  return `${yyyy}-${mm}-${dd}`;
}

function isHalfDuration(durationType) {
  return durationType === "half-am" || durationType === "half-pm";
}

function getDurationLabel(durationType) {
  if (durationType === "half-am") return "Yarım Gün (Sabah)";
  if (durationType === "half-pm") return "Yarım Gün (Öğleden Sonra)";
  return "Tam Gün";
}

function getStatusTone(status) {
  switch (status) {
    case "ready":
    case "processed":
      return "ok";
    case "insufficient_balance":
      return "warn";
    case "overlap":
    case "inactive":
    case "error":
      return "error";
    default:
      return "info";
  }
}

function getStatusLabel(status) {
  switch (status) {
    case "ready":
      return "Hazır";
    case "processed":
      return "İşlendi";
    case "insufficient_balance":
      return "Bakiye Yetersiz";
    case "overlap":
      return "Çakışan İzin";
    case "inactive":
      return "Pasif Kullanıcı";
    case "missing_balance":
      return "Bakiye Kaydı Yok";
    case "skipped":
      return "Atlandı";
    case "error":
      return "Hata";
    default:
      return status || "-";
  }
}

// --- Table styles ---
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

const textAreaStyle = {
  width: "100%",
  fontSize: 15,
  fontFamily: "Urbanist, Arial, sans-serif",
  border: "1px solid #CDE5F4",
  borderRadius: 8,
  padding: "8px 10px",
  outline: "none",
  background: "#F9FBFC",
  color: "#434344",
  resize: "vertical",
};

export default function AdminPanel() {
  const { dbUser, loading } = useUser();

  const TABS = [
    { key: "users", label: "Kullanıcılar" },
    { key: "bulk", label: "Toplu İzin İşlemi" },
    { key: "settings", label: "Ayarlar" },
    { key: "holidays", label: "Resmi Tatiller" },
    { key: "backups", label: "Yedekler" },
  ];

  const [active, setActive] = useState("users");

  const [users, setUsers] = useState([]);
  const [annualType, setAnnualType] = useState(null);
  const [leaveTypes, setLeaveTypes] = useState([]);
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
  const [archivingUserId, setArchivingUserId] = useState(null);
  const [mobileEditUserId, setMobileEditUserId] = useState(null);
  const mobileEditUser = mobileEditUserId ? (users.find(u => u.id === mobileEditUserId) ?? null) : null;

  // --- Bulk leave state ---
  const [bulkUserFilter, setBulkUserFilter] = useState("");
  const [bulkLoadingPreview, setBulkLoadingPreview] = useState(false);
  const [bulkApplying, setBulkApplying] = useState(false);
  const [bulkPreview, setBulkPreview] = useState(null);
  const [bulkForm, setBulkForm] = useState({
    user_ids: [],
    leave_type_id: "",
    start_date: todayISO(),
    end_date: todayISO(),
    duration_type: "full",
    location: "Company-wide leave",
    note: "",
    send_email: false,
  });

  useEffect(() => {
    async function fetchAll() {
      const { data: usersData } = await supabase
        .from("users")
        .select("id, name, email, role, manager_email, initials")
        .eq("is_active", true);

      setUsers(usersData || []);

      const { data: typeData } = await supabase
        .from("leave_types")
        .select("*")
        .eq("name", "Annual")
        .maybeSingle();

      setAnnualType(typeData);

      const { data: leaveTypesData } = await supabase
        .from("leave_types")
        .select("*")
        .order("name", { ascending: true });

      setLeaveTypes(leaveTypesData || []);

      if (typeData) {
        const { data: balData } = await supabase
          .from("leave_balances")
          .select("*")
          .eq("leave_type_id", typeData.id);

        setBalances(balData || []);
      }

      const { data: holData } = await supabase.from("holidays").select("*").order("date");
      setHolidays(holData || []);

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

  useEffect(() => {
    if (!bulkForm.leave_type_id && leaveTypes.length > 0) {
      const annual = leaveTypes.find((lt) => lt.name === "Annual");
      setBulkForm((prev) => ({
        ...prev,
        leave_type_id: annual?.id || leaveTypes[0].id,
      }));
    }
  }, [leaveTypes, bulkForm.leave_type_id]);

  useEffect(() => {
    if (isHalfDuration(bulkForm.duration_type) && bulkForm.end_date !== bulkForm.start_date) {
      setBulkForm((prev) => ({
        ...prev,
        end_date: prev.start_date,
      }));
    }
  }, [bulkForm.duration_type, bulkForm.start_date, bulkForm.end_date]);

  const filteredBulkUsers = useMemo(() => {
    const q = bulkUserFilter.trim().toLocaleLowerCase("tr-TR");
    const sorted = [...users].sort((a, b) => {
      const an = a.name || a.email || "";
      const bn = b.name || b.email || "";
      return an.localeCompare(bn, "tr");
    });

    if (!q) return sorted;

    return sorted.filter((u) => {
      const hay = `${u.name || ""} ${u.email || ""} ${u.manager_email || ""}`.toLocaleLowerCase("tr-TR");
      return hay.includes(q);
    });
  }, [users, bulkUserFilter]);

  const selectedBulkUsers = useMemo(() => {
    const setIds = new Set(bulkForm.user_ids);
    return users.filter((u) => setIds.has(u.id));
  }, [users, bulkForm.user_ids]);

  function onEdit(user_id, field, value) {
    setEditing((prev) => ({ ...prev, [`${user_id}_${field}`]: value }));
  }

  function getBal(user_id) {
    if (!annualType) return {};
    return balances.find((b) => b.user_id === user_id && b.leave_type_id === annualType.id) || {};
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

  async function getAuthTokenOrToast() {
    let token = "";
    try {
      const { data } = await supabase.auth.getSession();
      token = data?.session?.access_token;
    } catch {
      token = "";
    }

    if (!token) {
      setMessage("Oturum bulunamadı, lütfen tekrar giriş yapın.");
      toast.error("Oturum bulunamadı, lütfen tekrar giriş yapın.");
      return null;
    }

    return token;
  }

  async function onConfirmSave() {
    if (!confirmingUser) return;

    setConfirmingUser(null);
    setAdminNote("");
    setSavingUserId(confirmingUser.id);
    setMessage("");

    const bal = getBal(confirmingUser?.id);
    const key = (field) => `${confirmingUser.id}_${field}`;
    const parseOrZero = (val) => (isNaN(Number(val)) || val === "" ? 0 : Number(val));
    const remaining = parseOrZero(editing[key("remaining")] ?? bal?.remaining ?? "");

    const token = await getAuthTokenOrToast();
    if (!token) {
      setSavingUserId(null);
      setConfirmingUser(null);
      setAdminNote("");
      return;
    }

    try {
      const res = await fetch(EDGE_FUNCTION_URL, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
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
          const updated = prev.map((balItem) => {
            if (balItem.user_id === confirmingUser.id && balItem.leave_type_id === annualType.id) {
              found = true;
              return { ...balItem, remaining, last_updated: new Date().toISOString() };
            }
            return balItem;
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
    } catch {
      setMessage("Kaydetme sırasında hata oluştu.");
      toast.error("Kaydetme sırasında hata oluştu.");
    }

    setSavingUserId(null);
  }

  async function handleManagerChange(userId, newManagerEmail) {
    setMessage("");

    const token = await getAuthTokenOrToast();
    if (!token) return;

    try {
      const res = await fetch(ASSIGN_MANAGER_URL, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify({ user_id: userId, manager_email: newManagerEmail }),
      });

      const data = await res.json();

      if (!data.success) {
        setMessage(data.error || "Yönetici atama başarısız.");
        toast.error(data.error || "Yönetici atama başarısız.");
      } else {
        setUsers((prev) => prev.map((u) => (u.id === userId ? { ...u, manager_email: newManagerEmail } : u)));
        setMessage("Yönetici değiştirildi.");
        toast.success("Yönetici değiştirildi.");
      }
    } catch {
      setMessage("Yönetici atama sırasında hata oluştu.");
      toast.error("Yönetici atama sırasında hata oluştu.");
    }
  }

  async function onSaveUserInfo(user) {
    setSavingUserId(user.id);
    setMessage("");

    const token = await getAuthTokenOrToast();
    if (!token) {
      setSavingUserId(null);
      return;
    }

    const name = editing[`${user.id}_name`] ?? user.name ?? "";
    const initials = normalizeInitialsTR(editing[`${user.id}_initials`] ?? user.initials ?? "");

    if (!/^[A-ZÇĞİÖŞÜ]{2}[A-ZÇĞİÖŞÜ]?$/.test(initials)) {
      setMessage("Baş harfler 2 veya 3 karakter olmalı ve büyük harf olmalı (TR destekli).");
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
      const res = await fetch(UPDATE_USER_INFO_URL, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify({ user_id: user.id, name, initials }),
      });

      const data = await res.json();

      if (!data.success) {
        setMessage(data.error || "Kaydetme işlemi başarısız oldu.");
        toast.error(data.error || "Kaydetme işlemi başarısız oldu.");
      } else {
        setUsers((prev) => prev.map((u) => (u.id === user.id ? { ...u, name, initials } : u)));
        setMessage("Kullanıcı adı ve baş harfler güncellendi.");
        toast.success("Kullanıcı adı ve baş harfler güncellendi!");
        setEditing((ed) => {
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

    const token = await getAuthTokenOrToast();
    if (!token) return;

    try {
      const res = await fetch(ASSIGN_ROLE_URL, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify({ user_id: userId, role: newRole }),
      });

      const data = await res.json();

      if (!data.success) {
        setMessage(data.error || "Rol atama başarısız.");
        toast.error(data.error || "Rol atama başarısız.");
      } else {
        setUsers((prev) => prev.map((u) => (u.id === userId ? { ...u, role: newRole } : u)));
        setMessage("Rol güncellendi.");
        toast.success("Rol güncellendi.");
      }
    } catch {
      setMessage("Rol atama sırasında hata oluştu.");
      toast.error("Rol atama sırasında hata oluştu.");
    }
  }

  async function archiveUser(user) {
    const ok = window.confirm(
      `${user.name || user.email} kullanıcısını arşivlemek istediğinize emin misiniz?\n\n` +
        "Bu işlem kullanıcıyı pasifleştirir. Geçmiş izin kayıtları korunur."
    );
    if (!ok) return;

    const reason = prompt("Arşiv sebebi (ör: İstifa / İşten ayrıldı / Sözleşme bitti):", "İşten ayrıldı");
    if (reason === null) return;

    setArchivingUserId(user.id);
    setMessage("");

    const { error } = await supabase
      .from("users")
      .update({
        is_active: false,
        archived_at: new Date().toISOString(),
        archived_reason: reason,
      })
      .eq("id", user.id);

    if (error) {
      setMessage("Arşivleme sırasında hata oluştu.");
      toast.error(error.message || "Arşivleme sırasında hata oluştu.");
      setArchivingUserId(null);
      return;
    }

    await supabase.from("users_logs").insert([
      {
        target_user_id: user.id,
        action: "ARCHIVE_USER",
        old_manager_email: user.manager_email ?? null,
        new_manager_email: user.manager_email ?? null,
        old_role: user.role ?? null,
        new_role: user.role ?? null,
        performed_by: dbUser.id,
        performed_by_email: dbUser.email,
        note: reason,
      },
    ]);

    setUsers((prev) => prev.filter((u) => u.id !== user.id));
    setMobileEditUserId(null);

    toast.success("Kullanıcı arşivlendi.");
    setMessage("Kullanıcı arşivlendi.");
    setArchivingUserId(null);
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

    setUsers((prev) => prev.map((u) => (u.id === userId ? { ...u, ...updatedUser } : u)));
    setMessage("Kullanıcı bilgisi yenilendi.");
    toast.success("Kullanıcı bilgisi yenilendi.");
    setRefreshingUserId(null);
    setRecentlyRefreshedUserId(userId);
    setTimeout(() => setRecentlyRefreshedUserId(null), 1000);
  }

  async function handleAddHoliday(e) {
    e.preventDefault();
    setAddingHoliday(true);

    const newRow = {
      date: newHolidayDate,
      name: newHolidayName,
      is_half_day: isHalfDay,
      half: isHalfDay ? half : null,
    };

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
      setHolidays(holidays.filter((hol) => hol.id !== h.id));
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

  function setBulkField(field, value) {
    setBulkForm((prev) => {
      const next = { ...prev, [field]: value };

      if (field === "duration_type" && isHalfDuration(value)) {
        next.end_date = next.start_date;
      }

      if (field === "start_date" && isHalfDuration(prev.duration_type)) {
        next.end_date = value;
      }

      return next;
    });
  }

  function toggleBulkUser(userId) {
    setBulkForm((prev) => {
      const exists = prev.user_ids.includes(userId);
      return {
        ...prev,
        user_ids: exists ? prev.user_ids.filter((id) => id !== userId) : [...prev.user_ids, userId],
      };
    });
  }

  function selectAllFilteredBulkUsers() {
    const ids = filteredBulkUsers.map((u) => u.id);
    setBulkForm((prev) => ({
      ...prev,
      user_ids: Array.from(new Set([...prev.user_ids, ...ids])),
    }));
  }

  function clearAllBulkUsers() {
    setBulkForm((prev) => ({
      ...prev,
      user_ids: [],
    }));
  }

  function resetBulkPreview() {
    setBulkPreview(null);
  }

  function validateBulkForm() {
    if (!bulkForm.user_ids.length) {
      toast.error("Lütfen en az bir çalışan seçin.");
      return false;
    }

    if (!bulkForm.leave_type_id) {
      toast.error("Lütfen izin türü seçin.");
      return false;
    }

    if (!bulkForm.start_date || !bulkForm.end_date) {
      toast.error("Lütfen başlangıç ve bitiş tarihlerini girin.");
      return false;
    }

    if (bulkForm.start_date > bulkForm.end_date) {
      toast.error("Başlangıç tarihi, bitiş tarihinden sonra olamaz.");
      return false;
    }

    if (isHalfDuration(bulkForm.duration_type) && bulkForm.start_date !== bulkForm.end_date) {
      toast.error("Yarım gün işleminde başlangıç ve bitiş tarihi aynı olmalıdır.");
      return false;
    }

    return true;
  }

  async function handleBulkPreview() {
    setMessage("");
    resetBulkPreview();

    if (!validateBulkForm()) return;

    const token = await getAuthTokenOrToast();
    if (!token) return;

    setBulkLoadingPreview(true);

    try {
      const res = await fetch(BULK_COMPANY_LEAVE_URL, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          mode: "preview",
          ...bulkForm,
        }),
      });

      const data = await res.json();

      if (!res.ok || !data?.success) {
        toast.error(data?.error || "Ön izleme alınamadı.");
        setBulkPreview(null);
        return;
      }

      setBulkPreview(data);
      toast.success("Ön izleme hazır.");
    } catch {
      toast.error("Ön izleme sırasında hata oluştu.");
      setBulkPreview(null);
    } finally {
      setBulkLoadingPreview(false);
    }
  }

  async function handleBulkApply() {
    if (!bulkPreview) {
      toast.error("Önce ön izleme alın.");
      return;
    }

    const token = await getAuthTokenOrToast();
    if (!token) return;

    let insufficientAction = "skip";
    const insufficientCount = Number(bulkPreview?.summary?.insufficient_balance || 0);

    if (insufficientCount > 0) {
      const confirmDeduct = window.confirm(
        `${insufficientCount} çalışan için bakiye yetersiz görünüyor.\n\n` +
          `Tamam = Yetersiz bakiyeye rağmen düş\n` +
          `İptal = Yetersiz bakiyeli çalışanları atla`
      );

      insufficientAction = confirmDeduct ? "deduct_anyway" : "skip";
    }

    const finalConfirm = window.confirm(
      `Toplu izin işlemi uygulanacak.\n\n` +
        `Seçili çalışan: ${bulkForm.user_ids.length}\n` +
        `Yetersiz bakiye aksiyonu: ${
          insufficientAction === "deduct_anyway" ? "Düş" : "Atla"
        }\n\nDevam edilsin mi?`
    );

    if (!finalConfirm) {
      toast("İşlem iptal edildi.");
      return;
    }

    setBulkApplying(true);

    try {
      const res = await fetch(BULK_COMPANY_LEAVE_URL, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          mode: "apply",
          insufficient_balance_action: insufficientAction,
          ...bulkForm,
        }),
      });

      const data = await res.json();

      if (!res.ok || !data?.success) {
        toast.error(data?.error || "Toplu işlem uygulanamadı.");
        return;
      }

      setBulkPreview(data);
      toast.success("Toplu izin işlemi tamamlandı.");
    } catch {
      toast.error("Toplu işlem sırasında hata oluştu.");
    } finally {
      setBulkApplying(false);
    }
  }

  if (loading || loadingAnnualType || typeof annualType === "undefined" || !dbUser) {
    return <div style={{ fontFamily: "Urbanist" }}>Yükleniyor…</div>;
  }

  if (!annualType) {
    return <div style={{ fontFamily: "Urbanist" }}>'Yıllık' izin tipi tanımlı değil.</div>;
  }

  return (
    <div
      className="admin-panel-wrapper"
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
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          marginBottom: 12,
          gap: 10,
          flexWrap: "wrap",
        }}
      >
        <h1 style={{ margin: 0, fontSize: 22, color: COLORS.grayDark, fontWeight: 800 }}>
          Yönetici Paneli
        </h1>
        {message && (
          <div
            style={{
              color:
                message.includes("hata") || message.includes("başarısız") ? COLORS.red : "#1C6234",
              fontWeight: 700,
            }}
          >
            {message}
          </div>
        )}
      </div>

      {/* Tab bar */}
      <div
        role="tablist"
        aria-label="Admin Tabs"
        className="admin-tab-bar"
        style={{
          display: "flex",
          gap: 8,
          background: COLORS.veryLightBlue,
          border: `1px solid ${COLORS.lightBlue}`,
          padding: 6,
          borderRadius: 12,
          marginBottom: 14,
          flexWrap: "wrap",
        }}
      >
        {TABS.map((t) => {
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

          {/* ── Mobile list (hidden on desktop) ── */}
          <div className="admin-users-mobile-list">
            {[...users].sort((a, b) => a.email.localeCompare(b.email)).map(user => (
              <button
                key={user.id}
                className="admin-user-list-item"
                onClick={() => setMobileEditUserId(user.id)}
              >
                <div className="admin-user-list-avatar">
                  {(user.initials || (user.name || user.email).slice(0, 2)).toUpperCase()}
                </div>
                <div className="admin-user-list-info">
                  <div className="admin-user-list-name">{user.name || user.email}</div>
                  <div className="admin-user-list-email">{user.email.replace("@terralab.com.tr", "")}@…</div>
                </div>
                <Pill tone={user.role === "admin" ? "ok" : user.role === "manager" ? "info" : undefined}>
                  {user.role === "admin" ? "Admin" : user.role === "manager" ? "Yönetici" : "Kullanıcı"}
                </Pill>
              </button>
            ))}
          </div>

          {/* ── Desktop table (hidden on mobile) ── */}
          <div className="admin-users-table-wrapper">
          <div style={{ overflowX: "auto" }}>
            <table
              style={{
                width: "100%",
                fontSize: 16,
                borderSpacing: 0,
                minWidth: 820,
              }}
            >
              <thead>
                <tr style={{ background: COLORS.veryLightBlue, color: COLORS.grayDark }}>
                  <th></th>
                  <th style={th}>Ad / Başh.</th>
                  <th style={th}>@terralab.com.tr</th>
                  <th style={th}>Rol</th>
                  <th style={th}>Yön.</th>
                  <th style={{ ...th, borderLeft: `2px solid ${COLORS.veryLightBlue}`, width: 78 }}>
                    Kalan
                  </th>
                  <th style={{ ...th, width: 70 }}>İşlem</th>
                </tr>
              </thead>
              <tbody>
                {[...users]
                  .sort((a, b) => a.email.localeCompare(b.email))
                  .map((user) => {
                    const key = (field) => `${user.id}_${field}`;
                    const name = editing[key("name")] ?? user.name ?? "";
                    const initials = normalizeInitialsTR(editing[key("initials")] ?? user.initials ?? "");
                    const remaining = editing[key("remaining")] ?? getBal(user.id).remaining ?? "";
                    const username = user.email.replace("@terralab.com.tr", "");
                    const highlight = recentlyRefreshedUserId === user.id;

                    return (
                      <tr
                        key={user.id}
                        style={{
                          transition: "background 0.5s, opacity 0.5s",
                          background: highlight ? "#e9faf5" : undefined,
                          opacity: refreshingUserId === user.id ? 0.5 : 1,
                        }}
                      >
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
                              cursor: refreshingUserId === user.id ? "not-allowed" : "pointer",
                            }}
                            title="Satırı yenile"
                            onClick={() => handleRefreshUser(user.id)}
                            disabled={refreshingUserId === user.id}
                          >
                            🔄
                          </button>
                        </td>

                        <td
                          style={{
                            ...td,
                            textAlign: "left",
                            minWidth: 120,
                            maxWidth: 220,
                            display: "flex",
                            alignItems: "center",
                            gap: 8,
                          }}
                        >
                          <input
                            type="text"
                            value={name}
                            onChange={(e) => onEdit(user.id, "name", e.target.value)}
                            style={{
                              ...inputStyle,
                              width: 130,
                              fontWeight: 600,
                              fontSize: 15,
                              marginRight: 2,
                            }}
                            maxLength={60}
                            placeholder="Ad Soyad"
                            autoComplete="off"
                          />

                          <input
                            type="text"
                            value={initials}
                            onFocus={(e) => e.target.select()}
                            onChange={(e) => {
                              const val = normalizeInitialsTR(e.target.value);
                              onEdit(user.id, "initials", val);
                            }}
                            style={{
                              ...inputStyle,
                              width: 42,
                              textAlign: "center",
                              fontWeight: 700,
                              fontSize: 14,
                              background: "#FFF2DC",
                              color: COLORS.orange,
                            }}
                            maxLength={3}
                            minLength={2}
                            placeholder="İLK."
                            title="2–3 harf (TR), büyük harf"
                            autoComplete="off"
                          />
                        </td>

                        <td
                          style={{
                            ...td,
                            fontSize: 14,
                            maxWidth: 130,
                            overflow: "hidden",
                            textOverflow: "ellipsis",
                          }}
                        >
                          {username}
                        </td>

                        <td style={td}>
                          {user.role === "admin" ? (
                            <Pill tone="ok">Admin</Pill>
                          ) : (
                            <select
                              value={user.role}
                              onChange={(e) => handleRoleChange(user.id, e.target.value)}
                              style={{ ...inputStyle, width: 112 }}
                            >
                              <option value="user">Kullanıcı</option>
                              <option value="manager">Yönetici</option>
                            </select>
                          )}
                        </td>

                        <td style={{ ...td, minWidth: 220, textAlign: "left" }}>
                          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                            {user.role === "admin" ? (
                              <div style={{ flex: 1, color: COLORS.grayDark }}>
                                {users.find((u) => u.email === user.manager_email)?.name ||
                                  user.manager_email ||
                                  "-"}
                              </div>
                            ) : (
                              <select
                                value={user.manager_email || ""}
                                onChange={(e) => handleManagerChange(user.id, e.target.value)}
                                style={{ ...inputStyle, width: 180 }}
                              >
                                <option value="">Yok</option>
                                {[...users]
                                  .filter((u) => u.email !== user.email)
                                  .sort((a, b) => a.email.localeCompare(b.email))
                                  .map((mgr) => (
                                    <option key={mgr.email} value={mgr.email}>
                                      {mgr.name || mgr.email}
                                    </option>
                                  ))}
                              </select>
                            )}

                            <button
                              onClick={() => onSaveUserInfo(user)}
                              disabled={savingUserId === user.id}
                              title="Kullanıcı bilgilerini kaydet"
                              style={{
                                background: COLORS.blue,
                                border: "none",
                                borderRadius: 7,
                                width: 34,
                                height: 30,
                                color: "#fff",
                                fontWeight: 900,
                                fontSize: 19,
                                display: "inline-flex",
                                alignItems: "center",
                                justifyContent: "center",
                                boxShadow: "0 1px 3px #cde5f470",
                                cursor: savingUserId === user.id ? "not-allowed" : "pointer",
                                opacity: savingUserId === user.id ? 0.6 : 1,
                                flexShrink: 0,
                              }}
                            >
                              ✔
                            </button>
                          </div>
                        </td>

                        <td
                          style={{
                            ...td,
                            borderLeft: `2px solid ${COLORS.veryLightBlue}`,
                            background: "#f8fbfd",
                            width: 78,
                          }}
                        >
                          <input
                            type="number"
                            value={remaining}
                            onChange={(e) => onEdit(user.id, "remaining", e.target.value)}
                            style={{ ...inputStyle, width: 60, fontSize: 15 }}
                            min={0}
                          />
                        </td>

                        <td style={{ ...td, background: "#f8fbfd", width: 64 }}>
                          <div
                            style={{
                              display: "flex",
                              flexDirection: "column",
                              gap: 6,
                              alignItems: "center",
                            }}
                          >
                            <button
                              style={{
                                background: COLORS.orange,
                                color: "#fff",
                                border: "none",
                                borderRadius: 7,
                                width: 34,
                                height: 30,
                                fontSize: 17,
                                padding: 0,
                                cursor: savingUserId === user.id ? "not-allowed" : "pointer",
                              }}
                              disabled={savingUserId === user.id}
                              onClick={() => onSaveClick(user)}
                              title="Bakiyeyi Kaydet (E-posta gönderir)"
                            >
                              💾
                            </button>

                            <button
                              onClick={() => archiveUser(user)}
                              disabled={archivingUserId === user.id}
                              title="Kullanıcıyı arşivle (pasifleştir)"
                              style={{
                                background: COLORS.gray,
                                color: "#fff",
                                border: "none",
                                borderRadius: 7,
                                width: 34,
                                height: 30,
                                fontSize: 16,
                                padding: 0,
                                cursor: archivingUserId === user.id ? "not-allowed" : "pointer",
                                opacity: archivingUserId === user.id ? 0.6 : 1,
                              }}
                            >
                              🗃
                            </button>
                          </div>
                        </td>
                      </tr>
                    );
                  })}
              </tbody>
            </table>
          </div>
          </div>{/* end admin-users-table-wrapper */}

          {/* ── Mobile edit bottom-sheet modal ── */}
          {mobileEditUser && (
            <div className="admin-mobile-overlay" onClick={() => setMobileEditUserId(null)}>
              <div className="admin-mobile-sheet" onClick={e => e.stopPropagation()}>

                {/* Header */}
                <div className="admin-mobile-sheet-header">
                  <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
                    <div className="admin-user-list-avatar" style={{ width: 44, height: 44, fontSize: 17 }}>
                      {(mobileEditUser.initials || (mobileEditUser.name || mobileEditUser.email).slice(0, 2)).toUpperCase()}
                    </div>
                    <div>
                      <div style={{ fontWeight: 800, fontSize: 16, color: COLORS.grayDark }}>{mobileEditUser.name || mobileEditUser.email}</div>
                      <div style={{ fontSize: 13, color: COLORS.gray }}>{mobileEditUser.email}</div>
                    </div>
                  </div>
                  <button className="admin-mobile-close" onClick={() => setMobileEditUserId(null)}>✕</button>
                </div>

                {/* User info fields */}
                <div className="admin-mobile-section-label">Kullanıcı Bilgileri</div>
                <div className="admin-mobile-field">
                  <label>Ad Soyad</label>
                  <input
                    type="text"
                    value={editing[`${mobileEditUser.id}_name`] ?? mobileEditUser.name ?? ""}
                    onChange={e => onEdit(mobileEditUser.id, "name", e.target.value)}
                    maxLength={60}
                    autoComplete="off"
                    className="admin-mobile-input"
                  />
                </div>
                <div className="admin-mobile-field">
                  <label>Baş Harfler</label>
                  <input
                    type="text"
                    value={normalizeInitialsTR(editing[`${mobileEditUser.id}_initials`] ?? mobileEditUser.initials ?? "")}
                    onChange={e => onEdit(mobileEditUser.id, "initials", normalizeInitialsTR(e.target.value))}
                    maxLength={3}
                    autoComplete="off"
                    className="admin-mobile-input"
                    style={{ maxWidth: 80 }}
                  />
                </div>
                <button
                  className="admin-mobile-btn-primary"
                  onClick={() => onSaveUserInfo(mobileEditUser)}
                  disabled={savingUserId === mobileEditUser.id}
                >
                  {savingUserId === mobileEditUser.id ? "Kaydediliyor…" : "✔ Bilgileri Kaydet"}
                </button>

                {/* Role & manager */}
                <div className="admin-mobile-section-label">Rol & Yönetici</div>
                {mobileEditUser.role === "admin" ? (
                  <div style={{ marginBottom: 12 }}><Pill tone="ok">Admin</Pill></div>
                ) : (
                  <div className="admin-mobile-field">
                    <label>Rol</label>
                    <select
                      value={mobileEditUser.role}
                      onChange={e => handleRoleChange(mobileEditUser.id, e.target.value)}
                      className="admin-mobile-input"
                    >
                      <option value="user">Kullanıcı</option>
                      <option value="manager">Yönetici</option>
                    </select>
                  </div>
                )}
                {mobileEditUser.role !== "admin" && (
                  <div className="admin-mobile-field">
                    <label>Yönetici</label>
                    <select
                      value={mobileEditUser.manager_email || ""}
                      onChange={e => handleManagerChange(mobileEditUser.id, e.target.value)}
                      className="admin-mobile-input"
                    >
                      <option value="">Yok</option>
                      {[...users]
                        .filter(u => u.email !== mobileEditUser.email)
                        .sort((a, b) => a.email.localeCompare(b.email))
                        .map(mgr => (
                          <option key={mgr.email} value={mgr.email}>{mgr.name || mgr.email}</option>
                        ))}
                    </select>
                  </div>
                )}

                {/* Balance */}
                <div className="admin-mobile-section-label">İzin Bakiyesi</div>
                <div className="admin-mobile-field">
                  <label>Kalan (gün)</label>
                  <input
                    type="number"
                    min={0}
                    value={editing[`${mobileEditUser.id}_remaining`] ?? getBal(mobileEditUser.id).remaining ?? ""}
                    onChange={e => onEdit(mobileEditUser.id, "remaining", e.target.value)}
                    className="admin-mobile-input"
                    style={{ maxWidth: 100 }}
                  />
                </div>
                <button
                  className="admin-mobile-btn-primary"
                  onClick={() => onSaveClick(mobileEditUser)}
                  disabled={savingUserId === mobileEditUser.id}
                >
                  💾 Bakiyeyi Kaydet
                </button>

                {/* Archive */}
                <div style={{ marginTop: 24, paddingTop: 16, borderTop: `1px solid ${COLORS.veryLightBlue}` }}>
                  <button
                    className="admin-mobile-btn-danger"
                    onClick={() => archiveUser(mobileEditUser)}
                    disabled={archivingUserId === mobileEditUser.id}
                  >
                    {archivingUserId === mobileEditUser.id ? "Arşivleniyor…" : "🗃 Kullanıcıyı Arşivle"}
                  </button>
                </div>

              </div>
            </div>
          )}

          {confirmingUser && (
            <div
              style={{
                position: "fixed",
                left: 0,
                top: 0,
                width: "100vw",
                height: "100vh",
                background: "rgba(33,47,62,0.22)",
                zIndex: 999,
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
              }}
            >
              <div
                style={{
                  background: "#fff",
                  borderRadius: 12,
                  padding: "32px 28px",
                  boxShadow: "0 4px 28px #a8d2f285",
                  width: "90%",
                  maxWidth: 440,
                  border: `1px solid ${COLORS.veryLightBlue}`,
                }}
              >
                <h3
                  style={{
                    color: COLORS.orange,
                    marginBottom: 8,
                    fontWeight: 700,
                    fontSize: 22,
                  }}
                >
                  Kaydı Onayla
                </h3>
                <div style={{ marginBottom: 16, color: COLORS.grayDark, fontWeight: 500 }}>
                  <div>
                    <b>{confirmingUser.name || confirmingUser.email}</b> kullanıcısının bakiyesi
                    güncellenecek.
                  </div>
                  <div style={{ fontSize: 15, margin: "10px 0 2px 0" }}>
                    Bu işlem çalışana ve yöneticisine e-posta bildirimi gönderir.
                  </div>
                </div>
                <div style={{ marginBottom: 18 }}>
                  <label htmlFor="admin-note" style={{ fontSize: 15, fontWeight: 500 }}>
                    Açıklama (e-postada gösterilecek):
                  </label>
                  <textarea
                    id="admin-note"
                    value={adminNote}
                    onChange={(e) => setAdminNote(e.target.value)}
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
                      cursor: "pointer",
                    }}
                    onClick={onCancelConfirm}
                  >
                    İptal
                  </button>
                  <button
                    style={{
                      background: COLORS.orange,
                      color: "#fff",
                      fontWeight: 700,
                      border: "none",
                      borderRadius: 7,
                      padding: "7px 22px",
                      fontSize: 17,
                      cursor: "pointer",
                    }}
                    onClick={onConfirmSave}
                  >
                    Onayla ve Kaydet
                  </button>
                </div>
              </div>
            </div>
          )}
        </Section>
      )}

      {/* BULK TAB */}
      {active === "bulk" && (
        <Section
          title="Toplu İzin İşlemi"
          right={
            <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
              <Pill tone="info">Önce Ön İzleme</Pill>
              <Pill tone="warn">Bakiye yetersizse admin karar verir</Pill>
            </div>
          }
        >
          <div
            style={{
              border: `1px solid ${COLORS.veryLightBlue}`,
              background: "#F8FBFD",
              borderRadius: 14,
              padding: 16,
              marginBottom: 16,
            }}
          >
            <div
              style={{
                display: "grid",
                gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))",
                gap: 12,
                marginBottom: 14,
              }}
            >
              <div>
                <label style={{ display: "block", marginBottom: 6, fontWeight: 700, color: COLORS.grayDark }}>
                  İzin Türü
                </label>
                <select
                  value={bulkForm.leave_type_id}
                  onChange={(e) => setBulkField("leave_type_id", e.target.value)}
                  style={{ ...inputStyle, width: "100%", padding: "8px 10px" }}
                >
                  <option value="">Seçin</option>
                  {leaveTypes.map((lt) => (
                    <option key={lt.id} value={lt.id}>
                      {lt.name}
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label style={{ display: "block", marginBottom: 6, fontWeight: 700, color: COLORS.grayDark }}>
                  Süre
                </label>
                <select
                  value={bulkForm.duration_type}
                  onChange={(e) => setBulkField("duration_type", e.target.value)}
                  style={{ ...inputStyle, width: "100%", padding: "8px 10px" }}
                >
                  <option value="full">Tam Gün</option>
                  <option value="half-am">Yarım Gün (Sabah)</option>
                  <option value="half-pm">Yarım Gün (Öğleden Sonra)</option>
                </select>
              </div>

              <div>
                <label style={{ display: "block", marginBottom: 6, fontWeight: 700, color: COLORS.grayDark }}>
                  Başlangıç Tarihi
                </label>
                <input
                  type="date"
                  value={bulkForm.start_date}
                  onChange={(e) => setBulkField("start_date", e.target.value)}
                  style={{ ...inputStyle, width: "100%", padding: "8px 10px" }}
                />
              </div>

              <div>
                <label style={{ display: "block", marginBottom: 6, fontWeight: 700, color: COLORS.grayDark }}>
                  Bitiş Tarihi
                </label>
                <input
                  type="date"
                  value={bulkForm.end_date}
                  onChange={(e) => setBulkField("end_date", e.target.value)}
                  style={{ ...inputStyle, width: "100%", padding: "8px 10px" }}
                  disabled={isHalfDuration(bulkForm.duration_type)}
                />
              </div>

              <div>
                <label style={{ display: "block", marginBottom: 6, fontWeight: 700, color: COLORS.grayDark }}>
                  Lokasyon
                </label>
                <input
                  type="text"
                  value={bulkForm.location}
                  onChange={(e) => setBulkField("location", e.target.value)}
                  placeholder="Company-wide leave"
                  style={{ ...inputStyle, width: "100%", padding: "8px 10px" }}
                />
              </div>

              <div style={{ display: "flex", alignItems: "flex-end" }}>
                <label
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: 8,
                    fontWeight: 600,
                    color: COLORS.grayDark,
                    paddingBottom: 8,
                  }}
                >
                  <input
                    type="checkbox"
                    checked={bulkForm.send_email}
                    onChange={(e) => setBulkField("send_email", e.target.checked)}
                  />
                  E-posta bildirimi gönder
                </label>
              </div>
            </div>

            <div style={{ marginBottom: 14 }}>
              <label style={{ display: "block", marginBottom: 6, fontWeight: 700, color: COLORS.grayDark }}>
                Not
              </label>
              <textarea
                value={bulkForm.note}
                onChange={(e) => setBulkField("note", e.target.value)}
                placeholder="Örn: Bayram öncesi şirket genel izin düşümü"
                rows={3}
                style={textAreaStyle}
              />
            </div>

            <div
              style={{
                border: `1px solid ${COLORS.lightBlue}`,
                background: "#fff",
                borderRadius: 12,
                padding: 14,
              }}
            >
              <div
                style={{
                  display: "flex",
                  justifyContent: "space-between",
                  gap: 10,
                  flexWrap: "wrap",
                  alignItems: "center",
                  marginBottom: 12,
                }}
              >
                <div>
                  <div style={{ fontWeight: 800, color: COLORS.grayDark, marginBottom: 4 }}>
                    Çalışan Seçimi
                  </div>
                  <div style={{ fontSize: 14, color: COLORS.gray }}>
                    Seçilen çalışan sayısı: <b>{bulkForm.user_ids.length}</b>
                  </div>
                </div>

                <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                  <input
                    type="text"
                    value={bulkUserFilter}
                    onChange={(e) => setBulkUserFilter(e.target.value)}
                    placeholder="İsim veya e-posta ara"
                    style={{ ...inputStyle, width: 220, padding: "8px 10px" }}
                  />
                  <button
                    type="button"
                    onClick={selectAllFilteredBulkUsers}
                    style={{
                      background: COLORS.blue,
                      color: "#fff",
                      border: "none",
                      borderRadius: 8,
                      padding: "8px 12px",
                      fontWeight: 700,
                      cursor: "pointer",
                    }}
                  >
                    Filtredekileri Seç
                  </button>
                  <button
                    type="button"
                    onClick={clearAllBulkUsers}
                    style={{
                      background: COLORS.gray,
                      color: "#fff",
                      border: "none",
                      borderRadius: 8,
                      padding: "8px 12px",
                      fontWeight: 700,
                      cursor: "pointer",
                    }}
                  >
                    Temizle
                  </button>
                </div>
              </div>

              <div
                style={{
                  maxHeight: 320,
                  overflowY: "auto",
                  border: `1px solid ${COLORS.veryLightBlue}`,
                  borderRadius: 10,
                  background: "#F9FBFC",
                  padding: 8,
                }}
              >
                {filteredBulkUsers.length === 0 ? (
                  <div style={{ padding: 16, color: COLORS.gray }}>Kullanıcı bulunamadı.</div>
                ) : (
                  <div
                    style={{
                      display: "grid",
                      gridTemplateColumns: "repeat(auto-fit, minmax(260px, 1fr))",
                      gap: 8,
                    }}
                  >
                    {filteredBulkUsers.map((user) => {
                      const checked = bulkForm.user_ids.includes(user.id);
                      return (
                        <label
                          key={user.id}
                          style={{
                            display: "flex",
                            alignItems: "center",
                            gap: 10,
                            border: checked ? `1px solid ${COLORS.orange}` : `1px solid ${COLORS.veryLightBlue}`,
                            background: checked ? "#FFF7EC" : "#fff",
                            borderRadius: 10,
                            padding: "10px 12px",
                            cursor: "pointer",
                          }}
                        >
                          <input
                            type="checkbox"
                            checked={checked}
                            onChange={() => toggleBulkUser(user.id)}
                          />
                          <div style={{ minWidth: 0 }}>
                            <div
                              style={{
                                fontWeight: 700,
                                color: COLORS.grayDark,
                                whiteSpace: "nowrap",
                                overflow: "hidden",
                                textOverflow: "ellipsis",
                              }}
                            >
                              {user.name || user.email}
                            </div>
                            <div
                              style={{
                                fontSize: 13,
                                color: COLORS.gray,
                                whiteSpace: "nowrap",
                                overflow: "hidden",
                                textOverflow: "ellipsis",
                              }}
                            >
                              {user.email}
                            </div>
                          </div>
                        </label>
                      );
                    })}
                  </div>
                )}
              </div>
            </div>

            <div
              style={{
                display: "flex",
                gap: 10,
                justifyContent: "flex-end",
                flexWrap: "wrap",
                marginTop: 16,
              }}
            >
              <button
                type="button"
                onClick={resetBulkPreview}
                style={{
                  background: "#fff",
                  color: COLORS.grayDark,
                  border: `1px solid ${COLORS.lightBlue}`,
                  borderRadius: 8,
                  padding: "9px 14px",
                  fontWeight: 700,
                  cursor: "pointer",
                }}
              >
                Ön İzlemeyi Temizle
              </button>

              <button
                type="button"
                onClick={handleBulkPreview}
                disabled={bulkLoadingPreview}
                style={{
                  background: COLORS.orange,
                  color: "#fff",
                  border: "none",
                  borderRadius: 8,
                  padding: "9px 16px",
                  fontWeight: 800,
                  cursor: bulkLoadingPreview ? "not-allowed" : "pointer",
                  opacity: bulkLoadingPreview ? 0.7 : 1,
                }}
              >
                {bulkLoadingPreview ? "Ön İzleme Alınıyor…" : "Ön İzleme"}
              </button>
            </div>
          </div>

          {selectedBulkUsers.length > 0 && (
            <div
              style={{
                border: `1px solid ${COLORS.veryLightBlue}`,
                background: "#fff",
                borderRadius: 14,
                padding: 14,
                marginBottom: 16,
              }}
            >
              <div style={{ fontWeight: 800, color: COLORS.grayDark, marginBottom: 8 }}>
                Seçili İşlem Özeti
              </div>
              <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 8 }}>
                <Pill tone="info">{selectedBulkUsers.length} çalışan</Pill>
                <Pill tone="info">
                  {leaveTypes.find((lt) => lt.id === bulkForm.leave_type_id)?.name || "İzin Türü"}
                </Pill>
                <Pill tone="info">{getDurationLabel(bulkForm.duration_type)}</Pill>
                <Pill tone="info">
                  {formatDateTR(bulkForm.start_date)} - {formatDateTR(bulkForm.end_date)}
                </Pill>
              </div>
            </div>
          )}

          {bulkPreview && (
            <div
              style={{
                border: `1px solid ${COLORS.lightBlue}`,
                background: "#F8FBFD",
                borderRadius: 14,
                padding: 16,
              }}
            >
              <div
                style={{
                  display: "flex",
                  justifyContent: "space-between",
                  alignItems: "center",
                  flexWrap: "wrap",
                  gap: 10,
                  marginBottom: 12,
                }}
              >
                <div>
                  <div style={{ fontWeight: 800, color: COLORS.grayDark, marginBottom: 4 }}>
                    Ön İzleme Sonucu
                  </div>
                  <div style={{ fontSize: 14, color: COLORS.gray }}>
                    Uygulamadan önce durum kontrolü
                  </div>
                </div>

                <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                  <Pill tone="ok">Hazır: {bulkPreview?.summary?.ready ?? 0}</Pill>
                  <Pill tone="warn">
                    Bakiye Yetersiz: {bulkPreview?.summary?.insufficient_balance ?? 0}
                  </Pill>
                  <Pill tone="error">Çakışma: {bulkPreview?.summary?.overlap ?? 0}</Pill>
                  <Pill tone="error">Pasif: {bulkPreview?.summary?.inactive ?? 0}</Pill>
                </div>
              </div>

              <div style={{ overflowX: "auto", marginBottom: 14 }}>
                <table
                  style={{
                    width: "100%",
                    borderSpacing: 0,
                    background: "#fff",
                    border: `1px solid ${COLORS.veryLightBlue}`,
                    borderRadius: 10,
                    overflow: "hidden",
                    minWidth: 760,
                  }}
                >
                  <thead>
                    <tr style={{ background: COLORS.veryLightBlue }}>
                      <th style={th}>Çalışan</th>
                      <th style={th}>E-posta</th>
                      <th style={th}>Durum</th>
                      <th style={th}>Kalan</th>
                      <th style={th}>Gerekli</th>
                      <th style={th}>Not / Sebep</th>
                    </tr>
                  </thead>
                  <tbody>
                    {(bulkPreview?.results || []).map((row, idx) => (
                      <tr key={`${row.user_id || row.email || "row"}_${idx}`}>
                        <td style={{ ...td, textAlign: "left" }}>{row.name || "-"}</td>
                        <td style={{ ...td, textAlign: "left" }}>{row.email || "-"}</td>
                        <td style={td}>
                          <Pill tone={getStatusTone(row.status)}>{getStatusLabel(row.status)}</Pill>
                        </td>
                        <td style={td}>{row.remaining ?? "-"}</td>
                        <td style={td}>{row.needed ?? row.days ?? "-"}</td>
                        <td style={{ ...td, textAlign: "left" }}>
                          {row.reason || row.note || "-"}
                        </td>
                      </tr>
                    ))}
                    {(bulkPreview?.results || []).length === 0 && (
                      <tr>
                        <td colSpan={6} style={{ padding: 12, color: COLORS.gray }}>
                          Sonuç bulunamadı.
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>

              <div
                style={{
                  display: "flex",
                  gap: 10,
                  justifyContent: "flex-end",
                  flexWrap: "wrap",
                }}
              >
                <button
                  type="button"
                  onClick={handleBulkApply}
                  disabled={bulkApplying}
                  style={{
                    background: COLORS.orange,
                    color: "#fff",
                    border: "none",
                    borderRadius: 8,
                    padding: "10px 16px",
                    fontWeight: 800,
                    cursor: bulkApplying ? "not-allowed" : "pointer",
                    opacity: bulkApplying ? 0.7 : 1,
                  }}
                >
                  {bulkApplying ? "Uygulanıyor…" : "İşlemi Uygula"}
                </button>
              </div>
            </div>
          )}
        </Section>
      )}

      {/* SETTINGS TAB */}
      {active === "settings" && (
        <Section title="Ayarlar">
          <div
            style={{
              margin: "12px 0",
              padding: 12,
              background: "#F8FBFD",
              borderRadius: 10,
              border: `1px solid ${COLORS.veryLightBlue}`,
            }}
          >
            <label
              style={{
                fontSize: 17,
                fontWeight: 600,
                display: "flex",
                alignItems: "center",
                gap: 16,
                flexWrap: "wrap",
              }}
            >
              <span>Kullanıcılar geçmiş tarihler için izin talep edebilsin (retroaktif izin)</span>
              <div
                onClick={handleToggleRetroactive}
                style={{
                  width: 48,
                  height: 26,
                  borderRadius: 18,
                  background: allowRetroactiveLeave ? COLORS.red : COLORS.blue,
                  position: "relative",
                  cursor: "pointer",
                  transition: "background 0.25s",
                  boxShadow: allowRetroactiveLeave ? "0 0 6px #E0653A44" : "0 0 6px #A8D2F2",
                  border: allowRetroactiveLeave
                    ? `1.5px solid ${COLORS.red}`
                    : `1.5px solid ${COLORS.blue}`,
                }}
                tabIndex={0}
                role="button"
                aria-pressed={allowRetroactiveLeave}
                onKeyDown={(e) => {
                  if (e.key === " " || e.key === "Enter") handleToggleRetroactive();
                }}
                title={allowRetroactiveLeave ? "Açık" : "Kapalı"}
              >
                <span
                  style={{
                    position: "absolute",
                    left: allowRetroactiveLeave ? 24 : 2,
                    top: 2,
                    width: 22,
                    height: 22,
                    borderRadius: "50%",
                    background: "#fff",
                    boxShadow: "0 1px 4px #8883",
                    transition: "left 0.25s",
                  }}
                />
              </div>
              <span
                style={{
                  fontWeight: 700,
                  color: allowRetroactiveLeave ? COLORS.red : COLORS.blue,
                  minWidth: 68,
                }}
              >
                {allowRetroactiveLeave ? "Açık" : "Kapalı"}
              </span>
            </label>
          </div>
        </Section>
      )}

      {/* HOLIDAYS TAB */}
      {active === "holidays" && (
        <Section title="Resmi Tatil Yönetimi" right={null}>
          <form
            onSubmit={handleAddHoliday}
            style={{
              marginBottom: 18,
              display: "flex",
              gap: 8,
              alignItems: "center",
              flexWrap: "wrap",
            }}
          >
            <input
              type="date"
              required
              value={newHolidayDate}
              onChange={(e) => setNewHolidayDate(e.target.value)}
              style={{
                fontSize: 15,
                padding: 5,
                borderRadius: 6,
                border: `1px solid ${COLORS.veryLightBlue}`,
              }}
            />
            <input
              type="text"
              required
              placeholder="Tatil Adı"
              value={newHolidayName}
              onChange={(e) => setNewHolidayName(e.target.value)}
              style={{
                fontSize: 15,
                padding: 5,
                borderRadius: 6,
                border: `1px solid ${COLORS.veryLightBlue}`,
                minWidth: 200,
              }}
            />
            <label style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 15 }}>
              <input
                type="checkbox"
                checked={isHalfDay}
                onChange={(e) => setIsHalfDay(e.target.checked)}
              />
              Yarım Gün
            </label>
            {isHalfDay && (
              <select
                value={half}
                onChange={(e) => setHalf(e.target.value)}
                style={{
                  fontSize: 15,
                  borderRadius: 6,
                  border: `1px solid ${COLORS.veryLightBlue}`,
                }}
              >
                <option value="morning">Sabah</option>
                <option value="afternoon">Öğleden Sonra</option>
              </select>
            )}
            <button
              type="submit"
              disabled={addingHoliday}
              style={{
                background: COLORS.orange,
                color: "#fff",
                border: "none",
                borderRadius: 8,
                padding: "6px 18px",
                fontWeight: 700,
                cursor: addingHoliday ? "not-allowed" : "pointer",
              }}
            >
              {addingHoliday ? "Ekleniyor…" : "Ekle"}
            </button>
          </form>

          <div style={{ overflowX: "auto" }}>
            <table
              style={{
                width: "100%",
                background: "#F8FBFD",
                borderRadius: 10,
                fontSize: 16,
                border: `1px solid ${COLORS.veryLightBlue}`,
              }}
            >
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
                        style={{
                          background: "none",
                          border: "none",
                          fontSize: 20,
                          cursor: deletingHolidayId === h.id ? "not-allowed" : "pointer",
                        }}
                      >
                        {deletingHolidayId === h.id ? "…" : "🗑"}
                      </button>
                    </td>
                  </tr>
                ))}
                {holidays.length === 0 && (
                  <tr>
                    <td
                      colSpan={4}
                      style={{
                        padding: 12,
                        color: COLORS.gray,
                        fontFamily: "Urbanist, system-ui",
                      }}
                    >
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
        <Section title="Leave Balance Backups" right={<Pill tone="info">Aylık snapshot + dışa aktarım</Pill>}>
          <AdminBackups />
        </Section>
      )}

      <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
    </div>
  );
}