import { Link } from '@tanstack/react-router'
import { FolderHeartIcon } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { LIBRARY_KIND_LABEL, useMyLibrary } from '@/lib/myLibrary'
import type { LibraryAsset, LibraryKind } from '@/types/gallery'

/** 从「我的素材库」挑一张素材 */
export function LibraryPickerDialog({
  kind,
  open,
  onOpenChange,
  onPick,
}: {
  kind: LibraryKind
  open: boolean
  onOpenChange: (open: boolean) => void
  onPick: (asset: LibraryAsset) => void
}) {
  const assets = useMyLibrary()
  const same = assets.filter((a) => a.kind === kind)
  const others = assets.filter((a) => a.kind !== kind)

  const grid = (list: LibraryAsset[]) => (
    <div className="grid grid-cols-3 gap-2 sm:grid-cols-4">
      {list.map((a) => (
        <button
          key={a.id}
          type="button"
          onClick={() => {
            onPick(a)
            onOpenChange(false)
          }}
          className="group overflow-hidden rounded-xl border bg-muted p-1 text-left transition hover:border-primary focus-visible:outline-2 focus-visible:outline-ring"
        >
          <img src={a.url} alt={a.name} className="aspect-3/4 w-full rounded-lg object-contain" />
          <div className="mt-1 truncate px-0.5 text-[11px] font-medium">{a.name}</div>
          <div className="truncate px-0.5 text-[10px] text-muted-foreground">{LIBRARY_KIND_LABEL[a.kind]}{a.note ? ` · ${a.note}` : ''}</div>
        </button>
      ))}
    </div>
  )

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[88vh] w-[95vw] max-w-2xl overflow-y-auto p-4 sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle className="text-base">从素材库选择{LIBRARY_KIND_LABEL[kind]}</DialogTitle>
          <DialogDescription className="text-xs">
            素材保存在当前浏览器中。在「我的素材库」页可以批量上传、改名和写备注。
          </DialogDescription>
        </DialogHeader>
        {assets.length === 0 ? (
          <div className="flex flex-col items-center gap-3 py-10 text-center text-sm text-muted-foreground">
            <FolderHeartIcon className="size-6" />
            素材库还是空的
            <Button size="sm" variant="outline" asChild onClick={() => onOpenChange(false)}>
              <Link to="/library">去添加素材</Link>
            </Button>
          </div>
        ) : (
          <div className="space-y-4">
            {same.length > 0 ? grid(same) : <p className="text-xs text-muted-foreground">还没有「{LIBRARY_KIND_LABEL[kind]}」类素材，也可以直接用其他类型的素材：</p>}
            {others.length > 0 && (
              <details open={same.length === 0}>
                <summary className="cursor-pointer text-xs font-medium text-muted-foreground">其他类型素材（{others.length}）</summary>
                <div className="mt-2">{grid(others)}</div>
              </details>
            )}
          </div>
        )}
      </DialogContent>
    </Dialog>
  )
}
