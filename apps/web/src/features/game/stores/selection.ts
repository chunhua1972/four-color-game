import { create } from 'zustand';
interface Selection {
  selectedId: number | null;
  sort: 'color' | 'role';
  select: (id: number | null) => void;
  setSort: (sort: 'color' | 'role') => void;
}
export const useSelection = create<Selection>((set) => ({
  selectedId: null,
  sort: 'color',
  select: (id) => set({ selectedId: id }),
  setSort: (sort) => set({ sort }),
}));
