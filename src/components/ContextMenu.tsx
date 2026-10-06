import type { Equipment, Note, PortKind, PortRow, Project, SignalType, Wire } from '../types';
import { PALETTE, SIGNALS } from '../types';
import type { EquipmentTemplate } from '../lib/templates';

export type MenuState =
  | { kind: 'blank'; x: number; y: number }                        // x/y — экранные координаты
  | { kind: 'equip'; x: number; y: number; eqId: string }
  | { kind: 'row'; x: number; y: number; eqId: string; rowId: string }
  | { kind: 'port'; x: number; y: number; eqId: string; rowId: string }
  | { kind: 'wire'; x: number; y: number; wireId: string }
  | { kind: 'note'; x: number; y: number; noteId: string };

interface Props {
  menu: MenuState;
  project: Project;
  selection: string[];
  templates: EquipmentTemplate[];
  eq?: Equipment;
  row?: PortRow;
  wire?: Wire;
  note?: Note;
  wireCableCount: number;
  onAddEquipment: (clientX: number, clientY: number) => void;
  onAddSource: (clientX: number, clientY: number) => void;
  onAddNote: (clientX: number, clientY: number) => void;
  onAddSignal: (eqId: string, signal: SignalType) => void;
  onAddPoint: (eqId: string) => void;
  onSetRowKind: (eqId: string, rowId: string, kind: PortKind) => void;
  onRenameRowRequest: (eqId: string, rowId: string) => void;
  onDeleteEquipment: (eqId: string) => void;
  onDuplicateEquipment: (eqId: string) => void;
  onDeleteRow: (eqId: string, rowId: string) => void;
  onDeleteWire: (wireId: string) => void;
  onDetachWire: (wireId: string) => void;
  onOpenCable: (cableId: string) => void;
  onSetCableColor: (cableId: string, color: string) => void;
  onSetStripe: (wireId: string, stripe?: string) => void;
  onSplice: (ids: string[]) => void;
  onUnsplice: (wireId: string) => void;
  onToggleFlip: (wireId: string) => void;
  onClearLayout: (wireId: string) => void;
  onRenameNoteRequest: (noteId: string) => void;
  onDeleteNote: (noteId: string) => void;
  /** выровнять оборудование по сетке (id не задан — всё оборудование) */
  onAlignToGrid: (id?: string) => void;
  onSaveTemplateRequest: (eqId: string) => void;
  onInsertTemplate: (name: string, clientX: number, clientY: number) => void;
  onClose: () => void;
}

const COLOR_DOTS = PALETTE.map((c) => ({ hex: c.hex, name: c.name }));

