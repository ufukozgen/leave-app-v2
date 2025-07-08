import React, { useState, useEffect } from "react";
import { supabase } from "../supabaseClient";
import VacationBalanceCard from "./VacationBalanceCard";
import LeaveRequestList from "./LeaveRequestList";

function formatDisplayName(email) {
  if (!email) return "";
  const [username] = email.split("@");
  return username
    .split(".")
    .map(part => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}
function getEmailPrefix(email) {
  if (!email) return "";
  return email.split("@")[0];
}

export default function EmployeeLeaveConsole({ managerEmail }) {
  const [subordinates, setSubordinates] = useState([]); // { id, email }
  const [selectedUser, setSelectedUser] = useState(null); // { id, email }
  const [leaveRequests, setLeaveRequests] = useState([]);
  const [vacationBalance, setVacationBalance] = useState(null);
  const [loading, setLoading] = useState(false);
  const launchDate = "01.07.2025";   // or whatever your actual date is


  // Fetch subordinates of this manager
  useEffect(() => {
    async function fetchSubordinates() {
      const { data, error } = await supabase
        .from("users")
        .select("id, email")
        .eq("manager_email", managerEmail);

      if (!error && data) setSubordinates(data);
      else setSubordinates([]);
    }
    fetchSubordinates();
  }, [managerEmail]);

  // Fetch leave requests & balance when a subordinate is picked
  useEffect(() => {
    if (!selectedUser) {
      setLeaveRequests([]);
      setVacationBalance(null);
      return;
    }
    setLoading(true);

    async function fetchData() {
      // 1. İzin talepleri
      const { data: requests, error: reqErr } = await supabase
        .from("leave_requests")
        .select("*")
        .eq("email", selectedUser.email)
        .order("start_date", { ascending: false });

      // 2. Bakiye (leave_balances tablosu, user_id ile)
      const { data: balance, error: balErr } = await supabase
        .from("leave_balances")
        .select("*")
        .eq("user_id", selectedUser.id)
        .single();

      setLeaveRequests(reqErr ? [] : requests || []);
      setVacationBalance(balErr ? null : balance || null);
      setLoading(false);
    }
    fetchData();
  }, [selectedUser]);

  return (
    <div className="employee-console-container">
        <div
          className="max-w-2xl mx-auto bg-white shadow-xl rounded-2xl p-6 my-8"
          style={{ minHeight: 480 }}
        >
          <h2 className="text-2xl font-urbanist mb-4 text-[#F39200] font-bold">
            Çalışan Takip Konsolu
          </h2>
          {/* Dropdown Section */}
        <div className="custom-select-wrapper">
          <label htmlFor="subordinate-select" className="custom-select-label">
        Çalışan Seçiniz
          </label>
          <select
        id="subordinate-select"
        className="custom-select"
        value={selectedUser?.id || ""}
        onChange={e => {
          const user = subordinates.find(u => u.id === e.target.value);
          setSelectedUser(user || null);
        }}
          >
        <option value="">-- Seçiniz --</option>
        {subordinates.map(user => (
          <option key={user.id} value={user.id}>
            {formatDisplayName(user.email)}
          </option>
        ))}
          </select>
          {/* SVG chevron */}
         <span className="custom-select-chevron">
          <svg width="28" height="28" viewBox="0 0 28 28" fill="none">
        <path d="M9 11l5 6 5-6" stroke="#A8D2F2" strokeWidth="2.8" fill="none" strokeLinecap="round" strokeLinejoin="round"/>
          </svg>
        </span>
        </div>
          {/* Loading message */}
          {loading && (
            <div className="text-[#818285] text-base mb-2">Yükleniyor...</div>
          )}
          {/* Selected user's cards/lists */}
          {selectedUser && !loading && (
            <>
              <div className="mb-8">
                <VacationBalanceCard
                    email={selectedUser.email}
                    balance={vacationBalance}
                    title={`${getEmailPrefix(selectedUser.email)} İzin Bakiyesi`}
                    launchDate={launchDate}
                    showGreeting={false}
                    isManagerView={true}
                />
              </div>
              <LeaveRequestList
                email={selectedUser.email}
                requests={leaveRequests}
                isManagerView={true}
                title={`${getEmailPrefix(selectedUser.email)} İzin Talepleri`}
                />
            </>
          )}
        </div>
    </div>
  );
}
