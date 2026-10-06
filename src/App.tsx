import { useCallback, useEffect, useRef, useState } from 'react';
import Editor from './components/Editor';
import CablePanel from './components/CablePanel';
import PrintSheets from './components/PrintSheets';
import type { Project } from './types';
import { isElectron, onMenuAction, openFile, saveExport, saveFile } from './lib/file';
import { migrate, looksLikeProject, serializeProject } from './lib/migrate';
import { cableJournalCsv, exportBaseName, schemeDxf, schemeSvg } from './lib/exporters';
import {
  addEquipmentAt, addNoteAt, addSourceAt, addWire, alignEquipmentToGrid, deleteEquipment,
  deleteNote, deleteRow, deleteWires, detachWire, duplicateEquipment, insertEquipment,
  mergeCables, moveEquipmentTo, moveNoteTo, moveRow, patchCable, patchWire, renameEquipment,
  renameNote, renameRow, setCableColor, setCoreCount, setRowKind, setStripe, setWireLayout,
  snapToGrid, spliceWires, splitCable, toggleFlip, unspliceWire, useProject,
} from './state/useProject';
import { addPoint, addSignal } from './state/useProject';
import { instantiateTemplate, listTemplates, saveTemplate, templateFromEquipment } from './lib/templates';

const LS_KEY = 'cable-manager-v1';
const PANEL_W_KEY = 'cable-manager-panel-w';
const GRID_KEY = 'cable-manager-grid';
const PANEL_MIN = 320;
const PANEL_MAX = 820;

const defaultProject = (): Project => ({
  docNumber: 'АНК 601Н-45 00 00 МЭ',
  equipment: [],
  wires: [],
  cables: [],
  notes: [],
});

function load(): Project {
  try {
    const raw = localStorage.getItem(LS_KEY);
    if (raw) {
      const p = JSON.parse(raw);
      if (looksLikeProject(p)) return migrate(p);
    }
  } catch { /* ignore */ }
  return defaultProject();
}

/** фокус в поле ввода? (там Ctrl+Z и Delete работают по тексту) */
const isTyping = () => {
  const tag = (document.activeElement as HTMLElement | null)?.tagName;
  return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT';
};

