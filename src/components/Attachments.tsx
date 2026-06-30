import { useEffect, useRef, useState } from 'react'
import { getBrowserSupabase } from '#/lib/supabase/browser'
import { uploadAttachment, type Attachment } from '#/lib/attachments'

interface AttachmentItem extends Attachment {
  signedUrl: string
}

interface AttachmentsProps {
  cardId: string
  boardId: string
}

export default function Attachments({ cardId, boardId }: AttachmentsProps) {
  const [items, setItems] = useState<AttachmentItem[]>([])
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    let active = true
    const supabase = getBrowserSupabase()

    async function load() {
      const { data, error: fetchError } = await supabase
        .from('attachments')
        .select('*')
        .eq('card_id', cardId)
        .order('created_at')

      if (fetchError || !active) return

      const rows = (data ?? []) as Attachment[]
      // Generate signed URLs in parallel (1 hr TTL).
      const withUrls = await Promise.all(
        rows.map(async (row) => {
          const { data: urlData } = await supabase.storage
            .from('card-files')
            .createSignedUrl(row.path, 3600)
          return { ...row, signedUrl: urlData?.signedUrl ?? '' }
        }),
      )
      if (active) setItems(withUrls)
    }

    load()
    return () => {
      active = false
    }
  }, [cardId])

  async function handleUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (!file) return
    setBusy(true)
    setError(null)
    try {
      const supabase = getBrowserSupabase()
      const row = await uploadAttachment(supabase, boardId, cardId, file)
      // Generate signed URL for the newly uploaded file.
      const { data: urlData } = await supabase.storage
        .from('card-files')
        .createSignedUrl(row.path, 3600)
      setItems((prev) => [...prev, { ...row, signedUrl: urlData?.signedUrl ?? '' }])
    } catch {
      setError('Upload failed. Please try again.')
    } finally {
      setBusy(false)
      // Reset input so the same file can be re-selected if needed.
      if (fileInputRef.current) fileInputRef.current.value = ''
    }
  }

  return (
    <div className="flex flex-col gap-2">
      <p className="text-xs font-semibold text-[var(--sea-ink-soft)]">Attachments</p>

      <div className="rounded-lg border border-[rgba(23,58,64,0.2)] p-2">
        {items.length === 0 ? (
          <p className="text-xs italic text-[var(--sea-ink-soft)]">No attachments yet.</p>
        ) : (
          <ul className="flex flex-col gap-1">
            {items.map((item) => (
              <li key={item.id} className="flex items-center gap-2 text-sm">
                <a
                  href={item.signedUrl}
                  download={item.filename}
                  className="truncate text-[var(--sea-ink)] underline hover:text-[var(--lagoon-deep)]"
                >
                  {item.filename}
                </a>
                <span className="shrink-0 text-[10px] text-[var(--sea-ink-soft)]">
                  {new Date(item.created_at).toLocaleDateString()}
                </span>
              </li>
            ))}
          </ul>
        )}
      </div>

      <div className="flex items-center gap-2">
        <label className="flex cursor-pointer items-center gap-2 rounded-lg border border-[rgba(23,58,64,0.2)] px-3 py-2 text-sm text-[var(--sea-ink)] transition-colors hover:bg-[rgba(23,58,64,0.05)]">
          <span>{busy ? 'Uploading…' : 'Choose file'}</span>
          <input
            ref={fileInputRef}
            type="file"
            className="sr-only"
            disabled={busy}
            onChange={handleUpload}
          />
        </label>
        {busy && (
          <span className="text-xs text-[var(--sea-ink-soft)]">Uploading…</span>
        )}
      </div>

      {error && <p className="text-xs text-red-600">{error}</p>}
    </div>
  )
}
