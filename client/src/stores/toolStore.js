import { create } from 'zustand';
import { persist } from 'zustand/middleware';

const useToolStore = create(
  persist(
    (set) => ({
      lastVisitedTool:  null,
      sidebarCollapsed: false,

      setLastVisitedTool: (toolId) => set({ lastVisitedTool: toolId }),
      toggleSidebar:      ()       => set((s) => ({ sidebarCollapsed: !s.sidebarCollapsed })),
      setSidebarCollapsed:(bool)   => set({ sidebarCollapsed: bool }),
      resetTool:          ()       => set({ lastVisitedTool: null, sidebarCollapsed: false }),
    }),
    { name: 'toolStore' }
  )
);

export default useToolStore;
