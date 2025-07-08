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

export default function VacationBalanceCard({ userId, email, launchDate, title, showGreeting = true }) {
  const [balance, setBalance] = useState(null);
  const [user, setUser] = useState(null);
  const [resolvedUserId, setResolvedUserId] = useState(userId || null);
  const [loading, setLoading] = useState(true);

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
          .select('name')
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
    <div className="vacation-card">
      <div className="vacation-card-header">
        <div>
          {showGreeting && (
            <div className="vacation-greeting">
              Merhaba{user?.name ? `, ${user.name}` : ""}!
            </div>
          )}
          <div className="vacation-label">{title ? title : "İzin Bakiyeniz"}</div>
        </div>
        <div className="vacation-stats-row">
          <div className="vacation-stat">
            <div className="vacation-stat-label">Kazanılan</div>
            <div className="vacation-stat-value">{balance.accrued ?? 0} <span style={{ fontSize: '0.82rem', fontWeight: 500 }}>gün</span></div>
          </div>
          <div className="vacation-stat">
            <div className="vacation-stat-label">Kullanılan</div>
            <div className="vacation-stat-value">{balance.used ?? 0} <span style={{ fontSize: '0.82rem', fontWeight: 500 }}>gün</span></div>
          </div>
          <div className="vacation-stat">
            <div className="vacation-remaining-label">Kalan</div>
            <div className="vacation-remaining-value">{balance.remaining ?? 0} <span style={{ fontSize: '0.94rem', fontWeight: 700 }}>gün</span></div>
          </div>
        </div>
      </div>
      <div className="vacation-card-note">
        <span className="vacation-card-note-icon">i</span>
        <span>
          Kazanılan ve kullanılan izinler <b>{launchDate}</b> tarihinden itibaren hesaplanmıştır.
        </span>
      </div>
    </div>
  );
}
