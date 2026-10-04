import { create } from 'zustand';

export type PaletteMode = '' | '>' | '#' | '@';

export type PickerKind =
  | 'status'
  | 'assignee'
  | 'priority'
  | 'labels'
  | 'project'
  | 'cycle'
  | 'team'
  | 'estimate'
  | 'relation'
  | 'milestone';

export interface PickerRequest {
  kind: PickerKind;
  issueIds: string[];
  /** Element the popup anchors to (focused row, property button). */
  anchor: HTMLElement | null;
}

export interface CreateDefaults {
  teamId?: string;
  statusId?: string;
  assigneeId?: string | null;
  priority?: number;
  projectId?: string | null;
  cycleId?: string | null;
  labelIds?: string[];
  parentId?: string | null;
  milestoneId?: string | null;
}

export interface ContextMenuRequest {
  issueIds: string[];
  /** Element the menu anchors to (focused row, panel property). */
  anchor: HTMLElement | null;
}

interface UiState {
  paletteOpen: boolean;
  paletteMode: PaletteMode;
  shortcutsOpen: boolean;
  createOpen: boolean;
  createDefaults: CreateDefaults;
  picker: PickerRequest | null;
  contextMenu: ContextMenuRequest | null;
  confirmDelete: string[] | null;
  openPalette: (mode?: PaletteMode) => void;
  closePalette: () => void;
  setShortcutsOpen: (open: boolean) => void;
  openCreate: (defaults?: CreateDefaults) => void;
  closeCreate: () => void;
  openPicker: (req: PickerRequest) => void;
  closePicker: () => void;
  openContextMenu: (req: ContextMenuRequest) => void;
  closeContextMenu: () => void;
  askDelete: (ids: string[]) => void;
  closeDelete: () => void;
}

export const useUi = create<UiState>()((set) => ({
  paletteOpen: false,
  paletteMode: '',
  shortcutsOpen: false,
  createOpen: false,
  createDefaults: {},
  picker: null,
  contextMenu: null,
  confirmDelete: null,
  openPalette: (mode = '') => set({ paletteOpen: true, paletteMode: mode }),
  closePalette: () => set({ paletteOpen: false }),
  setShortcutsOpen: (shortcutsOpen) => set({ shortcutsOpen }),
  openCreate: (defaults = {}) => set({ createOpen: true, createDefaults: defaults }),
  closeCreate: () => set({ createOpen: false }),
  openPicker: (picker) => set({ picker }),
  closePicker: () => set({ picker: null }),
  openContextMenu: (contextMenu) => set({ contextMenu }),
  closeContextMenu: () => set({ contextMenu: null }),
  askDelete: (ids) => set({ confirmDelete: ids }),
  closeDelete: () => set({ confirmDelete: null }),
}));
