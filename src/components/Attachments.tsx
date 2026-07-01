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

      <div className="rounded-[10px] border border-[var(--line)] bg-[var(--col-bg)] p-2">
        {items.length === 0 ? (
          <p className="text-xs italic text-[var(--sea-ink-soft)]">No attachments yet.</p>
        ) : (
          <ul className="flex flex-col gap-1">
            {items.map((item) => (
              <li key={item.id} className="flex items-center gap-2 text-sm">
                <a
                  href={item.signedUrl}
                  download={item.filename}
                  className="truncate text-[var(--sea-ink)] hover:text-[var(--lagoon-deep)]"
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

      <div>
        <label className="btn btn-ghost cursor-pointer">
          <span>{busy ? 'Uploading…' : 'Choose file'}</span>
          <input
            ref={fileInputRef}
            type="file"
            className="sr-only"
            disabled={busy}
            onChange={handleUpload}
          />
        </label>
      </div>

      {error && <p className="text-xs text-[#b23b3b]">{error}</p>}
    </div>
  )
}
