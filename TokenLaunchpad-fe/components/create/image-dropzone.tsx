"use client";

import { UI } from "@vezta/shared";
import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { ImageIcon } from "./icons";

const ACCEPT = "image/png,image/jpeg,image/webp";

/** A size the way a person reads it: 512 B, 2.0 KB, 1.5 MB. */
function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

/**
 * Where the logo is chosen: a dashed area to drop an image on, or a button that opens the file dialog. The real file input is still
 * there (out of sight, and labelled by the form) so a keyboard, a screen reader and the browser's own dialog work as ever. Once there is a
 * logo it shows it, with its name and size, and offers to replace or remove it. The file is only shown here, never sent: checking it and
 * sending it is the form's job.
 */
export function ImageDropzone({ id, file, onChange, error }: { id: string; file: File | undefined; onChange: (file: File | undefined) => void; error?: string }) {
  const input = useRef<HTMLInputElement>(null);
  const [dragging, setDragging] = useState(false);
  const [preview, setPreview] = useState<string>();

  // A preview is a URL the browser keeps a copy behind: one is made for each logo, and let go of when the logo changes or the form goes.
  useEffect(() => {
    if (!file) {
      setPreview(undefined);
      return;
    }
    const url = URL.createObjectURL(file);
    setPreview(url);
    return () => URL.revokeObjectURL(url);
  }, [file]);

  function choose() {
    input.current?.click();
  }

  function remove() {
    if (input.current) input.current.value = ""; // or choosing the same file again would not be noticed
    onChange(undefined);
  }

  return (
    <div className="flex flex-col gap-2">
      <div
        data-testid="dropzone"
        data-dragging={dragging ? "true" : undefined}
        data-invalid={error ? "true" : undefined}
        onDragOver={(e) => {
          e.preventDefault(); // or the browser opens a dropped file in the tab
          setDragging(true);
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={(e) => {
          e.preventDefault();
          setDragging(false);
          const dropped = e.dataTransfer?.files?.[0];
          if (dropped) onChange(dropped);
        }}
        className={cn(
          "flex min-h-56 flex-col items-center justify-center gap-3 rounded-lg border-2 border-dashed px-4 py-8 text-center transition-colors",
          error ? "border-destructive" : dragging ? "border-primary bg-primary/10" : "border-border bg-card/40",
        )}
      >
        <input ref={input} id={id} type="file" accept={ACCEPT} className="sr-only" aria-invalid={error ? true : undefined} onChange={(e) => onChange(e.target.files?.[0])} />
        {file ? (
          <>
            {preview && <img src={preview} alt={UI.create.image.previewAlt} className="size-28 rounded-lg border border-border object-cover" />}
            <div className="flex flex-col gap-0.5">
              <span className="max-w-64 truncate text-sm font-semibold" title={file.name}>
                {file.name}
              </span>
              <span className="font-mono text-xs text-muted-foreground">{formatBytes(file.size)}</span>
            </div>
            <div className="flex gap-2">
              <Button type="button" size="sm" onClick={choose}>
                {UI.create.image.replace}
              </Button>
              <Button type="button" size="sm" variant="outline" onClick={remove}>
                {UI.create.image.remove}
              </Button>
            </div>
          </>
        ) : (
          <>
            <ImageIcon className="size-12 text-muted-foreground" />
            <div className="flex flex-col gap-0.5">
              <span className="text-base font-semibold">{UI.create.image.title}</span>
              <span className="text-sm text-muted-foreground">{UI.create.image.drop}</span>
            </div>
            <Button type="button" onClick={choose}>
              {UI.create.image.select}
            </Button>
          </>
        )}
      </div>
      <p className="text-xs text-muted-foreground">{UI.create.fields.imageHint}</p>
      {error && <p className="text-xs text-destructive">{error}</p>}
    </div>
  );
}
