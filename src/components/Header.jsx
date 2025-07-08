// src/components/Header.jsx
import React from "react";

export default function Header({ setTab, tab, user, isAdmin, isManager }) {
  return (
    <header style={{
      background: "#A8D2F2", color: "#434344",
      padding: "1.5em 2em", display: "flex", justifyContent: "space-between", alignItems: "center"
    }}>
      <div style={{ fontWeight: "bold", fontSize: "1.5em" }}>
        Leave App v2
      </div>
      <nav>
        <button onClick={() => setTab("request")} style={tabBtn(tab === "request")}>Leave Request</button>
        <button onClick={() => setTab("history")} style={tabBtn(tab === "history")}>History</button>
        {(isAdmin || isManager) && (
          <button onClick={() => setTab("list")} style={tabBtn(tab === "list")}>Leave Requests</button>
        )}
        {isAdmin && (
          <>
            <button onClick={() => setTab("admin")} style={tabBtn(tab === "admin")}>Admin</button>
            <button onClick={() => setTab("vacation-admin")} style={tabBtn(tab === "vacation-admin")}>Vacation Days</button>
          </>
        )}
      </nav>
      <div>
        <span>{user.email}</span>
        <button onClick={() => window.location.reload()} style={{ marginLeft: 16 }}>Logout</button>
      </div>
    </header>
  );
}

function tabBtn(active) {
  return {
    margin: "0 6px", padding: "6px 12px", fontWeight: active ? "bold" : "normal",
    background: active ? "#F39200" : "#CDE5F4", border: "none", borderRadius: "8px", cursor: "pointer"
  };
}
