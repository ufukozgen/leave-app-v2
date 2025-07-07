import React, { useEffect, useState } from "react";
import { supabase } from "./supabaseClient";

function App() {
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(true);
  const [dbUser, setDbUser] = useState(null);
  const [dbLoading, setDbLoading] = useState(false);

  // 1. Check login session on mount and listen for auth changes
  useEffect(() => {
    let ignore = false;

    async function getSession() {
      const { data } = await supabase.auth.getSession();
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

  // 2. After login, check/insert user in 'users' table
  useEffect(() => {
    if (!user) {
      setDbUser(null);
      return;
    }
    setDbLoading(true);

    const syncUser = async () => {
      // 1. Try to fetch user from 'users' table
      const { data: existing, error: selectError } = await supabase
        .from("users")
        .select("*")
        .eq("email", user.email)
        .single();

      if (selectError && selectError.code !== "PGRST116" && selectError.code !== "406") {
        // Not 'No rows found', log error
        console.error("Select error:", selectError);
        setDbLoading(false);
        return;
      }

      if (!existing) {
        // 2. If not found, insert user
        const { data: inserted, error: insertError } = await supabase
          .from("users")
          .insert([
            {
              email: user.email,
              name: user.user_metadata?.full_name || "",
              role: "user",
              manager_email: "", // Fill or update as needed later
              profile_pic: user.user_metadata?.avatar_url || ""
            }
          ])
          .single();

        if (insertError) {
          console.error("Insert error:", insertError);
        } else {
          setDbUser(inserted);
        }
      } else {
        setDbUser(existing);
      }
      setDbLoading(false);
    };

    syncUser();
  }, [user]);

  // 3. Login with Microsoft (always redirect back to current site)
  const signInWithMicrosoft = async () => {
    await supabase.auth.signInWithOAuth({
      provider: "azure",
      options: {
        redirectTo: window.location.origin
      }
    });
  };

  // 4. Logout
  const handleLogout = async () => {
    await supabase.auth.signOut();
    setUser(null);
    setDbUser(null);
  };

  if (loading) {
    return <div>Loading authentication...</div>;
  }

  return (
    <div style={{
      maxWidth: 480,
      margin: "5em auto",
      padding: 32,
      border: "1px solid #ddd",
      borderRadius: 10,
      textAlign: "center"
    }}>
      <h2>Leave App v2 – Microsoft Login Demo</h2>

      {!user ? (
        <button onClick={signInWithMicrosoft}
                style={{ fontSize: 18, padding: "12px 24px", cursor: "pointer" }}>
          Sign in with Microsoft
        </button>
      ) : (
        <>
          <div style={{ margin: "32px 0" }}>
            <div><b>Email:</b> {user.email}</div>
            {user.user_metadata && (
              <div>
                {user.user_metadata.full_name && <div><b>Name:</b> {user.user_metadata.full_name}</div>}
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
                  style={{ fontSize: 16, padding: "8px 16px", cursor: "pointer", marginBottom: 24 }}>
            Logout
          </button>

          <div style={{ marginTop: 32 }}>
            {dbLoading && <p>Checking your database registration...</p>}
            {dbUser && (
              <p style={{ color: "#468847", fontWeight: "bold" }}>
                ✅ You are registered in the users table as: {dbUser.name || dbUser.email}
              </p>
            )}
          </div>
        </>
      )}
    </div>
  );
}

export default App;
