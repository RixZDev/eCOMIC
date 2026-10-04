import { createContext, useContext, useEffect, useState } from "react";
import { loadLang, saveLang, translations, DEFAULT_LANG } from "@/lib/i18n";

const I18nContext = createContext(null);

export function I18nProvider({ children }) {
  const [lang, setLangState] = useState(() => loadLang());

  useEffect(() => {
    const h = () => setLangState(loadLang());
    window.addEventListener("e621-lang-change", h);
    return () => window.removeEventListener("e621-lang-change", h);
  }, []);

  const setLang = (l) => {
    saveLang(l);
    setLangState(l);
  };

  const t = (key, vars) => {
    let str =
      (translations[lang] && translations[lang][key]) ||
      (translations[DEFAULT_LANG] && translations[DEFAULT_LANG][key]) ||
      key;
    if (vars) {
      for (const k in vars) {
        str = str.replace(`{${k}}`, vars[k]);
      }
    }
    return str;
  };

  return (
    <I18nContext.Provider value={{ lang, setLang, t }}>
      {children}
    </I18nContext.Provider>
  );
}

export function useI18n() {
  const ctx = useContext(I18nContext);
  if (!ctx) {
    return {
      lang: DEFAULT_LANG,
      setLang: () => {},
      t: (k) => k,
    };
  }
  return ctx;
}
