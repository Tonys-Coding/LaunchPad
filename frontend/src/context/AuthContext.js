import { createContext, useContext, useState, useEffect, useCallback } from "react";
import api from "@/lib/api";
import { useTheme } from "@/context/ThemeContext";

const AuthContext = createContext(null);

export function AuthProvider({ children }) {
  const { setPreference } = useTheme();
  const [user, setUser] = useState(null); // null=checking, false=unauth, object=auth
  const [loading, setLoading] = useState(true);

  const checkAuth = useCallback(async () => {
    try {
      const { data } = await api.get("/auth/me");
      setUser(data);
      if (data.preferences?.theme) setPreference(data.preferences.theme);
    } catch {
      setUser(false);
    } finally {
      setLoading(false);
    }
  }, [setPreference]);

  useEffect(() => {
    checkAuth();
  }, [checkAuth]);

  const logout = async () => {
    try {
      await api.post("/auth/logout");
    } catch {}
    setUser(false);
  };

  return (
    <AuthContext.Provider value={{ user, setUser, loading, checkAuth, logout }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  return useContext(AuthContext);
}
