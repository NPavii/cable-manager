/** Мост файловых операций: нативные диалоги в Electron, скачивание/загрузка в браузере */

export interface OpenedFile {
  json: string;
  path: string;
}

export interface SaveResult {
  ok: boolean;
  /** путь сохранённого файла (в браузере — имя скачанного файла) */
  path?: string;
}

interface ElectronBridge {
  isElectron: boolean;
  save: (json: string, filePath: string | null) => Promise<{ ok: boolean; filePath?: string }>;
  saveExport: (payload: {
    defaultName: string;
    text?: string;
    base64?: string;
    extName: string;
    ext: string;
  }) => Promise<{ ok: boolean; filePath?: string }>;
  open: () => Promise<OpenedFile | null>;
  onMenu: (cb: (action: string) => void) => void;
  confirmClose: () => void;
  setDirty: (d: boolean) => void;
}

declare global {
  interface Window {
    cableFile?: ElectronBridge;
  }
}

export const isElectron = () => !!window.cableFile?.isElectron;

/** Подписка на команды меню приложения (только Electron) */
export const onMenuAction = (cb: (action: string) => void) => {
  window.cableFile?.onMenu(cb);
};

/** Сохранение: в Electron — диалог «Сохранить как» при filePath=null; в браузере — скачивание */
export async function saveFile(json: string, filePath: string | null, suggestedName: string): Promise<SaveResult> {
  if (isElectron()) {
    const r = await window.cableFile!.save(json, filePath);
    return { ok: !!r.ok, path: r.filePath };
  }
  const blob = new Blob([json], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = suggestedName;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 5000);
  return { ok: true, path: suggestedName };
}

/** Скачивание блоба в браузере */
function downloadBlob(blob: Blob, name: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 5000);
}

/** Сохранение результата экспорта (CSV/SVG/DXF — текст; PNG — бинарный блоб) */
export async function saveExport(
  defaultName: string,
  data: { text: string } | { blob: Blob },
  extName: string,
  ext: string
): Promise<boolean> {
  if (isElectron()) {
    const r = await window.cableFile!.saveExport(
      'text' in data
        ? { defaultName, text: data.text, extName, ext }
        : { defaultName, base64: await blobToBase64(data.blob), extName, ext }
    );
    return !!r.ok;
  }
  if ('text' in data) downloadBlob(new Blob([data.text], { type: 'application/octet-stream' }), defaultName);
  else downloadBlob(data.blob, defaultName);
  return true;
}

const blobToBase64 = (b: Blob) =>
  new Promise<string>((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result).split(',')[1] ?? '');
    r.onerror = reject;
    r.readAsDataURL(b);
  });

/** Открытие: диалог выбора файла (Electron нативный, браузер — input) */
export function openFile(): Promise<OpenedFile | null> {
  if (isElectron()) return window.cableFile!.open();
  return new Promise((resolve) => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = '.cbm,.json,application/json';
    input.style.display = 'none';
    document.body.appendChild(input);
    input.onchange = async () => {
      const f = input.files?.[0];
      input.remove();
      if (!f) return resolve(null);
      resolve({ json: await f.text(), path: f.name });
    };
    input.click();
  });
}
