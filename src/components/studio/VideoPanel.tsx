import { ClapperboardIcon, DownloadIcon, FileUpIcon, LoaderCircleIcon } from 'lucide-react'
import { type ChangeEvent, useMemo, useRef, useState } from 'react'
import { toast } from 'sonner'
import { Field, Section } from '@/components/common/FormSection'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Switch } from '@/components/ui/switch'
import { Textarea } from '@/components/ui/textarea'
import { characterDna } from '@/lib/characterCard'
import {
  type ComfyVideoResult,
  detectVideoWorkflowNodes,
  generateVideoWithComfy,
  type GenerationProgress,
  parseComfyWorkflowNodes,
} from '@/services/aiGenerator'
import { useStudio } from '@/store/studioStore'

/** 图生视频：把当前生成结果作为首帧，提交到用户自己的 ComfyUI 视频工作流（H3 / Wan 等） */
export function VideoPanel() {
  const { apiConfig, updateVideoParams, previewUrl, recipe } = useStudio()
  const vp = apiConfig.videoParams
  const fileRef = useRef<HTMLInputElement | null>(null)
  const [motion, setMotion] = useState('')
  const [running, setRunning] = useState(false)
  const [progress, setProgress] = useState<GenerationProgress | null>(null)
  const [error, setError] = useState('')
  const [result, setResult] = useState<ComfyVideoResult | null>(null)

  const parsed = useMemo(() => (vp.workflowJson ? parseComfyWorkflowNodes(vp.workflowJson) : null), [vp.workflowJson])
  const dna = characterDna(recipe)
  const defaultMotion = `${dna.zh ? `${dna.zh}。` : ''}人物自然地眨眼并露出微笑，头部轻微转动，头发和衣摆随动作轻轻摆动，镜头缓慢推近，画面稳定，人物外貌和服装保持不变。`
  const finalMotion = motion || defaultMotion

  const onImport = async (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    e.target.value = ''
    if (!file) return
    const text = await file.text()
    const info = parseComfyWorkflowNodes(text)
    if (!info.valid) {
      toast.error(info.error || '工作流 JSON 无效（需要 ComfyUI「导出 (API)」格式）')
      return
    }
    const detected = detectVideoWorkflowNodes(text)
    updateVideoParams({ workflowJson: text, ...detected })
    toast.success(`已导入视频工作流：${info.imageNodes.length} 个图片节点、${info.promptNodes.length} 个提示词节点`)
  }

  const run = async () => {
    if (!previewUrl) return
    setRunning(true)
    setError('')
    setProgress(null)
    try {
      const cfg = apiConfig.providers.comfyui
      const res = await generateVideoWithComfy({
        baseUrl: cfg.baseUrl,
        apiKey: cfg.apiKey,
        workflowJson: vp.workflowJson,
        imageNodeId: vp.imageNodeId,
        promptNodeId: vp.promptNodeId,
        imageSrc: previewUrl,
        prompt: finalMotion,
        timeoutSec: vp.timeoutSec,
        randomizeSeed: vp.randomizeSeed,
        onProgress: setProgress,
      })
      if (result) URL.revokeObjectURL(result.url)
      setResult(res)
      toast.success('视频生成完成')
    } catch (e) {
      const msg = e instanceof Error ? e.message : '视频生成失败'
      setError(msg)
      toast.error(msg.split('\n')[0])
    } finally {
      setRunning(false)
      setProgress(null)
    }
  }

  return (
    <Section
      title="5. 图生视频（本地 ComfyUI）"
      desc="用当前生成结果作首帧，提交到你自己的视频工作流（如 H3、Wan 图生视频），结果直接在这里播放。"
      className="md:grid-cols-2"
      actions={
        <>
          <input ref={fileRef} type="file" accept=".json,application/json" className="hidden" onChange={onImport} />
          <Button variant="outline" size="sm" onClick={() => fileRef.current?.click()}>
            <FileUpIcon className="size-3.5" />
            {vp.workflowJson ? '更换工作流' : '导入视频工作流'}
          </Button>
        </>
      }
    >
      {!vp.workflowJson ? (
        <p className="col-span-full rounded-xl bg-background p-3 text-xs leading-relaxed text-muted-foreground">
          在 ComfyUI 中打开你常用的图生视频工作流 → 菜单「工作流 → 导出 (API)」→ 在这里导入。系统会自动识别首帧 LoadImage 节点和正向提示词节点，输出需要有
          VHS_VideoCombine / SaveVideo 等视频保存节点。ComfyUI 地址与「本地 ComfyUI」接口配置共用。
        </p>
      ) : (
        <>
          <Field label="首帧图片节点 (LoadImage)">
            <Select value={vp.imageNodeId} onValueChange={(v) => updateVideoParams({ imageNodeId: v })}>
              <SelectTrigger className="w-full text-xs">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="none">未选择</SelectItem>
                {parsed?.imageNodes.map((n) => (
                  <SelectItem key={n.id} value={n.id} className="text-xs">
                    #{n.id} {n.title}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Field>
          <Field label="运动提示词节点">
            <Select value={vp.promptNodeId} onValueChange={(v) => updateVideoParams({ promptNodeId: v })}>
              <SelectTrigger className="w-full text-xs">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="none">保留工作流原提示词</SelectItem>
                {parsed?.promptNodes.map((n) => (
                  <SelectItem key={n.id} value={n.id} className="text-xs">
                    #{n.id} {n.title} ({n.field})
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Field>
          <Field label="最长等待时间（秒）">
            <Input
              type="number"
              min={60}
              step={60}
              value={vp.timeoutSec}
              onChange={(e) => updateVideoParams({ timeoutSec: Math.max(60, Number(e.target.value) || 1800) })}
              className="text-xs"
            />
          </Field>
          <Field label="随机种子">
            <div className="flex h-9 items-center justify-between rounded-xl border bg-background px-3">
              <span className="text-xs text-muted-foreground">{vp.randomizeSeed ? '每次随机' : '固定工作流种子'}</span>
              <Switch checked={vp.randomizeSeed} onCheckedChange={(v) => updateVideoParams({ randomizeSeed: v })} />
            </div>
          </Field>
          <div className="col-span-full space-y-2">
            <Field label="运动提示词（默认已带上角色 DNA，可修改）">
              <Textarea value={finalMotion} onChange={(e) => setMotion(e.target.value)} rows={3} className="text-xs leading-relaxed" />
            </Field>
            <Button className="w-full" disabled={running || !previewUrl || vp.imageNodeId === 'none'} onClick={() => void run()}>
              {running ? <LoaderCircleIcon className="size-4 animate-spin" /> : <ClapperboardIcon className="size-4" />}
              {previewUrl ? (running ? '视频生成中…' : '用当前结果生成视频') : '先生成一张角色图'}
            </Button>
            {progress && (
              <div className="space-y-1">
                <div className="text-xs text-muted-foreground">{progress.message}</div>
                {progress.percent !== undefined && (
                  <div className="h-1.5 overflow-hidden rounded-full bg-muted">
                    <div className="h-full rounded-full bg-primary transition-all" style={{ width: `${progress.percent}%` }} />
                  </div>
                )}
              </div>
            )}
            {error && <p className="whitespace-pre-wrap break-all text-xs text-destructive">{error}</p>}
            {result && (
              <div className="space-y-1.5">
                {result.isVideo ? (
                  <video src={result.url} controls loop autoPlay muted playsInline className="max-h-[520px] w-full rounded-lg bg-black" />
                ) : (
                  <img src={result.url} alt="生成的动图" className="max-h-[520px] w-full rounded-lg object-contain" />
                )}
                <Button size="sm" variant="outline" asChild>
                  <a href={result.url} download={result.filename}>
                    <DownloadIcon className="size-3.5" />
                    下载 {result.filename}
                  </a>
                </Button>
              </div>
            )}
          </div>
        </>
      )}
    </Section>
  )
}
