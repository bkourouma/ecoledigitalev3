import { create } from "zustand";

interface CartState {
  selectedSessionId: string | null;
  telephone: string;
  setSelectedSessionId: (sessionId: string | null) => void;
  setTelephone: (telephone: string) => void;
}

export const useCartStore = create<CartState>((set) => ({
  selectedSessionId: null,
  telephone: "",
  setSelectedSessionId: (selectedSessionId) => set({ selectedSessionId }),
  setTelephone: (telephone) => set({ telephone }),
}));
