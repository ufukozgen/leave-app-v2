import React, { useState, useEffect, useRef } from "react";
import LeaveRequestForm from "./components/LeaveRequestForm";
import LeaveRequestList from "./components/LeaveRequestList";
import LeaveAppContent from "./components/LeaveAppContent";
import VacationBalanceCard from "./components/VacationBalanceCard";
import ManagerPanel from "./components/ManagerPanel";
import EmployeeLeaveConsole from "./components/EmployeeLeaveConsole";
import AdminPanel from "./components/AdminPanel";
import { FeedbackFooter } from "./components/FeedbackFooter";
import { useUser } from "./components/UserContext";
import { supabase } from "./supabaseClient";
import { CSSTransition, SwitchTransition } from "react-transition-group";
import "./tabfade.css";
import { Toaster } from "react-hot-toast";

export default function App() {
  const [tab, setTab] = useState("request");
  const { dbUser } = useUser();

  const [pendingCount, setPendingCount] = useState(0);
  const [approvedCount, setApprovedCount] = useState(0);

  const isLoggedIn = !!dbUser;
  const isManager = dbUser?.role === "manager" || dbUser?.role === "admin";
  const isAdmin = dbUser?.role === "admin";
  const nodeRef = useRef(null);

  const fetchCounts = async () => {
  if (!isManager || !dbUser?.email) return;
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
};

// 2. Call it in useEffect as before:
useEffect(() => {
  fetchCounts();
}, [dbUser, isManager, tab]);

const managerTotal = pendingCount + approvedCount;

// --- LOGGED OUT LANDING ---
if (!isLoggedIn) {
  return (
    <div
      style={{
        minHeight: "100vh",
        background: "#f8fbfd",
        display: "flex",
        alignItems: "center",
        justifyContent: "center"
      }}
    >
      <div
        style={{
          background: "#fff",
          padding: "48px 44px",
          borderRadius: 22,
          boxShadow: "0 0 32px #cde5f4",
          textAlign: "center",
          minWidth: 380,
          maxWidth: 420
        }}
      >
        <div style={{ marginBottom: 14 }}>
          <img
            src="/terralab_logo_dijital_kullanım(rgb).png"
            alt="Terralab Logo"
            style={{ width: 110, marginBottom: 8 }}
          />
        </div>
        <div style={{ fontWeight: 900, fontSize: 28, letterSpacing: 1, color: "#F39200", marginBottom: 8 }}>
          🏖️ İzin Uygulaması v2
        </div>
        <div style={{ color: "#434344", fontSize: 16, marginBottom: 22 }}>
          Terralab kurum içi izin yönetim sistemi<br />
          Giriş yapmak için Microsoft hesabınızı kullanınız.
        </div>
        <button
          onClick={() =>
            supabase.auth.signInWithOAuth({
              provider: "azure",
              options: { redirectTo: window.location.origin },
            })
          }
          style={{
            background: "#fff",
            color: "#434344",
            fontWeight: 700,
            border: "1.5px solid #A8D2F2",
            borderRadius: 12,
            padding: "13px 0",
            fontSize: 19,
            cursor: "pointer",
            width: "100%",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            gap: 12,
            boxShadow: "0 2px 10px #cde5f445"
          }}
        >
          <img
            src="https://upload.wikimedia.org/wikipedia/commons/4/44/Microsoft_logo.svg"
            alt="Microsoft"
            style={{ width: 30, height: 30 }}
          />
          <span style={{ fontWeight: 800, fontSize: 19, letterSpacing: 0.3 }}>
            Microsoft ile Giriş Yap
          </span>
        </button>
        {/* Footer */}
        <div style={{
          marginTop: 28,
          fontSize: 13,
          color: "#818285",
          borderTop: "1px solid #e5e5e5",
          paddingTop: 12
        }}>
          <div>
            Sorularınız veya geri bildiriminiz için:
            <a href="mailto:izinapp-feedback@terralab.com.tr" style={{ color: "#0056b3", marginLeft: 5 }}>
              izinapp-feedback@terralab.com.tr
            </a>
          </div>
          <div>
            © {new Date().getFullYear()}{" "}
            <a href="https://www.terralab.com.tr" style={{ color: "#0056b3" }}>Terralab</a>.
          </div>
          <div>
            Kullanıcı bilgileriniz gizli tutulur ve yalnızca şirket içi izin yönetimi için kullanılır.
            <a href="/privacy.html" style={{ color: "#0056b3", marginLeft: 8 }}>Gizlilik Politikası</a>
          </div>
        </div>
      </div>
    </div>
  );
}


  // --- LOGGED IN: NORMAL APP ---
  return (
    <>
      <Toaster position="top-center" />

      <div
        style={{
          minHeight: 800,
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

        <VacationBalanceCard userId={dbUser?.id} launchDate="01.07.2025" />

        <nav style={{
          display: "flex",
          justifyContent: "center",
          alignItems: "center",
          gap: 18,
          padding: "20px 0 0 0",
          marginBottom: 16,
          width: "100%",
        }}>
          <TabButton active={tab === "request"} onClick={() => setTab("request")}>İzin Talebi</TabButton>
          <TabButton active={tab === "list"} onClick={() => setTab("list")}>İzin Taleplerim</TabButton>
          {isManager && (
  <TabButton active={tab === "manager"} onClick={() => setTab("manager")}>
    Yönetici
    <CountBadge color="#F0B357" count={pendingCount} />
    <CountBadge color="#50B881" count={approvedCount} />
  </TabButton>
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
          >
            <div
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
                  {tab === "request" && <LeaveAppContent user={dbUser} />}
                  {tab === "list" && <LeaveRequestList />}
                </div>
              )}
              {tab === "admin" && isAdmin && <AdminPanel />}
              {tab === "manager" && isManager && (
                <ManagerPanel
                  pendingCount={pendingCount}
                  approvedCount={approvedCount}
                  refreshCounts={fetchCounts}
                />
              )}
              {tab === "employee-console" && isManager && (
                <EmployeeLeaveConsole managerEmail={dbUser.email} />
              )}
            </div>
          </CSSTransition>
        </SwitchTransition>
      </div>
    <FeedbackFooter />
    </>
  );
}

function CountBadge({ color, count }) {
  if (!count) return null;
  return (
    <span
      style={{
        minWidth: 26,
        height: 22,
        background: color,
        color: "#fff",
        fontWeight: 900,
        borderRadius: 8,
        display: "inline-flex",
        alignItems: "center",
        justifyContent: "center",
        fontSize: 15,
        padding: "0 7px",
        marginLeft: 7,
        marginRight: 3,
        boxShadow: "0 1px 4px #8883",
        letterSpacing: 1,
        verticalAlign: "middle",
      }}
    >
      {count}
    </span>
  );
}


function TabButton({ active, children, ...props }) {
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
    </button>
  );
}

