"use client";

import { useEffect, useRef, useState } from "react";
import { Check, ChevronDown, Monitor, Moon, Sun } from "lucide-react";

type Theme = "light" | "dark" | "system";
const options = [
  { value: "light", label: "浅色", icon: Sun },
  { value: "dark", label: "暗色", icon: Moon },
  { value: "system", label: "跟随系统", icon: Monitor },
] as const;

function applyTheme(theme: Theme) {
  const dark =
    theme === "dark" ||
    (theme === "system" && window.matchMedia("(prefers-color-scheme: dark)").matches);
  document.documentElement.dataset.theme = dark ? "dark" : "light";
}

export function ThemeSwitcher() {
  const [theme, setTheme] = useState<Theme>("system");
  const menu = useRef<HTMLDetailsElement>(null);
  const preference = useRef<Theme>("system");

  useEffect(() => {
    let initial: Theme = "system";
    try {
      const saved = localStorage.getItem("jida-theme");
      if (saved === "light" || saved === "dark") initial = saved;
    } catch {}
    preference.current = initial;
    setTheme(initial);
    applyTheme(initial);
    const media = window.matchMedia("(prefers-color-scheme: dark)");
    const followSystem = () => {
      if (preference.current === "system") applyTheme("system");
    };
    const syncPreference = (event: StorageEvent) => {
      if (event.key !== "jida-theme" && event.key !== null) return;
      const value =
        event.newValue === "light" || event.newValue === "dark" ? event.newValue : "system";
      preference.current = value;
      setTheme(value);
      applyTheme(value);
    };
    const dismiss = (event: PointerEvent) => {
      if (!menu.current?.contains(event.target as Node)) menu.current?.removeAttribute("open");
    };
    const escape = (event: KeyboardEvent) => {
      if (event.key === "Escape" && menu.current?.open) {
        menu.current.removeAttribute("open");
        menu.current.querySelector("summary")?.focus();
      }
    };
    media.addEventListener("change", followSystem);
    window.addEventListener("storage", syncPreference);
    document.addEventListener("pointerdown", dismiss);
    document.addEventListener("keydown", escape);
    return () => {
      media.removeEventListener("change", followSystem);
      window.removeEventListener("storage", syncPreference);
      document.removeEventListener("pointerdown", dismiss);
      document.removeEventListener("keydown", escape);
    };
  }, []);

  function choose(value: Theme) {
    preference.current = value;
    setTheme(value);
    applyTheme(value);
    try {
      localStorage.setItem("jida-theme", value);
    } catch {}
    menu.current?.removeAttribute("open");
    menu.current?.querySelector("summary")?.focus();
  }

  return (
    <details className="theme-menu" ref={menu}>
      <summary aria-label="主题设置" title="切换页面外观">
        <Sun className="theme-sun" size={17} aria-hidden="true" />
        <Moon className="theme-moon" size={17} aria-hidden="true" />
        <span>外观</span>
        <ChevronDown size={12} aria-hidden="true" />
      </summary>
      <div className="theme-options" aria-label="页面主题">
        {options.map(({ value, label, icon: Icon }) => (
          <button
            key={value}
            type="button"
            aria-pressed={theme === value}
            onClick={() => choose(value)}
          >
            <Icon size={16} aria-hidden="true" />
            {label}
            {theme === value && <Check size={14} className="push-right" aria-hidden="true" />}
          </button>
        ))}
      </div>
    </details>
  );
}
