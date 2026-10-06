import type { PortKind } from '../types';

/**
 * УГО разъёма: открытый треугольник.
 * side = 1 — смотрит вправо (▷), -1 — влево (◁).
 */
export function UgoSymbol({
  x,
  y,
  side,
  stroke = '#c9c9cf',
  s = 1,
}: {
  x: number;
  y: number;
  side: 1 | -1;
  stroke?: string;
  s?: number;
}) {
  return (
    <path
      d={`M ${x - 4 * side * s} ${y - 5.5 * s} L ${x + 8 * side * s} ${y} L ${x - 4 * side * s} ${y + 5.5 * s}`}
      fill="none"
      stroke={stroke}
      strokeWidth={1.7 * s}
      strokeLinejoin="round"
      strokeLinecap="round"
    />
  );
}

/** Клемма: бублик с дырочкой */
export function ClampSymbol({
  x,
  y,
  stroke = '#c9c9cf',
  holeFill = '#1e1e23',
  r = 4.6,
}: {
  x: number;
  y: number;
  stroke?: string;
  holeFill?: string;
  r?: number;
}) {
  return (
    <g>
      <circle cx={x} cy={y} r={r} fill="none" stroke={stroke} strokeWidth={1.7} />
      <circle cx={x} cy={y} r={r * 0.36} fill={holeFill} stroke={stroke} strokeWidth={0.9} />
    </g>
  );
}

/** Символ точки по типу: разъём или клемма */
export function PortSymbol({
  x,
  y,
  kind,
  side,
  stroke,
  holeFill,
  s = 1,
}: {
  x: number;
  y: number;
  kind: PortKind;
  side: 1 | -1;
  stroke?: string;
  holeFill?: string;
  s?: number;
}) {
  if (kind === 'разъем') {
    return <UgoSymbol x={x} y={y} side={side} stroke={stroke} s={s} />;
  }
  return <ClampSymbol x={x} y={y} stroke={stroke} holeFill={holeFill} r={4.6 * s} />;
}

/** Подпись точки «Имя:№» (пустые части опускаются) */
export const connText = (name: string, num: string) => {
  const n = name.trim();
  const m = num.trim();
  if (n && m) return `${n}:${m}`;
  return n || m || '';
};
