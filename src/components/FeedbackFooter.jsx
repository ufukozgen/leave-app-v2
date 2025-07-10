import React, { useState } from "react";
import { useUser } from "./UserContext";
import { supabase } from "../supabaseClient"; // adjust path as needed

export function FeedbackFooter() {
  const { dbUser } = useUser();
  const [open, setOpen] = useState(false);
  const [text, setText] = useState("");
  const [sending, setSending] = useState(false);
  const [result, setResult] = useState("");
  const [error, setError] = useState("");

  async function handleSend(e) {
    e.preventDefault();
    if (!text.trim()) {
      setError("Lütfen bir geri bildirim yazın.");
      return;
    }
    setError("");
    setSending(true);
    setResult("");
    try {
      // Get current user's session token
      const { data: { session } } = await supabase.auth.getSession();
      const token = session?.access_token;
      if (!token) throw new Error("Oturum bulunamadı, lütfen tekrar giriş yapın.");

      // Call Supabase Edge Function
      const response = await fetch("https://sxinuiwawpruwzxfcgpc.functions.supabase.co/send-feedback", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Authorization": `Bearer ${token}`,
        },
        body: JSON.stringify({
          message: text,
          name: dbUser?.name,
          email: dbUser?.email,
        }),
      });

      if (!response.ok) {
        const data = await response.json();
        throw new Error(data.error || "Gönderilemedi.");
      }

      setResult("Teşekkürler, geri bildiriminiz gönderildi!");
      setText("");
      setTimeout(() => {
        setOpen(false);
        setResult("");
      }, 1800);
    } catch (err) {
      setError(err.message || "Gönderilemedi. Lütfen daha sonra tekrar deneyin.");
    } finally {
      setSending(false);
    }
  }

  return (
    <>
      <button
        onClick={() => setOpen(true)}
        style={{
          position: "fixed",
          right: 30,
          bottom: 30,
          zIndex: 1000,
          background: "#F39200",
          color: "#fff",
          border: "none",
          borderRadius: 32,
          padding: "12px 28px",
          fontWeight: 700,
          fontFamily: "Urbanist, Arial, sans-serif",
          fontSize: 18,
          boxShadow: "0 4px 16px #A8D2F255",
          cursor: "pointer",
          transition: "background 0.2s",
          opacity: 0.96
        }}
      >
        Geri Bildirim
      </button>

      {open && (
        <div
          style={{
            position: "fixed",
            inset: 0,
            background: "rgba(67,67,68,0.18)",
            zIndex: 1100,
            display: "flex",
            alignItems: "center",
            justifyContent: "center"
          }}
          onClick={() => { setOpen(false); setError(""); setResult(""); }}
        >
          <div
            onClick={e => e.stopPropagation()}
            style={{
              background: "#fff",
              borderRadius: 18,
              boxShadow: "0 0 24px #cde5f4",
              padding: "36px 32px 28px 32px",
              minWidth: 370,
              maxWidth: "94vw",
              width: 400,
              fontFamily: "Urbanist, Arial, sans-serif",
              position: "relative"
            }}
          >
            <h3 style={{ color: "#F39200", fontWeight: 800, marginBottom: 18, fontSize: 22 }}>
              Geri Bildirim Gönder
            </h3>
            <form onSubmit={handleSend}>
              <div style={{ marginBottom: 16 }}>
                <textarea
                  value={text}
                  onChange={e => setText(e.target.value)}
                  placeholder="Yorum, öneri veya sorunuzu buraya yazın..."
                  rows={4}
                  style={{
                    width: "100%",
                    padding: 12,
                    border: "1.5px solid #CDE5F4",
                    borderRadius: 8,
                    fontSize: 16,
                    fontFamily: "Urbanist, Arial, sans-serif",
                    resize: "vertical",
                    background: "#f8f8f8"
                  }}
                  disabled={sending}
                  required
                />
              </div>
              <div style={{ fontSize: 14, color: "#818285", marginBottom: 8 }}>
                {dbUser?.name} ({dbUser?.email})
              </div>
              <button
                type="submit"
                disabled={sending || !text.trim()}
                style={{
                  background: "#F39200",
                  color: "#fff",
                  fontWeight: 700,
                  padding: "12px 28px",
                  border: "none",
                  borderRadius: 10,
                  fontSize: 18,
                  boxShadow: "0 1px 4px #CDE5F4",
                  cursor: sending ? "not-allowed" : "pointer",
                  display: "flex",
                  alignItems: "center",
                  gap: 10,
                  marginTop: 6
                }}
              >
                {sending && (
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
                {sending ? "Gönderiliyor..." : "Gönder"}
              </button>
              {error && (
                <div style={{ color: "#E0653A", fontWeight: 600, marginTop: 10 }}>
                  {error}
                </div>
              )}
              {result && (
                <div style={{ color: "#50B881", fontWeight: 700, marginTop: 10 }}>
                  {result}
                </div>
              )}
            </form>
            <style>{`
              @keyframes spin {
                0% { transform: rotate(0deg);}
                100% { transform: rotate(360deg);}
              }
            `}</style>
            <button
              onClick={() => setOpen(false)}
              style={{
                position: "absolute",
                right: 16,
                top: 18,
                background: "none",
                border: "none",
                color: "#818285",
                fontSize: 22,
                fontWeight: 700,
                cursor: "pointer"
              }}
              aria-label="Kapat"
              title="Kapat"
              tabIndex={0}
            >
              ×
            </button>
          </div>
        </div>
      )}
    </>
  );
}
