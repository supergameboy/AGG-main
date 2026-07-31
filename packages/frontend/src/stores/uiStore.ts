import { create } from 'zustand';
import { persist, devtools, createJSONStorage } from 'zustand/middleware';
import type { PanelType, ModalType } from '@/types';

interface UIState {
  leftSidebarCollapsed: boolean;
  rightSidebarCollapsed: boolean;
  activeLeftPanel: PanelType | null;
  activeRightPanel: PanelType | null;
  activeBottomTab: PanelType | null;
  modal: ModalType;
  modalData: unknown;

  toggleLeftSidebar: () => void;
  toggleRightSidebar: () => void;
  setActiveLeftPanel: (panel: PanelType | null) => void;
  setActiveRightPanel: (panel: PanelType | null) => void;
  setActiveBottomTab: (tab: PanelType | null) => void;
  openModal: (modal: ModalType, data?: unknown) => void;
  closeModal: () => void;
  reset: () => void;
}

const initialState = {
  leftSidebarCollapsed: false,
  rightSidebarCollapsed: false,
  activeLeftPanel: null as PanelType | null,
  activeRightPanel: 'character' as PanelType | null,
  activeBottomTab: null as PanelType | null,
  modal: null as ModalType,
  modalData: null as unknown,
};

export const useUIStore = create<UIState>()(
  devtools(
    persist(
      (set) => ({
        ...initialState,

        toggleLeftSidebar: () =>
          set((state) => ({ leftSidebarCollapsed: !state.leftSidebarCollapsed }), false, 'toggleLeftSidebar'),
        toggleRightSidebar: () =>
          set((state) => ({ rightSidebarCollapsed: !state.rightSidebarCollapsed }), false, 'toggleRightSidebar'),
        setActiveLeftPanel: (panel) =>
          set({ activeLeftPanel: panel }, false, 'setActiveLeftPanel'),
        setActiveRightPanel: (panel) =>
          set({ activeRightPanel: panel }, false, 'setActiveRightPanel'),
        setActiveBottomTab: (tab) =>
          set({ activeBottomTab: tab }, false, 'setActiveBottomTab'),
        openModal: (modal, data = null) =>
          set({ modal, modalData: data }, false, 'openModal'),
        closeModal: () =>
          set({ modal: null, modalData: null }, false, 'closeModal'),
        reset: () => set(initialState, false, 'resetUI'),
      }),
      {
        name: 'ai-rpg-ui',
        storage: createJSONStorage(() => sessionStorage),
        partialize: (state) => ({
          leftSidebarCollapsed: state.leftSidebarCollapsed,
          rightSidebarCollapsed: state.rightSidebarCollapsed,
          activeRightPanel: state.activeRightPanel,
        }),
      }
    ),
    { name: 'UIStore' }
  )
);
