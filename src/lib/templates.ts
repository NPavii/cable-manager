import type { Equipment, PortRow } from '../types';
import { uid } from '../types';

/**
 * Библиотека шаблонов оборудования: именованные блоки в localStorage.
 * Шаблон хранит тип, имя-заготовку и строки выводов; id генерируются при вставке.
 */

export interface EquipmentTemplate {
  name: string;
  type: 'equip' | 'source';
  equipName: string;
  rows: PortRow[];
}

const LS_KEY = 'cable-manager-templates-v1';

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null;

function migrateRow(raw: unknown): PortRow | null {
  if (!isObj(raw)) return null;
  return {
    id: String(raw.id ?? uid()),
    name: String(raw.name ?? 'Точка'),
    kind: raw.kind === 'разъем' ? 'разъем' : 'клемма',
    signal: typeof raw.signal === 'string' ? (raw.signal as PortRow['signal']) : undefined,
    dir: raw.dir === 'IN' || raw.dir === 'OUT' ? raw.dir : undefined,
  };
}

export function listTemplates(): EquipmentTemplate[] {
  try {
    const raw = localStorage.getItem(LS_KEY);
    if (!raw) return [];
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.flatMap((t: unknown): EquipmentTemplate[] => {
      if (!isObj(t) || typeof t.name !== 'string' || !t.name) return [];
      const rows = Array.isArray(t.rows) ? t.rows.map(migrateRow).filter((r): r is PortRow => r !== null) : [];
      return [{
        name: t.name,
        type: t.type === 'source' ? 'source' : 'equip',
        equipName: String(t.equipName ?? t.name),
        rows,
      }];
    });
  } catch {
    return [];
  }
}

export function saveTemplate(t: EquipmentTemplate): void {
  const rest = listTemplates().filter((x) => x.name !== t.name);
  localStorage.setItem(LS_KEY, JSON.stringify([...rest, t]));
}

export function deleteTemplate(name: string): void {
  localStorage.setItem(LS_KEY, JSON.stringify(listTemplates().filter((x) => x.name !== name)));
}

/** Шаблон → готовый блок с новыми id, расположенный в (x, y) */
export function instantiateTemplate(t: EquipmentTemplate, x: number, y: number): Equipment {
  return {
    id: uid(),
    type: t.type,
    name: t.equipName,
    x: Math.max(0, x),
    y: Math.max(0, y),
    rows: t.rows.map((r) => ({ ...r, id: uid() })),
  };
}

/** Текущее оборудование → шаблон (id строк не сохраняются) */
export const templateFromEquipment = (eq: Equipment, name: string): EquipmentTemplate => ({
  name,
  type: eq.type,
  equipName: eq.name,
  rows: eq.rows.map((r) => ({ ...r, id: '' })),
});
