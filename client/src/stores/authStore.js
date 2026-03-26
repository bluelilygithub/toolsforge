import { create } from 'zustand';
import { persist } from 'zustand/middleware';

const useAuthStore = create(
  persist(
    (set, get) => ({
      token: null,
      user: null,
      setAuth: (token, user) => set({ token, user }),
      clearAuth: () => set({ token: null, user: null }),
      logout: () => get().clearAuth(),
    }),
    { name: 'toolsforge-auth' }
  )
);

export default useAuthStore;
