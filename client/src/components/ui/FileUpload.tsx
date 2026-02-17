import { Upload, X, FileText } from 'lucide-react';
import { useRef, useState, DragEvent } from 'react';

interface FileUploadProps {
  onFileSelect: (file: File | null) => void;
  currentFile?: { name: string; path?: string } | null;
  accept?: string;
}

export default function FileUpload({ onFileSelect, currentFile, accept = '.pdf,.jpg,.jpeg,.png,.webp' }: FileUploadProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [dragOver, setDragOver] = useState(false);
  const [selectedFile, setSelectedFile] = useState<File | null>(null);

  const handleFile = (file: File) => {
    setSelectedFile(file);
    onFileSelect(file);
  };

  const handleDrop = (e: DragEvent) => {
    e.preventDefault();
    setDragOver(false);
    const file = e.dataTransfer.files[0];
    if (file) handleFile(file);
  };

  const clear = () => {
    setSelectedFile(null);
    onFileSelect(null);
    if (inputRef.current) inputRef.current.value = '';
  };

  const displayName = selectedFile?.name || currentFile?.name;

  return (
    <div className="space-y-1">
      <div
        onDragOver={e => { e.preventDefault(); setDragOver(true); }}
        onDragLeave={() => setDragOver(false)}
        onDrop={handleDrop}
        onClick={() => inputRef.current?.click()}
        className={`border-2 border-dashed rounded-lg p-6 text-center cursor-pointer transition-colors ${dragOver ? 'border-primary-500 bg-primary-50' : 'border-gray-300 hover:border-gray-400'}`}
      >
        <Upload size={24} className="mx-auto text-gray-400 mb-2" />
        <p className="text-sm text-gray-600">Click or drag file to upload</p>
        <p className="text-xs text-gray-400 mt-1">PDF, JPEG, PNG, WebP (max 10MB)</p>
      </div>
      <input ref={inputRef} type="file" accept={accept} onChange={e => e.target.files?.[0] && handleFile(e.target.files[0])} className="hidden" />
      {displayName && (
        <div className="flex items-center gap-2 p-2 bg-gray-50 rounded-lg">
          <FileText size={16} className="text-gray-400" />
          <span className="text-sm text-gray-700 flex-1 truncate">{displayName}</span>
          <button onClick={clear} className="text-gray-400 hover:text-gray-600"><X size={16} /></button>
        </div>
      )}
    </div>
  );
}
