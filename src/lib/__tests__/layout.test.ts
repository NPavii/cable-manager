import { describe, expect, it } from 'vitest';
import { BOX_W, HEADER_H, ROW_H, groupedWires, roundedPath, usedSheets, wirePoints } from '../layout';
import { makeEquipment, makeVirtualWire, nextCableName, wireEndKind } from '../../types';
import type { Project, Wire } from '../../types';

/** Минимальный проект: два блока, одна жила */
function fixture(): Project {
  const a = makeEquipment(1, 100, 100);
  a.rows = [
    { id: 'row-a1', name: 'Работа OUT', signal: 'Работа', dir: 'OUT', kind: 'клемма' },
    { id: 'row-a2', name: 'X1', signal: undefined, dir: undefined, kind: 'разъем' },
  ];
  const b = makeEquipment(2, 600, 200);
  b.rows = [{ id: 'row-b1', name: 'Работа IN', signal: 'Работа', dir: 'IN', kind: 'клемма' }];
  const wire: Wire = {
    id: 'w1', fromEq: a.id, fromRow: 'row-a1', toEq: b.id, toRow: 'row-b1',
    color: '#E57373', marking: 'Работа OUT', tipA: 'nshvi', tipB: 'nshvi',
    aNum: '1', aName: '', bNum: '2', bName: '', cableId: 'c1',
  };
  return {
    docNumber: 'Тест', equipment: [a, b], wires: [wire],
    cables: [{ id: 'c1', name: 'Кабель 1', type: '', section: '0,75', lengthM: 0, color: '#E57373' }],
    notes: [],
  };
}

describe('roundedPath', () => {
  it('прямая линия без скруглений', () => {
    expect(roundedPath([{ x: 0, y: 0 }, { x: 100, y: 0 }], 10)).toBe('M 0 0 L 100 0');
  });

  it('удаляет коллинеарные промежуточные точки', () => {
    const d = roundedPath([{ x: 0, y: 0 }, { x: 50, y: 0 }, { x: 100, y: 0 }], 10);
    expect(d).toBe('M 0 0 L 100 0');
  });

  it('один поворот — одна квадратичная кривая', () => {
    const d = roundedPath([{ x: 0, y: 0 }, { x: 100, y: 0 }, { x: 100, y: 100 }], 10);
    expect(d.startsWith('M 0 0')).toBe(true);
    expect(d.match(/Q/g) ?? []).toHaveLength(1);
    expect(d.endsWith('L 100 100')).toBe(true);
  });

  it('дубликаты подряд идущих точек не ломают путь', () => {
    const d = roundedPath([{ x: 0, y: 0 }, { x: 0, y: 0 }, { x: 100, y: 0 }], 10);
    expect(d).toBe('M 0 0 L 100 0');
  });
});

describe('usedSheets', () => {
  it('пустой проект — ни одного листа', () => {
    expect(usedSheets({ docNumber: '', equipment: [], wires: [], cables: [], notes: [] })).toEqual([]);
  });

  it('блок в начале координат — один лист с номером 1', () => {
    const sheets = usedSheets(fixture());
    expect(sheets).toEqual([{ ix: 0, iy: 0, num: 1 }]);
  });
});

describe('groupedWires', () => {
  it('жилы одного порта и splice-группы объединяются', () => {
    const p = fixture();
    const w2: Wire = { ...p.wires[0], id: 'w2', cableId: 'c2' };
    p.wires.push(w2);
    const groups = [...groupedWires(p).values()];
    expect(groups).toHaveLength(1);
    expect(groups[0].map((w) => w.id)).toEqual(['w1', 'w2']);
  });

  it('virtual-жилы в группировку не попадают', () => {
    const p = fixture();
    p.wires.push(makeVirtualWire('c1', 1));
    const groups = [...groupedWires(p).values()];
    expect(groups.flat()).toHaveLength(1);
  });
});

describe('wirePoints', () => {
  it('ручная трасса (layout) проходит как есть, между портами', () => {
    const p = fixture();
    p.wires[0].layout = [{ x: 300, y: 50 }, { x: 300, y: 400 }];
    const [a, b] = p.equipment;
    const pts = wirePoints(p.wires[0], p);
    expect(pts[0]).toEqual({ x: a.x + BOX_W, y: a.y + HEADER_H + ROW_H / 2 });
    expect(pts[pts.length - 1]).toEqual({ x: b.x, y: b.y + HEADER_H + ROW_H / 2 });
    expect(pts.slice(1, -1)).toEqual([{ x: 300, y: 50 }, { x: 300, y: 400 }]);
  });
});

describe('wireEndKind', () => {
  it('дополнительная жила наследует тип точки первой жилы кабеля', () => {
    const p = fixture();
    const v = makeVirtualWire('c1', 1);
    p.wires.push(v);
    expect(wireEndKind(p, v, 'A')).toBe('клемма');
    // у первой жилы сторона А — клемма, сторона Б у строки row-b1 тоже клемма
    expect(wireEndKind(p, p.wires[0], 'B')).toBe('клемма');
  });
});

describe('nextCableName', () => {
  it('продолжает нумерацию после максимального номера', () => {
    expect(nextCableName([
      { id: '1', name: 'Кабель 3', type: '', section: '', lengthM: 0, color: '' },
      { id: '2', name: 'Кабель 7', type: '', section: '', lengthM: 0, color: '' },
    ])).toBe('Кабель 8');
  });

  it('пустой список — «Кабель 1»', () => {
    expect(nextCableName([])).toBe('Кабель 1');
  });
});
