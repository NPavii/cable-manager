import type { Equipment, Project, Wire } from '../types';

/** Шаг координатной сетки (привязка при перетаскивании), px */
export const GRID = 22;

/** Ширина блока оборудования */
export const BOX_W = 200;
/** Высота шапки блока */
export const HEADER_H = 34;
/** Высота строки вывода */
export const ROW_H = 28;

export interface Pt {
  x: number;
  y: number;
}

export const boxHeight = (eq: Equipment) => HEADER_H + eq.rows.length * ROW_H;

/** Позиция порта строки на боковой кромке блока ('L' | 'R'); null если строка не найдена */
export function portPos(eq: Equipment, rowId: string, side: 'L' | 'R'): Pt | null {
  const i = eq.rows.findIndex((r) => r.id === rowId);
  if (i < 0) return null;
  return {
    x: side === 'L' ? eq.x : eq.x + BOX_W,
    y: eq.y + HEADER_H + i * ROW_H + ROW_H / 2,
  };
}

/** Убирает дубликаты и промежуточные точки на прямых участках */
function compress(pts: Pt[]): Pt[] {
  const dedup: Pt[] = [];
  for (const p of pts) {
    const q = dedup[dedup.length - 1];
    if (!q || p.x !== q.x || p.y !== q.y) dedup.push(p);
  }
  const out: Pt[] = [dedup[0]];
  for (let i = 1; i < dedup.length - 1; i++) {
    const a = out[out.length - 1];
    const b = dedup[i];
    const c = dedup[i + 1];
    const collinear = (a.x === b.x && b.x === c.x) || (a.y === b.y && b.y === c.y);
    if (!collinear) out.push(b);
  }
  out.push(dedup[dedup.length - 1]);
  return out;
}

/** Ортогональная ломаная со скруглёнными углами (SVG path) */
export function roundedPath(pts: Pt[], r: number): string {
  const p = compress(pts);
  if (p.length < 2) return '';
  let d = `M ${p[0].x} ${p[0].y}`;
  for (let i = 1; i < p.length - 1; i++) {
    const p0 = p[i - 1];
    const p1 = p[i];
    const p2 = p[i + 1];
    const d1 = Math.hypot(p1.x - p0.x, p1.y - p0.y);
    const d2 = Math.hypot(p2.x - p1.x, p2.y - p1.y);
    if (d1 === 0 || d2 === 0) continue;
    const rr = Math.min(r, d1 / 2, d2 / 2);
    const ax = p1.x - ((p1.x - p0.x) / d1) * rr;
    const ay = p1.y - ((p1.y - p0.y) / d1) * rr;
    const bx = p1.x + ((p2.x - p1.x) / d2) * rr;
    const by = p1.y + ((p2.y - p1.y) / d2) * rr;
    d += ` L ${ax} ${ay} Q ${p1.x} ${p1.y} ${bx} ${by}`;
  }
  const l = p[p.length - 1];
  d += ` L ${l.x} ${l.y}`;
  return d;
}

const EXIT = 26;

/** Сдвиг по Y для проводов, разделяющих один порт (несколько проводов на точке) */
function portShift(project: Project, wireId: string, eqId: string, rowId: string): number {
  const users = project.wires.filter(
    (x) => (x.fromEq === eqId && x.fromRow === rowId) || (x.toEq === eqId && x.toRow === rowId)
  );
  if (users.length <= 1) return 0;
  const idx = Math.max(0, users.findIndex((x) => x.id === wireId));
  return (idx - (users.length - 1) / 2) * 9;
}

/** Концы трассы: позиции портов и выбор сторон (с учётом flip — переброса) */
interface Ends {
  s: Pt;
  t: Pt;
  overlap: boolean;
  toRight: boolean;
  fe: Equipment;
  te: Equipment;
}

