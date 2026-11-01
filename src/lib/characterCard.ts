import { recipeReferences, resolveStyle } from '@/services/aiGenerator'
import { referenceImageUrl } from '@/lib/recipeImages'
import { createZip, readZip, type ZipEntry } from '@/lib/zip'
import type { CostumeItem, CustomStylePreset, PortraitItem, PoseItem, RecipeState } from '@/types/gallery'

// 人物卡：把角色配方 + 参考图 + 生成结果 + 角色描述打包成一个 ZIP，
// 方便交给短剧 / 数字人 / 图生视频流程继续使用，也可以再导入回合成台复现角色。

export const CARD_FORMAT = 'ai-pose-gallery-character-card'

export interface CharacterCardMeta {
  format: typeof CARD_FORMAT
  version: 1
  name: string
  description: string
  createdAt: string
  style: { key: string; label: string; prompt: string }
  /** 角色外观的一句话描述（中英），可直接粘贴到视频 / 出图提示词中锁定角色 */
  dna: { zh: string; en: string }
  prompt: string
  references: Array<{ role: string; label: string; sub: string; file: string; sourceId?: string }>
  outputs: Array<{ label: string; file: string; prompt?: string }>
}

export interface CardOutput {
  label: string
  imageUrl: string
  prompt?: string
}

function safeName(s: string): string {
  return s.replace(/[\\/:*?"<>|\s]+/g, '_').slice(0, 40) || 'image'
}

async function urlToBytes(src: string): Promise<{ bytes: Uint8Array; ext: string }> {
  const res = await fetch(referenceImageUrl(src))
  if (!res.ok) throw new Error(`读取图片失败 (HTTP ${res.status})`)
  const blob = await res.blob()
  const ext = blob.type.includes('png') ? 'png' : blob.type.includes('webp') ? 'webp' : blob.type.includes('jpeg') ? 'jpg' : 'png'
  return { bytes: new Uint8Array(await blob.arrayBuffer()), ext }
}

export function characterDna(recipe: RecipeState): { zh: string; en: string } {
  const zh: string[] = []
  const en: string[] = []
  if (recipe.portrait) {
    zh.push(recipe.portrait.source === 'upload' ? `外貌参考「${recipe.portrait.标题}」` : `发型：${recipe.portrait.标题}`)
    if (recipe.portrait.发长) en.push(`${{ 短发: 'short', 中发: 'medium-length', 中长发: 'shoulder-length', 长发: 'long' }[recipe.portrait.发长] ?? ''} hair`.trim())
  }
  if (recipe.costume) {
    zh.push(`服装：${recipe.costume.服装名称}`)
    if (recipe.costume.关键词) en.push(`wearing ${recipe.costume.关键词}`)
    else en.push(`wearing the reference outfit (${recipe.costume.服装名称})`)
  }
  if (recipe.expression) {
    zh.push(`表情：${recipe.expression.name}`)
    en.push('expression as in the reference')
  }
  if (recipe.prop) {
    zh.push(`道具：${recipe.prop.name}`)
    en.push('holding the reference prop')
  }
  return { zh: zh.join('；'), en: en.filter(Boolean).join(', ') }
}

export async function buildCharacterCard(params: {
  name: string
  description: string
  recipe: RecipeState
  prompt: string
  stylePreset: string
  customStyles: CustomStylePreset[]
  outputs: CardOutput[]
}): Promise<Blob> {
  const { name, recipe, outputs } = params
  const entries: ZipEntry[] = []
  const refs = recipeReferences(recipe)
  const references: CharacterCardMeta['references'] = []
  for (let i = 0; i < refs.length; i++) {
    const ref = refs[i]
    const { bytes, ext } = await urlToBytes(ref.src)
    const file = `refs/${String(i + 1).padStart(2, '0')}_${ref.label}.${ext}`
    entries.push({ name: file, data: bytes })
    const source =
      ref.role === 'portrait' ? recipe.portrait : ref.role === 'costume' ? recipe.costume : ref.role === 'pose' ? recipe.pose : null
    references.push({
      role: ref.role,
      label: ref.label,
      sub: ref.sub,
      file,
      sourceId: source && source.source !== 'upload' ? source.id : undefined,
    })
  }
  const outMeta: CharacterCardMeta['outputs'] = []
  for (let i = 0; i < outputs.length; i++) {
    const { bytes, ext } = await urlToBytes(outputs[i].imageUrl)
    const file = `images/${String(i + 1).padStart(2, '0')}_${safeName(outputs[i].label)}.${ext}`
    entries.push({ name: file, data: bytes })
    outMeta.push({ label: outputs[i].label, file, prompt: outputs[i].prompt })
  }

  const style = resolveStyle(params.stylePreset, params.customStyles)
  const dna = characterDna(recipe)
  const meta: CharacterCardMeta = {
    format: CARD_FORMAT,
    version: 1,
    name,
    description: params.description,
    createdAt: new Date().toISOString(),
    style: { key: style.key, label: style.label, prompt: style.prompt },
    dna,
    prompt: params.prompt,
    references,
    outputs: outMeta,
  }
  entries.unshift({ name: 'character.json', data: JSON.stringify(meta, null, 2) })

  const md = [
    `# 人物卡：${name}`,
    '',
    params.description ? `${params.description}\n` : '',
    '## 角色 DNA（锁定外观用，可直接粘贴进提示词）',
    '',
    `- 中文：${dna.zh || '（见参考图）'}`,
    `- English: ${dna.en || '(see reference images)'}`,
    `- 画风：${style.label}${style.prompt ? ` —— ${style.prompt}` : ''}`,
    '',
    '## 参考图',
    '',
    ...references.map((r) => `- ${r.label}：${r.sub}（${r.file}）`),
    '',
    '## 生成结果',
    '',
    ...(outMeta.length ? outMeta.map((o) => `- ${o.label}：${o.file}`) : ['- （无）']),
    '',
    '## 合成提示词',
    '',
    '```text',
    params.prompt,
    '```',
    '',
    '## 用法',
    '',
    '- **图生视频 / 数字人**：用 images/ 下的正面图作为首帧或人物参考图，把「角色 DNA」写进提示词开头。',
    '- **多镜头保持同一个人**：每个镜头都带上 refs/ 里的人像参考，并复用同一段角色 DNA。',
    '- **复现**：在 AI 合成台点「导入人物卡」选择本 ZIP，可还原全部参考图与配方。',
    '',
  ].join('\n')
  entries.splice(1, 0, { name: '人物卡.md', data: md })
  return createZip(entries)
}

function bytesToDataUrl(bytes: Uint8Array, file: string): string {
  const mime = file.endsWith('.png') ? 'image/png' : file.endsWith('.webp') ? 'image/webp' : 'image/jpeg'
  let bin = ''
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000))
  return `data:${mime};base64,${btoa(bin)}`
}

