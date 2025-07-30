// src/components/UserContext.jsx
import { createContext, useContext, useState, useEffect } from "react";
import { supabase } from "../supabaseClient";

export const UserContext = createContext();

export function UserProvider({ children }) {
  const [authUser, setAuthUser] = useState(null);  // Supabase Auth user
  const [dbUser, setDbUser] = useState(null);      // Full row from users table
  const [loading, setLoading] = useState(true);

  // Listen for auth changes and fetch dbUser on login
  useEffect(() => {
    let sub;
    (async () => {
      const { data } = await supabase.auth.getSession();
      setAuthUser(data?.session?.user ?? null);

      sub = supabase.auth.onAuthStateChange((_event, session) => {
        setAuthUser(session?.user ?? null);
      });
    })();
    return () => sub && sub.data.subscription.unsubscribe();
  }, []);

  // Fetch full dbUser when logged in
  useEffect(() => {
    if (!authUser) {
      setDbUser(null);
      setLoading(false);
      return;
    }
    setLoading(true);
    supabase
      .from("users")
      .select("*")
      .eq("id", authUser.id)
      .single()
      .then(({ data }) => {
        setDbUser(data);
        setLoading(false);
      });
  }, [authUser]);

  return (
    <UserContext.Provider value={{ authUser, dbUser, loading }}>
      {children}
    </UserContext.Provider>
  );
}

export function useUser() {
  return useContext(UserContext);
}
