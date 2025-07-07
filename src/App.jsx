import React, { useEffect, useState } from "react";
import { supabase } from "./supabaseClient";

function App() {
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(true);

  // Check session on mount and listen for changes
  useEffect(() => {
    let ignore = false;

    async function getSession() {
      const { data, error } = await supabase.auth.getSession();
      if (!ignore) {
        setUser(data?.session?.user ?? null);
        setLoading(false);
      }
    }
    getSession();

    // Listen for login/logout
    const { data: listener } = supabase.auth.onAuthStateChange((_event, session) => {
      setUser(session?.user ?? null);
    });

    return () => {
      ignore = true;
      listener.subscription.unsubscribe();
    };
  }, []);

  // Sign in with Microsoft
const signInWithMicrosoft = async () => {
  await supabase.auth.signInWithOAuth({
    provider: "azure",
    options: {
      redirectTo: window.location.origin  // Will redirect to current domain after login
    }
  });
};

  // Logout
  const handleLogout = async () => {
    await supabase.auth.signOut();
    setUser(null);
  };

  if (loading) {
    return <div>Loading...</div>;
  }

  return (
    <div style={{
      maxWidth: 400, margin: "5em auto", padding: 32,
      border: "1px solid #ddd", borderRadius: 10, textAlign: "center"
    }}>
      <h2>Leave App v2 - Microsoft Login Test</h2>
      {!user ? (
        <button onClick={signInWithMicrosoft}
          style={{ fontSize: 18, padding: "12px 24px", cursor: "pointer" }}>
          Sign in with Microsoft
        </button>
      ) : (
        <>
          <div style={{ margin: "32px 0" }}>
            <div>
              <b>User:</b> {user.email}
            </div>
            {user.user_metadata && (
              <div>
                {user.user_metadata.full_name && <div>{user.user_metadata.full_name}</div>}
                {user.user_metadata.avatar_url && (
                  <img
                    src={user.user_metadata.avatar_url}
                    alt="profile"
                    style={{ width: 56, height: 56, borderRadius: "50%", marginTop: 8 }}
                  />
                )}
              </div>
            )}
          </div>
          <button onClick={handleLogout}
            style={{ fontSize: 16, padding: "8px 16px", cursor: "pointer" }}>
            Logout
          </button>
        </>
      )}
    </div>
  );
}

export default App;
