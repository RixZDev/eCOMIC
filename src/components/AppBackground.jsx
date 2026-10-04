import React from "react";
import { useCustomization } from "@/hooks/useCustomization";

// Fixed background layer driven by the user's customization settings.
export default function AppBackground() {
  const config = useCustomization();
  const bg = config.background;
  const style =
    bg.type === "image" && bg.value
      ? {
          backgroundImage: `url(${bg.value})`,
          backgroundSize: "cover",
          backgroundPosition: "center",
          opacity: bg.opacity / 100,
        }
      : { backgroundColor: bg.value, opacity: bg.opacity / 100 };

  return <div className="fixed inset-0 z-0" style={style} aria-hidden />;
}
