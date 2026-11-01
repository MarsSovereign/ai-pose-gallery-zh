import { BrainCircuitIcon, ImageUpIcon, LoaderCircleIcon, StarIcon, XIcon } from 'lucide-react'
import { type ChangeEvent, useRef, useState } from 'react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { type ClipLibrary, type ClipProgress, searchByImage, searchByText } from '@/lib/clipSearch'
import { readImageFile } from '@/lib/myLibrary'
import { cn } from '@/lib/utils'

export interface AiResult {
  /** 结果说明，如「语义：红色连衣裙」 */
  label: string
  /** 按相关度排序的条目 ID */
  ids: string[]
}

/**
 * 图库页通用工具条：AI 语义搜索（文字描述 / 以图搜图）+「只看收藏」开关
 */
export function SmartSearchBar({
  lib,
  aiResult,
  onAiResult,
  onlyFavorites,
  onOnlyFavoritesChange,
  favoriteCount,
}: {
  lib: ClipLibrary
  aiResult: AiResult | null
  onAiResult: (r: AiResult | null) => void
  onlyFavorites: boolean
  onOnlyFavoritesChange: (v: boolean) => void
  favoriteCount: number
}) {
  const [open, setOpen] = useState(false)
  const [text, setText] = useState('')
  const [busy, setBusy] = useState(false)
  const [progress, setProgress] = useState<ClipProgress | null>(null)
  const fileRef = useRef<HTMLInputElement | null>(null)

  const run = async (label: string, fn: (onProgress: (p: ClipProgress) => void) => Promise<Array<{ id: string }>>) => {
    setBusy(true)
    setProgress({ message: '正在搜索…' })
    try {
      const res = await fn(setProgress)
      onAiResult({ label, ids: res.map((x) => x.id) })
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'AI 搜索失败')
    } finally {
      setBusy(false)
      setProgress(null)
    }
  }

  const onText = () => {
    const q = text.trim()
    if (!q) return
    void run(`语义：${q}`, (p) => searchByText(q, lib, 120, p))
  }

  const onImage = async (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    e.target.value = ''
    if (!file) return
    const { url } = await readImageFile(file, 512)
    void run(`以图搜图：${file.name.slice(0, 16)}`, (p) => searchByImage(url, lib, 120, p))
  }

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center gap-2">
        <Button
          type="button"
          variant={open ? 'secondary' : 'outline'}
          size="sm"
          className="h-8 text-xs"
          onClick={() => setOpen((v) => !v)}
        >
          <BrainCircuitIcon className="size-3.5" />
          AI 语义搜索
        </Button>
        <Button
          type="button"
          variant={onlyFavorites ? 'secondary' : 'outline'}
          size="sm"
          className="h-8 text-xs"
          onClick={() => onOnlyFavoritesChange(!onlyFavorites)}
          aria-pressed={onlyFavorites}
        >
          <StarIcon className={cn('size-3.5', onlyFavorites && 'fill-amber-400 text-amber-500')} />
          只看收藏（{favoriteCount}）
        </Button>
        {aiResult && (
          <span className="inline-flex h-8 items-center gap-1 rounded-lg bg-primary/10 px-2.5 text-xs font-medium text-primary">
            {aiResult.label} · 按相关度排序
            <button type="button" aria-label="清除 AI 搜索结果" onClick={() => onAiResult(null)} className="rounded p-0.5 hover:bg-primary/15">
              <XIcon className="size-3.5" />
            </button>
          </span>
        )}
      </div>
      {open && (
        <div className="space-y-2 rounded-xl border bg-background p-3">
          <div className="flex flex-col gap-2 sm:flex-row">
            <Input
              value={text}
              onChange={(e) => setText(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && onText()}
              placeholder={
                lib === 'pose' ? '用一句话描述动作，如：坐在地上抱着膝盖' : lib === 'costume' ? '描述穿搭，如：白色衬衫配牛仔短裤' : '描述人像，如：黑色长直发、齐刘海'
              }
              className="text-sm"
              disabled={busy}
            />
            <div className="flex gap-2">
              <Button type="button" size="sm" className="h-9" onClick={onText} disabled={busy || !text.trim()}>
                {busy ? <LoaderCircleIcon className="size-3.5 animate-spin" /> : <BrainCircuitIcon className="size-3.5" />}
                搜索
              </Button>
              <input ref={fileRef} type="file" accept="image/*" className="hidden" onChange={onImage} />
              <Button type="button" variant="outline" size="sm" className="h-9" onClick={() => fileRef.current?.click()} disabled={busy}>
                <ImageUpIcon className="size-3.5" />
                以图搜图
              </Button>
            </div>
          </div>
          {progress ? (
            <div className="space-y-1">
              <div className="text-xs text-muted-foreground">{progress.message}</div>
              {progress.percent !== undefined && (
                <div className="h-1.5 overflow-hidden rounded-full bg-muted">
                  <div className="h-full rounded-full bg-primary transition-all" style={{ width: `${progress.percent}%` }} />
                </div>
              )}
            </div>
          ) : (
            <p className="text-xs text-muted-foreground">
              基于 Chinese-CLIP 在浏览器本地运行。首次使用需下载约 190 MB 模型（下载源可在「API 接口配置」页切换），之后离线可用。也可在大图预览中点「找相似」。
            </p>
          )}
        </div>
      )}
    </div>
  )
}

/** 按 AI 结果过滤并排序列表 */
export function applyAiOrder<T extends { id: string }>(list: T[], ai: AiResult | null): T[] {
  if (!ai) return list
  const pos = new Map(ai.ids.map((id, i) => [id, i]))
  return list.filter((x) => pos.has(x.id)).sort((a, b) => pos.get(a.id)! - pos.get(b.id)!)
}

export function FavoriteButton({
  active,
  onToggle,
  className,
}: {
  active: boolean
  onToggle: () => void
  className?: string
}) {
  return (
    <button
      type="button"
      aria-label={active ? '取消收藏' : '收藏'}
      aria-pressed={active}
      onClick={(e) => {
        e.stopPropagation()
        onToggle()
      }}
      className={cn(
        'flex size-7 items-center justify-center rounded-full bg-black/60 text-white shadow transition hover:bg-black/80',
        className
      )}
    >
      <StarIcon className={cn('size-3.5', active && 'fill-amber-400 text-amber-400')} />
    </button>
  )
}
