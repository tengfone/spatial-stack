import { FileUp, Loader2, X } from "lucide-react";

import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

type FileDropzoneProps = {
  file: File | null;
  isLoading: boolean;
  onFileChange: (file: File | null) => void;
  onAnalyze: () => void;
};

export function FileDropzone({ file, isLoading, onAnalyze, onFileChange }: FileDropzoneProps) {
  const chooseFile = (nextFile?: File | null) => {
    if (!nextFile) return;
    onFileChange(nextFile);
  };

  return (
    <div className="flex items-center gap-1.5">
      {file ? (
        <>
          <span className="max-w-[160px] truncate text-xs font-medium text-foreground" title={file.name}>
            {file.name}
          </span>
          <span className="mono-data text-[0.625rem] text-muted-foreground">
            {Math.max(1, Math.round(file.size / 1024)).toLocaleString()} KB
          </span>
          <button
            type="button"
            className="rounded p-0.5 text-muted-foreground transition-colors duration-150 hover:text-foreground"
            onClick={() => {
              onFileChange(null);
            }}
            disabled={isLoading}
            aria-label="Clear selected floor plan"
          >
            <X className="h-3 w-3" />
          </button>
          <Button type="button" size="sm" onClick={onAnalyze} disabled={isLoading} className="ml-0.5 h-6 px-2 text-[0.6875rem]">
            {isLoading ? <Loader2 className="h-3 w-3 animate-spin" /> : null}
            {isLoading ? "Analyzing" : "Analyze"}
          </Button>
        </>
      ) : (
        <label
          className={cn(
            "relative inline-flex h-6 cursor-pointer items-center justify-center gap-1.5 overflow-hidden rounded px-2 text-xs font-semibold text-foreground transition-colors duration-150 hover:bg-secondary focus-within:outline-none focus-within:ring-2 focus-within:ring-ring",
            isLoading && "pointer-events-none opacity-55",
          )}
        >
          <input
            className="absolute inset-0 h-full w-full cursor-pointer opacity-0"
            type="file"
            accept="image/png,image/jpeg,application/pdf"
            onChange={(event) => {
              chooseFile(event.target.files?.item(0));
              event.currentTarget.value = "";
            }}
            disabled={isLoading}
            aria-label="Upload floor plan"
          />
          <FileUp className="h-3 w-3" />
          Upload floor plan
        </label>
      )}
    </div>
  );
}
