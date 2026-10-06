import { describe, expect, it } from 'vitest';
import { cableJournalCsv, exportBaseName, schemeDxf, schemeSvg } from '../exporters';
import type { Project, Wire } from '../../types';

function fixture(): Project {
  const a = {
    id: 'eq1', type: 'equip' as const, name: 'Шкаф & «Север»', x: 100, y: 100,
    rows: [{ id: 'r1', name: 'Работа OUT', signal: 'Работа' as const, dir: 'OUT' as const, kind: 'клемма' as const }],
  };
  const b = {
    id: 'eq2', type: 'equip' as const, name: 'Насос; №2', x: 600, y: 200,
    rows: [{ id: 'r2', name: 'Работа IN', signal: 'Работа' as const, dir: 'IN' as const, kind: 'клемма' as const }],
  };
  const w1: Wire = {
    id: 'w1', fromEq: 'eq1', fromRow: 'r1', toEq: 'eq2', toRow: 'r2',
    color: '#E57373', marking: '1', tipA: 'nshvi', tipB: 'ring4',
    aNum: '1', aName: 'X1', bNum: '2', bName: 'X2', cableId: 'c1',
  };
  const w2: Wire = {
    id: 'w2', fromEq: 'eq1', fromRow: 'r1', toEq: 'eq2', toRow: 'r2',
    color: '#64B5F6', marking: '2', tipA: 'nshvi', tipB: 'nshvi',
    aNum: '3', aName: 'X1', bNum: '4', bName: 'X2', cableId: 'c1',
  };
  return {
    docNumber: 'АНК 601Н', equipment: [a, b], wires: [w1, w2],
    cables: [{ id: 'c1', name: 'Кабель 1', type: 'КГВВнг', section: '0,75', lengthM: 12.5, color: '#E57373' }],
    notes: [{ id: 'n1', x: 300, y: 40, text: 'Трасса по <стене>' }],
  };
}

describe('cableJournalCsv', () => {
  it('заголовок и строка кабеля с разделителем «;»', () => {
    const csv = cableJournalCsv(fixture());
    const lines = csv.replace(/^﻿/, '').split('\r\n');
    expect(lines[0]).toBe('№;Кабель;Марка/тип;Сечение;Жил;Откуда;Подключение А;Подключение Б;Куда;Длина, м;Наконечники А;Наконечники Б');
    expect(lines[1]).toContain('Кабель 1;КГВВнг;0,75;2;');
    expect(lines[1]).toContain('X1:1');
    expect(lines[1]).toContain('X2:2');
    expect(lines[1]).toContain('12.5');
  });

  it('поля с «;» и кавычками экранируются по правилам CSV', () => {
    const csv = cableJournalCsv(fixture());
    // имя оборудования 'Насос; №2' должно быть в кавычках
    expect(csv).toContain('"Насос; №2"');
  });

  it('начинается с BOM (Excel открывает UTF-8 корректно)', () => {
    expect(cableJournalCsv(fixture()).charCodeAt(0)).toBe(0xfeff);
  });
});

describe('schemeSvg', () => {
  it('корректный XML с объявлением и корневым svg', () => {
    const svg = schemeSvg(fixture());
    expect(svg.startsWith('<?xml version="1.0" encoding="UTF-8"?>')).toBe(true);
    expect(svg).toContain('<svg xmlns="http://www.w3.org/2000/svg"');
    expect(svg.trim().endsWith('</svg>')).toBe(true);
  });

  it('экранирует спецсимволы в текстах', () => {
    const svg = schemeSvg(fixture());
    expect(svg).toContain('Шкаф &amp; «Север»');
    expect(svg).not.toContain('<стене>');
    expect(svg).toContain('&lt;стене&gt;');
  });

  it('содержит оборудование и обе жилы кабеля', () => {
    const svg = schemeSvg(fixture());
    expect(svg).toContain('Насос; №2');
    expect((svg.match(/stroke-width="2.4"/g) ?? []).length).toBeGreaterThanOrEqual(2);
  });

  it('пустой проект даёт валидный SVG', () => {
    const svg = schemeSvg({ docNumber: '', equipment: [], wires: [], cables: [], notes: [] });
    expect(svg).toContain('<svg');
  });
});

describe('schemeDxf', () => {
  it('структура DXF: секции, слои, завершение EOF', () => {
    const dxf = schemeDxf(fixture());
    expect(dxf).toContain('2\nENTITIES');
    expect(dxf).toContain('2\nLAYER');
    expect(dxf.trim().endsWith('0\nEOF')).toBe(true);
  });

  it('провода — полилинии на слое WIRES, оборудование — замкнутый контур', () => {
    const dxf = schemeDxf(fixture());
    // ствол + 2 ветви (группа одного порта)
    expect((dxf.match(/LWPOLYLINE/g) ?? []).length).toBeGreaterThanOrEqual(3);
    expect(dxf).toContain('8\nWIRES');
    // замкнутый контур оборудования: 70\n1
    expect(dxf).toContain('70\n1');
    // имя оборудования — текстовая сущность
    expect(dxf).toContain('Шкаф & «Север»');
  });

  it('инвертирует ось Y (чертёжная система координат)', () => {
    const dxf = schemeDxf(fixture());
    // оборудование eq1 в y=100 → 20-координата −100
    expect(dxf).toContain('20\n-100.00');
  });
});

describe('exportBaseName', () => {
  it('обозначение документа + расширение, недопустимые символы заменяются', () => {
    expect(exportBaseName({ docNumber: 'АНК 601Н-45 00 00 МЭ' } as Project, 'csv')).toBe('АНК 601Н-45 00 00 МЭ.csv');
    expect(exportBaseName({ docNumber: 'a/b:c' } as Project, 'svg')).toBe('a_b_c.svg');
  });
});
