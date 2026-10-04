import { useEffect, useState } from "react";
import { loadCustomization } from "@/lib/customization";

export function useCustomization() {
  const [config, setConfig] = useState(() => loadCustomization());
  useEffect(() => {
    const h = () => setConfig(loadCustomization());
    window.addEventListener("e621-customization-change", h);
    return () => window.removeEventListener("e621-customization-change", h);
  }, []);
  return config;
}
