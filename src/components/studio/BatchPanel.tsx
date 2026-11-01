import { useQuery } from '@tanstack/react-query'
import {
  DownloadIcon,
  FileArchiveIcon,
  FileUpIcon,
  GalleryHorizontalEndIcon,
  LayersIcon,
  LoaderCircleIcon,
  ShuffleIcon,
  SquareIcon,
} from 'lucide-react'
import { type ChangeEvent, useMemo, useRef, useState } from 'react'
import { toast } from 'sonner'
import { costumesQuery, isNsfwPose, portraitsQuery, posesQuery } from '@/api/gallery'
import { Field, Section } from '@/components/common/FormSection'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Textarea } from '@/components/ui/textarea'
import { buildCharacterCard, importCharacterCard } from '@/lib/characterCard'
import { composeCharacterSheet } from '@/lib/characterSheet'
import { useFavorites } from '@/lib/favorites'
import { downloadBlob } from '@/lib/zip'
import { buildRecipePrompt } from '@/services/aiGenerator'
import { type BatchJob, promptOptionsFor, useStudio } from '@/store/studioStore'
import type { PoseItem } from '@/types/gallery'

type Scope = 'category' | 'system' | 'favorites' | 'all'
type AngleMode = 'same' | '正面' | 'any'

function sample<T>(list: T[], n: number): T[] {
  const copy = [...list]
  for (let i = copy.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1))
    ;[copy[i], copy[j]] = [copy[j], copy[i]]
  }
  return copy.slice(0, n)
}

