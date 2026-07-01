import { useEffect, useRef, useState } from 'react'
import { FileText, Upload } from 'lucide-react'
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
    <div className="flex flex-col gap-3.5">
      <p className="display-title text-[15px] font-bold text-[var(--ink)]">Attachments</p>

      {items.length === 0 ? (
        <p className="text-[13px] text-[var(--ink3)]">No files attached.</p>
      ) : (
        <ul className="flex flex-col gap-2">
          {items.map((item) => (
            <li key={item.id}>
              <a
                href={item.signedUrl}
                download={item.filename}
                className="flex items-center gap-2.5 rounded-[12px] bg-[var(--col)] px-3 py-2.5 no-underline"
              >
                <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-[9px] border border-[var(--line)] bg-[var(--card)] text-[var(--accent-ink)]">
                  <FileText size={15} aria-hidden="true" />
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-[13px] font-semibold text-[var(--accent-ink)] underline">
                    {item.filename}
                  </span>
                  <span className="block text-[11px] text-[var(--ink3)]">
                    {new Date(item.created_at).toLocaleDateString()}
                  </span>
                </span>
              </a>
            </li>
          ))}
        </ul>
      )}

      <div>
        <label className="inline-flex cursor-pointer items-center gap-2 rounded-full border border-[var(--line)] bg-[var(--card)] px-4 py-2.5 text-[13px] font-semibold text-[var(--ink)] transition hover:border-[var(--accent)]">
          <Upload size={15} aria-hidden="true" />
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

      {error && <p className="text-xs text-[var(--danger)]">{error}</p>}
    </div>
  )
}
