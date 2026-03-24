import { create } from 'zustand';
import { persist } from 'zustand/middleware';

const useSettingsStore = create(
  persist(
    (set) => ({
      font:    'DM Sans',
      theme:   'warm-sand',
      setFont:  (font)  => set({ font }),
      setTheme: (theme) => set({ theme }),
    }),
    { name: 'toolsforge-settings' }
  )
);

export default useSettingsStore;
