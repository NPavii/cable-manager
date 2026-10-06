import { useEffect, useRef, useState } from 'react';
import type { PortKind, Project, SignalType, Wire } from '../types';
import { PALETTE, wireEndKind } from '../types';
import {
  BOX_W, GRID, HEADER_H, ROW_H, SHEET_H, SHEET_W, boxHeight,
  groupedWires, portPos, roundedPath, usedSheets, wireColor, wirePoints,
} from '../lib/layout';
import type { Pt } from '../lib/layout';
import type { EquipmentTemplate } from '../lib/templates';
import ContextMenu from './ContextMenu';
import type { MenuState } from './ContextMenu';
import { PortSymbol, connText } from './symbols';

interface ViewState {
  ox: number;
  oy: number;
  scale: number;
}

interface Props {
  project: Project;
  selection: string[];
  /** фоновая сетка + привязка перетаскивания к узлам 22 px */
  grid: boolean;
  /** библиотека шаблонов оборудования */
  templates: EquipmentTemplate[];
  onSelect: (ids: string[]) => void;
  onOpenCable: (id: string | null) => void;
  onAddEquipment: (x: number, y: number) => void;
  onAddSource: (x: number, y: number) => void;
  onAddNote: (x: number, y: number) => void;
  onMoveEquipment: (id: string, x: number, y: number) => void;
  onRenameEquipment: (id: string, name: string) => void;
  onAddSignal: (eqId: string, signal: SignalType) => void;
  onAddPoint: (eqId: string) => void;
  onSetRowKind: (eqId: string, rowId: string, kind: PortKind) => void;
  onRenameRow: (eqId: string, rowId: string, name: string) => void;
  onMoveRow: (eqId: string, rowId: string, index: number) => void;
  onDeleteEquipment: (eqId: string) => void;
  onDuplicateEquipment: (eqId: string) => void;
  onDeleteRow: (eqId: string, rowId: string) => void;
  onDeleteWires: (ids: string[]) => void;
  onDetachWire: (id: string) => void;
  onAddWire: (fromEq: string, fromRow: string, toEq: string, toRow: string, color: string) => void;
  onSetCableColor: (cableId: string, color: string) => void;
  onSetStripe: (wireId: string, stripe?: string) => void;
  onSplice: (ids: string[]) => void;
  onUnsplice: (wireId: string) => void;
  onSetLayout: (wireId: string, layout?: { x: number; y: number }[]) => void;
  onToggleFlip: (wireId: string) => void;
  onMoveNote: (id: string, x: number, y: number) => void;
  onRenameNote: (id: string, text: string) => void;
  onDeleteNote: (id: string) => void;
  /** выровнять оборудование по узлам сетки (id не задан — всё) */
  onAlignToGrid: (id?: string) => void;
  /** сохранить оборудование как шаблон (имя вводится во всплывающем поле редактора) */
  onSaveTemplateRequest: (eqId: string, name: string) => void;
  /** вставить шаблон в мировые координаты */
  onInsertTemplate: (name: string, x: number, y: number) => void;
}

interface TempWire {
  eqId: string;
  rowId: string;
  dir?: 'IN' | 'OUT';
  color: string;
}

interface RenamingState {
  mode: 'eq' | 'row' | 'note' | 'template';
  eqId?: string;
  rowId?: string;
  noteId?: string;
  left: number;
  top: number;
  value: string;
}

/** Символы концов провода: разъём/клемма + подпись «Имя:№» у каждой стороны */
function WireEnds({
  w,
  pts,
  project,
  dark,
}: {
  w: Wire;
  pts: Pt[];
  project: Project;
  dark: boolean;
}) {
  const stroke = dark ? '#c9c9cf' : '#000';
  const holeFill = dark ? '#1e1e23' : '#fff';
  const labelFill = dark ? '#9a9aa4' : '#000';
  const s = pts[0];
  const t = pts[pts.length - 1];
  const dirA = Math.sign(pts[1].x - s.x) || 1;   // направление выхода из порта А
  const dirT = Math.sign(t.x - pts[pts.length - 2].x) || 1; // направление входа в порт Б
  const kindA = wireEndKind(project, w, 'A');
  const kindB = wireEndKind(project, w, 'B');
  const ax = s.x + dirA * 22;
  const bx = t.x - dirT * 22;
  const txtA = connText(w.aName, w.aNum);
  const txtB = connText(w.bName, w.bNum);
  return (
    <g>
      <PortSymbol x={ax} y={s.y} kind={kindA} side={(dirA * -1) as 1 | -1} stroke={stroke} holeFill={holeFill} />
      <PortSymbol x={bx} y={t.y} kind={kindB} side={dirT as 1 | -1} stroke={stroke} holeFill={holeFill} />
      {txtA && (
        <text x={ax} y={s.y - 11} fontSize={10} textAnchor="middle" fill={labelFill} style={{ userSelect: 'none' }}>
          {txtA}
        </text>
      )}
      {txtB && (
        <text x={bx} y={t.y - 11} fontSize={10} textAnchor="middle" fill={labelFill} style={{ userSelect: 'none' }}>
          {txtB}
        </text>
      )}
    </g>
  );
}

