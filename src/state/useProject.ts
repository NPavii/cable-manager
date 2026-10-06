import { useCallback, useMemo, useRef, useState } from 'react';
import type { Cable, Equipment, PortKind, Project, SignalType, Wire } from '../types';
import { makeEquipment, makeSource, makeVirtualWire, nextCableName, uid } from '../types';
import { GRID } from '../lib/layout';

/**
 * Операции над проектом + история отмены/повтора.
 *
 * История — снимки состояния (Project — плоский JSON, снимок дёшев).
 * Чтобы перетаскивания не плодили записи, update() принимает coalesceKey:
 * изменения с тем же ключом в пределах окна COALESCE_MS схлопываются в одну запись.
 * Для драга ключ стабилен («move-eq:<id>»), поэтому отмена возвращает состояние
 * до начала перетаскивания целиком.
 */

const HISTORY_LIMIT = 100;
/** окно слияния последовательных изменений с одним ключом, мс */
const COALESCE_MS = 1500;

/** Мутация проекта: (текущий) => следующий; вернуть тот же объект — «нет изменений» */
export type Mutator = (pr: Project) => Project;

export interface UseProject {
  project: Project;
  /** применить мутацию; coalesceKey — слияние серий изменений в одну запись истории */
  update: (fn: Mutator, coalesceKey?: string) => void;
  /** полная замена состояния (открытие/новый проект/undo/redo) — история не трогается, кроме resetHistory */
  setProjectState: (p: Project) => void;
  resetHistory: () => void;
  undo: () => void;
  redo: () => void;
  canUndo: boolean;
  canRedo: boolean;
}

export function useProject(initial: Project): UseProject {
  const [project, setProject] = useState<Project>(initial);
  const [past, setPast] = useState<{ json: string; key: string; time: number }[]>([]);
  const [future, setFuture] = useState<string[]>([]);
  const projectRef = useRef(project);
  projectRef.current = project;

  const update = useCallback((fn: Mutator, coalesceKey?: string) => {
    const cur = projectRef.current;
    const next = fn(cur);
    if (next === cur) return;
    projectRef.current = next; // синхронно: следующий update в том же тике увидит результат
    const now = Date.now();
    const json = JSON.stringify(cur);
    setPast((p) => {
      const last = p[p.length - 1];
      if (coalesceKey && last && last.key === coalesceKey && now - last.time < COALESCE_MS) {
        // то же действие продолжается — не плодим записи, но обновляем время окна
        return [...p.slice(0, -1), { json: last.json, key: last.key, time: now }];
      }
      return [...p.slice(-(HISTORY_LIMIT - 1)), { json, key: coalesceKey ?? `step:${now}:${Math.random()}`, time: now }];
    });
    setFuture([]);
    setProject(next);
  }, []);

  const undo = useCallback(() => {
    setPast((p) => {
      if (!p.length) return p;
      const entry = p[p.length - 1];
      const cur = projectRef.current;
      setFuture((f) => [...f, JSON.stringify(cur)]);
      const prev = JSON.parse(entry.json) as Project;
      projectRef.current = prev;
      setProject(prev);
      return p.slice(0, -1);
    });
  }, []);

  const redo = useCallback(() => {
    setFuture((f) => {
      if (!f.length) return f;
      const json = f[f.length - 1];
      const cur = projectRef.current;
      setPast((p) => [...p.slice(-(HISTORY_LIMIT - 1)), { json: JSON.stringify(cur), key: `redo:${Date.now()}`, time: Date.now() }]);
      const next = JSON.parse(json) as Project;
      projectRef.current = next;
      setProject(next);
      return f.slice(0, -1);
    });
  }, []);

  const setProjectState = useCallback((p: Project) => {
    projectRef.current = p;
    setProject(p);
  }, []);
  const resetHistory = useCallback(() => {
    setPast([]);
    setFuture([]);
  }, []);

  return useMemo(
    () => ({
      project,
      update,
      setProjectState,
      resetHistory,
      undo,
      redo,
      canUndo: past.length > 0,
      canRedo: future.length > 0,
    }),
    [project, update, setProjectState, resetHistory, undo, redo, past.length, future.length]
  );
}

/** Округление к шагу сетки */
export const snapToGrid = (v: number) => Math.round(v / GRID) * GRID;

/* === Операции над проектом (чистые функции поверх update) === */

