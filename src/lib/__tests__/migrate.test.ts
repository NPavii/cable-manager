import { describe, expect, it } from 'vitest';
import { FORMAT_VERSION, looksLikeProject, migrate, serializeProject } from '../migrate';

describe('looksLikeProject', () => {
  it('принимает объект с equipment и wires', () => {
    expect(looksLikeProject({ equipment: [], wires: [] })).toBe(true);
  });

  it('отклоняет мусор', () => {
    expect(looksLikeProject(null)).toBe(false);
    expect(looksLikeProject({})).toBe(false);
    expect(looksLikeProject('строка')).toBe(false);
    expect(looksLikeProject({ equipment: [] })).toBe(false);
  });
});

describe('migrate', () => {
  it('мусор на входе — пустой, но валидный проект', () => {
    const p = migrate(undefined);
    expect(p.equipment).toEqual([]);
    expect(p.wires).toEqual([]);
    expect(p.cables).toEqual([]);
    expect(p.notes).toEqual([]);
    expect(p.docNumber).toBeTruthy();
  });

  it('старый формат без кабелей: каждой жиле создаётся кабель, имена назначаются', () => {
    const p = migrate({
      equipment: [{ id: 'e1', name: 'Шкаф', x: 10, y: 20, rows: [{ id: 'r1', name: 'A' }] }],
      wires: [
        { id: 'w1', fromEq: 'e1', fromRow: 'r1', toEq: 'e1', toRow: 'r1', color: '#E57373' },
        { id: 'w2', fromEq: 'e1', fromRow: 'r1', toEq: 'e1', toRow: 'r1', color: '#64B5F6', cableId: 'несуществующий' },
      ],
    });
    expect(p.wires).toHaveLength(2);
    expect(p.cables).toHaveLength(2);
    expect(p.wires.every((w) => p.cables.some((c) => c.id === w.cableId))).toBe(true);
    expect(p.cables[0].name).toBe('Кабель 1');
    expect(p.cables[0].color).toBe('#E57373'); // цвет кабеля — от первой жилы
  });

  it('сохраняет stripe / spliceId / layout / flip (регресс: раньше терялись при загрузке)', () => {
    const p = migrate({
      equipment: [{ id: 'e1', x: 0, y: 0, rows: [{ id: 'r1' }] }],
      wires: [{
        id: 'w1', fromEq: 'e1', fromRow: 'r1', toEq: 'e1', toRow: 'r1', cableId: 'c1',
        stripe: '#FFD54F', spliceId: 's9', flip: true, layout: [{ x: 5, y: 6 }],
      }],
      cables: [{ id: 'c1', name: 'Кабель 9' }],
    });
    const w = p.wires[0];
    expect(w.stripe).toBe('#FFD54F');
    expect(w.spliceId).toBe('s9');
    expect(w.flip).toBe(true);
    expect(w.layout).toEqual([{ x: 5, y: 6 }]);
  });

  it('пустые кабели (без жил) выбрасываются', () => {
    const p = migrate({
      equipment: [],
      wires: [],
      cables: [{ id: 'c1', name: 'Пустой' }],
    });
    expect(p.cables).toEqual([]);
  });

  it('типы точек и направления невалидные значения не проходят', () => {
    const p = migrate({
      equipment: [{
        id: 'e1', x: 0, y: 0,
        rows: [
          { id: 'r1', kind: 'разъем', dir: 'БАБАХ', signal: 'Что-то' },
          { id: 'r2', kind: 'неизвестно' },
        ],
      }],
      wires: [],
    });
    expect(p.equipment[0].rows[0].kind).toBe('разъем');
    expect(p.equipment[0].rows[0].dir).toBeUndefined();
    expect(p.equipment[0].rows[0].signal).toBeUndefined();
    expect(p.equipment[0].rows[1].kind).toBe('клемма');
  });
});

describe('serializeProject', () => {
  it('добавляет версию формата, проект парсится обратно', () => {
    const p = migrate({ equipment: [], wires: [] });
    const json = serializeProject(p);
    const parsed = JSON.parse(json);
    expect(parsed.formatVersion).toBe(FORMAT_VERSION);
    expect(looksLikeProject(parsed)).toBe(true);
    expect(migrate(parsed)).toEqual(p);
  });
});
