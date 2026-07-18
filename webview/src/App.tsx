import { useEffect, useMemo, useState } from "react"
import { ChatComposer, type ContextFile } from "@/components/ChatComposer"
import { Badge } from "@/components/ui/badge"
import { closeRpcPeer, getRpcPeer, isHostConnected } from "@/lib/rpc"

type Message = {
  id: string
  role: "user" | "system"
  text: string
  files?: ContextFile[]
}

export default function App() {
  const [connected, setConnected] = useState(false)
  const [messages, setMessages] = useState<Message[]>([
    {
      id: "welcome",
      role: "system",
      text: "Vibe coding on the fly. Host RPC and agent wiring come next.",
    },
  ])

  useEffect(() => {
    setConnected(isHostConnected())
    getRpcPeer()
    return () => {
      closeRpcPeer()
    }
  }, [])

  const statusLabel = useMemo(
    () => (connected ? "Host connected" : "Standalone preview"),
    [connected],
  )

  const handleSubmit = (prompt: string, files: ContextFile[]) => {
    setMessages((prev) => [
      ...prev,
      {
        id: `m-${Date.now()}`,
        role: "user",
        text: prompt || "(files only)",
        files,
      },
    ])
  }

  return (
    <div className="flex h-full min-h-0 flex-col">
      <header className="flex items-center justify-between border-b px-4 py-3">
        <div>
          <h1 className="text-sm font-semibold tracking-tight">Vibe Fly</h1>
          <p className="text-xs text-muted-foreground">
            JetBrains-first vibe coding
          </p>
        </div>
        <Badge variant={connected ? "default" : "secondary"}>
          {statusLabel}
        </Badge>
      </header>

      <main className="min-h-0 flex-1 overflow-y-auto px-4 py-3">
        <ul className="mx-auto flex max-w-2xl flex-col gap-3">
          {messages.map((message) => (
            <li
              key={message.id}
              className={
                message.role === "user"
                  ? "ml-8 rounded-lg border bg-card px-3 py-2 text-sm"
                  : "mr-8 rounded-lg bg-muted/60 px-3 py-2 text-sm text-muted-foreground"
              }
            >
              <p className="whitespace-pre-wrap">{message.text}</p>
              {message.files && message.files.length > 0 && (
                <div className="mt-2 flex flex-wrap gap-1">
                  {message.files.map((file) => (
                    <Badge key={file.id} variant="outline">
                      {file.name}
                    </Badge>
                  ))}
                </div>
              )}
            </li>
          ))}
        </ul>
      </main>

      <footer className="border-t px-4 py-3">
        <div className="mx-auto max-w-2xl">
          <ChatComposer onSubmit={handleSubmit} />
        </div>
      </footer>
    </div>
  )
}
