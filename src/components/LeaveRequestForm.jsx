import React, { useState, useEffect } from "react";
import { supabase } from "../supabaseClient";
import { useUser } from "./UserContext";
import DatePicker from "react-datepicker";
import "react-datepicker/dist/react-datepicker.css";
import { addDays, isWeekend, format, isAfter } from "date-fns";
import { tr } from "date-fns/locale";
import { RELEASES } from "../version";
import { motion, AnimatePresence } from "framer-motion";
import { toast } from "react-hot-toast";


const APP_VERSION = RELEASES[0].version;


export default function LeaveRequestForm() {
  const { dbUser, loading } = useUser();
  const [annualType, setAnnualType] = useState(null);
  const [allowRetroactiveLeave, setAllowRetroactiveLeave] = useState(false);
  const [holidaysMap, setHolidaysMap] = useState({});
  const [holidays, setHolidays] = useState([]);
  const [form, setForm] = useState({
    start_date: null,
    end_date: null,
    duration_type: "full",
    return_date: "",
    location: "",
    note: "",
  });
  const [submitting, setSubmitting] = useState(false);
  const [result, setResult] = useState("");

  function isHoliday(date) {
  const d = format(date, "yyyy-MM-dd");
  // holidaysMap[d] is defined AND not a half-day holiday
  return holidaysMap[d] && !holidaysMap[d].is_half_day;
}

  useEffect(() => {
    supabase
      .from("holidays")
      .select("date, is_half_day, half")
      .then(({ data }) => {
         setHolidays(data || []);
      });
  }, []);

useEffect(() => {
  async function fetchSettings() {
    const { data } = await supabase.from("settings").select("allow_retroactive_leave").single();
    if (data) setAllowRetroactiveLeave(data.allow_retroactive_leave);
  }
  fetchSettings();
}, []);

useEffect(() => {
    const obj = {};
    holidays.forEach(h => {
      obj[h.date] = h; // h: { date, is_half_day, half }
    });
    setHolidaysMap(obj);
  }, [holidays]);

useEffect(() => {
  async function fetchAnnualType() {
    const { data, error } = await supabase
      .from("leave_types")
      .select("id")
      .eq("name", "Annual")
      .maybeSingle();
    if (!error && data) {
      setAnnualType(data);
    }
  }
  fetchAnnualType();
}, []);
useEffect(() => {
  if (!form.start_date || !form.end_date) {
    setForm(f => ({ ...f, return_date: "" }));
    return;
  }

  const isSingleDay = format(form.start_date, "yyyy-MM-dd") === format(form.end_date, "yyyy-MM-dd");

  // Handle half-day logic
  if (isSingleDay && form.duration_type === "half-am") {
    // Morning half-day: returns same day (comes back after lunch)
    setForm(f => ({ ...f, return_date: format(form.start_date, "yyyy-MM-dd") }));
  } else if (isSingleDay && form.duration_type === "half-pm") {
    // Afternoon half-day: returns next working day
    let next = addDays(form.start_date, 1);
    while (isWeekend(next) || isHoliday(next)) {
      next = addDays(next, 1);
    }
    setForm(f => ({ ...f, return_date: format(next, "yyyy-MM-dd") }));
  } else {
    // All other cases: next valid day after end_date
    let next = addDays(form.end_date, 1);
    while (isWeekend(next) || isHoliday(next)) {
      next = addDays(next, 1);
    }
    setForm(f => ({ ...f, return_date: format(next, "yyyy-MM-dd") }));
  }
}, [form.start_date, form.end_date, form.duration_type, holidays.length]);


   function getHalfDayHoliday(date) {
  const d = format(date, "yyyy-MM-dd");
  if (holidaysMap[d] && holidaysMap[d].is_half_day) {
    return holidaysMap[d];
  }
  return null;
}
  function calculateDays() {
    if (!form.start_date || !form.end_date) return 0;
    const start = format(form.start_date, "yyyy-MM-dd");
    const end = format(form.end_date, "yyyy-MM-dd");

    // --- Single-day logic (including half-day leaves)
    if (start === end) {
      const halfHoliday = getHalfDayHoliday(form.start_date);
      if (form.duration_type === "full") {
        if (isHoliday(form.start_date)) return 0; // full holiday: 0
        if (halfHoliday) return 0.5; // only half-day possible
        return 1; // normal
      }
      // User picked half-day
      if (halfHoliday) {
        // If user picks the same half as the holiday: 0
        if (
          (halfHoliday.half === "morning" && form.duration_type === "half-am") ||
          (halfHoliday.half === "afternoon" && form.duration_type === "half-pm")
        ) {
          return 0;
        } else {
          return 0.5;
        }
      }
      return 0.5;
    }

    // --- Multi-day logic
    let total = 0;
    let cur = form.start_date;
    while (cur <= form.end_date) {
      const curStr = format(cur, "yyyy-MM-dd");
      if (isWeekend(cur)) {
        // skip
      } else if (isHoliday(cur)) {
        // full holiday: skip
      } else if (holidaysMap[curStr] && holidaysMap[curStr].is_half_day) {
        total += 0.5;
      } else {
        total += 1;
      }
      cur = addDays(cur, 1);
    }
    return total > 0 ? total : 0;
  }

  // 5. DatePicker filter (for both start and end)
  function filterDate(date) {
    return !isWeekend(date) && !isHoliday(date);
  }

async function handleSubmit(e) {
  e.preventDefault();
  setSubmitting(true);
  setResult("");

  if (!annualType) {
    setResult("❌ Yıllık izin türü henüz yüklenmedi, lütfen bekleyiniz.");
    toast.error("Yıllık izin türü yüklenmedi, lütfen bekleyiniz.");
    setSubmitting(false);
    return;
  }

  if (!form.start_date || !form.end_date) {
    setResult("❌ Lütfen tüm zorunlu alanları doldurun.");
    toast.error("Lütfen tüm zorunlu alanları doldurun.");
    setSubmitting(false);
    return;
  }

  if (!form.location) {
    setResult("❌ Lütfen izin lokasyonunu giriniz.");
    toast.error("Lütfen izin lokasyonunu giriniz.");
    setSubmitting(false);
    return;
  }

  if (!dbUser?.manager_email) {
    setResult("❌ Hesabınıza atanmış bir yönetici yok.");
    toast.error("Hesabınıza atanmış bir yönetici yok.");
    setSubmitting(false);
    return;
  }

  const days = calculateDays();
  if (days === 0) {
    setResult("❌ Bitiş tarihi, başlangıç tarihinden önce olamaz veya hafta sonu/tatil günlerine izin talep edilemez.");
    toast.error("Tarih aralığı hatalı veya izin haftasonu/tatile denk geliyor.");
    setSubmitting(false);
    return;
  }

  // Convert to strings for DB
  const start_date_str = format(form.start_date, "yyyy-MM-dd");
  const end_date_str = format(form.end_date, "yyyy-MM-dd");

  // Insert leave request (for "Annual")
  const userSession = await supabase.auth.getSession();
  const accessToken = userSession?.data?.session?.access_token;

  const response = await fetch("https://sxinuiwawpruwzxfcgpc.functions.supabase.co/create-leave", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${accessToken}`,
    },
    body: JSON.stringify({
      user_id: dbUser.id,
      start_date: start_date_str,
      end_date: end_date_str,
      duration_type: form.duration_type,
      return_date: form.return_date,
      location: form.location,
      note: form.note,
      days,
      manager_email: dbUser.manager_email,
      email: dbUser.email,
      leave_type_id: annualType?.id,
    }),
  });

  const resultJson = await response.json();
  setSubmitting(false);

  if (!response.ok || resultJson.error) {
    setResult("❌ " + (resultJson.error || "Bir hata oluştu."));
    toast.error(resultJson.error || "Bir hata oluştu.");
  } else {
    setResult("✅ İzin talebiniz gönderildi!");
    toast.success("İzin talebiniz gönderildi!");
    // Clear/reset form
    setForm({
      start_date: null,
      end_date: null,
      duration_type: "full",
      return_date: "",
      location: "",
      note: "",
    });
  }
}


  const [showHistory, setShowHistory] = useState(false);
  const latestRelease = RELEASES[0];

  if (loading) return <div style={{ fontFamily: "Urbanist" }}>Yükleniyor...</div>;
  if (!dbUser) return <div style={{ fontFamily: "Urbanist" }}>Kullanıcı profili yüklenemedi.</div>;



  return (
    <>
      <h2 style={{ fontWeight: 700, marginBottom: 24, color: "#434344" }}>İzin Talep Et</h2>
      <div style={{ fontWeight: 500, marginBottom: 18 }}>
        <span style={{ color: "#434344" }}>Yönetici:</span>{" "}
        <span style={{ color: dbUser.manager_email ? "#434344" : "#E0653A" }}>
          {dbUser.manager_email || "Atanmış yönetici yok"}
        </span>
      </div>
      <form onSubmit={handleSubmit} style={{ fontSize: 18 }}>
        <div style={{ marginBottom: 16 }}>
          <label>Başlangıç Tarihi:</label><br />
          <DatePicker
            selected={form.start_date}
            minDate={allowRetroactiveLeave ? undefined : new Date()}
            onChange={date =>
              setForm(f => ({ ...form, start_date: date }))
            }
             filterDate={filterDate}
             dateFormat="dd/MM/yyyy"
            placeholderText="İlk izin gününü seçin"
            required
            withPortal
            style={inputStyle}
            locale={tr}
            showWeekNumbers
            weekLabel="Hf"
          />
        </div>
        <div style={{ marginBottom: 16 }}>
          <label>Bitiş Tarihi:</label><br />
          <DatePicker
            selected={form.end_date}
            minDate={form.start_date || (allowRetroactiveLeave ? undefined : new Date())}
            filterDate={date =>
              (!form.start_date || date >= form.start_date) &&
              !isWeekend(date) &&
              !isHoliday(date)
            }
            onChange={date =>
              setForm(f => ({
                ...f,
                end_date: date,
                duration_type: "full",
              }))
            }
            openToDate={form.start_date || new Date()}
            dateFormat="dd/MM/yyyy"
            placeholderText="Son izin gününü seçin"
            required
            withPortal
            style={inputStyle}
            locale={tr}
            showWeekNumbers
            weekLabel="Hf"
            />
        </div>
        {form.start_date &&
          form.end_date &&
          format(form.start_date, "yyyy-MM-dd") === format(form.end_date, "yyyy-MM-dd") && (
            <div style={{ marginBottom: 16 }}>
              <label>Başlangıç ve bitiş aynı gün ise:</label><br />
              <select
                value={form.duration_type}
                onChange={e =>
                  setForm(f => ({ ...f, duration_type: e.target.value }))
                }
                style={inputStyle}
              >
                <option value="full">Tüm Gün</option>
                <option value="half-am">Yarım Gün (Sabah)</option>
                <option value="half-pm">Yarım Gün (Öğleden Sonra)</option>
              </select>
            </div>
          )}
        <div style={{ marginBottom: 16 }}>
  <label>İzin sonrası işe başlama tarihi:</label><br />
  <span style={{ ...inputStyle, display: "inline-block", background: "#f8f8f8", color: "#434344" }}>
    {form.return_date ? format(new Date(form.return_date), "dd/MM/yyyy") : ""}
  </span>
</div>
        <div style={{ marginBottom: 16 }}>
          <label>Lokasyon:</label><br />
          <input
            type="text"
            value={form.location}
            onChange={e => setForm(f => ({ ...f, location: e.target.value }))}
            style={inputStyle}
            required
            placeholder="İznin geçirileceği lokasyon"
          />
        </div>
        <div style={{ marginBottom: 16 }}>
          <label>Not:</label><br />
          <textarea
            value={form.note}
            onChange={e => setForm(f => ({ ...f, note: e.target.value }))}
            style={{ ...inputStyle, height: 50 }}
            placeholder="Eklemek istediğiniz notlarınız"
          />
        </div>
        <div>
        Talep edilen gün sayısı: <b>{calculateDays()}</b>
      </div>
      <button
          type="submit"
          disabled={submitting}
          style={{
            background: "#F39200",
            color: "#fff",
            fontWeight: 700,
            padding: "12px 28px",
            border: "none",
            borderRadius: 10,
            fontSize: 18,
            boxShadow: "0 1px 4px #CDE5F4",
            cursor: "pointer",
            transition: "background 0.15s",
            display: "flex",
            alignItems: "center",
            gap: 10,
          }}
        >
          {submitting && (
            <span
              style={{
                display: "inline-block",
                width: 22,
                height: 22,
                border: "3px solid #fff",
                borderRight: "3px solid #F39200",
                borderRadius: "50%",
                animation: "spin 1s linear infinite",
              }}
            />
          )}
          {submitting ? "Gönderiliyor..." : "Talebi Gönder"}
        </button>
      </form>
      {result && (
        <div
          style={{
            color: result.startsWith("✅") ? "#468847" : "#E0653A",
            marginTop: 18,
            fontWeight: 700,
          }}
        >
          {result}
        </div>
        
      )}
    <div
  style={{
    margin: "28px 0",
    background: "#F8FBFD",
    border: "1px solid #CDE5F4",
    borderRadius: 12,
    padding: 22,
    maxWidth: 420,
    boxShadow: "0 2px 16px #a8d2f433",
    fontSize: 15,
  }}
>
  <div
    style={{
      display: "flex",
      alignItems: "center",
      cursor: "pointer",
      gap: 10,
      userSelect: "none",
      fontWeight: 800,
      fontSize: 16,
      color: "#F39200",
    }}
    onClick={() => setShowHistory(s => !s)}
    tabIndex={0}
    onKeyDown={e => { if (e.key === " " || e.key === "Enter") setShowHistory(s => !s); }}
    aria-expanded={showHistory}
    aria-controls="release-history"
  >
    <span>
      Güncel Sürüm: {latestRelease.version}
    </span>
    <span style={{
      marginLeft: "auto",
      fontSize: 22,
      color: "#A8D2F2",
      transform: showHistory ? "rotate(90deg)" : "rotate(0deg)",
      transition: "transform 0.2s"
    }}>▶</span>
  </div>

  <AnimatePresence initial={false}>
    {showHistory && (
      <motion.div
        id="release-history"
        initial={{ height: 0, opacity: 0 }}
        animate={{ height: "auto", opacity: 1 }}
        exit={{ height: 0, opacity: 0 }}
        style={{
          overflow: "hidden",
          marginTop: 10
        }}
        transition={{ duration: 0.28, ease: [0.43, 0.13, 0.23, 0.96] }}
      >
        <div>
          {RELEASES.map(r => (
            <div key={r.version} style={{ marginBottom: 12 }}>
              <b style={{ color: "#F39200" }}>
                {r.version}
                <span style={{ color: "#818285", fontWeight: 400, fontSize: 13, marginLeft: 6 }}>
                  ({r.date})
                </span>
              </b>
              <ul style={{ marginLeft: 18, marginTop: 2 }}>
                {r.notes.map((n, i) => <li key={i}>{n}</li>)}
              </ul>
            </div>
          ))}
        </div>
      </motion.div>
    )}
  </AnimatePresence>
</div>

</>
  );
}

const inputStyle = {
  width: "100%",
  maxWidth: 300,
  padding: "8px",
  border: "1px solid #CDE5F4",
  borderRadius: 7,
  fontSize: 16,
  fontFamily: "Urbanist, Arial, sans-serif",
  marginTop: 4,
  marginBottom: 4,
};
