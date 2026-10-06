import type { Cable, Project, Wire } from '../types';
import { PALETTE, TIPS, wireEndKind } from '../types';

interface Props {
  cable: Cable;
  wires: Wire[];
  project: Project;
  onPatch: (patch: Partial<Cable>) => void;
  onPatchWire: (id: string, patch: Partial<Wire>) => void;
  onSetCoreCount: (n: number) => void;
  onSplit: () => void;
  onClose: () => void;
}

const TIP_OPTS = TIPS.map((t) => (
  <option key={t.id} value={t.id}>{t.name}</option>
));

/** Одна жила — одна строка: ● [марк.] Имя № Нак | Нак № Имя ● [цвет] */
function WireRow({
  w,
  index,
  project,
  onPatch,
}: {
  w: Wire;
  index: number;
  project: Project;
  onPatch: (patch: Partial<Wire>) => void;
}) {
  const eqA = project.equipment.find((e) => e.id === w.fromEq);
  const eqB = project.equipment.find((e) => e.id === w.toEq);
  const rowA = eqA?.rows.find((r) => r.id === w.fromRow);
  const rowB = eqB?.rows.find((r) => r.id === w.toRow);
  const kindA = wireEndKind(project, w, 'A');
  const kindB = wireEndKind(project, w, 'B');
  const route = w.virtual
    ? 'Дополнительная жила — повторяет первую по типу точек'
    : `${eqA?.name} — ${rowA?.name} → ${eqB?.name} — ${rowB?.name}`;

  return (
    <div className="wire-row" title={route}>
      <span className="color-dot" style={{ background: w.color }} title="Цвет жилы (чертёж)" />
      <b className="wire-idx">{index + 1}</b>
      <input
        className="sp-input wr-mark"
        value={w.marking}
        placeholder="Марк."
        title="Маркировка жилы"
        onChange={(e) => onPatch({ marking: e.target.value })}
      />
      <span className="wr-side" title={`Сторона А — ${kindA}`}>{kindA === 'клемма' ? '●' : '▸'}</span>
      <input
        className="sp-input wr-name"
        value={w.aName}
        placeholder={kindA === 'клемма' ? 'Имя А' : 'Разъём А'}
        title="Имя клеммы / разъёма, сторона А"
        onChange={(e) => onPatch({ aName: e.target.value })}
      />
      <input
        className="sp-input wr-num"
        value={w.aNum}
        placeholder="№"
        title={kindA === 'клемма' ? '№ клеммы А' : '№ контакта А'}
        onChange={(e) => onPatch({ aNum: e.target.value })}
      />
      <select className="sp-input wr-tip" value={w.tipA} title="Наконечник А" onChange={(e) => onPatch({ tipA: e.target.value })}>
        {TIP_OPTS}
      </select>
      <span className="wr-dash">—</span>
      <select className="sp-input wr-tip" value={w.tipB} title="Наконечник Б" onChange={(e) => onPatch({ tipB: e.target.value })}>
        {TIP_OPTS}
      </select>
      <input
        className="sp-input wr-num"
        value={w.bNum}
        placeholder="№"
        title={kindB === 'клемма' ? '№ клеммы Б' : '№ контакта Б'}
        onChange={(e) => onPatch({ bNum: e.target.value })}
      />
      <input
        className="sp-input wr-name"
        value={w.bName}
        placeholder={kindB === 'клемма' ? 'Имя Б' : 'Разъём Б'}
        title="Имя клеммы / разъёма, сторона Б"
        onChange={(e) => onPatch({ bName: e.target.value })}
      />
      <span className="wr-side" title={`Сторона Б — ${kindB}`}>{kindB === 'клемма' ? '●' : '▸'}</span>
      <select
        className="sp-input wr-color"
        value={w.color}
        title="Цвет жилы (на чертеже)"
        onChange={(e) => onPatch({ color: e.target.value })}
      >
        {PALETTE.map((c) => (
          <option key={c.hex} value={c.hex}>{c.name}</option>
        ))}
      </select>
    </div>
  );
}

export default function CablePanel({ cable, wires, project, onPatch, onPatchWire, onSetCoreCount, onSplit, onClose }: Props) {
  const physicalCount = wires.filter((w) => !w.virtual).length;

  return (
    <div className="side-panel">
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <h2>Настройки кабеля</h2>
        <button className="tb-btn" onClick={onClose}>Закрыть ✕</button>
      </div>

      <div style={{ display: 'flex', gap: 8 }}>
        <div style={{ flex: 1, minWidth: 0 }}>
          <span className="sp-label">Наименование кабеля</span>
          <input className="sp-input" value={cable.name} onChange={(e) => onPatch({ name: e.target.value })} />
        </div>
        <div style={{ width: 132, flexShrink: 0 }}>
          <span className="sp-label">Цвет кабеля</span>
          <select
            className="sp-input"
            value={cable.color}
            title="Цвет, которым кабель рисуется на схеме"
            onChange={(e) => onPatch({ color: e.target.value })}
          >
            {PALETTE.map((c) => (
              <option key={c.hex} value={c.hex}>{c.name}</option>
            ))}
          </select>
        </div>
      </div>

      <div>
        <span className="sp-label">Тип / марка кабеля</span>
        <input
          className="sp-input"
          value={cable.type}
          placeholder="например КГВВнг"
          onChange={(e) => onPatch({ type: e.target.value })}
        />
      </div>

      <div className="grid3">
        <div>
          <span className="sp-label">Сечение, мм²</span>
          <input className="sp-input" value={cable.section} onChange={(e) => onPatch({ section: e.target.value })} />
        </div>
        <div>
          <span className="sp-label">Длина, м</span>
          <input
            className="sp-input"
            type="number"
            min={0}
            value={cable.lengthM}
            onChange={(e) => onPatch({ lengthM: parseFloat(e.target.value) || 0 })}
          />
        </div>
        <div>
          <span className="sp-label">Жил, шт</span>
          <input
            className="sp-input"
            type="number"
            min={physicalCount}
            max={64}
            value={wires.length}
            onChange={(e) => onSetCoreCount(parseInt(e.target.value, 10) || physicalCount)}
          />
        </div>
      </div>
      <div className="sp-label">
        Итог: <b>{cable.name} — {wires.length}х{cable.section}{cable.lengthM > 0 ? ` — L=${cable.lengthM} м` : ''}</b>
      </div>

      <div style={{ fontSize: 10.5, color: '#8a8a94', lineHeight: 1.5 }}>
        ● клемма · ▸ разъём · порядок: Имя / № / Наконечник
      </div>

      {wires.map((w, i) => (
        <WireRow key={w.id} w={w} index={i} project={project} onPatch={(p) => onPatchWire(w.id, p)} />
      ))}

      {wires.length > 1 && (
        <button className="tb-btn" style={{ color: '#ff7b72', alignSelf: 'flex-start' }} onClick={onSplit}>
          Разъединить на отдельные кабели
        </button>
      )}
    </div>
  );
}
