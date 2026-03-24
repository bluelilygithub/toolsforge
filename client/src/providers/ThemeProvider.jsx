import { useEffect } from 'react';
import useSettingsStore from '../store/settingsStore';
import { themes } from '../themes';

const loadedFonts = new Set(['DM Sans']);

function loadFont(fontName) {
  if (loadedFonts.has(fontName)) return;
  loadedFonts.add(fontName);
  const link = document.createElement('link');
  link.rel = 'stylesheet';
  link.href = `https://fonts.googleapis.com/css2?family=${encodeURIComponent(fontName)}:wght@300;400;500;600;700&display=swap`;
  document.head.appendChild(link);
}

function hexToRgb(hex) {
  const h = hex.replace('#', '');
  return `${parseInt(h.slice(0,2),16)},${parseInt(h.slice(2,4),16)},${parseInt(h.slice(4,6),16)}`;
}

function ThemeProvider({ children }) {
  const theme = useSettingsStore((s) => s.theme);
  const font  = useSettingsStore((s) => s.font);

  useEffect(() => {
    const t = themes[theme] || themes['warm-sand'];
    let el = document.getElementById('forge-theme-vars');
    if (!el) {
      el = document.createElement('style');
      el.id = 'forge-theme-vars';
      document.head.appendChild(el);
    }
    el.textContent = `
      :root {
        --color-bg: ${t.bg};
        --color-surface: ${t.surface};
        --color-border: ${t.border};
        --color-primary: ${t.primary};
        --color-primary-rgb: ${hexToRgb(t.primary)};
        --color-text: ${t.text};
        --color-muted: ${t.muted};
      }
    `;
  }, [theme]);

  useEffect(() => {
    loadFont(font);
    document.documentElement.style.setProperty('--font-sans', `'${font}', sans-serif`);
  }, [font]);

  return children;
}

export default ThemeProvider;