/** Удаляет провода и подчищает опустевшие кабели */
const withoutWires = (pr: Project, ids: string[]): Project => {
  const wires = pr.wires.filter((w) => !ids.includes(w.id));
  const alive = new Set(wires.map((w) => w.cableId).filter(Boolean));
  return { ...pr, wires, cables: pr.cables.filter((c) => alive.has(c.id)) };
};

export const addEquipmentAt = (api: UseProject, x: number, y: number) =>
  api.update((pr) => {
    const count = pr.equipment.filter((e) => e.type === 'equip').length;
    return { ...pr, equipment: [...pr.equipment, makeEquipment(count + 1, Math.max(0, x), Math.max(0, y))] };
  });

export const addSourceAt = (api: UseProject, x: number, y: number) =>
  api.update((pr) => {
    const count = pr.equipment.filter((e) => e.type === 'source').length;
    return { ...pr, equipment: [...pr.equipment, makeSource(count + 1, Math.max(0, x), Math.max(0, y))] };
  });

export const addNoteAt = (api: UseProject, x: number, y: number) =>
  api.update((pr) => ({ ...pr, notes: [...pr.notes, { id: uid(), x, y, text: 'NOTE' }] }));

export const moveEquipmentTo = (api: UseProject, id: string, x: number, y: number) =>
  api.update(
    (pr) => ({ ...pr, equipment: pr.equipment.map((e) => (e.id === id ? { ...e, x, y } : e)) }),
    `move-eq:${id}`
  );

/** Выровнять оборудование по узлам сетки (id не задан — все) */
export const alignEquipmentToGrid = (api: UseProject, id?: string) =>
  api.update((pr) => ({
    ...pr,
    equipment: pr.equipment.map((e) =>
      id && e.id !== id ? e : { ...e, x: snapToGrid(e.x), y: snapToGrid(e.y) }
    ),
  }));

export const moveNoteTo = (api: UseProject, id: string, x: number, y: number) =>
  api.update(
    (pr) => ({ ...pr, notes: pr.notes.map((n) => (n.id === id ? { ...n, x, y } : n)) }),
    `move-note:${id}`
  );

export const renameEquipment = (api: UseProject, id: string, name: string) =>
  api.update((pr) => ({ ...pr, equipment: pr.equipment.map((e) => (e.id === id ? { ...e, name } : e)) }));

export const renameNote = (api: UseProject, id: string, text: string) =>
  api.update((pr) => ({ ...pr, notes: pr.notes.map((n) => (n.id === id ? { ...n, text } : n)) }));

export const deleteNote = (api: UseProject, id: string) =>
  api.update((pr) => ({ ...pr, notes: pr.notes.filter((n) => n.id !== id) }));

export const addSignal = (api: UseProject, eqId: string, signal: SignalType) =>
  api.update((pr) => ({
    ...pr,
    equipment: pr.equipment.map((e) =>
      e.id === eqId
        ? {
            ...e,
            rows: [
              ...e.rows,
              { id: uid(), name: `${signal} IN`, signal, dir: 'IN' as const, kind: 'клемма' as PortKind },
              { id: uid(), name: `${signal} OUT`, signal, dir: 'OUT' as const, kind: 'клемма' as PortKind },
            ],
          }
        : e
    ),
  }));

export const addPoint = (api: UseProject, eqId: string) =>
  api.update((pr) => ({
    ...pr,
    equipment: pr.equipment.map((e) =>
      e.id === eqId
        ? { ...e, rows: [...e.rows, { id: uid(), name: `Точка ${e.rows.length + 1}`, kind: 'клемма' as PortKind }] }
        : e
    ),
  }));

export const setRowKind = (api: UseProject, eqId: string, rowId: string, kind: PortKind) =>
  api.update(
    (pr) => ({
      ...pr,
      equipment: pr.equipment.map((e) =>
        e.id === eqId ? { ...e, rows: e.rows.map((r) => (r.id === rowId ? { ...r, kind } : r)) } : e
      ),
    }),
    `rowkind:${rowId}`
  );

/** Перенос строки на новую позицию (drag & drop внутри оборудования) */
export const moveRow = (api: UseProject, eqId: string, rowId: string, index: number) =>
  api.update(
    (pr) => ({
      ...pr,
      equipment: pr.equipment.map((e) => {
        if (e.id !== eqId) return e;
        const rows = [...e.rows];
        const from = rows.findIndex((r) => r.id === rowId);
        if (from < 0) return e;
        const to = Math.max(0, Math.min(rows.length - 1, index));
        if (from === to) return e;
        const [row] = rows.splice(from, 1);
        rows.splice(to, 0, row);
        return { ...e, rows };
      }),
    }),
    `moverow:${rowId}`
  );