export default function App() {
  const api = useProject(load());
  const { project } = api;
  const [selection, setSelection] = useState<string[]>([]);
  const [activeCableId, setActiveCableId] = useState<string | null>(null);
  const [printMode, setPrintMode] = useState(false);
  const [templates, setTemplates] = useState(() => listTemplates());
  const refreshTemplates = useCallback(() => setTemplates(listTemplates()), []);

  // привязка к сетке: фоновая сетка + шаг при перетаскивании
  const [grid, setGrid] = useState(() => localStorage.getItem(GRID_KEY) !== '0');
  const toggleGrid = useCallback(() => {
    setGrid((g) => {
      localStorage.setItem(GRID_KEY, g ? '0' : '1');
      return !g;
    });
  }, []);

  // --- файлы и защита от потерь ---
  const [filePath, setFilePath] = useState<string | null>(null);
  const savedJsonRef = useRef<string | null>(null);
  const projectJson = JSON.stringify(project);
  // загруженное состояние (localStorage/файл) — базовая линия «сохранено»
  if (savedJsonRef.current === null) savedJsonRef.current = projectJson;
  const dirty = projectJson !== savedJsonRef.current;
  const dirtyRef = useRef(dirty);
  dirtyRef.current = dirty;

  /** имя файла для заголовка/диалогов */
  const fileName = filePath ? filePath.replace(/\\/g, '/').split('/').pop() : null;
  const suggestedName = () => exportBaseName(project, 'cbm');

  const applyProject = (p: Project, path: string | null) => {
    savedJsonRef.current = JSON.stringify(p);
    setFilePath(path);
    setSelection([]);
    setActiveCableId(null);
    api.setProjectState(p);
    api.resetHistory();
  };

  const doSave = async (saveAs: boolean): Promise<boolean> => {
    const r = await saveFile(serializeProject(project), saveAs ? null : filePath, suggestedName());
    if (!r.ok) return false;
    savedJsonRef.current = JSON.stringify(project); // компактная версия для сравнения
    if (r.path) setFilePath(r.path);
    return true;
  };

  const doOpen = async () => {
    if (dirty) {
      const go = window.confirm('Есть несохранённые изменения. Открыть другой файл без сохранения?');
      if (!go) return;
    }
    const f = await openFile();
    if (!f) return;
    try {
      const parsed = JSON.parse(f.json);
      if (!looksLikeProject(parsed)) {
        window.alert('Файл не является проектом кабельного менеджера.');
        return;
      }
      applyProject(migrate(parsed), f.path);
    } catch {
      window.alert('Не удалось прочитать файл: повреждённый JSON.');
    }
  };

  /** Новый проект (с защитой от потерь) */
  const doNew = () => {
    if (dirty && !window.confirm('Есть несохранённые изменения. Создать новый проект без сохранения?')) {
      return;
    }
    applyProject(defaultProject(), null);
  };

  // --- undo / redo ---
  const doUndo = useCallback(() => {
    if (isTyping()) return;
    api.undo();
    setActiveCableId(null);
  }, [api]);
  const doRedo = useCallback(() => {
    if (isTyping()) return;
    api.redo();
    setActiveCableId(null);
  }, [api]);

  // --- экспорт ---
  const doExportCsv = useCallback(async () => {
    if (!project.cables.length) {
      window.alert('В проекте нет кабелей — журнал пуст.');
      return;
    }
    await saveExport(exportBaseName(project, 'csv'), { text: cableJournalCsv(project) }, 'Кабельный журнал (CSV)', 'csv');
  }, [project]);
  const doExportSvg = useCallback(async () => {
    await saveExport(exportBaseName(project, 'svg'), { text: schemeSvg(project) }, 'Схема (SVG)', 'svg');
  }, [project]);
  const doExportDxf = useCallback(async () => {
    if (!project.equipment.length && !project.wires.length) {
      window.alert('Схема пуста.');
      return;
    }
    await saveExport(exportBaseName(project, 'dxf'), { text: schemeDxf(project) }, 'Схема (DXF)', 'dxf');
  }, [project]);
  const doExportPng = useCallback(async () => {
    const svg = schemeSvg(project);
    const blob = await new Promise<Blob | null>((resolve) => {
      const img = new Image();
      img.onload = () => {
        // рендерим с запасом 2x, чтобы текст оставался читаемым
        const scale = 2;
        const m = /width="(\d+)" height="(\d+)"/.exec(svg);
        const canvas = document.createElement('canvas');
        canvas.width = (m ? parseInt(m[1], 10) : 1200) * scale;
        canvas.height = (m ? parseInt(m[2], 10) : 800) * scale;
        const ctx = canvas.getContext('2d')!;
        ctx.fillStyle = '#fff';
        ctx.fillRect(0, 0, canvas.width, canvas.height);
        ctx.scale(scale, scale);
        ctx.drawImage(img, 0, 0);
        canvas.toBlob((b) => resolve(b), 'image/png');
      };
      img.onerror = () => resolve(null);
      img.src = URL.createObjectURL(new Blob([svg], { type: 'image/svg+xml' }));
    });
    if (!blob) {
      window.alert('Не удалось построить PNG из схемы.');
      return;
    }
    await saveExport(exportBaseName(project, 'png'), { blob }, 'Схема (PNG)', 'png');
  }, [project]);

  // --- шаблоны ---
  const doSaveTemplate = useCallback((eqId: string, name: string) => {
    const eq = api.project.equipment.find((e) => e.id === eqId);
    if (!eq || !name.trim()) return;
    saveTemplate(templateFromEquipment(eq, name.trim()));
    refreshTemplates();
  }, [api, refreshTemplates]);
  const doInsertTemplate = useCallback((name: string, x: number, y: number) => {
    const t = listTemplates().find((x2) => x2.name === name);
    if (!t) return;
    insertEquipment(api, instantiateTemplate(t, snapToGrid(x), snapToGrid(y)));
  }, [api]);

  // --- обёртки с коррекцией выделения ---
  const onDeleteEquipment = useCallback((eqId: string) => {
    const ids = deleteEquipment(api, eqId);
    setSelection((sel) => sel.filter((id) => !ids.includes(id)));
    if (activeCableId && !api.project.wires.some((w) => w.cableId === activeCableId && !ids.includes(w.id))) {
      setActiveCableId(null);
    }
  }, [api, activeCableId]);
  const onDeleteRow = useCallback((eqId: string, rowId: string) => {
    const ids = deleteRow(api, eqId, rowId);
    setSelection((sel) => sel.filter((id) => !ids.includes(id)));
  }, [api]);
  const onDeleteWires = useCallback((ids: string[]) => {
    deleteWires(api, ids);
    setSelection((sel) => sel.filter((id) => !ids.includes(id)));
    if (activeCableId && !api.project.wires.some((w) => w.cableId === activeCableId && !ids.includes(w.id))) {
      setActiveCableId(null);
    }
  }, [api, activeCableId]);
  const onDetachWire = useCallback((id: string) => {
    detachWire(api, id);
    setActiveCableId(null);
  }, [api]);

  // актуальные обработчики для меню (подписка — одна, на весь жизненный цикл)
  const handlersRef = useRef({ doOpen, doSave, doNew, doUndo, doRedo });
  handlersRef.current = { doOpen, doSave, doNew, doUndo, doRedo };

  // сообщаем main-процессу о «грязном» состоянии (для закрытия окна)
  useEffect(() => {
    if (isElectron()) window.cableFile?.setDirty(dirty);
  }, [dirty]);

  // горячие клавиши файловых операций + undo/redo + меню Electron (регистрируем один раз)
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!(e.ctrlKey || e.metaKey)) return;
      const k = e.key.toLowerCase();
      if (k === 's') {
        e.preventDefault();
        void handlersRef.current.doSave(e.shiftKey);
      } else if (k === 'o') {
        e.preventDefault();
        void handlersRef.current.doOpen();
      } else if (k === 'n') {
        e.preventDefault();
        handlersRef.current.doNew();
      } else if (k === 'z' && !isTyping()) {
        e.preventDefault();
        if (e.shiftKey) handlersRef.current.doRedo();
        else handlersRef.current.doUndo();
      } else if (k === 'y' && !isTyping()) {
        e.preventDefault();
        handlersRef.current.doRedo();
      }
    };
    window.addEventListener('keydown', onKey);
    onMenuAction((action) => {
      const h = handlersRef.current;
      if (action === 'new') h.doNew();
      else if (action === 'open') void h.doOpen();
      else if (action === 'save') void h.doSave(false);
      else if (action === 'saveAs') void h.doSave(true);
      else if (action === 'undo') h.doUndo();
      else if (action === 'redo') h.doRedo();
      else if (action === 'close-request') {
        const close = () => window.cableFile?.confirmClose();
        if (!dirtyRef.current) {
          close();
          return;
        }
        const save = window.confirm('Есть несохранённые изменения.\nОК — сохранить и закрыть, Отмена — остаться.');
        if (save) {
          void h.doSave(false).then((ok) => {
            if (ok) close();
          });
        }
      }
    });
    return () => window.removeEventListener('keydown', onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // защита от случайного закрытия вкладки в браузере
  useEffect(() => {
    if (isElectron()) return;
    const h = (e: BeforeUnloadEvent) => {
      if (dirtyRef.current) {
        e.preventDefault();
        e.returnValue = '';
      }
    };
    window.addEventListener('beforeunload', h);
    return () => window.removeEventListener('beforeunload', h);
  }, []);

  // Ширина панели кабеля — запоминается между запусками
  const [panelW, setPanelW] = useState<number>(() => {
    const v = parseInt(localStorage.getItem(PANEL_W_KEY) || '380');
    return Number.isFinite(v) ? Math.min(PANEL_MAX, Math.max(PANEL_MIN, v)) : 380;
  });
  const dragRef = useRef<{ startX: number; startW: number } | null>(null);

  useEffect(() => {
    localStorage.setItem(LS_KEY, JSON.stringify(project));
  }, [project]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setPrintMode(false);
      // Ctrl/Cmd + P — наше окно печати вместо системного диалога
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'p') {
        e.preventDefault();
        setPrintMode(true);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  const activeCable = project.cables.find((c) => c.id === activeCableId) ?? null;

  // объединение возможно, когда выбраны жилы из разных кабелей
  const selCableIds = [
    ...new Set(
      project.wires
        .filter((w) => selection.includes(w.id))
        .map((w) => w.cableId)
        .filter(Boolean) as string[]
    ),
  ];
  const canMerge = selCableIds.length >= 2;

  const onPanelResizeStart = (e: React.PointerEvent) => {
    e.preventDefault();
    dragRef.current = { startX: e.clientX, startW: panelW };
    const onMove = (ev: PointerEvent) => {
      const d = dragRef.current;
      if (!d) return;
      setPanelW(Math.min(PANEL_MAX, Math.max(PANEL_MIN, d.startW + d.startX - ev.clientX)));
    };
    const onUp = () => {
      dragRef.current = null;
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
      setPanelW((w) => {
        localStorage.setItem(PANEL_W_KEY, String(w));
        return w;
      });
    };
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
  };

  return (
    <div className="app">
      <div className="toolbar no-print">
        <h1>Кабельный менеджер</h1>
        <span className="tb-label">Обозначение документа</span>
        <input
          className="tb-input"
          style={{ width: 210 }}
          value={project.docNumber}
          onChange={(e) => api.update((pr) => ({ ...pr, docNumber: e.target.value }), 'docnumber')}
        />
        <div className="tb-file">
          <button className="tb-btn" onClick={doNew} title="Новый проект (Ctrl+N)">
            Новый
          </button>
          <button className="tb-btn" onClick={() => void doOpen()} title="Открыть проект (Ctrl+O)">
            Открыть
          </button>
          <button className="tb-btn" onClick={() => void doSave(false)} title="Сохранить (Ctrl+S)">
            Сохранить
          </button>
          <button className="tb-btn" onClick={() => void doSave(true)} title="Сохранить как (Ctrl+Shift+S)">
            Сохранить как
          </button>
          <button className="tb-btn" onClick={doUndo} disabled={!api.canUndo} title="Отменить (Ctrl+Z)">
            ↶
          </button>
          <button className="tb-btn" onClick={doRedo} disabled={!api.canRedo} title="Повторить (Ctrl+Shift+Z)">
            ↷
          </button>
          <span className="tb-filename" title={filePath ?? 'Файл ещё не сохранён'}>
            {dirty && <span className="tb-dirty" title="Есть несохранённые изменения">●</span>}
            {fileName ?? 'без файла'}
          </span>
        </div>
        <div className="tb-spacer" />
        <button className={'tb-btn' + (grid ? ' primary' : '')} onClick={toggleGrid} title="Фоновая сетка и привязка перетаскивания к узлам (22 px)">
          ▦ Сетка
        </button>
        <div className="tb-export">
          <button className="tb-btn" onClick={() => void doExportCsv()} title="Кабельный журнал для Excel: имя, марка, откуда→куда, длина, наконечники">
            Журнал CSV
          </button>
          <button className="tb-btn" onClick={() => void doExportSvg()} title="Вся схема одним SVG-файлом">
            SVG
          </button>
          <button className="tb-btn" onClick={() => void doExportPng()} title="Вся схема одним PNG-изображением (2x)">
            PNG
          </button>
          <button className="tb-btn" onClick={() => void doExportDxf()} title="Схема в DXF (провода — полилинии, оборудование — контуры)">
            DXF
          </button>
        </div>
        <button className="tb-btn primary" disabled={!canMerge} onClick={() => { mergeCables(api, selCableIds); setActiveCableId(selCableIds[0]); }} title="Выберите жилы нескольких кабелей (Ctrl+клик)">
          Объединить в кабель{selection.length > 0 ? ` (${selection.length})` : ''}
        </button>
        <button className="tb-btn" onClick={() => setPrintMode(true)}>Печать (А4)</button>
      </div>

      <div className="main no-print">
        <Editor
          project={project}
          selection={selection}
          grid={grid}
          templates={templates}
          onSelect={setSelection}
          onOpenCable={setActiveCableId}
          onAddEquipment={(x, y) => addEquipmentAt(api, snapIf(x), snapIf(y))}
          onAddSource={(x, y) => addSourceAt(api, snapIf(x), snapIf(y))}
          onAddNote={(x, y) => addNoteAt(api, x, y)}
          onMoveEquipment={(id, x, y) => moveEquipmentTo(api, id, x, y)}
          onRenameEquipment={(id, name) => renameEquipment(api, id, name)}
          onAddSignal={(eqId, signal) => addSignal(api, eqId, signal)}
          onAddPoint={(eqId) => addPoint(api, eqId)}
          onSetRowKind={(eqId, rowId, kind) => setRowKind(api, eqId, rowId, kind)}
          onRenameRow={(eqId, rowId, name) => renameRow(api, eqId, rowId, name)}
          onMoveRow={(eqId, rowId, index) => moveRow(api, eqId, rowId, index)}
          onDeleteEquipment={onDeleteEquipment}
          onDuplicateEquipment={(eqId) => duplicateEquipment(api, eqId)}
          onDeleteRow={onDeleteRow}
          onDeleteWires={onDeleteWires}
          onDetachWire={onDetachWire}
          onAddWire={(fEq, fRow, tEq, tRow, color) => addWire(api, fEq, fRow, tEq, tRow, color)}
          onSetCableColor={(cableId, color) => setCableColor(api, cableId, color)}
          onSetStripe={(wireId, stripe) => setStripe(api, wireId, stripe)}
          onSplice={(ids) => spliceWires(api, ids)}
          onUnsplice={(wireId) => unspliceWire(api, wireId)}
          onSetLayout={(wireId, layout) => setWireLayout(api, wireId, layout)}
          onToggleFlip={(wireId) => toggleFlip(api, wireId)}
          onMoveNote={(id, x, y) => moveNoteTo(api, id, x, y)}
          onRenameNote={(id, text) => renameNote(api, id, text)}
          onDeleteNote={(id) => deleteNote(api, id)}
          onAlignToGrid={(id) => alignEquipmentToGrid(api, id)}
          onSaveTemplateRequest={doSaveTemplate}
          onInsertTemplate={doInsertTemplate}
        />
        {activeCable && (
          <>
            <div
              className="panel-resize"
              onPointerDown={onPanelResizeStart}
              title="Потяните, чтобы изменить ширину панели"
            />
            <div className="side-panel-wrap" style={{ width: panelW }}>
              <CablePanel
                cable={activeCable}
                wires={project.wires.filter((w) => w.cableId === activeCable.id)}
                project={project}
                onPatch={(patch) => patchCable(api, activeCable.id, patch)}
                onPatchWire={(id, patch) => patchWire(api, id, patch)}
                onSetCoreCount={(n) => setCoreCount(api, activeCable.id, n)}
                onSplit={() => { splitCable(api, activeCable.id); setActiveCableId(null); }}
                onClose={() => setActiveCableId(null)}
              />
            </div>
          </>
        )}
      </div>

      <div className="hint no-print">
        ПКМ по полю — оборудование / источник / заметка / шаблоны • ПКМ по точке — клемма (○) или разъём (▸) • Провод тянется от OUT к IN • ПКМ по проводу — цвет, штриховка, splice • Ctrl+клик — выбор проводов • Delete — удалить • Двойной клик — переименование • Ctrl+Z — отмена
      </div>

      {printMode && (
        <div className="print-root">
          <div className="print-bar no-print">
            <button className="tb-btn primary" onClick={() => window.print()}>Печать / Сохранить PDF</button>
            <button className="tb-btn" onClick={() => setPrintMode(false)}>Закрыть (Esc)</button>
          </div>
          <PrintSheets project={project} />
        </div>
      )}
    </div>
  );

  function snapIf(v: number) {
    return grid ? snapToGrid(v) : v;
  }
}
