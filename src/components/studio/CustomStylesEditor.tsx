import { PlusIcon, Trash2Icon } from 'lucide-react'
import { useState } from 'react'
import { toast } from 'sonner'
import { Field, Section } from '@/components/common/FormSection'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Textarea } from '@/components/ui/textarea'
import { getHfHost, HF_HOSTS, setHfHost } from '@/lib/clipSearch'
import { STYLE_PRESETS } from '@/services/aiGenerator'
import { useStudio } from '@/store/studioStore'

/** 自定义画风预设管理 + AI 搜索模型下载源 */
export function CustomStylesEditor() {
  const { apiConfig, updateApiConfig } = useStudio()
  const styles = apiConfig.customStyles
  const [label, setLabel] = useState('')
  const [prompt, setPrompt] = useState('')
  const [base, setBase] = useState('')
  const [hfHost, setHost] = useState(getHfHost())

  const add = () => {
    if (!label.trim() || !prompt.trim()) {
      toast.error('请填写画风名称和画风描述')
      return
    }
    const id = crypto.randomUUID().slice(0, 8)
    updateApiConfig({ customStyles: [...styles, { id, label: label.trim(), prompt: prompt.trim() }], stylePreset: `custom:${id}` })
    setLabel('')
    setPrompt('')
    setBase('')
    toast.success('已添加自定义画风，并设为当前画风')
  }

  const update = (id: string, patch: { label?: string; prompt?: string }) => {
    updateApiConfig({ customStyles: styles.map((s) => (s.id === id ? { ...s, ...patch } : s)) })
  }

  const remove = (id: string) => {
    updateApiConfig({
      customStyles: styles.filter((s) => s.id !== id),
      ...(apiConfig.stylePreset === `custom:${id}` ? { stylePreset: 'realistic' } : {}),
    })
  }

  return (
    <>
      <Section title="自定义画风预设" desc="画风描述会写进提示词的「风格」一行（中英文提示词共用这段描述）。可以基于内置画风改写。" className="md:grid-cols-1">
        {styles.map((s) => (
          <div key={s.id} className="grid gap-2 rounded-xl bg-background p-3 md:grid-cols-[180px_1fr_auto] md:items-start">
            <Input value={s.label} onChange={(e) => update(s.id, { label: e.target.value })} aria-label="画风名称" className="text-xs" />
            <Textarea value={s.prompt} onChange={(e) => update(s.id, { prompt: e.target.value })} rows={2} aria-label="画风描述" className="text-xs" />
            <Button variant="ghost" size="icon" aria-label="删除画风" onClick={() => remove(s.id)}>
              <Trash2Icon className="size-4" />
            </Button>
          </div>
        ))}
        <div className="grid gap-2 rounded-xl border border-dashed p-3 md:grid-cols-[180px_1fr_auto] md:items-start">
          <div className="space-y-2">
            <Input value={label} onChange={(e) => setLabel(e.target.value)} placeholder="画风名称，如：港风胶片" className="text-xs" />
            <Select
              value={base}
              onValueChange={(v) => {
                setBase(v)
                setPrompt(STYLE_PRESETS[v]?.prompt ?? '')
                if (!label) setLabel(`${STYLE_PRESETS[v]?.label ?? ''}（改）`)
              }}
            >
              <SelectTrigger className="h-8 w-full text-xs">
                <SelectValue placeholder="基于内置画风…" />
              </SelectTrigger>
              <SelectContent>
                {Object.entries(STYLE_PRESETS)
                  .filter(([, v]) => v.prompt)
                  .map(([k, v]) => (
                    <SelectItem key={k} value={k} className="text-xs">
                      {v.label}
                    </SelectItem>
                  ))}
              </SelectContent>
            </Select>
          </div>
          <Textarea
            value={prompt}
            onChange={(e) => setPrompt(e.target.value)}
            rows={3}
            placeholder="画风描述，如：90 年代香港电影胶片质感，霓虹暖色调，轻微柔焦与颗粒…"
            className="text-xs"
          />
          <Button onClick={add}>
            <PlusIcon className="size-4" />
            添加
          </Button>
        </div>
      </Section>

      <Section title="AI 语义搜索" desc="图库页的「AI 语义搜索 / 以图搜图」在浏览器本地运行 Chinese-CLIP 模型，首次使用需下载约 190 MB。">
        <Field label="模型下载源" hint="修改后刷新页面生效">
          <Select
            value={hfHost}
            onValueChange={(v) => {
              setHost(v)
              setHfHost(v)
              toast.success('已切换下载源，刷新页面后生效')
            }}
          >
            <SelectTrigger className="w-full">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {HF_HOSTS.map((h) => (
                <SelectItem key={h.value} value={h.value}>
                  {h.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </Field>
      </Section>
    </>
  )
}