export default function ContextMenu({
  menu,
  project,
  selection,
  templates,
  eq,
  row,
  wire,
  note,
  wireCableCount,
  onAddEquipment,
  onAddSource,
  onAddNote,
  onAddSignal,
  onAddPoint,
  onSetRowKind,
  onRenameRowRequest,
  onDeleteEquipment,
  onDuplicateEquipment,
  onDeleteRow,
  onDeleteWire,
  onDetachWire,
  onOpenCable,
  onSetCableColor,
  onSetStripe,
  onSplice,
  onUnsplice,
  onToggleFlip,
  onClearLayout,
  onRenameNoteRequest,
  onDeleteNote,
  onAlignToGrid,
  onSaveTemplateRequest,
  onInsertTemplate,
  onClose,
}: Props) {
  const run = (fn: () => void) => () => {
    fn();
    onClose();
  };

  // можно ли соединить выбранные провода (splice): ≥2 проводов
  const canSplice = selection.length >= 2;

  return (
    <div className="ctx-menu" style={{ left: menu.x, top: menu.y }}>
      {menu.kind === 'blank' && (
        <>
          <div className="ctx-item" onClick={run(() => onAddEquipment(menu.x, menu.y))}>
            ▢ Оборудование
          </div>
          <div className="ctx-item" onClick={run(() => onAddSource(menu.x, menu.y))}>
            ⏻ Источник
          </div>
          <div className="ctx-item" onClick={run(() => onAddNote(menu.x, menu.y))}>
            ✎ Заметка
          </div>
          <div className="ctx-item">
            ▤ Шаблоны <span className="arrow">▸</span>
            <div className="ctx-sub">
              {templates.length === 0 && <div className="ctx-item ctx-disabled">(пусто — ПКМ по оборудованию)</div>}
              {templates.map((t) => (
                <div
                  key={t.name}
                  className="ctx-item"
                  title={`${t.type === 'source' ? 'Источник' : 'Оборудование'}, точек: ${t.rows.length}`}
                  onClick={run(() => onInsertTemplate(t.name, menu.x, menu.y))}
                >
                  {t.type === 'source' ? '⏻' : '▢'} {t.name}
                </div>
              ))}
            </div>
          </div>
          <div className="ctx-sep" />
          <div className="ctx-item" onClick={run(() => onAlignToGrid(undefined))}>
            ⌗ Выровнять всё по сетке
          </div>
        </>
      )}

      {menu.kind === 'equip' && eq?.type === 'source' && (
        <>
          <div className="ctx-item" onClick={run(() => onAddPoint(menu.eqId))}>
            ⊕ Добавить точку
          </div>
          <div className="ctx-item" onClick={run(() => onDuplicateEquipment(menu.eqId))}>
            ⧉ Дублировать
          </div>
          <div className="ctx-item" onClick={run(() => onAlignToGrid(menu.eqId))}>
            ⌗ Выровнять по сетке
          </div>
          <div className="ctx-item danger" onClick={run(() => onDeleteEquipment(menu.eqId))}>
            ✕ Удалить источник
          </div>
        </>
      )}

      {menu.kind === 'equip' && eq?.type !== 'source' && (
        <>
          <div className="ctx-item">
            ⊕ Добавить сигнал <span className="arrow">▸</span>
            <div className="ctx-sub">
              {SIGNALS.map((s) => (
                <div key={s} className="ctx-item" onClick={run(() => onAddSignal(menu.eqId, s))}>
                  {s}
                </div>
              ))}
            </div>
          </div>
          <div className="ctx-item" onClick={run(() => onDuplicateEquipment(menu.eqId))}>
            ⧉ Дублировать
          </div>
          <div className="ctx-item" onClick={run(() => onSaveTemplateRequest(menu.eqId))}>
            ★ Сохранить как шаблон
          </div>
          <div className="ctx-item" onClick={run(() => onAlignToGrid(menu.eqId))}>
            ⌗ Выровнять по сетке
          </div>
          <div className="ctx-item danger" onClick={run(() => onDeleteEquipment(menu.eqId))}>
            ✕ Удалить оборудование
          </div>
        </>
      )}

      {menu.kind === 'row' && (
        <>
          <div className="ctx-item" onClick={run(() => onRenameRowRequest(menu.eqId, menu.rowId))}>
            ✎ Переименовать
          </div>
          <div className="ctx-item danger" onClick={run(() => onDeleteRow(menu.eqId, menu.rowId))}>
            ✕ Удалить строку
          </div>
        </>
      )}

      {menu.kind === 'port' && row && (
        <>
          <div className="ctx-item" onClick={run(() => onSetRowKind(menu.eqId, menu.rowId, 'клемма'))}>
            {row.kind === 'клемма' ? '✓' : '·'} ○ Клемма
          </div>
          <div className="ctx-item" onClick={run(() => onSetRowKind(menu.eqId, menu.rowId, 'разъем'))}>
            {row.kind === 'разъем' ? '✓' : '·'} ▸ Разъём
          </div>
          <div className="ctx-sep" />
          <div className="ctx-item" onClick={run(() => onRenameRowRequest(menu.eqId, menu.rowId))}>
            ✎ Переименовать
          </div>
          <div className="ctx-item danger" onClick={run(() => onDeleteRow(menu.eqId, menu.rowId))}>
            ✕ Удалить строку
          </div>
        </>
      )}

      {menu.kind === 'wire' && wire && (
        <>
          {wire.cableId && (
            <div className="ctx-item" onClick={run(() => onOpenCable(wire.cableId!))}>
              ✎ Настройки кабеля
            </div>
          )}
          <div className="ctx-item">
            ■ Цвет <span className="arrow">▸</span>
            <div className="ctx-sub">
              {COLOR_DOTS.map((c) => (
                <div key={c.hex} className="ctx-item" onClick={run(() => wire.cableId && onSetCableColor(wire.cableId, c.hex))}>
                  <span className="color-dot" style={{ background: c.hex }} /> {c.name}
                </div>
              ))}
            </div>
          </div>
          <div className="ctx-item">
            ▨ Штриховка <span className="arrow">▸</span>
            <div className="ctx-sub">
              <div className="ctx-item" onClick={run(() => onSetStripe(wire.id, undefined))}>
                {wire.stripe ? '·' : '✓'} Нет
              </div>
              {COLOR_DOTS.map((c) => (
                <div key={c.hex} className="ctx-item" onClick={run(() => onSetStripe(wire.id, c.hex))}>
                  <span className="color-dot" style={{ background: c.hex }} /> {c.name}
                </div>
              ))}
            </div>
          </div>
          {canSplice && (
            <div className="ctx-item" onClick={run(() => onSplice(selection))}>
              ⦿ Соединить провода (splice)
            </div>
          )}
          <div className="ctx-item" onClick={run(() => onToggleFlip(wire.id))}>
            ⇄ Перебросить на другую сторону{wire.flip ? ' (активно)' : ''}
          </div>
          {wire.layout && wire.layout.length > 0 && (
            <div className="ctx-item" onClick={run(() => onClearLayout(wire.id))}>
              ⌁ Удалить точки трассы
            </div>
          )}
          {wire.spliceId && (
            <div className="ctx-item" onClick={run(() => onUnsplice(wire.id))}>
              ⌀ Разъединить splice
            </div>
          )}
          {wire.cableId && wireCableCount > 1 && (
            <div className="ctx-item" onClick={run(() => onDetachWire(wire.id))}>
              ⤢ Выделить в отдельный кабель
            </div>
          )}
          <div className="ctx-item danger" onClick={run(() => onDeleteWire(wire.id))}>
            ✕ Удалить провод
          </div>
        </>
      )}

      {menu.kind === 'note' && note && (
        <>
          <div className="ctx-item" onClick={run(() => onRenameNoteRequest(note.id))}>
            ✎ Редактировать
          </div>
          <div className="ctx-item danger" onClick={run(() => onDeleteNote(note.id))}>
            ✕ Удалить заметку
          </div>
        </>
      )}
    </div>
  );
}
