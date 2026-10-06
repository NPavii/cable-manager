import type { Cable, Project, Wire } from '../types';
import { TIPS, wireEndKind } from '../types';
import {
  BOX_W, HEADER_H, ROW_H, boxHeight, groupedWires, roundedPath, wireColor, wirePoints,
} from './layout';
import type { Pt } from './layout';
import { connText } from '../components/symbols';

/**
 * Экспорт проекта: кабельный журнал (CSV), схема (SVG), схема (DXF).
 * Всё — чистые функции от Project, покрыты тестами.
 */

const esc = (s: string) =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

const csvCell = (s: string) => (/[;"\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s);

const tipName = (id: string) => TIPS.find((t) => t.id === id)?.name ?? id;

const eqName = (project: Project, id: string) =>
  project.equipment.find((e) => e.id === id)?.name ?? '—';

/* === Кабельный журнал (CSV с BOM, разделитель «;» — открывается в Excel RU) === */

export function cableJournalCsv(project: Project): string {
  const head = [
    '№', 'Кабель', 'Марка/тип', 'Сечение', 'Жил', 'Откуда', 'Подключение А',
    'Подключение Б', 'Куда', 'Длина, м', 'Наконечники А', 'Наконечники Б',
  ];
  const lines = [head.join(';')];
  project.cables.forEach((c, i) => {
    const wires = project.wires.filter((w) => w.cableId === c.id);
    const phys = wires.filter((w) => !w.virtual);
    const froms = [...new Set(phys.map((w) => eqName(project, w.fromEq)))].join(', ') || '—';
    const tos = [...new Set(phys.map((w) => eqName(project, w.toEq)))].join(', ') || '—';
    const fw = phys[0];
    const tipsA = [...new Set(wires.map((w) => tipName(w.tipA)))].join(', ');
    const tipsB = [...new Set(wires.map((w) => tipName(w.tipB)))].join(', ');
    lines.push(
      [
        String(i + 1), c.name, c.type || `${wires.length}х${c.section}`, c.section,
        String(wires.length), froms,
        fw ? connText(fw.aName, fw.aNum) || '—' : '—',
        fw ? connText(fw.bName, fw.bNum) || '—' : '—',
        tos, String(c.lengthM || ''), tipsA, tipsB,
      ].map(csvCell).join(';')
    );
  });
  return '﻿' + lines.join('\r\n');
}

/* === SVG: вся схема одним файлом (белый фон, как в печати) === */

interface Extents {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}

function projectExtents(project: Project): Extents {
  const e: Extents = { x0: Infinity, y0: Infinity, x1: -Infinity, y1: -Infinity };
  const grow = (x: number, y: number) => {
    e.x0 = Math.min(e.x0, x);
    e.y0 = Math.min(e.y0, y);
    e.x1 = Math.max(e.x1, x);
    e.y1 = Math.max(e.y1, y);
  };
  for (const eq of project.equipment) {
    grow(eq.x - 90, eq.y - 40);
    grow(eq.x + BOX_W + 90, eq.y + boxHeight(eq) + 40);
  }
  for (const w of project.wires) {
    if (w.virtual) continue;
    for (const p of wirePoints(w, project)) grow(p.x, p.y);
  }
  for (const n of project.notes) {
    grow(n.x - 8, n.y - 16);
    grow(n.x + Math.max(52, n.text.length * 7.2 + 16), n.y + 8);
  }
  if (!Number.isFinite(e.x0)) return { x0: 0, y0: 0, x1: SHEET_W_SAFE, y1: SHEET_H_SAFE };
  return e;
}
// запасной размер холста для пустого проекта (А4)
const SHEET_W_SAFE = 1123;
const SHEET_H_SAFE = 794;

/** УГО разъёма как path-строка */
const ugoPath = (x: number, y: number, side: 1 | -1, s = 1) =>
  `M ${x - 4 * side * s} ${y - 5.5 * s} L ${x + 8 * side * s} ${y} L ${x - 4 * side * s} ${y + 5.5 * s}`;

/** концы провода: символ + подпись «Имя:№» + маркировка (как на печати) */
function wireEndsSvg(parts: string[], w: Wire, pts: Pt[], project: Project) {
  const s = pts[0];
  const t = pts[pts.length - 1];
  const dirA = Math.sign(pts[1].x - s.x) || 1;
  const dirT = Math.sign(t.x - pts[pts.length - 2].x) || 1;
  const kindA = wireEndKind(project, w, 'A');
  const kindB = wireEndKind(project, w, 'B');
  const ax = s.x + dirA * 22;
  const bx = t.x - dirT * 22;
  const sym = (x: number, y: number, kind: 'клемма' | 'разъем', side: 1 | -1) =>
    kind === 'разъем'
      ? `<path d="${ugoPath(x, y, side)}" fill="none" stroke="#000" stroke-width="1.7" stroke-linejoin="round" stroke-linecap="round"/>`
      : `<circle cx="${x}" cy="${y}" r="4.6" fill="none" stroke="#000" stroke-width="1.7"/><circle cx="${x}" cy="${y}" r="1.65" fill="#fff" stroke="#000" stroke-width="0.9"/>`;
  parts.push(`<g>${sym(ax, s.y, kindA, (dirA * -1) as 1 | -1)}${sym(bx, t.y, kindB, dirT as 1 | -1)}`);
  const txtA = connText(w.aName, w.aNum);
  const txtB = connText(w.bName, w.bNum);
  if (txtA) parts.push(`<text x="${ax}" y="${s.y - 11}" font-size="10" text-anchor="middle" fill="#000" font-family="Segoe UI, sans-serif">${esc(txtA)}</text>`);
  if (txtB) parts.push(`<text x="${bx}" y="${t.y - 11}" font-size="10" text-anchor="middle" fill="#000" font-family="Segoe UI, sans-serif">${esc(txtB)}</text>`);
  parts.push(
    `<text x="${s.x + dirA * 40}" y="${s.y + 14}" font-size="9" text-anchor="middle" fill="#333" font-family="Segoe UI, sans-serif">${esc(w.marking)}</text>`,
    `<text x="${t.x + dirT * 40}" y="${t.y + 14}" font-size="9" text-anchor="middle" fill="#333" font-family="Segoe UI, sans-serif">${esc(w.marking)}</text></g>`
  );
}

/** Вся схема одним SVG (белый фон, геометрия как в печати) */
export function schemeSvg(project: Project): string {
  const ext = projectExtents(project);
  const M = 30; // поля
  const W = Math.ceil(ext.x1 - ext.x0 + M * 2);
  const H = Math.ceil(ext.y1 - ext.y0 + M * 2);
  const parts: string[] = [];
  parts.push(
    `<?xml version="1.0" encoding="UTF-8"?>`,
    `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="${ext.x0 - M} ${ext.y0 - M} ${W} ${H}">`,
    `<rect x="${ext.x0 - M}" y="${ext.y0 - M}" width="${W}" height="${H}" fill="#fff"/>`
  );

  // провода (группы splice / общий порт — как в печати)
  for (const [, group] of groupedWires(project)) {
    const pts0 = wirePoints(group[0], project);
    if (!pts0.length) continue;
    const strokeFor = (w: Wire) => wireColor(project, w);
    const dash = (d: string, color: string) =>
      `<path d="${d}" fill="none" stroke="${color}" stroke-width="2.4"/>`;
    if (group.length === 1) {
      const w = group[0];
      const d = roundedPath(pts0, 10);
      parts.push(`<g>${dash(d, strokeFor(w))}`);
      if (w.stripe) parts.push(`<path d="${d}" fill="none" stroke="${w.stripe}" stroke-width="1.6" stroke-dasharray="12 7"/>`);
      parts.push('</g>');
      wireEndsSvg(parts, w, pts0, project);
      continue;
    }
    const s = pts0[0];
    const dir = Math.sign(pts0[1].x - s.x) || 1;
    const J = { x: s.x + dir * 70, y: s.y };
    const splices = !!group[0].spliceId;
    parts.push(dash(roundedPath([s, J], 10), strokeFor(group[0])));
    parts.push(
      `<circle cx="${J.x}" cy="${J.y}" r="5" fill="${splices ? '#E91E63' : '#444'}" stroke="#fff" stroke-width="1.2"/>`
    );
    for (const w of group) {
      const pts = wirePoints(w, project);
      if (pts.length < 3) continue;
      const branch = [J, ...pts.slice(2)];
      const d = roundedPath(branch, 10);
      parts.push(`<g>${dash(d, strokeFor(w))}`);
      if (w.stripe) parts.push(`<path d="${d}" fill="none" stroke="${w.stripe}" stroke-width="1.6" stroke-dasharray="12 7"/>`);
      parts.push('</g>');
      wireEndsSvg(parts, w, branch, project);
    }
  }

  // оборудование
  for (const eq of project.equipment) {
    const h = boxHeight(eq);
    const rows: string[] = [];
    rows.push(`<g transform="translate(${eq.x},${eq.y})">`);
    rows.push(`<rect width="${BOX_W}" height="${h}" rx="6" fill="#fff" stroke="#000" stroke-width="1.4"/>`);
    rows.push(`<rect width="${BOX_W}" height="${HEADER_H}" rx="6" fill="#e9e9e9" stroke="#000" stroke-width="1.2"/>`);
    rows.push(`<text x="10" y="22" font-size="13" font-weight="600" fill="#000" font-family="Segoe UI, sans-serif">${esc(eq.name)}</text>`);
    eq.rows.forEach((r, i) => {
      const y = HEADER_H + i * ROW_H;
      const yc = y + ROW_H / 2;
      rows.push(`<line x1="0" x2="${BOX_W}" y1="${y}" y2="${y}" stroke="#999" stroke-width="0.6"/>`);
      rows.push(`<text x="10" y="${yc + 4}" font-size="11" fill="#000" font-family="Segoe UI, sans-serif">${esc(r.name)}</text>`);
      if (r.kind === 'разъем') {
        rows.push(
          `<path d="${ugoPath(7, yc, -1, 0.7)}" fill="none" stroke="#000" stroke-width="1.2"/>`,
          `<path d="${ugoPath(BOX_W - 7, yc, 1, 0.7)}" fill="none" stroke="#000" stroke-width="1.2"/>`
        );
      } else {
        rows.push(
          `<circle cx="7" cy="${yc}" r="3.4" fill="none" stroke="#000" stroke-width="1.2"/><circle cx="7" cy="${yc}" r="1.2" fill="#fff" stroke="#000" stroke-width="0.6"/>`,
          `<circle cx="${BOX_W - 7}" cy="${yc}" r="3.4" fill="none" stroke="#000" stroke-width="1.2"/><circle cx="${BOX_W - 7}" cy="${yc}" r="1.2" fill="#fff" stroke="#000" stroke-width="0.6"/>`
        );
      }
    });
    rows.push('</g>');
    parts.push(rows.join(''));
  }

  // заметки
  for (const n of project.notes) {
    const w = Math.max(52, n.text.length * 7.2 + 16);
    parts.push(
      `<g transform="translate(${n.x},${n.y})"><rect x="-8" y="-16" width="${w}" height="24" rx="4" fill="#fff" stroke="#000" stroke-width="0.8" stroke-dasharray="4 3"/>`,
      `<text x="0" y="1" font-size="12" fill="#000" font-family="Segoe UI, sans-serif">${esc(n.text || 'NOTE')}</text></g>`
    );
  }

  parts.push('</svg>');
  return parts.join('\n');
}

/* === DXF (AC1015): провода — LWPOLYLINE, оборудование — контуры + текст === */

const dxfEscape = (s: string) => s.replace(/\\/g, '\\\\').replace(/{/g, '\\{').replace(/}/g, '\\}');

const hexToTrueColor = (hex: string): number | null => {
  const m = /^#([0-9a-f]{6})$/i.exec(hex.trim());
  return m ? parseInt(m[1], 16) : null;
};

/** Убираем дубликаты подряд идущих точек (коллинеарные оставляем — polyline их переварит) */
const dedupe = (pts: Pt[]): Pt[] => {
  const out: Pt[] = [];
  for (const p of pts) {
    const q = out[out.length - 1];
    if (!q || p.x !== q.x || p.y !== q.y) out.push(p);
  }
  return out;
};

export function schemeDxf(project: Project): string {
  const e: string[] = [];
  let layers = '';
  for (const name of ['WIRES', 'EQUIP', 'TEXT']) {
    layers += `0\nLAYER\n2\n${name}\n70\n0\n62\n7\n6\nCONTINUOUS\n`;
  }

  const lwpoly = (pts: Pt[], layer: string, color: string | null, closed = false) => {
    const d = dedupe(pts);
    if (d.length < 2) return;
    const tc = color ? hexToTrueColor(color) : null;
    e.push(`0\nLWPOLYLINE\n8\n${layer}\n90\n${d.length}\n70\n${closed ? 1 : 0}`);
    if (tc !== null) e.push(`420\n${tc}`);
    for (const p of d) e.push(`10\n${p.x.toFixed(2)}\n20\n${(-p.y).toFixed(2)}`); // Y вверх (чертёж)
  };
  const line = (a: Pt, b: Pt, layer: string) =>
    e.push(
      `0\nLINE\n8\n${layer}\n10\n${a.x.toFixed(2)}\n20\n${(-a.y).toFixed(2)}\n11\n${b.x.toFixed(2)}\n21\n${(-b.y).toFixed(2)}`
    );
  const circle = (c: Pt, r: number, layer: string, color: string) => {
    const tc = hexToTrueColor(color);
    e.push(`0\nCIRCLE\n8\n${layer}\n10\n${c.x.toFixed(2)}\n20\n${(-c.y).toFixed(2)}\n40\n${r}`);
    if (tc !== null) e.push(`420\n${tc}`);
  };
  const text = (x: number, y: number, h: number, s: string, layer = 'TEXT') =>
    e.push(
      `0\nTEXT\n8\n${layer}\n10\n${x.toFixed(2)}\n20\n${(-y).toFixed(2)}\n40\n${h}\n1\n${dxfEscape(s)}`
    );

  // провода
  for (const [, group] of groupedWires(project)) {
    const pts0 = wirePoints(group[0], project);
    if (!pts0.length) continue;
    const colorOf = (w: Wire) => wireColor(project, w);
    if (group.length === 1) {
      lwpoly(pts0, 'WIRES', colorOf(group[0]));
    } else {
      const s = pts0[0];
      const dir = Math.sign(pts0[1].x - s.x) || 1;
      const J = { x: s.x + dir * 70, y: s.y };
      lwpoly([s, J], 'WIRES', colorOf(group[0]));
      circle(J, 5, 'WIRES', group[0].spliceId ? '#E91E63' : '#444444');
      for (const w of group) {
        const pts = wirePoints(w, project);
        if (pts.length < 3) continue;
        lwpoly([J, ...pts.slice(2)], 'WIRES', colorOf(w));
      }
    }
  }

  // оборудование
  for (const eq of project.equipment) {
    const h = boxHeight(eq);
    lwpoly(
      [
        { x: eq.x, y: eq.y },
        { x: eq.x + BOX_W, y: eq.y },
        { x: eq.x + BOX_W, y: eq.y + h },
        { x: eq.x, y: eq.y + h },
      ],
      'EQUIP',
      null,
      true
    );
    line({ x: eq.x, y: eq.y + HEADER_H }, { x: eq.x + BOX_W, y: eq.y + HEADER_H }, 'EQUIP');
    text(eq.x + 10, eq.y + 22, 13, eq.name);
    eq.rows.forEach((r, i) => {
      const y = eq.y + HEADER_H + i * ROW_H;
      const yc = y + ROW_H / 2;
      line({ x: eq.x, y }, { x: eq.x + BOX_W, y }, 'EQUIP');
      text(eq.x + 10, yc + 4, 11, r.name);
      circle({ x: eq.x + (r.kind === 'разъем' ? 7 : 7), y: yc }, r.kind === 'разъем' ? 5.5 : 3.4, 'EQUIP', '#000000');
      circle({ x: eq.x + BOX_W - 7, y: yc }, r.kind === 'разъем' ? 5.5 : 3.4, 'EQUIP', '#000000');
    });
  }

  // заметки
  for (const n of project.notes) text(n.x, n.y, 12, n.text || 'NOTE');

  return [
    '0\nSECTION\n2\nHEADER\n9\n$ACADVER\n1\nAC1015\n9\n$INSUNITS\n70\n5\n0\nENDSEC',
    `0\nSECTION\n2\nTABLES\n0\nTABLE\n2\nLAYER\n70\n3\n${layers}0\nENDTAB\n0\nENDSEC`,
    `0\nSECTION\n2\nENTITIES\n${e.join('\n')}\n0\nENDSEC\n0\nEOF`,
  ].join('\n');
}

/** Имя файла экспорта на основе обозначения документа */
export const exportBaseName = (project: Project, ext: string) => {
  const base = (project.docNumber || 'scheme').trim().replace(/[\\/:*?"<>|]+/g, '_') || 'scheme';
  return `${base}.${ext}`;
};

/** Строка «кабель → откуда—куда» для журнала и подсказок */
export const cableRoute = (project: Project, cable: Cable): { froms: string; tos: string } => {
  const phys = project.wires.filter((w) => w.cableId === cable.id && !w.virtual);
  return {
    froms: [...new Set(phys.map((w) => eqName(project, w.fromEq)))].join(', ') || '—',
    tos: [...new Set(phys.map((w) => eqName(project, w.toEq)))].join(', ') || '—',
  };
};
