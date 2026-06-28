import { useRef } from "react";

interface FileDropzoneProps {
  onFile: (file: File) => void;
}

export function FileDropzone({ onFile }: FileDropzoneProps) {
  const inputRef = useRef<HTMLInputElement>(null);

  const handleFiles = (files: FileList | null) => {
    const file = files?.[0];
    if (!file) return;
    if (file.type !== "application/pdf") {
      alert("Please select a PDF file.");
      return;
    }
    onFile(file);
  };

  return (
    <div
      className="dropzone"
      onClick={() => inputRef.current?.click()}
      onDragOver={(e) => e.preventDefault()}
      onDrop={(e) => {
        e.preventDefault();
        handleFiles(e.dataTransfer.files);
      }}
    >
      <p>
        <strong>Click to upload</strong> or drag &amp; drop a PDF contract
      </p>
      <p style={{ color: "#9ca3af", fontSize: 13 }}>PDF only · MVP uses mock extraction</p>
      <input
        ref={inputRef}
        type="file"
        accept="application/pdf"
        hidden
        onChange={(e) => handleFiles(e.target.files)}
      />
    </div>
  );
}