export const renameRow = (api: UseProject, eqId: string, rowId: string, name: string) =>
  api.update((pr) => ({
    ...pr,
    equipment: pr.equipment.map((e) =>
      e.id === eqId
        ? {
            ...e,
            rows: e.rows.map((r) => {
              if (r.id !== rowId) return r;
              const fallback = r.signal && r.dir ? `${r.signal} ${r.dir}` : 'Точка';
              return { ...r, name: name.trim() || fallback };
            }),
          }
        : e
    ),
  }));

/** Дублирование оборудования/источника со всеми строками (новые id, связи не копируются) */
export const duplicateEquipment = (api: UseProject, eqId: string) =>
  api.update((pr) => {
    const src = pr.equipment.find((e) => e.id === eqId);
    if (!src) return pr;
    const copy: Equipment = {
      ...src,
      id: uid(),
      name: `${src.name} (копия)`,
      x: src.x + 32,
      y: src.y + 32,
      rows: src.rows.map((r) => ({ ...r, id: uid() })),
    };
    return { ...pr, equipment: [...pr.equipment, copy] };
  });

/** Вставка готового блока (например, из шаблона) */
export const insertEquipment = (api: UseProject, eq: Equipment) =>
  api.update((pr) => ({ ...pr, equipment: [...pr.equipment, eq] }));

/** Удаляет оборудование вместе с проводами; возвращает id удалённых проводов */
export const deleteEquipment = (api: UseProject, eqId: string): string[] => {
  const ids = api.project.wires.filter((w) => w.fromEq === eqId || w.toEq === eqId).map((w) => w.id);
  api.update((pr) => withoutWires({ ...pr, equipment: pr.equipment.filter((e) => e.id !== eqId) }, ids));
  return ids;
};

/** Удаляет строку вместе с проводами; возвращает id удалённых проводов */
export const deleteRow = (api: UseProject, eqId: string, rowId: string): string[] => {
  const ids = api.project.wires
    .filter((w) => (w.fromEq === eqId && w.fromRow === rowId) || (w.toEq === eqId && w.toRow === rowId))
    .map((w) => w.id);
  api.update((pr) =>
    withoutWires(
      {
        ...pr,
        equipment: pr.equipment.map((e) =>
          e.id === eqId ? { ...e, rows: e.rows.filter((r) => r.id !== rowId) } : e
        ),
      },
      ids
    )
  );
  return ids;
};

export const addWire = (
  api: UseProject,
  fromEq: string,
  fromRow: string,
  toEq: string,
  toRow: string,
  color: string
) =>
  api.update((pr) => {
    // к одной точке можно подключать несколько проводов
    // каждый провод — самостоятельный кабель (цвет кабеля изначально = цвету жилы)
    const cable: Cable = { id: uid(), name: nextCableName(pr.cables), type: '', section: '0,75', lengthM: 0, color };
    const marking = pr.equipment.find((e) => e.id === fromEq)?.rows.find((r) => r.id === fromRow)?.name ?? '';
    const wire: Wire = {
      id: uid(), fromEq, fromRow, toEq, toRow, color, marking,
      tipA: 'nshvi', tipB: 'nshvi',
      aNum: '1', aName: '', bNum: '1', bName: '',
      cableId: cable.id,
    };
    return { ...pr, cables: [...pr.cables, cable], wires: [...pr.wires, wire] };
  });

export const deleteWires = (api: UseProject, ids: string[]) =>
  api.update((pr) => withoutWires(pr, ids));

export const patchWire = (api: UseProject, id: string, patch: Partial<Wire>, coalesceKey?: string) =>
  api.update(
    (pr) => ({ ...pr, wires: pr.wires.map((w) => (w.id === id ? { ...w, ...patch } : w)) }),
    coalesceKey ?? `wire:${id}`
  );

/** Цвет кабеля (визуальный) через ПКМ по проводу */
export const setCableColor = (api: UseProject, cableId: string, color: string) =>
  api.update((pr) => ({ ...pr, cables: pr.cables.map((c) => (c.id === cableId ? { ...c, color } : c)) }));

/** Штриховка (Stripe) поверх провода */
export const setStripe = (api: UseProject, wireId: string, stripe?: string) =>
  patchWire(api, wireId, { stripe });

/** Splice: помечаем выбранные провода как соединённые в одной точке */
export const spliceWires = (api: UseProject, ids: string[]) => {
  if (ids.length < 2) return;
  const sid = uid();
  const set = new Set(ids);
  api.update((pr) => ({ ...pr, wires: pr.wires.map((w) => (set.has(w.id) ? { ...w, spliceId: sid } : w)) }));
};