export default function Editor(props: Props) {
  const { project, selection, onSelect } = props;
  const wrapRef = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState({ w: 1200, h: 800 });
  const [menu, setMenu] = useState<MenuState | null>(null);
  const [renaming, setRenaming] = useState<RenamingState | null>(null);
  const [temp, setTemp] = useState<TempWire | null>(null);
  const [mouse, setMouse] = useState<{ x: number; y: number } | null>(null);
  const [view, setView] = useState<ViewState>({ ox: 0, oy: 0, scale: 1 });
  const [panning, setPanning] = useState(false);

  useEffect(() => {
    const el = wrapRef.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setSize({ w: el.clientWidth, h: el.clientHeight }));
    ro.observe(el);
    setSize({ w: el.clientWidth, h: el.clientHeight });
    return () => ro.disconnect();
  }, []);

  // зум колесиком мыши (вокруг курсора), без пассивного слушателя — чтобы перехватить
  useEffect(() => {
    const el = wrapRef.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const r = el.getBoundingClientRect();
      const px = e.clientX - r.left;
      const py = e.clientY - r.top;
      setView((v) => {
        const scale = Math.min(2.5, Math.max(0.25, v.scale * Math.exp(-e.deltaY * 0.0012)));
        const k = scale / v.scale;
        return { scale, ox: px - (px - v.ox) * k, oy: py - (py - v.oy) * k };
      });
    };
    el.addEventListener('wheel', onWheel, { passive: false });
    return () => el.removeEventListener('wheel', onWheel);
  }, []);

  /** Клиентские координаты → мировые (с учётом панорамы и масштаба) */
  const toSvg = (clientX: number, clientY: number) => {
    const r = wrapRef.current?.getBoundingClientRect();
    return {
      x: (clientX - (r?.left ?? 0) - view.ox) / view.scale,
      y: (clientY - (r?.top ?? 0) - view.oy) / view.scale,
    };
  };

  /** Мировые координаты → клиентские */
  const toClient = (x: number, y: number) => {
    const r = wrapRef.current?.getBoundingClientRect();
    return { left: (r?.left ?? 0) + x * view.scale + view.ox, top: (r?.top ?? 0) + y * view.scale + view.oy };
  };

  // панорама средней кнопкой мыши
  const startPan = (e: React.PointerEvent) => {
    if (e.button !== 1) return;
    e.preventDefault();
    e.stopPropagation();
    setMenu(null);
    setPanning(true);
    const start = { x: e.clientX, y: e.clientY };
    const v0 = { ...view };
    const onMove = (ev: PointerEvent) => {
      setView({ ...v0, ox: v0.ox + ev.clientX - start.x, oy: v0.oy + ev.clientY - start.y });
    };
    const onUp = () => {
      setPanning(false);
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
    };
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
  };

  // --- перетаскивание оборудования за шапку ---
  const startDragEq = (e: React.PointerEvent, eqId: string) => {
    if (e.button !== 0) return;
    e.stopPropagation();
    setMenu(null);
    const start = toSvg(e.clientX, e.clientY);
    const eq = project.equipment.find((x) => x.id === eqId);
    if (!eq) return;
    const dx = start.x - eq.x;
    const dy = start.y - eq.y;
    const step = props.grid ? GRID : 4;
    const onMove = (ev: PointerEvent) => {
      const p = toSvg(ev.clientX, ev.clientY);
      props.onMoveEquipment(
        eqId,
        Math.round((p.x - dx) / step) * step,
        Math.round((p.y - dy) / step) * step
      );
    };
    const onUp = () => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
    };
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
  };

  // --- перетаскивание заметки ---
  const startDragNote = (e: React.PointerEvent, noteId: string) => {
    if (e.button !== 0) return;
    e.stopPropagation();
    setMenu(null);
    const start = toSvg(e.clientX, e.clientY);
    const note = project.notes.find((n) => n.id === noteId);
    if (!note) return;
    const dx = start.x - note.x;
    const dy = start.y - note.y;
    const step = props.grid ? GRID : 1;
    const onMove = (ev: PointerEvent) => {
      const p = toSvg(ev.clientX, ev.clientY);
      props.onMoveNote(noteId, Math.round((p.x - dx) / step) * step, Math.round((p.y - dy) / step) * step);
    };
    const onUp = () => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
    };
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
  };

  // --- ручное перетаскивание провода (layout-точки, как в Harness.Design) ---
  const startWireDrag = (e: React.PointerEvent, w: Wire) => {
    if (e.button !== 0) return;
    e.stopPropagation();
    setMenu(null);
    const pts = wirePoints(w, project);
    if (pts.length < 2) return;
    const start = toSvg(e.clientX, e.clientY);
    let dragging = false;
    let layout: Pt[] = pts.slice(1, -1).map((p) => ({ ...p }));
    let grabIdx = -1;
    const step = props.grid ? GRID : 4;

    const full = () => [pts[0], ...layout, pts[pts.length - 1]];

    const onMove = (ev: PointerEvent) => {
      const p = toSvg(ev.clientX, ev.clientY);
      if (!dragging) {
        if (Math.hypot(p.x - start.x, p.y - start.y) * view.scale < 6) return;
        dragging = true;
        // за что схватили: существующую точку (<14 px) или сегмент (вставляем точку)
        grabIdx = -1;
        let bestD = 14 / view.scale;
        layout.forEach((pt, i) => {
          const d = Math.hypot(pt.x - start.x, pt.y - start.y);
          if (d < bestD) {
            bestD = d;
            grabIdx = i;
          }
        });
        if (grabIdx < 0) {
          const poly = full();
          let best = { d: 10 / view.scale, index: 1, point: { ...poly[1] } };
          for (let k = 0; k < poly.length - 1; k++) {
            const a = poly[k];
            const b = poly[k + 1];
            const dx = b.x - a.x;
            const dy = b.y - a.y;
            const len2 = dx * dx + dy * dy;
            const t = len2 ? Math.max(0, Math.min(1, ((start.x - a.x) * dx + (start.y - a.y) * dy) / len2)) : 0;
            const q = { x: a.x + t * dx, y: a.y + t * dy };
            const d = Math.hypot(q.x - start.x, q.y - start.y);
            if (d < best.d) {
              // ортогонализируем: точка на оси сегмента
              const point =
                Math.abs(dx) >= Math.abs(dy)
                  ? { x: Math.round(q.x / step) * step, y: a.y }
                  : { x: a.x, y: Math.round(q.y / step) * step };
              best = { d, index: k, point };
            }
          }
          layout.splice(best.index, 0, best.point);
          grabIdx = best.index;
        }
        props.onSetLayout(w.id, layout.map((pt) => ({ ...pt })));
        return;
      }
      layout = layout.map((pt, i) =>
        i === grabIdx ? { x: Math.round(p.x / step) * step, y: Math.round(p.y / step) * step } : pt
      );
      props.onSetLayout(w.id, layout.map((pt) => ({ ...pt })));
    };
    const onUp = (ev: PointerEvent) => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
      if (!dragging) {
        // это был клик, а не перетаскивание — выбор провода
        clickWire(ev as unknown as React.MouseEvent, w.id);
      }
    };
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
  };

  // --- перетаскивание строки (смена порядка) ---
  const startDragRow = (e: React.PointerEvent, eqId: string, rowId: string) => {
    if (e.button !== 0) return;
    e.stopPropagation();
    setMenu(null);
    const eq = project.equipment.find((x) => x.id === eqId);
    if (!eq) return;
    const onMove = (ev: PointerEvent) => {
      const p = toSvg(ev.clientX, ev.clientY);
      const idx = Math.max(0, Math.min(eq.rows.length - 1, Math.floor((p.y - eq.y - HEADER_H) / ROW_H)));
      props.onMoveRow(eqId, rowId, idx);
    };
    const onUp = () => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
    };
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
  };

  // --- прокладка провода от порта к порту ---
  const SNAP = 30; // радиус притяжения к порту, px
  const [dropTarget, setDropTarget] = useState<{ eq: string; row: string } | null>(null);

  /** Ближайший порт в радиусе притяжения (не считая исходного) */
  const findNearestPort = (clientX: number, clientY: number, selfEq: string, selfRow: string): Element | null => {
    let bestEl: Element | null = null;
    let bestD = SNAP;
    document.querySelectorAll('[data-port]').forEach((el) => {
      const eq = el.getAttribute('data-eq') ?? '';
      const row = el.getAttribute('data-row') ?? '';
      if (eq === selfEq && row === selfRow) return;
      const r = el.getBoundingClientRect();
      const d = Math.hypot(clientX - (r.left + r.width / 2), clientY - (r.top + r.height / 2));
      if (d < bestD) {
        bestD = d;
        bestEl = el;
      }
    });
    return bestEl;
  };

  const startWire = (e: React.PointerEvent, eqId: string, rowId: string, dir?: 'IN' | 'OUT') => {
    if (e.button !== 0) return;
    e.stopPropagation();
    setMenu(null);
    const drag: TempWire = { eqId, rowId, dir, color: PALETTE[project.wires.length % PALETTE.length].hex };
    setTemp(drag);
    setMouse(toSvg(e.clientX, e.clientY));
    const onMove = (ev: PointerEvent) => {
      setMouse(toSvg(ev.clientX, ev.clientY));
      const el = findNearestPort(ev.clientX, ev.clientY, drag.eqId, drag.rowId);
      setDropTarget(el ? { eq: el.getAttribute('data-eq') ?? '', row: el.getAttribute('data-row') ?? '' } : null);
    };
    const onUp = (ev: PointerEvent) => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
      setTemp(null);
      setMouse(null);
      setDropTarget(null);
      // притяжение: ближайший порт в радиусе SNAP, иначе — элемент под курсором
      const el =
        findNearestPort(ev.clientX, ev.clientY, drag.eqId, drag.rowId) ??
        (ev.target as Element | null)?.closest?.('[data-port]');
      if (!el) return;
      const tEq = el.getAttribute('data-eq') ?? '';
      const tRow = el.getAttribute('data-row') ?? '';
      const tDir = el.getAttribute('data-dir') as 'IN' | 'OUT' | null;
      if (!tEq || (tEq === drag.eqId && tRow === drag.rowId)) return;
      if (drag.dir && tDir && drag.dir === tDir) return;
      if (drag.dir === 'OUT' || (!drag.dir && tDir === 'IN')) {
        props.onAddWire(drag.eqId, drag.rowId, tEq, tRow, drag.color);
      } else {
        props.onAddWire(tEq, tRow, drag.eqId, drag.rowId, drag.color);
      }
    };
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
  };

  const clickWire = (e: React.MouseEvent, wId: string) => {
    e.stopPropagation();
    setMenu(null);
    const w = project.wires.find((x) => x.id === wId);
    if (!w) return;
    if (e.ctrlKey || e.metaKey) {
      onSelect(selection.includes(wId) ? selection.filter((id) => id !== wId) : [...selection, wId]);
    } else {
      const key = w.spliceId ?? `${w.fromEq}:${w.fromRow}`;
      const mates = project.wires.filter((x) => (x.spliceId ?? `${x.fromEq}:${x.fromRow}`) === key).map((x) => x.id);
      onSelect(mates.length > 1 ? mates : [wId]);
    }
  };

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const tag = (document.activeElement as HTMLElement | null)?.tagName;
      const typing = tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT';
      if (e.key === 'Escape') {
        setMenu(null);
        setRenaming(null);
      }
      if ((e.key === 'Delete' || e.key === 'Backspace') && !typing && selection.length) {
        props.onDeleteWires(selection);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selection, project]);

  // резиновый провод при прокладке
  const tempEq = temp ? project.equipment.find((e) => e.id === temp.eqId) : null;
  const tempStart =
    temp && tempEq ? portPos(tempEq, temp.rowId, mouse && mouse.x >= tempEq.x + BOX_W / 2 ? 'R' : 'L') : null;
  const tempD =
    temp && tempStart && tempEq && mouse
      ? (() => {
          if (mouse.x > tempEq.x - 60 && mouse.x < tempEq.x + BOX_W + 60) {
            const dir = mouse.x >= tempEq.x + BOX_W / 2 ? 1 : -1;
            const edgeX = dir > 0 ? tempEq.x + BOX_W : tempEq.x;
            const chX = dir > 0 ? tempEq.x + BOX_W + 56 : tempEq.x - 56;
            return roundedPath(
              [{ x: edgeX, y: tempStart.y }, { x: chX, y: tempStart.y }, { x: chX, y: mouse.y }, mouse],
              12
            );
          }
          const d1 = mouse.x >= tempStart.x ? 1 : -1;
          const ax = tempStart.x + d1 * 26;
          const cx = (ax + mouse.x) / 2;
          return roundedPath(
            [tempStart, { x: ax, y: tempStart.y }, { x: cx, y: tempStart.y }, { x: cx, y: mouse.y }, mouse],
            10
          );
        })()
      : '';

  const openRowRename = (eqId: string, rowId: string, eqX: number, eqY: number, rowY: number, value: string) => {
    const c = toClient(eqX, eqY + rowY + 2);
    setRenaming({ mode: 'row', eqId, rowId, left: c.left, top: c.top, value });
  };

  const sheets = usedSheets(project);

  // видимая область в мировых координатах — для фоновой сетки
  const vx0 = -view.ox / view.scale;
  const vy0 = -view.oy / view.scale;
  const vx1 = (size.w - view.ox) / view.scale;
  const vy1 = (size.h - view.oy) / view.scale;
  const gridLines = (() => {
    if (!props.grid) return null;
    const majorStep = GRID * 5;
    // мелкая сетка отключается при сильном отдалении, чтобы не сливаться
    const minorStep = view.scale >= 0.55 ? GRID : 0;
    let minor = '';
    let major = '';
    if (minorStep) {
      for (let x = Math.floor(vx0 / minorStep) * minorStep; x <= vx1; x += minorStep)
        minor += `M ${x} ${vy0} V ${vy1} `;
      for (let y = Math.floor(vy0 / minorStep) * minorStep; y <= vy1; y += minorStep)
        minor += `M ${vx0} ${y} H ${vx1} `;
    }
    for (let x = Math.floor(vx0 / majorStep) * majorStep; x <= vx1; x += majorStep)
      major += `M ${x} ${vy0} V ${vy1} `;
    for (let y = Math.floor(vy0 / majorStep) * majorStep; y <= vy1; y += majorStep)
      major += `M ${vx0} ${y} H ${vx1} `;
    return { minor, major };
  })();

  return (
    <div
      className={'editor-wrap' + (panning ? ' panning' : '')}
      ref={wrapRef}
      onAuxClick={(e) => e.preventDefault()}
    >
      <svg
        width={size.w}
        height={size.h}
        onPointerDown={(e) => {
          if (e.button === 1) {
            startPan(e);
            return;
          }
          if (e.button !== 0) return;
          setMenu(null);
          if (e.target === e.currentTarget) {
            onSelect([]);
            props.onOpenCable(null);
          }
        }}
        onContextMenu={(e) => {
          e.preventDefault();
          onSelect([]);
          props.onOpenCable(null);
          setMenu({ kind: 'blank', x: e.clientX, y: e.clientY });
        }}
      >
        <g transform={`translate(${view.ox},${view.oy}) scale(${view.scale})`}>
        {/* координатная сетка (мировые координаты) */}
        {gridLines && (
          <g className="world-grid">
            {gridLines.minor && <path d={gridLines.minor} className="grid-minor" />}
            <path d={gridLines.major} className="grid-major" />
          </g>
        )}
        {/* разметка листов А4 (занятые) */}
        <g>
          {sheets.map((s) => (
            <g key={`${s.ix},${s.iy}`}>
              <rect
                x={s.ix * SHEET_W + 1}
                y={s.iy * SHEET_H + 1}
                width={SHEET_W - 2}
                height={SHEET_H - 2}
                fill="none"
                stroke="#4a4a58"
                strokeWidth={1.2}
                strokeDasharray="10 7"
              />
              <text
                x={s.ix * SHEET_W + 10}
                y={s.iy * SHEET_H + 20}
                fontSize={12}
                fill="#5f5f70"
                style={{ userSelect: 'none' }}
              >
                Лист {s.num}
              </text>
            </g>
          ))}
        </g>

        {/* провода под оборудованием */}
        <g>
          {[...groupedWires(project)].map(([key, group]) => {
            const pts0 = wirePoints(group[0], project);
            if (!pts0.length) return null;
            const sel = (w: Wire) => selection.includes(w.id);
            const inCable = (w: Wire) =>
              !!w.cableId && project.wires.filter((x) => x.cableId === w.cableId).length > 1;

            if (group.length === 1) {
              const w = group[0];
              const d = roundedPath(pts0, 10);
              return (
                <g key={key}>
                  <path
                    d={d}
                    className="wire-hit"
                    onPointerDown={(e) => startWireDrag(e, w)}
                    onDoubleClick={(e) => {
                      e.stopPropagation();
                      if (w.cableId) props.onOpenCable(w.cableId);
                    }}
                    onContextMenu={(e) => {
                      e.preventDefault();
                      e.stopPropagation();
                      onSelect(selection.includes(w.id) ? selection : [w.id]);
                      setMenu({ kind: 'wire', x: e.clientX, y: e.clientY, wireId: w.id });
                    }}
                  />
                  {inCable(w) && <path d={d} className="wire-jacket" />}
                  <path d={d} className={'wire' + (inCable(w) ? ' cable-member' : '') + (sel(w) ? ' selected' : '')} stroke={wireColor(project, w)} />
                  {w.stripe && <path d={d} className="wire-stripe" stroke={w.stripe} />}
                  <WireEnds w={w} pts={pts0} project={project} dark />
                </g>
              );
            }

            // группа (splice / общий порт): ствол -> точка -> ветви
            const s = pts0[0];
            const dir = Math.sign(pts0[1].x - s.x) || 1;
            const J = { x: s.x + dir * 70, y: s.y };
            const splices = !!group[0].spliceId;
            // у ручной трассы (layout) развязка — середина первого сегмента провода
            const wireInfo = group.map((w) => {
              const pts = wirePoints(w, project);
              if (pts.length < 3) return null;
              const hasLayout = !!(w.layout && w.layout.length);
              const Jw = hasLayout
                ? { x: (pts[0].x + pts[1].x) / 2, y: (pts[0].y + pts[1].y) / 2 }
                : J;
              const branchPts = hasLayout ? [Jw, ...pts.slice(1)] : [J, ...pts.slice(2)];
              return { w, pts, Jw, branchPts, hasLayout };
            });
            return (
              <g key={key}>
                {wireInfo.map((inf) =>
                  inf ? (
                    <path
                      key={inf.w.id}
                      d={roundedPath([inf.pts[0], inf.Jw, ...inf.branchPts.slice(1)], 10)}
                      className="wire-hit"
                      onClick={(e) => clickWire(e, inf.w.id)}
                      onDoubleClick={(e) => {
                        e.stopPropagation();
                        if (inf.w.cableId) props.onOpenCable(inf.w.cableId);
                      }}
                      onContextMenu={(e) => {
                        e.preventDefault();
                        e.stopPropagation();
                        onSelect(selection.includes(inf.w.id) ? selection : [inf.w.id]);
                        setMenu({ kind: 'wire', x: e.clientX, y: e.clientY, wireId: inf.w.id });
                      }}
                    />
                  ) : null
                )}
                {wireInfo.map((inf) => {
                  if (!inf) return null;
                  const trunkD = roundedPath([inf.pts[0], inf.Jw], 10);
                  return (
                    <g key={`t-${inf.w.id}`}>
                      {inCable(inf.w) && <path d={trunkD} className="wire-jacket" />}
                      <path d={trunkD} className={'wire' + (inCable(inf.w) ? ' cable-member' : '') + (sel(inf.w) ? ' selected' : '')} stroke={wireColor(project, inf.w)} />
                      <circle cx={inf.Jw.x} cy={inf.Jw.y} r={5} fill={splices ? '#E91E63' : '#8a8a94'} stroke="#17171a" strokeWidth={1.5} />
                    </g>
                  );
                })}
                {wireInfo.map((inf) => {
                  if (!inf) return null;
                  const d = roundedPath(inf.branchPts, 10);
                  return (
                    <g key={`b-${inf.w.id}`}>
                      <path d={d} className={'wire' + (sel(inf.w) ? ' selected' : '')} stroke={wireColor(project, inf.w)} />
                      {inf.w.stripe && <path d={d} className="wire-stripe" stroke={inf.w.stripe} />}
                      <WireEnds w={inf.w} pts={inf.branchPts} project={project} dark />
                    </g>
                  );
                })}
              </g>
            );
          })}
          {temp && tempD && <path d={tempD} className="temp-wire" />}
        </g>

        {/* оборудование и источники */}
        {project.equipment.map((eq) => {
          const h = boxHeight(eq);
          return (
            <g key={eq.id} transform={`translate(${eq.x},${eq.y})`}>
              <rect className="eq-rect" width={BOX_W} height={h} rx={8} />
              <g
                className="eq-header"
                onPointerDown={(e) => startDragEq(e, eq.id)}
                onDoubleClick={(e) => {
                  e.stopPropagation();
                  const c = toClient(eq.x, eq.y + 2);
                  setRenaming({ mode: 'eq', eqId: eq.id, left: c.left, top: c.top, value: eq.name });
                }}
                onContextMenu={(e) => {
                  e.preventDefault();
                  e.stopPropagation();
                  setMenu({ kind: 'equip', x: e.clientX, y: e.clientY, eqId: eq.id });
                }}
              >
                <rect className="eq-head-rect" width={BOX_W} height={HEADER_H} rx={8} />
                <text className="eq-title" x={12} y={22}>{eq.name}</text>
                <text className="eq-grip" x={BOX_W - 26} y={22}>≫</text>
              </g>
              {eq.rows.map((row, i) => {
                const y = HEADER_H + i * ROW_H;
                const yc = y + ROW_H / 2;
                return (
                  <g
                    key={row.id}
                    onDoubleClick={(e) => {
                      e.stopPropagation();
                      openRowRename(eq.id, row.id, eq.x, eq.y, y, row.name);
                    }}
                    onContextMenu={(e) => {
                      e.preventDefault();
                      e.stopPropagation();
                      setMenu({ kind: 'row', x: e.clientX, y: e.clientY, eqId: eq.id, rowId: row.id });
                    }}
                  >
                    <line className="eq-row-line" x1={0} x2={BOX_W} y1={y} y2={y} />
                    <text className="eq-row-text" x={12} y={yc + 4}>{row.name}</text>
                    {/* ручка перетаскивания строки */}
                    <g
                      className="row-grip"
                      transform={`translate(${BOX_W - 20},${yc})`}
                      onPointerDown={(e) => startDragRow(e, eq.id, row.id)}
                      onDoubleClick={(e) => e.stopPropagation()}
                      onContextMenu={(e) => {
                        e.preventDefault();
                        e.stopPropagation();
                        setMenu({ kind: 'row', x: e.clientX, y: e.clientY, eqId: eq.id, rowId: row.id });
                      }}
                    >
                      <circle r={11} fill="transparent" />
                      <text x={0} y={3.5} fontSize={11} textAnchor="middle">≡</text>
                    </g>
                    {(['L', 'R'] as const).map((side) => {
                      const hot = !!dropTarget && dropTarget.eq === eq.id && dropTarget.row === row.id;
                      return (
                        <g
                          key={side}
                          className={'port' + (hot ? ' port-hot' : '')}
                          data-port="1"
                          data-eq={eq.id}
                          data-row={row.id}
                          data-dir={row.dir ?? ''}
                          transform={`translate(${side === 'L' ? 0 : BOX_W},${yc})`}
                          onPointerDown={(e) => startWire(e, eq.id, row.id, row.dir)}
                          onDoubleClick={(e) => e.stopPropagation()}
                          onContextMenu={(e) => {
                            e.preventDefault();
                            e.stopPropagation();
                            setMenu({ kind: 'port', x: e.clientX, y: e.clientY, eqId: eq.id, rowId: row.id });
                          }}
                        >
                          <circle r={15} fill="transparent" />
                          <g className={hot ? 'port-hot-glyph' : undefined}>
                            <PortSymbol
                              x={0}
                              y={0}
                              kind={row.kind}
                              side={(side === 'R' ? 1 : -1) as 1 | -1}
                              stroke={hot ? '#4a90e2' : '#8a8a94'}
                              holeFill="#1e1e23"
                              s={hot ? 0.85 : 0.62}
                            />
                          </g>
                        </g>
                      );
                    })}
                  </g>
                );
              })}
            </g>
          );
        })}

        {/* заметки */}
        {project.notes.map((n) => (
          <g
            key={n.id}
            transform={`translate(${n.x},${n.y})`}
            onPointerDown={(e) => startDragNote(e, n.id)}
            onDoubleClick={(e) => {
              e.stopPropagation();
              const c = toClient(n.x, n.y + 26);
              setRenaming({ mode: 'note', noteId: n.id, left: c.left, top: c.top, value: n.text });
            }}
            onContextMenu={(e) => {
              e.preventDefault();
              e.stopPropagation();
              setMenu({ kind: 'note', x: e.clientX, y: e.clientY, noteId: n.id });
            }}
            style={{ cursor: 'grab' }}
          >
            <rect
              x={-8}
              y={-16}
              width={Math.max(52, n.text.length * 7.2 + 16)}
              height={24}
              rx={4}
              fill="#22222a"
              stroke="#4a4a58"
              strokeDasharray="4 3"
            />
            <text x={0} y={1} fontSize={12} fill="#e2e2e6" style={{ userSelect: 'none' }}>{n.text || 'NOTE'}</text>
          </g>
        ))}
        </g>
      </svg>

      {menu && (
        <ContextMenu
          menu={menu}
          project={project}
          selection={selection}
          eq={menu.kind !== 'blank' && menu.kind !== 'wire' && menu.kind !== 'note' ? project.equipment.find((e) => e.id === menu.eqId) : undefined}
          row={menu.kind === 'row' || menu.kind === 'port' ? project.equipment.find((e) => e.id === menu.eqId)?.rows.find((r) => r.id === (menu as { rowId: string }).rowId) : undefined}
          wire={menu.kind === 'wire' ? project.wires.find((w) => w.id === menu.wireId) : undefined}
          note={menu.kind === 'note' ? project.notes.find((n) => n.id === menu.noteId) : undefined}
          wireCableCount={menu.kind === 'wire' ? project.wires.filter((w) => w.cableId && w.cableId === project.wires.find((x) => x.id === menu.wireId)?.cableId).length : 0}
          onAddEquipment={(cx, cy) => {
            const p = toSvg(cx, cy);
            props.onAddEquipment(Math.round(p.x - BOX_W / 2), Math.round(p.y - HEADER_H / 2));
          }}
          onAddSource={(cx, cy) => {
            const p = toSvg(cx, cy);
            props.onAddSource(Math.round(p.x - BOX_W / 2), Math.round(p.y - HEADER_H / 2));
          }}
          onAddNote={(cx, cy) => {
            const p = toSvg(cx, cy);
            props.onAddNote(Math.round(p.x), Math.round(p.y));
          }}
          onAddSignal={props.onAddSignal}
          onAddPoint={props.onAddPoint}
          onSetRowKind={props.onSetRowKind}
          onRenameRowRequest={(eqId, rowId) => {
            const eq = project.equipment.find((e) => e.id === eqId);
            const row = eq?.rows.find((r) => r.id === rowId);
            if (eq && row) {
              const y = HEADER_H + eq.rows.findIndex((r) => r.id === rowId) * ROW_H;
              openRowRename(eqId, rowId, eq.x, eq.y, y, row.name);
            }
          }}
          onDeleteEquipment={props.onDeleteEquipment}
          onDuplicateEquipment={props.onDuplicateEquipment}
          onDeleteRow={props.onDeleteRow}
          onDeleteWire={(id) => props.onDeleteWires([id])}
          onDetachWire={props.onDetachWire}
          onOpenCable={(id) => props.onOpenCable(id)}
          onSetCableColor={props.onSetCableColor}
          onSetStripe={props.onSetStripe}
          onSplice={(ids) => props.onSplice(ids)}
          onUnsplice={props.onUnsplice}
          onToggleFlip={props.onToggleFlip}
          onClearLayout={props.onSetLayout}
          onRenameNoteRequest={(noteId) => {
            const n = project.notes.find((x) => x.id === noteId);
            if (n) {
              const c = toClient(n.x, n.y + 26);
              setRenaming({ mode: 'note', noteId, left: c.left, top: c.top, value: n.text });
            }
          }}
          onDeleteNote={props.onDeleteNote}
          onAlignToGrid={props.onAlignToGrid}
          onSaveTemplateRequest={(eqId) => {
            // window.prompt в Electron не работает — ввод имени через попап переименования
            const eq = project.equipment.find((e) => e.id === eqId);
            if (!eq) return;
            const c = toClient(eq.x, eq.y + 36);
            setRenaming({ mode: 'template', eqId, left: c.left, top: c.top, value: eq.name });
          }}
          onInsertTemplate={(name, cx, cy) => {
            const p = toSvg(cx, cy);
            props.onInsertTemplate(name, p.x, p.y);
          }}
          templates={props.templates}
          onClose={() => setMenu(null)}
        />
      )}

      {renaming && (
        <div className="rename-pop" style={{ left: renaming.left, top: renaming.top }}>
          <input
            autoFocus
            value={renaming.value}
            placeholder={renaming.mode === 'note' ? 'Текст заметки' : renaming.mode === 'template' ? 'Имя шаблона' : ''}
            onChange={(e) => setRenaming({ ...renaming, value: e.target.value })}
            onBlur={() => {
              if (renaming.mode === 'eq') {
                props.onRenameEquipment(renaming.eqId!, renaming.value.trim() || 'Оборудование');
              } else if (renaming.mode === 'row') {
                props.onRenameRow(renaming.eqId!, renaming.rowId!, renaming.value.trim());
              } else if (renaming.mode === 'template') {
                if (renaming.value.trim()) props.onSaveTemplateRequest(renaming.eqId!, renaming.value);
              } else {
                props.onRenameNote(renaming.noteId!, renaming.value);
              }
              setRenaming(null);
            }}
            onKeyDown={(e) => {
              if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
              if (e.key === 'Escape') setRenaming(null);
            }}
          />
        </div>
      )}
    </div>
  );
}
