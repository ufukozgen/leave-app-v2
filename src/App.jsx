import React, { useState, useEffect } from "react";
import LeaveRequestForm from "./components/LeaveRequestForm";
import LeaveRequestList from "./components/LeaveRequestList";
import LeaveAppContent from "./components/LeaveAppContent";
import VacationBalanceCard from "./components/VacationBalanceCard";
import ManagerPanel from "./components/ManagerPanel";
import EmployeeLeaveConsole from "./components/EmployeeLeaveConsole";
import Header from "./components/Header";
import { useUser } from "./components/UserContext";
import { supabase } from "./supabaseClient";
import AdminPanel from "./components/AdminPanel";
import { CSSTransition, SwitchTransition } from "react-transition-group";
import "./tabfade.css";
import { useRef } from "react";
import { Toaster } from "react-hot-toast";


export default function App() {
  const [tab, setTab] = useState("request");
  const { dbUser } = useUser();

  const [pendingCount, setPendingCount] = useState(0);
  const [approvedCount, setApprovedCount] = useState(0);

  const isManager = dbUser?.role === "manager" || dbUser?.role === "admin";
  const isAdmin = dbUser?.role === "admin";
  const nodeRef = useRef(null);

  useEffect(() => {
    if (!isManager || !dbUser?.email) return;
    async function fetchCounts() {
      const { count: pending } = await supabase
        .from("leave_requests")
        .select("id", { count: "exact", head: true })
        .eq("manager_email", dbUser.email)
        .eq("status", "Pending");
      setPendingCount(pending || 0);

      const { count: approved } = await supabase
        .from("leave_requests")
        .select("id", { count: "exact", head: true })
        .eq("manager_email", dbUser.email)
        .eq("status", "Approved");
      setApprovedCount(approved || 0);
    }
    fetchCounts();
  }, [dbUser, isManager, tab]);

  const managerTotal = pendingCount + approvedCount;

  return (
    <>
    
    <Toaster position="top-center" />

   
    <div
      style={{
        minHeight: 800, // Increased for consistency
        maxWidth: 1040,
        width: 1040,
        margin: "32px auto",
        padding: "0 0 36px 0",
        background: "#fff",
        borderRadius: 22,
        boxShadow: "0 0 32px #cde5f4",
        fontFamily: "'Urbanist', Arial, sans-serif",
        position: "relative",
        transition: "min-height 0.3s",
        display: "flex",
        flexDirection: "column"
      }}
    >
      <div style={{
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        padding: "18px 32px 0 32px",
        fontFamily: "'Urbanist', Arial, sans-serif"
      }}>
        <div style={{ fontWeight: 900, fontSize: 32, letterSpacing: 1, color: "#F39200", marginBottom: 20 }}>
          🏖️ İzin Uygulaması v2
        </div>
       <div style={{
  display: "flex",
  alignItems: "center",
  justifyContent: "space-between",
  padding: "18px 32px 0 32px",
  fontFamily: "'Urbanist', Arial, sans-serif"
}}>

  {/* LOGIN/LOGOUT BUTTONS */}
  <div>
    {dbUser ? (
      <>
        <span style={{ marginRight: 16, fontWeight: 600, color: "#434344" }}>
          {dbUser.name || dbUser.email}
        </span>
        <button
          onClick={async () => {
            await supabase.auth.signOut();
            window.location.reload();
          }}
          style={{
            background: "#E0653A",
            color: "#fff",
            fontWeight: 700,
            border: "none",
            borderRadius: 8,
            padding: "8px 28px",
            fontSize: 18,
            cursor: "pointer"
          }}
        >Çıkış Yap</button>
      </>
    ) : (
      <button
        onClick={() =>
          supabase.auth.signInWithOAuth({
            provider: "azure",
            options: { redirectTo: window.location.origin },
          })
        }
        style={{
          background: "#F39200",
          color: "#fff",
          fontWeight: 700,
          border: "none",
          borderRadius: 8,
          padding: "8px 28px",
          fontSize: 18,
          cursor: "pointer"
        }}
      >Giriş Yap</button>
    )}
  </div>
</div>
      </div>
        
        <VacationBalanceCard userId={dbUser?.id} launchDate="01.07.2025" />

      <nav style={{
        display: "flex",
    justifyContent: "center",  // <-- center the tab buttons horizontally
    alignItems: "center",
    gap: 18,                   // slightly more gap for visual comfort
    padding: "20px 0 0 0",     // remove horizontal padding so centering is exact
    marginBottom: 16,
    width: "100%",             // optional, flex will fill parent
      }}>
        <TabButton active={tab === "request"} onClick={() => setTab("request")}>İzin Talebi</TabButton>
        <TabButton active={tab === "list"} onClick={() => setTab("list")}>İzin Taleplerim</TabButton>
        {isManager && (<TabButton active={tab === "manager"}
                          onClick={() => setTab("manager")}badge={managerTotal}>Yönetici </TabButton>
          )}
        {isManager && (
  <TabButton
    active={tab === "employee-console"}
    onClick={() => setTab("employee-console")}
  >
    Çalışan Takip Konsolu
  </TabButton>
)}

        {isAdmin && (
          <TabButton
            active={tab === "admin"}
            onClick={() => setTab("admin")}
          >
            Admin Paneli
          </TabButton>
        )}
      </nav>
      <SwitchTransition>
  <CSSTransition
    key={tab}
    nodeRef={nodeRef}
    timeout={200}
    classNames="fade"
    unmountOnExit
  ><div
  ref={nodeRef}
  style={{
    padding: "18px 28px",
    width: "100%",
    minHeight: 600,
    boxSizing: "border-box",
  }}
>
  {(tab === "request" || tab === "list") && (
  <div className="main-content">
    {/* These are now both in the same inner pretty card! */}
    {tab === "request" && <LeaveAppContent user={dbUser} />}
    {tab === "list" && <LeaveRequestList />}
  </div>
)}
{tab === "admin" && isAdmin && <AdminPanel />}
{tab === "manager" && isManager && (
  <ManagerPanel
    pendingCount={pendingCount}
    approvedCount={approvedCount}
  />
)}
{tab === "employee-console" && isManager && (
  <EmployeeLeaveConsole managerEmail={dbUser.email} />
)}

</div>

  </CSSTransition>
</SwitchTransition>
    </div>
     </>
  );
}




function TabButton({ active, children, badge, ...props }) {
  return (
    <button
      {...props}
      className={"tab-btn" + (props.className ? " " + props.className : "")}
      style={{
        background: active ? "#F39200" : "#CDE5F4",
        color: active ? "#fff" : "#434344",
        fontWeight: 700,
        fontFamily: "Urbanist, Arial, sans-serif",
        fontSize: 20,
        border: "none",
        borderRadius: 12,
        padding: "12px 34px",
        boxShadow: active ? "0 2px 8px #F3920022" : "none",
        cursor: "pointer",
        marginRight: 12,
        position: "relative",
      }}
    >
      {children}
      {badge > 0 && (
        <span
          style={{
            position: "absolute",
            top: 7,
            right: 18,
            minWidth: 24,
            height: 24,
            background: "#E0653A",
            color: "#fff",
            fontWeight: 900,
            borderRadius: "50%",
            display: "inline-flex",
            alignItems: "center",
            justifyContent: "center",
            fontSize: 15,
            boxShadow: "0 1px 4px #E0653A44",
          }}
        >
          {badge}
        </span>
      )}
    </button>
  );
}

