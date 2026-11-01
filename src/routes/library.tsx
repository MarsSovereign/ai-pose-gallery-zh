import { createFileRoute, useNavigate } from '@tanstack/react-router'
import { FolderHeartIcon, ImagePlusIcon, SparklesIcon, Trash2Icon } from 'lucide-react'
import { type ChangeEvent, type DragEvent, useMemo, useRef, useState } from 'react'
import { toast } from 'sonner'
import { EmptyState } from '@/components/common/EmptyState'
import { PageHeader } from '@/components/common/PageHeader'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import {
  addLibraryFiles,
  applyAssetToRecipe,
  LIBRARY_KIND_LABEL,
  LIBRARY_KINDS,
  removeLibraryAsset,
  updateLibraryAsset,
  useMyLibrary,
} from '@/lib/myLibrary'
import { cn } from '@/lib/utils'
import { useStudio } from '@/store/studioStore'
import type { LibraryKind } from '@/types/gallery'

export const Route = createFileRoute('/library')({
  staticData: { title: '我的素材库' },
  component: LibraryPage,
})

function LibraryPage() {
  const assets = useMyLibrary()
  const { recipe, replaceRecipe } = useStudio()
  const navigate = useNavigate()
  const [kind, setKind] = useState<LibraryKind | 'all'>('all')
  const [uploadKind, setUploadKind] = useState<LibraryKind>('portrait')
  const [busy, setBusy] = useState(false)
  const [dragging, setDragging] = useState(false)
  const inputRef = useRef<HTMLInputElement | null>(null)

  const counts = useMemo(() => {
    const c: Record<string, number> = {}
    for (const a of assets) c[a.kind] = (c[a.kind] || 0) + 1
    return c
  }, [assets])
  const list = kind === 'all' ? assets : assets.filter((a) => a.kind === kind)
  const targetKind = kind === 'all' ? uploadKind : kind

  const upload = async (files: File[]) => {
    if (!files.length) return
    setBusy(true)
    try {
      const added = await addLibraryFiles(targetKind, files)
      toast.success(`已添加 ${added.length} 张${LIBRARY_KIND_LABEL[targetKind]}素材`)
    } catch (e) {
      toast.error(e instanceof Error ? e.message : '添加失败')
    } finally {
      setBusy(false)
    }
  }

  const onInput = (e: ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files || [])
    e.target.value = ''
    void upload(files)
  }

  const onDrop = (e: DragEvent<HTMLDivElement>) => {
    e.preventDefault()
    setDragging(false)
    void upload(Array.from(e.dataTransfer.files || []))
  }

  return (
    <>
      <PageHeader
        title="我的素材库"
        description="保存你自己的角色、服装、姿势、场景、表情、道具，随时放进合成配方。素材只保存在当前浏览器（IndexedDB），不会上传。"
      />

      <div className="flex gap-2 overflow-x-auto pb-1 sm:flex-wrap sm:pb-0">
        {[{ kind: 'all' as const, label: '全部' }, ...LIBRARY_KINDS].map((k) => (
          <button
            key={k.kind}
            type="button"
            onClick={() => setKind(k.kind)}
            className={cn(
              'shrink-0 rounded-full px-3.5 py-1.5 text-sm font-medium transition-colors',
              kind === k.kind ? 'bg-primary text-primary-foreground' : 'bg-muted text-muted-foreground hover:text-foreground'
            )}
          >
            {k.label} ({k.kind === 'all' ? assets.length : counts[k.kind] || 0})
          </button>
        ))}
      </div>

      <div
        onDragOver={(e) => {
          e.preventDefault()
          setDragging(true)
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={onDrop}
        className={cn(
          'flex flex-col gap-3 rounded-[22px] border border-dashed p-4 sm:flex-row sm:items-center sm:justify-between',
          dragging ? 'border-primary bg-primary/5' : 'border-border bg-muted'
        )}
      >
        <div className="text-sm">
          <div className="font-medium">添加{LIBRARY_KIND_LABEL[targetKind]}素材</div>
          <div className="text-xs text-muted-foreground">
            {LIBRARY_KINDS.find((k) => k.kind === targetKind)?.hint}。可多选，或直接把图片拖到这里。
          </div>
        </div>
        <div className="flex items-center gap-2">
          {kind === 'all' && (
            <Select value={uploadKind} onValueChange={(v) => setUploadKind(v as LibraryKind)}>
              <SelectTrigger className="w-28 bg-background">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {LIBRARY_KINDS.map((k) => (
                  <SelectItem key={k.kind} value={k.kind}>
                    {k.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          )}
          <input ref={inputRef} type="file" accept="image/*" multiple className="hidden" onChange={onInput} />
          <Button onClick={() => inputRef.current?.click()} disabled={busy}>
            <ImagePlusIcon className="size-4" />
            {busy ? '处理中…' : '选择图片'}
          </Button>
        </div>
      </div>

      {list.length === 0 ? (
        <EmptyState
          icon={FolderHeartIcon}
          title="这里还没有素材"
          description="上传常用的角色脸、私有服装、场景背景等。合成台每个槽位都可以直接从素材库挑选。"
        />
      ) : (
        <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5">
          {list.map((a) => (
            <div key={a.id} className="flex flex-col gap-2 rounded-[20px] bg-muted p-2">
              <div className="relative aspect-3/4 overflow-hidden rounded-2xl bg-background">
                <img src={a.url} alt={a.name} loading="lazy" className="h-full w-full object-contain" />
                <span className="absolute top-2 left-2 rounded-md bg-black/70 px-1.5 py-0.5 text-[10px] font-bold text-white">
                  {LIBRARY_KIND_LABEL[a.kind]}
                </span>
              </div>
              <Input
                value={a.name}
                onChange={(e) => updateLibraryAsset(a.id, { name: e.target.value })}
                aria-label="素材名称"
                className="h-8 bg-background text-xs"
              />
              <Input
                value={a.note}
                onChange={(e) => updateLibraryAsset(a.id, { note: e.target.value })}
                placeholder="备注（会写进提示词）"
                aria-label="素材备注"
                className="h-8 bg-background text-xs"
              />
              <div className="flex items-center gap-1.5">
                <Select value={a.kind} onValueChange={(v) => updateLibraryAsset(a.id, { kind: v as LibraryKind })}>
                  <SelectTrigger className="h-8 flex-1 bg-background text-xs" aria-label="素材类型">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {LIBRARY_KINDS.map((k) => (
                      <SelectItem key={k.kind} value={k.kind} className="text-xs">
                        {k.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <Button
                  variant="ghost"
                  size="icon"
                  className="size-8"
                  aria-label="删除素材"
                  onClick={() => {
                    removeLibraryAsset(a.id)
                    toast.success('已删除')
                  }}
                >
                  <Trash2Icon className="size-3.5" />
                </Button>
              </div>
              <Button
                size="sm"
                className="h-8 text-xs"
                onClick={() => {
                  replaceRecipe(applyAssetToRecipe(recipe, a))
                  toast.success(`已放入配方的「${LIBRARY_KIND_LABEL[a.kind]}」槽位`, {
                    action: { label: '去合成台', onClick: () => void navigate({ to: '/studio' }) },
                  })
                }}
              >
                <SparklesIcon className="size-3.5" />
                用于配方
              </Button>
            </div>
          ))}
        </div>
      )}
    </>
  )
}