function endPoints(w: Wire, project: Project): Ends | null {
  const fe = project.equipment.find((e) => e.id === w.fromEq);
  const te = project.equipment.find((e) => e.id === w.toEq);
  if (!fe || !te) return null;
  const sShift = portShift(project, w.id, w.fromEq, w.fromRow);
  const tShift = portShift(project, w.id, w.toEq, w.toRow);
  // flip — провод переброшен на противоположные стороны блоков
  const toRight = (te.x + BOX_W / 2 >= fe.x + BOX_W / 2) !== !!w.flip;
  const overlap = !(fe.x + BOX_W < te.x || te.x + BOX_W < fe.x);

  let s: Pt | null;
  let t: Pt | null;
  if (!overlap) {
    s = portPos(fe, w.fromRow, toRight ? 'R' : 'L');
    t = portPos(te, w.toRow, toRight ? 'L' : 'R');
  } else {
    // Обводим сбоку: оба порта на одной стороне
    const side = toRight ? 'R' : 'L';
    s = portPos(fe, w.fromRow, side);
    t = portPos(te, w.toRow, side);
  }
  if (!s || !t) return null;
  s.y += sShift;
  t.y += tShift;
  return { s, t, overlap, toRight, fe, te };
}

/** Автоматическая середина трассы (выход, канал, подход) */
function autoMiddle(e: Ends): Pt[] {
  if (!e.overlap) {
    const d1 = e.toRight ? 1 : -1;        // направление выхода из источника
    const dir2 = e.toRight ? -1 : 1;      // куда смотрит порт приёма
    return [
      { x: e.s.x + d1 * EXIT, y: e.s.y },
      { x: e.t.x + dir2 * EXIT, y: e.t.y },
    ];
  }
  const chX = e.toRight ? Math.max(e.fe.x, e.te.x) + BOX_W + 56 : Math.min(e.fe.x, e.te.x) - 56;
  return [
    { x: chX, y: e.s.y },
    { x: chX, y: e.t.y },
  ];
}

/** Автотрасса без подстановки согласованных каналов (для резолвера коллизий) */
function basePoints(w: Wire, project: Project): Pt[] {
  const ends = endPoints(w, project);
  if (!ends) return [];
  const mids = autoMiddle(ends);
  if (!ends.overlap) {
    // вертикальный канал посередине
    const cx = (mids[0].x + mids[1].x) / 2 + portShift(project, w.id, w.fromEq, w.fromRow);
    return [ends.s, mids[0], { x: cx, y: ends.s.y }, { x: cx, y: ends.t.y }, mids[1], ends.t];
  }
  return [ends.s, mids[0], mids[1], ends.t];
}

/* === Разведение каналов: не даём вертикальным участкам налегать друг на друга === */

interface VertSeg {
  wireId: string;
  idx: number;      // индекс точки начала вертикального сегмента
  x: number;
  y1: number;
  y2: number;
  dir: 1 | -1;      // приоритетное направление сдвига канала
}

const MIN_GAP = 15;       // минимальная дистанция между параллельными каналами
const OVERLAP_MIN = 66;   // 3 клетки сетки (22 px): перекрытие дольше — разводим

function findVertSeg(pts: Pt[]): number {
  for (let k = 0; k < pts.length - 1; k++) {
    if (pts[k].x === pts[k + 1].x && pts[k].y !== pts[k + 1].y) return k;
  }
  return -1;
}

/** Считает согласованные позиции каналов всех проводов (коллизии разрешаются сдвигом) */
function resolveChannels(project: Project): Map<string, number> {
  const segs: VertSeg[] = [];
  for (const w of project.wires) {
    if (w.virtual || (w.layout && w.layout.length)) continue; // ручная трасса не участвует
    const pts = basePoints(w, project);
    const k = findVertSeg(pts);
    if (k < 0) continue;
    const fe = project.equipment.find((e) => e.id === w.fromEq);
    const te = project.equipment.find((e) => e.id === w.toEq);
    let dir: 1 | -1 = 1;
    if (fe && te) {
      const maxR = Math.max(fe.x, te.x) + BOX_W;
      const minL = Math.min(fe.x, te.x);
      dir = pts[k].x > maxR ? 1 : pts[k].x < minL ? -1 : 1;
    }
    segs.push({
      wireId: w.id,
      idx: k,
      x: pts[k].x,
      y1: Math.min(pts[k].y, pts[k + 1].y),
      y2: Math.max(pts[k].y, pts[k + 1].y),
      dir,
    });
  }

  // итеративно разводим перекрывающиеся каналы
  for (let pass = 0; pass < 10; pass++) {
    let moved = false;
    for (let i = 0; i < segs.length; i++) {
      for (let j = i + 1; j < segs.length; j++) {
        const a = segs[i];
        const b = segs[j];
        const ov = Math.min(a.y2, b.y2) - Math.max(a.y1, b.y1);
        if (ov <= OVERLAP_MIN || Math.abs(a.x - b.x) >= MIN_GAP) continue;
        // двигаем канал, который идёт позже по порядку проводов
        const target = a.wireId + a.idx < b.wireId + b.idx ? b : a;
        target.x += (target.dir >= 0 ? 1 : -1) * MIN_GAP;
        moved = true;
      }
    }
    if (!moved) break;
  }

  const map = new Map<string, number>();
  segs.forEach((s) => map.set(`${s.wireId}:${s.idx}`, s.x));
  return map;
}

