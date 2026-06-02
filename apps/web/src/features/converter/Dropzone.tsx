import { useRef, useState, type DragEvent } from 'react';

interface Props {
  file: File | null;
  onFile: (f: File | null) => void;
}

export function Dropzone({ file, onFile }: Props) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [over, setOver] = useState(false);

  const onDrop = (e: DragEvent<HTMLDivElement>): void => {
    e.preventDefault();
    setOver(false);
    const f = e.dataTransfer.files?.[0];
    if (f) onFile(f);
  };

  return (
    <div
      onDragOver={(e) => {
        e.preventDefault();
        setOver(true);
      }}
      onDragLeave={() => setOver(false)}
      onDrop={onDrop}
      onClick={() => inputRef.current?.click()}
      className={`cursor-pointer rounded-2xl border-2 border-dashed p-8 text-center transition ${
        over ? 'border-sky-400 bg-sky-400/10' : 'border-zinc-700 bg-zinc-900/40 hover:border-zinc-500'
      }`}
    >
      <input
        ref={inputRef}
        type="file"
        accept=".txt,.json,.zip"
        className="hidden"
        onChange={(e) => onFile(e.target.files?.[0] ?? null)}
      />
      {file ? (
        <div className="text-zinc-200">
          <div className="text-lg font-medium">{file.name}</div>
          <div className="text-sm text-zinc-400">{(file.size / 1024).toFixed(1)} KB — click to replace</div>
        </div>
      ) : (
        <div className="text-zinc-400">
          <div className="text-lg font-medium text-zinc-200">Drop a chat export here</div>
          <div className="text-sm">or click to choose — .txt, .json or .zip</div>
        </div>
      )}
    </div>
  );
}
