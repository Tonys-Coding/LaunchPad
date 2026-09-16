import { createContext, useCallback, useContext, useEffect, useState } from "react";

const THEME_PREFERENCES = new Set(["light", "dark", "system"]);
const cachedPreference = () => {
  const saved = localStorage.getItem("theme-preference") || localStorage.getItem("theme");
  return THEME_PREFERENCES.has(saved) ? saved : "dark";
};

const systemColorScheme = () => (
  window.matchMedia?.("(prefers-color-scheme: light)").matches ? "light" : "dark"
);

const ThemeContext = createContext({
  theme: "dark",
  preference: "dark",
  setPreference: () => {},
  toggle: () => {},
});

export function ThemeProvider({ children }) {
  const [preference, setStoredPreference] = useState(cachedPreference);
  const [systemTheme, setSystemTheme] = useState(systemColorScheme);
  const theme = preference === "system" ? systemTheme : preference;

  const setPreference = useCallback((nextPreference) => {
    if (THEME_PREFERENCES.has(nextPreference)) setStoredPreference(nextPreference);
  }, []);

  useEffect(() => {
    const media = window.matchMedia?.("(prefers-color-scheme: light)");
    if (!media) return undefined;
    const updateSystemTheme = () => setSystemTheme(media.matches ? "light" : "dark");
    updateSystemTheme();
    media.addEventListener?.("change", updateSystemTheme);
    return () => media.removeEventListener?.("change", updateSystemTheme);
  }, []);

  useEffect(() => {
    const root = document.documentElement;
    root.classList.toggle("light", theme === "light");
    root.style.colorScheme = theme;
    localStorage.setItem("theme-preference", preference);
    localStorage.setItem("theme", theme);
  }, [preference, theme]);

  const toggle = useCallback(() => {
    setStoredPreference(theme === "dark" ? "light" : "dark");
  }, [theme]);

  return <ThemeContext.Provider value={{ theme, preference, setPreference, toggle }}>{children}</ThemeContext.Provider>;
}

export function useTheme() {
  return useContext(ThemeContext);
}
