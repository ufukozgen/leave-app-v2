import React, { useEffect, useState } from "react";
import { supabase } from "../supabaseClient";

// Brand Colors from your spec
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

// Your deployed Edge Function URL for fetching profile photos
const PROFILE_PHOTO_FN_URL = "https://sxinuiwawpruwzxfcgpc.supabase.co/functions/v1/get-profile-photo";

export default function VacationBalanceCard({ userId, email, launchDate, title, showGreeting = true }) {
  const [balance, setBalance] = useState(null);
  const [user, setUser] = useState(null);
  const [resolvedUserId, setResolvedUserId] = useState(userId || null);
  const [loading, setLoading] = useState(true);
  const [profilePhoto, setProfilePhoto] = useState(null);

  // Resolve userId if only email is provided
  useEffect(() => {
    let cancelled = false;
    async function resolveUserId() {
      setLoading(true);
      if (userId) {
        setResolvedUserId(userId);
        setLoading(false);
        return;
      }
      if (email) {
        const { data: userRecord } = await supabase
          .from('users')
          .select('id, name')
          .eq('email', email)
          .maybeSingle();
        if (!cancelled) {
          setResolvedUserId(userRecord?.id || null);
          setUser(userRecord || null);
          setLoading(false);
        }
      } else {
        setResolvedUserId(null);
        setUser(null);
        setLoading(false);
      }
    }
    resolveUserId();
    return () => { cancelled = true; };
  }, [userId, email]);

  // Fetch balance and user name when resolvedUserId changes
  useEffect(() => {
    let cancelled = false;
    async function fetchData() {
      if (!resolvedUserId) {
        setBalance(null);
        if (!userId) setUser(null); // Don't clear if name was fetched by email above
        return;
      }
      setLoading(true);

      // Fetch balance
      const { data: bal } = await supabase
        .from('leave_balances')
        .select('accrued, used, remaining')
        .eq('user_id', resolvedUserId)
        .maybeSingle();
      if (!cancelled) setBalance(bal);

      // Fetch user info for full name (if not already loaded)
      if (!user) {
        const { data: usr } = await supabase
          .from('users')
          .select('name, email')
          .eq('id', resolvedUserId)
          .maybeSingle();
        if (!cancelled) setUser(usr);
      }
      setLoading(false);
    }
    fetchData();
    return () => { cancelled = true; };
    // Only run when resolvedUserId changes
    // eslint-disable-next-line
  }, [resolvedUserId]);

  // Fetch profile photo from Azure using Edge Function when email is available
  useEffect(() => {
    let cancelled = false;
    // Use the direct email prop, or fallback to user?.email if found via userId
    const userEmail = email || user?.email;
    async function fetchPhoto() {
      if (!userEmail) {
        setProfilePhoto(null);
        return;
      }
      try {
        const res = await fetch(PROFILE_PHOTO_FN_URL, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ user_email: userEmail })
        });
        const data = await res.json();
        if (!cancelled && data.image) setProfilePhoto(data.image);
        if (!cancelled && !data.image) setProfilePhoto(null);
      } catch {
        if (!cancelled) setProfilePhoto(null);
      }
    }
    fetchPhoto();
    return () => { cancelled = true; };
  }, [email, user?.email]);

  if (loading)
    return (
      <div className="my-6 p-6 bg-[#CDE5F4] rounded-2xl animate-pulse text-gray-500">
        Yükleniyor…
      </div>
    );

  if (!balance)
    return (
      <div className="my-6 p-6 bg-[#E0653A] text-white rounded-2xl">
        İzin bakiyesi bulunamadı.
      </div>
    );

return (
  <div
    className="vacation-card"
    style={{
      padding: "28px 28px 18px 28px",
      borderRadius: 18,
      background: "#fff",
      boxShadow: "0 2px 24px #cde5f422",
      minWidth: 320,
      maxWidth: 540,
      margin: "0 auto",
    }}
  >
    {/* Main header: photo + info + stats, horizontally aligned */}
    <div
      className="vacation-card-header"
      style={{
        display: "flex",
        alignItems: "center",
        gap: 32,
        minHeight: 92,
        marginBottom: 8,
      }}
    >
      {/* Profile Photo or fallback avatar */}
      {profilePhoto ? (
        <img
          src={profilePhoto}
          alt="Profil Fotoğrafı"
          style={{
            width: 80,
            height: 80,
            borderRadius: "50%",
            objectFit: "cover",
            boxShadow: "0 1px 8px #0002",
            background: "#eee",
            border: "1px solid #CDE5F4",
            flexShrink: 0,
          }}
        />
      ) : (
        <div
          style={{
            width: 80,
            height: 80,
            borderRadius: "50%",
            background: "#E0653A33",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            fontSize: 38,
            fontWeight: 800,
            color: "#818285",
            border: "3px solid #CDE5F4",
            flexShrink: 0,
          }}
        >
          {user?.name
            ? user.name
                .split(" ")
                .map((w) => w[0]?.toUpperCase())
                .join("")
            : "?"}
        </div>
      )}

      {/* Main info (greeting, label, stats) */}
      <div style={{ flex: 1, display: "flex", flexDirection: "column", justifyContent: "center" }}>
        {/* Greeting and label */}
        {showGreeting && (
          <div
            className="vacation-greeting"
            style={{
              fontSize: 21,
              fontWeight: 700,
              color: "#F39200",
              marginBottom: 2,
              lineHeight: 1.2,
            }}
          >
            Merhaba{user?.name ? `, ${user.name}` : ""}!
          </div>
        )}
        <div
          className="vacation-label"
          style={{
            fontSize: 17,
            fontWeight: 600,
            color: "#434344",
            marginBottom: 10,
          }}
        >
          {title ? title : "İzin Bakiyeniz"}
        </div>
        {/* Stats row */}
        <div
          className="vacation-stats-row"
          style={{
            display: "flex",
            gap: 0,
            alignItems: "flex-end",
            marginTop: 0,
          }}
        >
           <div className="vacation-stat" style={{ textAlign: "center" }}>
            <div className="vacation-remaining-label" style={{ fontSize: 15, color: "#F39200", fontWeight: 700, marginBottom: 1 }}>
              Kalan
            </div>
            <div
              className="vacation-remaining-value"
              style={{
                background: "#F39200",
                color: "#fff",
                borderRadius: 22,
                padding: "10px 28px",
                fontWeight: 800,
                fontSize: 30,
                minWidth: 90,
                display: "inline-block",
                marginTop: 2,
                boxShadow: "0 2px 8px #F3920022",
              }}
            >
              {balance.remaining ?? 0}{" "}
              <span style={{ fontSize: "0.94rem", fontWeight: 700 }}>gün</span>
            </div>
          </div>
        </div>
      </div>
    </div>
  </div>
);


}
