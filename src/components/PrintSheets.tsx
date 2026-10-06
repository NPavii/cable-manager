import type { Cable, Project, Wire } from '../types';
import { wireEndKind } from '../types';
import {
  BOX_W, HEADER_H, ROW_H, SHEET_H, SHEET_W,
  boxHeight, groupedWires, roundedPath, usedSheets, wireColor, wirePoints,
} from '../lib/layout';
import type { SheetCell } from '../lib/layout';
import { ClampSymbol, UgoSymbol, connText } from './symbols';

/** Строк листа связи на одном листе */
const LINKS_PER_SHEET = 20;

function Sheet({
  docNumber,
  num,
  total,
  title,
  children,
}: {
  docNumber: string;
  num: number;
  total: number;
  title?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="a4-sheet">
      <div className="a4-frame">
        <div className="a4-body">
          {title && <div className="a4-title">{title}</div>}
          {children}
        </div>
        <div className="a4-footer">
          <div className="doc">{docNumber}</div>
          <div className="page">Лист {num} из {total}</div>
        </div>
      </div>
    </div>
  );
}

/** Концы провода: символы (чёрные) + подписи «Имя:№» у каждой стороны */
function WireEndsPrint({ w, pts, project }: { w: Wire; pts: { x: number; y: number }[]; project: Project }) {
  const s = pts[0];
  const t = pts[pts.length - 1];
  const dirA = Math.sign(pts[1].x - s.x) || 1;
  const dirT = Math.sign(t.x - pts[pts.length - 2].x) || 1;
  const kindA = wireEndKind(project, w, 'A');
  const kindB = wireEndKind(project, w, 'B');
  const ax = s.x + dirA * 22;
  const bx = t.x - dirT * 22;
  const txtA = connText(w.aName, w.aNum);
  const txtB = connText(w.bName, w.bNum);
  return (
    <g>
      {kindA === 'разъем'
        ? <UgoSymbol x={ax} y={s.y} side={(dirA * -1) as 1 | -1} stroke="#000" />
        : <ClampSymbol x={ax} y={s.y} stroke="#000" holeFill="#fff" />}
      {kindB === 'разъем'
        ? <UgoSymbol x={bx} y={t.y} side={dirT as 1 | -1} stroke="#000" />
        : <ClampSymbol x={bx} y={t.y} stroke="#000" holeFill="#fff" />}
      {txtA && (
        <text x={ax} y={s.y - 11} fontSize={10} textAnchor="middle" fill="#000">{txtA}</text>
      )}
      {txtB && (
        <text x={bx} y={t.y - 11} fontSize={10} textAnchor="middle" fill="#000">{txtB}</text>
      )}
      {/* маркировка провода у каждой стороны */}
      <text x={s.x + dirA * 40} y={s.y + 14} fontSize={9} textAnchor="middle" fill="#333">{w.marking}</text>
      <text x={t.x + dirT * 40} y={t.y + 14} fontSize={9} textAnchor="middle" fill="#333">{w.marking}</text>
    </g>
  );
}

/** Содержимое одного листа размещения (белая тема, клип по границе листа) */
function PlacementContent({ project, sheet }: { project: Project; sheet: SheetCell }) {
  const x0 = sheet.ix * SHEET_W;
  const y0 = sheet.iy * SHEET_H;
  return (
    <svg
      className="placement-svg"
      viewBox={`${x0} ${y0} ${SHEET_W} ${SHEET_H}`}
      width="100%"
      preserveAspectRatio="xMidYMid meet"
      style={{ display: 'block' }}
    >
      {/* провода: группы (splice/общий порт) — ствол + точка + ветви */}
      {[...groupedWires(project)].map(([key, group]) => {
        const pts0 = wirePoints(group[0], project);
        if (!pts0.length) return null;
        if (group.length === 1) {
          const w = group[0];
          const d = roundedPath(pts0, 10);
          return (
            <g key={key}>
              <path d={d} fill="none" stroke={wireColor(project, w)} strokeWidth={2.4} />
              {w.stripe && (
                <path d={d} fill="none" stroke={w.stripe} strokeWidth={1.6} strokeDasharray="12 7" />
              )}
              <WireEndsPrint w={w} pts={pts0} project={project} />
            </g>
          );
        }
        const s = pts0[0];
        const dir = Math.sign(pts0[1].x - s.x) || 1;
        const J = { x: s.x + dir * 70, y: s.y };
        const splices = !!group[0].spliceId;
        return (
          <g key={key}>
            <path d={roundedPath([s, J], 10)} fill="none" stroke={wireColor(project, group[0])} strokeWidth={2.4} />
            <circle cx={J.x} cy={J.y} r={5} fill={splices ? '#E91E63' : '#444'} stroke="#fff" strokeWidth={1.2} />
            <text x={s.x + dir * 10} y={s.y - 8} fontSize={9} fill="#333">{group[0].marking}</text>
            {group.map((w) => {
              const pts = wirePoints(w, project);
              if (pts.length < 3) return null;
              const branch = [J, ...pts.slice(2)];
              const d = roundedPath(branch, 10);
              return (
                <g key={w.id}>
                  <path d={d} fill="none" stroke={wireColor(project, w)} strokeWidth={2.4} />
                  {w.stripe && (
                    <path d={d} fill="none" stroke={w.stripe} strokeWidth={1.6} strokeDasharray="12 7" />
                  )}
                  <WireEndsPrint w={w} pts={branch} project={project} />
                </g>
              );
            })}
          </g>
        );
      })}

      {/* оборудование и источники */}
      {project.equipment.map((eq) => {
        const h = boxHeight(eq);
        return (
          <g key={eq.id} transform={`translate(${eq.x},${eq.y})`}>
            <rect width={BOX_W} height={h} rx={6} fill="#fff" stroke="#000" strokeWidth={1.4} />
            <rect width={BOX_W} height={HEADER_H} rx={6} fill="#e9e9e9" stroke="#000" strokeWidth={1.2} />
            <text x={10} y={22} fontSize={13} fontWeight={600} fill="#000">{eq.name}</text>
            {eq.rows.map((r, i) => {
              const y = HEADER_H + i * ROW_H;
              const yc = y + ROW_H / 2;
              return (
                <g key={r.id}>
                  <line x1={0} x2={BOX_W} y1={y} y2={y} stroke="#999" strokeWidth={0.6} />
                  <text x={10} y={yc + 4} fontSize={11} fill="#000">{r.name}</text>
                  {r.kind === 'разъем' ? (
                    <>
                      <UgoSymbol x={7} y={yc} side={-1} stroke="#000" s={0.7} />
                      <UgoSymbol x={BOX_W - 7} y={yc} side={1} stroke="#000" s={0.7} />
                    </>
                  ) : (
                    <>
                      <ClampSymbol x={7} y={yc} stroke="#000" holeFill="#fff" r={3.4} />
                      <ClampSymbol x={BOX_W - 7} y={yc} stroke="#000" holeFill="#fff" r={3.4} />
                    </>
                  )}
                </g>
              );
            })}
          </g>
        );
      })}

      {/* заметки */}
      {project.notes.map((n) => (
        <g key={n.id} transform={`translate(${n.x},${n.y})`}>
          <rect
            x={-8}
            y={-16}
            width={Math.max(52, n.text.length * 7.2 + 16)}
            height={24}
            rx={4}
            fill="#fff"
            stroke="#000"
            strokeWidth={0.8}
            strokeDasharray="4 3"
          />
          <text x={0} y={1} fontSize={12} fill="#000">{n.text || 'NOTE'}</text>
        </g>
      ))}
    </svg>
  );
}

