// Client-side app customization: background + button icons/sizes.
// Stored in localStorage as JSON (images are downscaled data URLs).

const KEY = "e621_customization";

export const BUTTON_KEYS = ["home", "favorites", "downloads", "share", "previous", "next"];

export const DEFAULT_CUSTOMIZATION = {
  background: { type: "color", value: "#09090b", opacity: 100, resolution: null },
  buttons: {
    home: { icon: null, size: 20, resolution: null },
    favorites: { icon: null, size: 20, resolution: null },
    downloads: { icon: null, size: 20, resolution: null },
    share: { icon: null, size: 20, resolution: null },
    previous: { icon: null, size: 16, resolution: null },
    next: { icon: null, size: 16, resolution: null },
  },
};

export function loadCustomization() {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return DEFAULT_CUSTOMIZATION;
    const parsed = JSON.parse(raw);
    return {
      background: { ...DEFAULT_CUSTOMIZATION.background, ...(parsed.background || {}) },
      buttons: { ...DEFAULT_CUSTOMIZATION.buttons, ...(parsed.buttons || {}) },
    };
  } catch {
    return DEFAULT_CUSTOMIZATION;
  }
}

export function saveCustomization(cfg) {
  localStorage.setItem(KEY, JSON.stringify(cfg));
  window.dispatchEvent(new Event("e621-customization-change"));
}

// Read an image file, downscale to maxDim, return { dataURL, width, height }.
export function fileToImage(file, maxDim, mime = "image/png") {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const img = new Image();
      img.onload = () => {
        let w = img.naturalWidth;
        let h = img.naturalHeight;
        if (maxDim && (w > maxDim || h > maxDim)) {
          const scale = Math.min(maxDim / w, maxDim / h);
          w = Math.round(w * scale);
          h = Math.round(h * scale);
        }
        const canvas = document.createElement("canvas");
        canvas.width = w;
        canvas.height = h;
        canvas.getContext("2d").drawImage(img, 0, 0, w, h);
        resolve({ dataURL: canvas.toDataURL(mime, 0.9), width: w, height: h });
      };
      img.onerror = reject;
      img.src = reader.result;
    };
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}