/** 批量出图（多视角设定图 / 同角色换姿势）+ 人物卡导出导入 */
export function BatchPanel() {
  const {
    recipe,
    apiConfig,
    batch,
    runBatch,
    cancelBatch,
    clearBatch,
    isGenerating,
    safeMode,
    previewUrl,
    setPreviewUrl,
    addHistory,
    replaceRecipe,
    customPrompt,
  } = useStudio()
  const { data: poses } = useQuery(posesQuery)
  const { data: costumes } = useQuery(costumesQuery)
  const { data: portraits } = useQuery(portraitsQuery)
  const favPoses = useFavorites('pose')

  const [scope, setScope] = useState<Scope>('category')
  const [angleMode, setAngleMode] = useState<AngleMode>('same')
  const [count, setCount] = useState('8')
  const [sheetUrl, setSheetUrl] = useState('')
  const [composing, setComposing] = useState(false)
  const [cardName, setCardName] = useState('')
  const [cardDesc, setCardDesc] = useState('')
  const [exporting, setExporting] = useState(false)
  const importRef = useRef<HTMLInputElement | null>(null)

  const characterName = cardName.trim() || '我的角色'

  const poseGroup = useMemo(() => {
    if (!poses || !recipe.pose || recipe.pose.source === 'upload') return null
    return poses.groups.find((g) => g.system === recipe.pose!.体系 && g.number === recipe.pose!.姿势编号) ?? null
  }, [poses, recipe.pose])

  const posePool = useMemo((): PoseItem[] => {
    if (!poses) return []
    let pool = safeMode ? poses.items.filter((p) => !isNsfwPose(p)) : poses.items
    const cur = recipe.pose && recipe.pose.source !== 'upload' ? recipe.pose : null
    if (scope === 'category' && cur) pool = pool.filter((p) => p.体系 === cur.体系 && p.分类 === cur.分类)
    if (scope === 'system' && cur) pool = pool.filter((p) => p.体系 === cur.体系)
    if (scope === 'favorites') pool = pool.filter((p) => favPoses.has(p.id))
    if (angleMode === 'same' && cur?.角度) pool = pool.filter((p) => p.角度 === cur.角度)
    if (angleMode === '正面') pool = pool.filter((p) => p.角度 === '正面')
    return pool.filter((p) => !cur || p.姿势编号 !== cur.姿势编号 || p.体系 !== cur.体系)
  }, [poses, safeMode, scope, angleMode, recipe.pose, favPoses])

  const hasCharacter = Boolean(recipe.portrait || recipe.costume)

  const makeSheet = async (items: Array<{ label: string; imageUrl: string }>, title: string) => {
    setComposing(true)
    try {
      const url = await composeCharacterSheet(items, {
        title,
        subtitle: [recipe.portrait?.标题, recipe.costume?.服装名称].filter(Boolean).join(' · '),
      })
      setSheetUrl(url)
      setPreviewUrl(url)
      addHistory({
        provider: apiConfig.activeProvider,
        model: '角色设定图',
        prompt: '',
        imageUrl: url,
        recipeSummary: `[设定图] ${title}`,
        kind: 'sheet',
      })
      return url
    } catch (e) {
      toast.error(e instanceof Error ? e.message : '拼接设定图失败')
      return ''
    } finally {
      setComposing(false)
    }
  }

  const runTurnaround = async () => {
    if (!poseGroup) return
    const jobs: BatchJob[] = poseGroup.order.map((it) => ({ label: it.角度, recipe: { ...recipe, pose: it } }))
    setSheetUrl('')
    const results = await runBatch(`多视角设定图 · ${poseGroup.name}`, jobs)
    if (results.length >= 2) await makeSheet(results, `${characterName} · 多视角设定`)
  }

  const runPoseBatch = async () => {
    const picked = sample(posePool, Number(count))
    if (!picked.length) {
      toast.error('当前筛选条件下没有可用的姿势')
      return
    }
    setSheetUrl('')
    await runBatch(
      '批量换姿势',
      picked.map((it) => ({ label: `${it.姿势名称}（${it.角度}）`, recipe: { ...recipe, pose: it } }))
    )
  }

  const exportCard = async () => {
    setExporting(true)
    try {
      const outputs = batch?.results.length
        ? [
            ...(sheetUrl ? [{ label: '设定图', imageUrl: sheetUrl }] : []),
            ...batch.results.map((r) => ({ label: r.label, imageUrl: r.imageUrl, prompt: r.prompt })),
          ]
        : previewUrl
          ? [{ label: '角色图', imageUrl: previewUrl }]
          : []
      const blob = await buildCharacterCard({
        name: characterName,
        description: cardDesc.trim(),
        recipe,
        prompt: customPrompt ?? buildRecipePrompt(recipe, apiConfig.stylePreset, promptOptionsFor(apiConfig)),
        stylePreset: apiConfig.stylePreset,
        customStyles: apiConfig.customStyles,
        outputs,
      })
      downloadBlob(blob, `人物卡_${characterName.replace(/[\\/:*?"<>|\s]+/g, '_')}.zip`)
      toast.success(`已导出人物卡（${outputs.length} 张生成图）`)
    } catch (e) {
      toast.error(e instanceof Error ? e.message : '导出人物卡失败')
    } finally {
      setExporting(false)
    }
  }

  const onImportCard = async (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    e.target.value = ''
    if (!file) return
    try {
      const { meta, recipe: next, outputs } = await importCharacterCard(file, {
        portraits: portraits ?? [],
        costumes: costumes ?? [],
        poses: poses?.items ?? [],
      })
      replaceRecipe(next)
      setCardName(meta.name)
      setCardDesc(meta.description)
      if (outputs[0]) setPreviewUrl(outputs[0].imageUrl)
      toast.success(`已导入人物卡「${meta.name}」`)
    } catch (err) {
      toast.error(err instanceof Error ? err.message : '导入失败')
    }
  }

  const running = Boolean(batch?.running)

  return (
    <Section
      title="4. 批量出图 · 角色设定 · 人物卡"
      className="md:grid-cols-1"
      actions={
        <div className="flex items-center gap-1.5">
          <input ref={importRef} type="file" accept=".zip,application/zip" className="hidden" onChange={onImportCard} />
          <Button variant="outline" size="sm" onClick={() => importRef.current?.click()} disabled={running}>
            <FileUpIcon className="size-3.5" />
            导入人物卡
          </Button>
        </div>
      }
    >
      <div className="grid gap-3 md:grid-cols-2">
        <div className="space-y-2 rounded-xl bg-background p-3">
          <div className="flex items-center gap-1.5 text-sm font-medium">
            <LayersIcon className="size-4" />
            多视角设定图
          </div>
          <p className="text-xs text-muted-foreground">
            锁定当前人像和服装，把所选姿势的全部视角（正面 / 俯视 / 仰视 / 侧面 / 斜侧）各生成一张，再拼成一张角色设定图。
          </p>
          <Button
            size="sm"
            className="w-full"
            disabled={!poseGroup || !hasCharacter || isGenerating}
            onClick={() => void runTurnaround()}
          >
            <GalleryHorizontalEndIcon className="size-3.5" />
            {poseGroup ? `生成 ${poseGroup.order.length} 个视角` : '先从姿势库选一个姿势'}
          </Button>
        </div>

        <div className="space-y-2 rounded-xl bg-background p-3">
          <div className="flex items-center gap-1.5 text-sm font-medium">
            <ShuffleIcon className="size-4" />
            同一角色批量换姿势
          </div>
          <div className="grid grid-cols-3 gap-1.5">
            <Select value={scope} onValueChange={(v) => setScope(v as Scope)}>
              <SelectTrigger className="h-8 w-full text-xs" aria-label="姿势范围">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="category" className="text-xs">同动作分类</SelectItem>
                <SelectItem value="system" className="text-xs">同体系</SelectItem>
                <SelectItem value="favorites" className="text-xs">我收藏的姿势</SelectItem>
                <SelectItem value="all" className="text-xs">全部姿势</SelectItem>
              </SelectContent>
            </Select>
            <Select value={angleMode} onValueChange={(v) => setAngleMode(v as AngleMode)}>
              <SelectTrigger className="h-8 w-full text-xs" aria-label="视角">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="same" className="text-xs">同视角</SelectItem>
                <SelectItem value="正面" className="text-xs">只要正面</SelectItem>
                <SelectItem value="any" className="text-xs">任意视角</SelectItem>
              </SelectContent>
            </Select>
            <Select value={count} onValueChange={setCount}>
              <SelectTrigger className="h-8 w-full text-xs" aria-label="数量">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {['4', '8', '12', '20', '40'].map((n) => (
                  <SelectItem key={n} value={n} className="text-xs">
                    {n} 张
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <Button
            size="sm"
            variant="secondary"
            className="w-full"
            disabled={!hasCharacter || isGenerating || posePool.length === 0}
            onClick={() => void runPoseBatch()}
          >
            <ShuffleIcon className="size-3.5" />
            随机抽 {Math.min(Number(count), posePool.length)} 个姿势批量生成（可选 {posePool.length}）
          </Button>
          <p className="text-[11px] text-muted-foreground">适合做角色 LoRA 训练集或短剧多镜头素材。逐张串行生成，可随时停止。</p>
        </div>
      </div>

      {batch && (
        <div className="space-y-2 rounded-xl bg-background p-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="text-sm font-medium">
              {batch.title}：{batch.done}/{batch.total}
              {batch.running && batch.current ? <span className="text-muted-foreground"> · 正在生成「{batch.current}」</span> : null}
            </div>
            <div className="flex gap-1.5">
              {running ? (
                <Button size="sm" variant="outline" onClick={cancelBatch}>
                  <SquareIcon className="size-3.5" />
                  停止
                </Button>
              ) : (
                <>
                  {batch.results.length >= 2 && (
                    <Button
                      size="sm"
                      variant="outline"
                      disabled={composing}
                      onClick={() => void makeSheet(batch.results, `${characterName} · ${batch.title}`)}
                    >
                      {composing ? <LoaderCircleIcon className="size-3.5 animate-spin" /> : <LayersIcon className="size-3.5" />}
                      拼成设定图
                    </Button>
                  )}
                  <Button size="sm" variant="ghost" onClick={clearBatch}>
                    清除
                  </Button>
                </>
              )}
            </div>
          </div>
          <div className="h-1.5 overflow-hidden rounded-full bg-muted">
            <div className="h-full rounded-full bg-primary transition-all" style={{ width: `${(batch.done / Math.max(1, batch.total)) * 100}%` }} />
          </div>
          {batch.results.length > 0 && (
            <div className="grid grid-cols-3 gap-2 sm:grid-cols-5">
              {batch.results.map((r, i) => (
                <a key={i} href={r.imageUrl} download={`batch-${i + 1}.png`} className="group relative overflow-hidden rounded-lg bg-muted" title={`下载：${r.label}`}>
                  <img src={r.imageUrl} alt={r.label} className="aspect-3/4 w-full object-cover" />
                  <span className="absolute inset-x-0 bottom-0 truncate bg-black/65 px-1 py-0.5 text-[10px] text-white">{r.label}</span>
                </a>
              ))}
            </div>
          )}
          {batch.errors.length > 0 && (
            <details className="text-xs text-destructive">
              <summary className="cursor-pointer">失败 {batch.errors.length} 张</summary>
              {batch.errors.map((e, i) => (
                <div key={i} className="break-all">• {e}</div>
              ))}
            </details>
          )}
          {sheetUrl && (
            <div className="space-y-1.5">
              <img src={sheetUrl} alt="角色设定图" className="w-full rounded-lg border" />
              <Button size="sm" variant="outline" asChild>
                <a href={sheetUrl} download={`设定图_${characterName}.jpg`}>
                  <DownloadIcon className="size-3.5" />
                  下载设定图
                </a>
              </Button>
            </div>
          )}
        </div>
      )}

      <div className="grid gap-3 rounded-xl bg-background p-3 md:grid-cols-[1fr_1.4fr_auto] md:items-end">
        <Field label="人物卡名称">
          <Input value={cardName} onChange={(e) => setCardName(e.target.value)} placeholder={characterName} className="text-xs" />
        </Field>
        <Field label="角色说明（可选）">
          <Textarea
            value={cardDesc}
            onChange={(e) => setCardDesc(e.target.value)}
            rows={1}
            placeholder="身份、性格、在剧中的定位…"
            className="min-h-9 text-xs"
          />
        </Field>
        <Button onClick={() => void exportCard()} disabled={exporting || running || (!hasCharacter && !previewUrl)}>
          {exporting ? <LoaderCircleIcon className="size-4 animate-spin" /> : <FileArchiveIcon className="size-4" />}
          导出人物卡 ZIP
        </Button>
        <p className="text-[11px] text-muted-foreground md:col-span-3">
          人物卡包含：参考图、生成结果（有批量结果时导出全部，否则导出当前结果）、设定图、角色 DNA 中英描述、合成提示词（character.json + 人物卡.md）。可交给短剧 / 数字人 / 图生视频流程使用，也能再导入回来。
        </p>
      </div>
    </Section>
  )
}