/** Лист связи: одна строка на кабель */
function LinkRow({ project, cable, index }: { project: Project; cable: Cable; index: number }) {
  const eqName = (id: string) => project.equipment.find((e) => e.id === id)?.name ?? '—';
  const wires = project.wires.filter((w) => w.cableId === cable.id);
  const phys = wires.filter((w) => !w.virtual);
  const froms = [...new Set(phys.map((w) => eqName(w.fromEq)))].join(', ') || '—';
  const tos = [...new Set(phys.map((w) => eqName(w.toEq)))].join(', ') || '—';
  const fw = phys[0];
  return (
    <tr>
      <td>{index + 1}</td>
      <td>{cable.name}</td>
      <td>{cable.type || `${wires.length}х${cable.section}`}</td>
      <td>{froms}</td>
      <td>{fw ? connText(fw.aName, fw.aNum) || '—' : '—'}</td>
      <td>{fw ? connText(fw.bName, fw.bNum) || '—' : '—'}</td>
      <td>{tos}</td>
    </tr>
  );
}

export default function PrintSheets({ project }: { project: Project }) {
  const sheets = usedSheets(project);
  const linkChunks: Cable[][] = [];
  for (let i = 0; i < project.cables.length; i += LINKS_PER_SHEET) {
    linkChunks.push(project.cables.slice(i, i + LINKS_PER_SHEET));
  }
  const total = sheets.length + linkChunks.length;
  let num = 0;

  return (
    <>
      {/* Листы размещения (только занятые листы А4) */}
      {sheets.map((sheet) => (
        <Sheet key={`s${sheet.ix},${sheet.iy}`} docNumber={project.docNumber} num={++num} total={total}>
          <PlacementContent project={project} sheet={sheet} />
        </Sheet>
      ))}

      {/* Листы связи */}
      {linkChunks.length === 0 ? (
        <Sheet docNumber={project.docNumber} num={++num} total={total} title="Листы связи">
          <div style={{ textAlign: 'center', color: '#555', paddingTop: '40mm' }}>Кабели отсутствуют</div>
        </Sheet>
      ) : (
        linkChunks.map((chunk, ci) => (
          <Sheet
            key={`links-${ci}`}
            docNumber={project.docNumber}
            num={++num}
            total={total}
            title={linkChunks.length > 1 ? `Листы связи (часть ${ci + 1} из ${linkChunks.length})` : 'Листы связи'}
          >
            <table className="gost">
              <thead>
                <tr>
                  <th style={{ width: '10mm' }}>№</th>
                  <th>Кабель</th>
                  <th style={{ width: '30mm' }}>Тип</th>
                  <th>Откуда</th>
                  <th style={{ width: '26mm' }}>Подключение А</th>
                  <th style={{ width: '26mm' }}>Подключение Б</th>
                  <th>Куда</th>
                </tr>
              </thead>
              <tbody>
                {chunk.map((c, i) => (
                  <LinkRow key={c.id} project={project} cable={c} index={ci * LINKS_PER_SHEET + i} />
                ))}
              </tbody>
            </table>
          </Sheet>
        ))
      )}
    </>
  );
}