export const unspliceWire = (api: UseProject, wireId: string) =>
  patchWire(api, wireId, { spliceId: undefined });

/** Пользовательские точки трассы (undefined — вернуть автотрассу) */
export const setWireLayout = (api: UseProject, wireId: string, layout?: { x: number; y: number }[]) =>
  api.update(
    (pr) => ({ ...pr, wires: pr.wires.map((w) => (w.id === wireId ? { ...w, layout } : w)) }),
    `layout:${wireId}`
  );

/** Переброс провода на противоположную сторону блоков */
export const toggleFlip = (api: UseProject, wireId: string) =>
  api.update((pr) => ({ ...pr, wires: pr.wires.map((w) => (w.id === wireId ? { ...w, flip: !w.flip } : w)) }));

/** Жила выделяется в собственный кабель */
export const detachWire = (api: UseProject, id: string) =>
  api.update((pr) => {
    const w = pr.wires.find((x) => x.id === id);
    if (!w) return pr;
    const old = pr.cables.find((c) => c.id === w.cableId);
    const nc: Cable = {
      id: uid(),
      name: nextCableName(pr.cables),
      type: old?.type ?? '',
      section: old?.section ?? '0,75',
      lengthM: old?.lengthM ?? 0,
      color: old?.color ?? '#90A4AE',
    };
    const othersStay = pr.wires.some((x) => x.cableId === w.cableId && x.id !== id);
    return {
      ...pr,
      cables: [...(othersStay ? pr.cables : pr.cables.filter((c) => c.id !== w.cableId)), nc],
      wires: pr.wires.map((x) => (x.id === id ? { ...x, cableId: nc.id } : x)),
    };
  });

/** Выбранные жилы объединяются в один кабель (сквозная нумерация) */
export const mergeCables = (api: UseProject, cableIds: string[]) => {
  if (cableIds.length < 2) return;
  const keep = cableIds[0];
  const ids = new Set(cableIds);
  api.update((pr) => ({
    ...pr,
    wires: pr.wires.map((w) => (w.cableId && ids.has(w.cableId) ? { ...w, cableId: keep } : w)),
    cables: pr.cables.filter((c) => c.id === keep || !ids.has(c.id)),
  }));
};

export const patchCable = (api: UseProject, cableId: string, patch: Partial<Cable>) =>
  api.update(
    (pr) => ({ ...pr, cables: pr.cables.map((c) => (c.id === cableId ? { ...c, ...patch } : c)) }),
    `cable:${cableId}:${Object.keys(patch).join(',')}`
  );

/** Задать количество жил кабеля: лишние доп. жилы убираются, нехватка добирается */
export const setCoreCount = (api: UseProject, cableId: string, n: number) =>
  api.update((pr) => {
    const mine = pr.wires.filter((w) => w.cableId === cableId);
    const physical = mine.filter((w) => !w.virtual);
    const target = Math.max(physical.length, Math.min(64, Math.round(n)));
    const virtuals = mine.filter((w) => w.virtual);
    const needVirtual = target - physical.length;
    const keepV = virtuals.slice(0, Math.max(0, needVirtual));
    const added = Array.from(
      { length: Math.max(0, needVirtual - keepV.length) },
      (_, i) => makeVirtualWire(cableId, physical.length + keepV.length + i)
    );
    return {
      ...pr,
      wires: [...pr.wires.filter((w) => w.cableId !== cableId), ...physical, ...keepV, ...added],
    };
  });

/** Кабель разъединяется на самостоятельные кабели по жилам */
export const splitCable = (api: UseProject, cableId: string) =>
  api.update((pr) => {
    const old = pr.cables.find((c) => c.id === cableId);
    if (!old) return pr;
    const rest = pr.cables.filter((c) => c.id !== cableId);
    const mine = pr.wires.filter((w) => w.cableId === cableId);
    const named: Cable[] = [];
    for (let i = 0; i < mine.length; i++) {
      named.push({
        id: uid(),
        name: nextCableName([...rest, ...named]),
        type: old.type,
        section: old.section,
        lengthM: old.lengthM,
        color: old.color,
      });
    }
    const map = new Map(mine.map((w, i) => [w.id, named[i].id]));
    return {
      ...pr,
      cables: [...rest, ...named],
      wires: pr.wires.map((w) => (map.has(w.id) ? { ...w, cableId: map.get(w.id)! } : w)),
    };
  });
