import { ImagePlusIcon, MountainSnowIcon, PackageIcon, SmileIcon, XIcon } from 'lucide-react'
import { type ChangeEvent, useRef, useState } from 'react'
import { toast } from 'sonner'
import { LibraryPickerDialog } from '@/components/studio/LibraryPickerDialog'
import { Button } from '@/components/ui/button'
import { addLibraryFiles } from '@/lib/myLibrary'
import { useStudio } from '@/store/studioStore'
import type { ExtraSlotKind } from '@/types/gallery'

const SLOTS: Array<{ kind: ExtraSlotKind; label: string; icon: typeof SmileIcon }> = [
  { kind: 'scene', label: '场景', icon: MountainSnowIcon },
  { kind: 'expression', label: '表情', icon: SmileIcon },
  { kind: 'prop', label: '道具', icon: PackageIcon },
]

/** 场景 / 表情 / 道具 三个扩展槽位：从素材库挑选，或上传（上传的图片同时存入素材库） */
export function ExtraSlots() {
  const { recipe, setSlotAsset } = useStudio()
  const [picker, setPicker] = useState<ExtraSlotKind | null>(null)
  const [busy, setBusy] = useState<ExtraSlotKind | null>(null)
  const inputRef = useRef<HTMLInputElement | null>(null)
  const uploadKind = useRef<ExtraSlotKind>('scene')

  const onUpload = async (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    e.target.value = ''
    if (!file) return
    const kind = uploadKind.current
    setBusy(kind)
    try {
      const [asset] = await addLibraryFiles(kind, [file])
      if (asset) {
        setSlotAsset(kind, { id: asset.id, name: asset.name, note: asset.note, url: asset.url })
        toast.success('已放入槽位，并保存到「我的素材库」')
      }
    } catch (err) {
      toast.error(err instanceof Error ? err.message : '图片读取失败')
    } finally {
      setBusy(null)
    }
  }

  return (
    <>
      <input ref={inputRef} type="file" accept="image/*" className="hidden" onChange={onUpload} />
      <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
        {SLOTS.map(({ kind, label, icon: Icon }) => {
          const ref = recipe[kind]
          return (
            <div key={kind} className="flex min-w-0 items-center gap-2 rounded-xl bg-background p-2">
              {ref ? (
                <>
                  <img src={ref.url} alt={ref.name} className="h-11 w-9 shrink-0 rounded-lg object-cover" />
                  <div className="min-w-0 flex-1">
                    <div className="text-xs text-muted-foreground">{label}</div>
                    <div className="truncate text-xs font-medium" title={ref.note || ref.name}>
                      {ref.name}
                    </div>
                  </div>
                  <button
                    type="button"
                    aria-label={`清除${label}参考图`}
                    onClick={() => setSlotAsset(kind, null)}
                    className="flex size-11 shrink-0 items-center justify-center rounded-full text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
                  >
                    <XIcon className="size-3.5" />
                  </button>
                </>
              ) : (
                <>
                  <button
                    type="button"
                    onClick={() => setPicker(kind)}
                    className="flex min-h-11 min-w-0 flex-1 items-center gap-2 rounded-lg text-left text-muted-foreground hover:text-foreground"
                  >
                    <div className="flex h-10 w-8 shrink-0 items-center justify-center rounded-lg bg-muted">
                      <Icon className="size-4" />
                    </div>
                    <span className="truncate text-xs">+ {label}（可选）</span>
                  </button>
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    aria-label={`上传${label}参考图`}
                    disabled={busy !== null}
                    className="h-11 shrink-0 border-l px-2 text-xs"
                    onClick={() => {
                      uploadKind.current = kind
                      inputRef.current?.click()
                    }}
                  >
                    <ImagePlusIcon className="size-3.5" />
                    {busy === kind ? '处理中' : '上传'}
                  </Button>
                </>
              )}
            </div>
          )
        })}
      </div>
      {picker && (
        <LibraryPickerDialog
          kind={picker}
          open
          onOpenChange={(o) => !o && setPicker(null)}
          onPick={(a) => setSlotAsset(picker, { id: a.id, name: a.name, note: a.note, url: a.url })}
        />
      )}
    </>
  )
}
