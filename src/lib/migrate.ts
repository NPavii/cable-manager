import type { Cable, Equipment, Note, PortKind, PortRow, Project, SignalType, Wire } from '../types';
import { SIGNALS, uid } from '../types';

/** Текущая версия формата файла .cbm */
export const FORMAT_VERSION = 2;

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null;
const str = (v: unknown, d = ''): string => (typeof v === 'string' ? v : d);
const num = (v: unknown, d = 0): number => (typeof v === 'number' && Number.isFinite(v) ? v : d);
const bool = (v: unknown): boolean => v === true;
const arr = (v: unknown): unknown[] => (Array.isArray(v) ? v : []);

/** Оборудование / источник из непроверенных данных файла */
function migrateEquipment(raw: unknown): Equipment | null {
  if (!isObj(raw)) return null;
  const type = raw.type === 'source' ? ('source' as const) : ('equip' as const);
  const rows: PortRow[] = arr(raw.rows).flatMap((r: unknown): PortRow[] => {
    if (!isObj(r)) return [];
    const signal = SIGNALS.includes(r.signal as SignalType) ? (r.signal as SignalType) : undefined;
    const dir = r.dir === 'IN' || r.dir === 'OUT' ? (r.dir as 'IN' | 'OUT') : undefined;
    const kind: PortKind = r.kind === 'разъем' ? 'разъем' : 'клемма';
    const name = str(r.name, signal && dir ? `${signal} ${dir}` : 'Точка');
    return [{ id: str(r.id) || uid(), kind, signal, dir, name }];
  });
  return {
    id: str(raw.id) || uid(),
    type,
    name: str(raw.name, type === 'source' ? 'Источник' : 'Оборудование'),
    x: num(raw.x, 40),
    y: num(raw.y, 40),
    rows,
  };
}

function migrateCable(raw: unknown): Cable | null {
  if (!isObj(raw)) return null;
  return {
    id: str(raw.id) || uid(),
    name: str(raw.name),
    type: str(raw.type),
    section: str(raw.section, '0,75'),
    lengthM: num(raw.lengthM),
    color: str(raw.color),
  };
}

function migrateWire(raw: unknown, idx: number, equipment: Equipment[], cables: Cable[]): Wire | null {
  if (!isObj(raw)) return null;
  // у каждой жилы обязан быть существующий кабель — иначе создаём
  let cableId = str(raw.cableId);
  if (!cableId || !cables.some((c) => c.id === cableId)) {
    cableId = uid();
    cables.push({ id: cableId, name: '', type: '', section: '0,75', lengthM: 0, color: '' });
  }
  const fromRowName = equipment
    .find((e) => e.id === raw.fromEq)
    ?.rows.find((r) => r.id === raw.fromRow)?.name;
  const layout = arr(raw.layout)
    .filter(isObj)
    .map((p) => ({ x: num(p.x), y: num(p.y) }));
  return {
    id: str(raw.id) || uid(),
    fromEq: str(raw.fromEq),
    fromRow: str(raw.fromRow),
    toEq: str(raw.toEq),
    toRow: str(raw.toRow),
    color: str(raw.color, '#64B5F6'),
    marking: str(raw.marking, fromRowName ?? String(idx + 1)),
    tipA: str(raw.tipA, 'nshvi'),
    tipB: str(raw.tipB, 'nshvi'),
    aNum: str(raw.aNum, '1'),
    aName: str(raw.aName),
    bNum: str(raw.bNum, '1'),
    bName: str(raw.bName),
    aKind: raw.aKind === 'разъем' ? 'разъем' : raw.aKind === 'клемма' ? 'клемма' : undefined,
    bKind: raw.bKind === 'разъем' ? 'разъем' : raw.bKind === 'клемма' ? 'клемма' : undefined,
    virtual: bool(raw.virtual),
    stripe: str(raw.stripe) || undefined,
    spliceId: str(raw.spliceId) || undefined,
    layout: layout.length ? layout : undefined,
    flip: bool(raw.flip) || undefined,
    cableId,
  };
}

/**
 * Миграция старых сохранений + гарантия целостности:
 * у каждого провода — кабель, у кабелей без жил — удаление, имена и цвета по умолчанию.
 */
export function migrate(raw: unknown): Project {
  const p = isObj(raw) ? raw : {};
  const equipment = arr(p.equipment)
    .map(migrateEquipment)
    .filter((e): e is Equipment => e !== null);

  const cables: Cable[] = [];
  for (const c of arr(p.cables)) {
    const mc = migrateCable(c);
    if (mc) cables.push(mc);
  }

  const wires: Wire[] = [];
  arr(p.wires).forEach((w: unknown, idx: number) => {
    const mw = migrateWire(w, idx, equipment, cables);
    if (mw) wires.push(mw);
  });

  // выкинуть пустые кабели, раздать имена безымянным и цвет — от первой жилы
  const alive = cables.filter((c) => wires.some((w) => w.cableId === c.id));
  let n = 0;
  const named = alive.map((c) => {
    const withName = c.name.trim() ? c : { ...c, name: `Кабель ${++n}` };
    return c.color ? withName : { ...withName, color: wires.find((w) => w.cableId === c.id)?.color ?? '#90A4AE' };
  });

  const notes: Note[] = arr(p.notes).flatMap((x: unknown): Note[] => {
    if (!isObj(x)) return [];
    return [{ id: str(x.id) || uid(), x: num(x.x), y: num(x.y), text: str(x.text, 'NOTE') }];
  });

  return {
    docNumber: str(p.docNumber, 'АНК 601Н-45 00 00 МЭ'),
    equipment,
    wires,
    cables: named,
    notes,
  };
}

/** Проверка, что распарсенный JSON вообще похож на проект */
export const looksLikeProject = (v: unknown): boolean =>
  isObj(v) && Array.isArray(v.equipment) && Array.isArray(v.wires);

/** Сериализация для сохранения в файл (добавляем версию формата) */
export const serializeProject = (p: Project): string =>
  JSON.stringify({ formatVersion: FORMAT_VERSION, ...p }, null, 2);
