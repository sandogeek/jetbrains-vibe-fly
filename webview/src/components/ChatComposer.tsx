import { useCallback, useRef, useState, type DragEvent, type FormEvent } from "react"
import { Paperclip, SendHorizontal, X } from "lucide-react"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Textarea } from "@/components/ui/textarea"
import { cn } from "@/lib/utils"

export type ContextFile = {
  id: string
  name: string
  path?: string
  size?: number
}

type ChatComposerProps = {
  disabled?: boolean
  onSubmit: (prompt: string, files: ContextFile[]) => void
}

function fileId(file: File): string {
  return `${file.name}:${file.size}:${file.lastModified}`
}

export function ChatComposer({ disabled, onSubmit }: ChatComposerProps) {
  const [prompt, setPrompt] = useState("")
  const [files, setFiles] = useState<ContextFile[]>([])
  const [dragging, setDragging] = useState(false)
  const fileInputRef = useRef<HTMLInputElement>(null)

  const addFiles = useCallback((incoming: FileList | File[]) => {
    const next = Array.from(incoming).map((file) => ({
      id: fileId(file),
      name: file.name,
      path: (file as File & { path?: string }).path,
      size: file.size,
    }))
    setFiles((prev) => {
      const seen = new Set(prev.map((f) => f.id))
      const merged = [...prev]
      for (const file of next) {
        if (!seen.has(file.id)) {
          seen.add(file.id)
          merged.push(file)
        }
      }
      return merged
    })
  }, [])

  const removeFile = useCallback((id: string) => {
    setFiles((prev) => prev.filter((f) => f.id !== id))
  }, [])

  const handleDrop = useCallback(
    (event: DragEvent<HTMLDivElement>) => {
      event.preventDefault()
      setDragging(false)
      if (event.dataTransfer.files?.length) {
        addFiles(event.dataTransfer.files)
      }
    },
    [addFiles],
  )

  const handleSubmit = (event: FormEvent) => {
    event.preventDefault()
    const text = prompt.trim()
    if (!text && files.length === 0) return
    onSubmit(text, files)
    setPrompt("")
    setFiles([])
  }

  return (
    <div
      className={cn(
        "rounded-xl border bg-card p-3 shadow-sm transition-colors",
        dragging && "border-primary bg-accent/40",
      )}
      onDragEnter={(e) => {
        e.preventDefault()
        setDragging(true)
      }}
      onDragOver={(e) => {
        e.preventDefault()
        setDragging(true)
      }}
      onDragLeave={(e) => {
        e.preventDefault()
        if (e.currentTarget.contains(e.relatedTarget as Node)) return
        setDragging(false)
      }}
      onDrop={handleDrop}
    >
      {files.length > 0 && (
        <div className="mb-2 flex flex-wrap gap-1.5">
          {files.map((file) => (
            <Badge key={file.id} variant="secondary" className="gap-1 pr-1">
              <Paperclip className="size-3" />
              <span className="max-w-40 truncate">{file.name}</span>
              <button
                type="button"
                className="rounded p-0.5 hover:bg-background/60"
                onClick={() => removeFile(file.id)}
                aria-label={`Remove ${file.name}`}
              >
                <X className="size-3" />
              </button>
            </Badge>
          ))}
        </div>
      )}

      <form onSubmit={handleSubmit} className="flex flex-col gap-2">
        <Textarea
          value={prompt}
          onChange={(e) => setPrompt(e.target.value)}
          placeholder="Describe the change… drop files for context"
          disabled={disabled}
          rows={3}
          onKeyDown={(e) => {
            if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
              e.preventDefault()
              handleSubmit(e)
            }
          }}
        />
        <div className="flex items-center justify-between gap-2">
          <div className="flex items-center gap-1">
            <input
              ref={fileInputRef}
              type="file"
              multiple
              className="hidden"
              onChange={(e) => {
                if (e.target.files) addFiles(e.target.files)
                e.target.value = ""
              }}
            />
            <Button
              type="button"
              variant="ghost"
              size="icon"
              disabled={disabled}
              onClick={() => fileInputRef.current?.click()}
              aria-label="Attach files"
            >
              <Paperclip className="size-4" />
            </Button>
            <span className="text-xs text-muted-foreground">
              Drop files to add context
            </span>
          </div>
          <Button
            type="submit"
            size="sm"
            disabled={disabled || (!prompt.trim() && files.length === 0)}
          >
            <SendHorizontal className="size-4" />
            Send
          </Button>
        </div>
      </form>
    </div>
  )
}
