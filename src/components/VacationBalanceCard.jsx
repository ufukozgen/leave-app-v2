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
      padding: "32px 30px 24px 30px",         // bigger padding
      borderRadius: 26,                        // more rounded
      background: "#fff",
      boxShadow: "0 4px 22px #cde5f433",      // bigger, softer shadow
      minWidth: 400,                          // increased min/max width
      maxWidth: 480,
      margin: "0 auto",
      border: `2px solid ${COLORS.lightBlue}`,
    }}
  >
    <div
      style={{
        display: "flex",
        alignItems: "center",
        gap: 24,                               // more gap
        minHeight: 96,                         // taller
      }}
    >
      {/* Profile Photo */}
      {profilePhoto ? (
        <img
          src={profilePhoto}
          alt="Profil Fotoğrafı"
          style={{
            width: 78,
            height: 78,
            borderRadius: "50%",
            objectFit: "cover",
            boxShadow: "0 2px 12px #0001",
            background: "#eee",
            border: "2.5px solid #CDE5F4",
            flexShrink: 0,
          }}
        />
      ) : (
        <div
          style={{
            width: 78,
            height: 78,
            borderRadius: "50%",
            background: "#E0653A33",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            fontSize: 36,
            fontWeight: 900,
            color: "#818285",
            border: "2.5px solid #CDE5F4",
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

      {/* Info */}
      <div style={{ marginBottom: 2 }}>
  {showGreeting && (
    <>
      <div
        style={{
          fontSize: 21,
          fontWeight: 700,
          color: COLORS.orange,
          lineHeight: 1.15,
        }}
      >
        Merhaba,
      </div>
      <div
        style={{
          fontSize: 21,
          fontWeight: 700,
          color: COLORS.orange,
          lineHeight: 1.15,
          marginBottom: 2,
          whiteSpace: "nowrap",
          overflow: "hidden",
          textOverflow: "ellipsis",
          maxWidth: 160 // adjust if needed
        }}
        title={user?.name}
      >
        {user?.name}
      </div>
    </>
  )}
  <div
    style={{
      fontSize: 18,
      fontWeight: 700,
      color: COLORS.grayDark,
      marginBottom: 2,
    }}
  >
    {title || "İzin Bakiyeniz"}
  </div>
</div>


      {/* Stat: Kalan X gün */}
      <div style={{ display: "flex", flexDirection: "column", alignItems: "center", marginLeft: 10 }}>
        <div style={{ fontSize: 15, color: COLORS.orange, fontWeight: 700, marginBottom: 3 }}>
          Kalan
        </div>
        <div
          style={{
            background: COLORS.orange,
            color: "#fff",
            borderRadius: 24,
            padding: "12px 32px",
            fontWeight: 900,
            fontSize: 28,
            minWidth: 90,
            textAlign: "center",
            boxShadow: "0 3px 14px #F3920022",
          }}
        >
          {balance.remaining ?? 0}{" "}
          <span style={{ fontSize: "1.1rem", fontWeight: 700 }}>gün</span>
        </div>
      </div>
    </div>
  </div>
);

}
