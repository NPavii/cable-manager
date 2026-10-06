export type SignalType = 'Авария' | 'Работа' | 'Пауза' | 'Питание' | 'Связь' | 'Воздух';

export const SIGNALS: SignalType[] = ['Авария', 'Работа', 'Пауза', 'Питание', 'Связь', 'Воздух'];

/** Тип точки подключения: клемма (точка) или разъём (стрелочка «>») */
export type PortKind = 'клемма' | 'разъем';

export interface TipType {
  id: string;
  name: string;
}

export const TIPS: TipType[] = [
  { id: 'nshvi', name: 'НШВИ (штыревой)' },
  { id: 'ring4', name: 'РФ-М4 (кольцо)' },
  { id: 'ring5', name: 'РФ-М5 (кольцо)' },
  { id: 'fork', name: 'РВИ (вилочный)' },
  { id: 'sleeve', name: 'НКИ (гильза)' },
  { id: 'flat', name: 'РПИ (плоский)' },
  { id: 'none', name: 'Без наконечника' },
];

export interface WireColor {
  hex: string;
  name: string;
}

export const PALETTE: WireColor[] = [
  { hex: '#E57373', name: 'Красный' },
  { hex: '#64B5F6', name: 'Синий' },
  { hex: '#FFD54F', name: 'Жёлтый' },
  { hex: '#81C784', name: 'Зелёный' },
  { hex: '#BA68C8', name: 'Фиолетовый' },
  { hex: '#FF8A65', name: 'Оранжевый' },
  { hex: '#4DD0E1', name: 'Бирюзовый' },
  { hex: '#F06292', name: 'Розовый' },
  { hex: '#AED581', name: 'Салатовый' },
  { hex: '#90A4AE', name: 'Серый' },
];

export const colorName = (hex: string) => PALETTE.find((c) => c.hex === hex)?.name ?? hex;

/** Строка вывода оборудования / точка источника */
export interface PortRow {
  id: string;
  name: string;            // отображаемое имя (переименовывается двойным кликом)
  signal?: SignalType;     // только для оборудования
  dir?: 'IN' | 'OUT';      // только для оборудования; у источника — нет направления
  kind: PortKind;
}

export interface Equipment {
  id: string;
  type: 'equip' | 'source';
  name: string;
  x: number;
  y: number;
  rows: PortRow[];
}

export interface Wire {
  id: string;
  fromEq: string;    // оборудование/источник стороны А (вывод OUT либо произвольная точка)
  fromRow: string;
  toEq: string;      // сторона Б
  toRow: string;
  color: string;     // hex из PALETTE — визуальный цвет жилы
  marking: string;   // маркировка жилы (текст над проводом)
  tipA: string;      // наконечник стороны А
  tipB: string;      // наконечник стороны Б
  aNum: string;      // № клеммы / контакта, сторона А
  aName: string;     // имя клеммы / разъёма, сторона А
  bNum: string;
  bName: string;
  aKind?: PortKind;  // тип точки стороны А (только для жил без своей строки)
  bKind?: PortKind;  // тип точки стороны Б
  virtual?: boolean; // дополнительная жила без трассы на схеме
  stripe?: string;   // цвет штриховки (Stripe) поверх провода, hex
  spliceId?: string; // явное соединение (splice) проводов в одной точке
  layout?: { x: number; y: number }[]; // пользовательские точки трассы (drag)
  flip?: boolean;    // переброс на другую сторону блоков
  cableId?: string;  // кабель (у каждого провода всегда есть свой кабель)
}

/** Свободная заметка на поле */
export interface Note {
  id: string;
  x: number;
  y: number;
  text: string;
}

export interface Cable {
  id: string;
  name: string;      // «Кабель 1»
  type: string;      // тип/марка кабеля (произвольно, например «КГВВнг»)
  section: string;   // сечение жилы
  lengthM: number;   // длина, м
  color: string;     // визуальный цвет кабеля на схеме (hex)
}

export interface Project {
  docNumber: string;
  equipment: Equipment[];
  wires: Wire[];
  cables: Cable[];
  notes: Note[];
}

let counter = 1;
export const uid = () => `id_${Date.now().toString(36)}_${counter++}`;

export const makeEquipment = (n: number, x: number, y: number): Equipment => ({
  id: uid(),
  type: 'equip',
  name: `Оборудование №${n}`,
  x,
  y,
  rows: [],
});

export const makeSource = (n: number, x: number, y: number): Equipment => ({
  id: uid(),
  type: 'source',
  name: `Источник №${n}`,
  x,
  y,
  rows: [],
});

/** Следующее свободное имя «Кабель N» */
export const nextCableName = (cables: Cable[]) => {
  let max = 0;
  for (const c of cables) {
    const m = /Кабель\s+(\d+)\s*$/.exec(c.name);
    if (m) max = Math.max(max, parseInt(m[1], 10));
  }
  return `Кабель ${max + 1}`;
};

/** Эффективный тип точки жилы: из строки; у дополнительных жил — как у первой жилы кабеля */
export function wireEndKind(project: Project, w: Wire, side: 'A' | 'B'): PortKind {
  if (w.virtual) {
    const first = project.wires.find((x) => x.cableId === w.cableId && !x.virtual);
    if (first) return wireEndKind(project, first, side);
    return (side === 'A' ? w.aKind : w.bKind) ?? 'клемма';
  }
  const eqId = side === 'A' ? w.fromEq : w.toEq;
  const rowId = side === 'A' ? w.fromRow : w.toRow;
  const row = project.equipment.find((e) => e.id === eqId)?.rows.find((r) => r.id === rowId);
  return row?.kind ?? (side === 'A' ? w.aKind : w.bKind) ?? 'клемма';
}

/** Дополнительная жила кабеля без трассы на схеме */
export const makeVirtualWire = (cableId: string, idx: number): Wire => ({
  id: uid(),
  fromEq: '',
  fromRow: '',
  toEq: '',
  toRow: '',
  color: PALETTE[idx % PALETTE.length].hex,
  marking: String(idx + 1),
  tipA: 'nshvi',
  tipB: 'nshvi',
  aNum: String(idx + 1),
  aName: '',
  bNum: String(idx + 1),
  bName: '',
  aKind: 'клемма',
  bKind: 'клемма',
  virtual: true,
  cableId,
});
