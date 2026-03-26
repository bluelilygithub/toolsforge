import { create } from 'zustand';
import { persist } from 'zustand/middleware';

const useSettingsStore = create(
  persist(
    (set) => ({
      bodyFont:    'Inter',
      headingFont: 'Playfair Display',
      theme:       'warm-sand',
      setBodyFont:    (bodyFont)    => set({ bodyFont }),
      setHeadingFont: (headingFont) => set({ headingFont }),
      setTheme:       (theme)       => set({ theme }),
    }),
    { name: 'toolsforge-settings' }
  )
);

export default useSettingsStore;