const channelCache = new WeakMap<Project, Map<string, number>>();

function channelMap(project: Project): Map<string, number> {
  let m = channelCache.get(project);
  if (!m) {
    m = resolveChannels(project);
    channelCache.set(project, m);
  }
  return m;
}

/* === Листы А4 (альбомная ориентация) — разметка поля и печать === */

export const SHEET_W = 1123;  // 297 мм при 96 dpi
export const SHEET_H = 794;   // 210 мм

export interface SheetCell {
  ix: number;
  iy: number;
  num: number; // номер листа (только занятые, в порядке слева-направо, сверху-вниз)
}

/** Листы, на которых есть хотя бы один элемент (в порядке печати) */
export function usedSheets(project: Project): SheetCell[] {
  const set = new Set<string>();
  const mark = (x: number, y: number) =>
    set.add(`${Math.floor(x / SHEET_W)},${Math.floor(y / SHEET_H)}`);
  for (const e of project.equipment) {
    const h = boxHeight(e);
    mark(e.x, e.y);
    mark(e.x + BOX_W, e.y);
    mark(e.x, e.y + h);
    mark(e.x + BOX_W, e.y + h);
    e.rows.forEach((r, i) => {
      const y = e.y + HEADER_H + i * ROW_H + ROW_H / 2;
      mark(e.x, y);
      mark(e.x + BOX_W, y);
    });
  }
  for (const w of project.wires) {
    if (w.virtual) continue;
    wirePoints(w, project).forEach((p) => mark(p.x, p.y));
  }
  project.notes.forEach((n) => mark(n.x, n.y));
  const arr = [...set].map((k) => {
    const [ix, iy] = k.split(',').map(Number);
    return { ix, iy, num: 0 };
  });
  arr.sort((a, b) => a.iy - b.iy || a.ix - b.ix);
  arr.forEach((s, i) => (s.num = i + 1));
  return arr;
}

/** Провода, сгруппированные для отрисовки: splice-группы или общий исходный порт */
export function groupedWires(project: Project): Map<string, Wire[]> {
  const map = new Map<string, Wire[]>();
  for (const w of project.wires) {
    if (w.virtual) continue;
    const key = w.spliceId ?? `${w.fromEq}:${w.fromRow}`;
    if (!map.has(key)) map.set(key, []);
    map.get(key)!.push(w);
  }
  return map;
}

/** Цвет кабеля провода (визуальный) */
export const wireColor = (project: Project, w: Wire) =>
  project.cables.find((c) => c.id === w.cableId)?.color || w.color;

/**
 * Опорные точки трассы с учётом разведения каналов:
 * если вертикальные участки двух трасс идут параллельно и перекрываются
 * больше чем на 3 клетки сетки, каналы автоматически разносятся.
 */
/**
 * Опорные точки трассы: [порт А, ...середина, порт Б].
 * Середина — пользовательская (wire.layout) либо автоматическая с разведением каналов.
 */
export function wirePoints(w: Wire, project: Project): Pt[] {
  const ends = endPoints(w, project);
  if (!ends) return [];
  // ручная трасса — точки пользователя как есть
  if (w.layout && w.layout.length) {
    return [ends.s, ...w.layout.map((p) => ({ ...p })), ends.t];
  }
  const pts = basePoints(w, project);
  if (!pts.length) return pts;
  const k = findVertSeg(pts);
  if (k < 0) return pts;
  const adj = channelMap(project).get(`${w.id}:${k}`);
  if (adj !== undefined && adj !== pts[k].x) {
    pts[k] = { x: adj, y: pts[k].y };
    pts[k + 1] = { x: adj, y: pts[k + 1].y };
  }
  return pts;
}