/** 导入人物卡：优先按图库 ID 还原条目，找不到时用卡片内的参考图作为上传图片 */
export async function importCharacterCard(
  file: File,
  pools: { portraits: PortraitItem[]; costumes: CostumeItem[]; poses: PoseItem[] }
): Promise<{ meta: CharacterCardMeta; recipe: RecipeState; outputs: Array<{ label: string; imageUrl: string }> }> {
  const files = await readZip(file)
  const jsonBytes = files.get('character.json')
  if (!jsonBytes) throw new Error('ZIP 中没有 character.json，不是本工具导出的人物卡')
  const meta = JSON.parse(new TextDecoder().decode(jsonBytes)) as CharacterCardMeta
  if (meta.format !== CARD_FORMAT) throw new Error('人物卡格式不匹配')

  const recipe: RecipeState = { portrait: null, costume: null, pose: null, scene: null, expression: null, prop: null, extraImages: [] }
  const dataUrlOf = (f: string) => {
    const b = files.get(f)
    return b ? bytesToDataUrl(b, f) : ''
  }
  for (const ref of meta.references) {
    const url = dataUrlOf(ref.file)
    const base = { id: crypto.randomUUID(), source: 'upload' as const, 原图: url, 缩略图: url, 检索: ref.sub }
    if (ref.role === 'portrait') {
      recipe.portrait = pools.portraits.find((x) => x.id === ref.sourceId) ?? {
        ...base, 分区: '上传', 发长: '', 发型名称: ref.sub, 标题: ref.sub, 宽: 0, 高: 0, 字节数: 0, 精选: false, 热门: false,
      }
    } else if (ref.role === 'costume') {
      recipe.costume = pools.costumes.find((x) => x.id === ref.sourceId) ?? {
        ...base, 分类: '上传', 服装名称: ref.sub, 标签: [], 关键词: '', 预览图: url,
      }
    } else if (ref.role === 'pose') {
      recipe.pose = pools.poses.find((x) => x.id === ref.sourceId) ?? {
        ...base, 体系: '上传', 姿势编号: '', 分类: '上传', 姿势名称: ref.sub, 角度: '',
      }
    } else if (ref.role === 'scene' || ref.role === 'expression' || ref.role === 'prop') {
      const [name, note] = ref.sub.split(' · ')
      recipe[ref.role] = { id: crypto.randomUUID(), name, note, url }
    } else if (url) {
      recipe.extraImages!.push({ id: crypto.randomUUID(), name: ref.sub, url })
    }
  }
  const outputs = meta.outputs.map((o) => ({ label: o.label, imageUrl: dataUrlOf(o.file) })).filter((o) => o.imageUrl)
  return { meta, recipe, outputs }
}
