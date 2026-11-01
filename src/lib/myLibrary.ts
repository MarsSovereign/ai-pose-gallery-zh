import { useSyncExternalStore } from 'react'
import { idbGet, idbSet } from '@/lib/idbStorage'
import { uploadedReferences } from '@/lib/recipeImages'
import type { LibraryAsset, LibraryKind, RecipeState, SlotAssetRef } from '@/types/gallery'

// 「我的素材库」：用户自己的人像 / 服装 / 姿势 / 场景 / 表情 / 道具，持久化保存在浏览器 IndexedDB

const KEY = 'my_library_v1'

export const LIBRARY_KINDS: Array<{ kind: LibraryKind; label: string; hint: string }> = [
  { kind: 'portrait', label: '人像', hint: '固定角色的脸：正脸清晰、光线均匀的半身照最好' },
  { kind: 'costume', label: '服装', hint: '整套穿搭的平铺图或模特图' },
  { kind: 'pose', label: '姿势', hint: '想复刻的动作：真人照片、人偶图或骨架图均可' },
  { kind: 'scene', label: '场景', hint: '背景环境：室内、街景、棚拍背景等' },
  { kind: 'expression', label: '表情', hint: '想要的表情神态特写' },
  { kind: 'prop', label: '道具', hint: '手持物品：包、伞、武器、乐器等' },
]

export const LIBRARY_KIND_LABEL = Object.fromEntries(LIBRARY_KINDS.map((k) => [k.kind, k.label])) as Record<LibraryKind, string>

let assets: LibraryAsset[] = []
let loaded = false
const listeners = new Set<() => void>()

function emit() {
  for (const l of listeners) l()
}

async function ensureLoaded() {
  if (loaded) return
  loaded = true
  const saved = await idbGet<LibraryAsset[]>(KEY)
  if (Array.isArray(saved)) {
    assets = saved
    emit()
  }
}

function persist(next: LibraryAsset[]) {
  assets = next
  emit()
  void idbSet(KEY, next)
}

function subscribe(cb: () => void) {
  listeners.add(cb)
  void ensureLoaded()
  return () => listeners.delete(cb)
}

export function useMyLibrary(): LibraryAsset[] {
  return useSyncExternalStore(subscribe, () => assets, () => assets)
}

export async function getMyLibrary(): Promise<LibraryAsset[]> {
  await ensureLoaded()
  return assets
}

/** 读取并压缩图片（最长边 1024，JPEG 质量 0.9），返回 data URL 与尺寸 */
export async function readImageFile(file: File, maxSide = 1024): Promise<{ url: string; width: number; height: number }> {
  const raw = await new Promise<string>((resolve, reject) => {
    const reader = new FileReader()
    reader.onerror = () => reject(new Error('读取文件失败'))
    reader.onload = () => resolve(reader.result as string)
    reader.readAsDataURL(file)
  })
  const img = new Image()
  img.src = raw
  await img.decode()
  const scale = Math.min(1, maxSide / Math.max(img.width, img.height))
  const c = document.createElement('canvas')
  c.width = Math.round(img.width * scale)
  c.height = Math.round(img.height * scale)
  c.getContext('2d')!.drawImage(img, 0, 0, c.width, c.height)
  const hasAlpha = file.type === 'image/png' || file.type === 'image/webp'
  return { url: hasAlpha ? c.toDataURL('image/png') : c.toDataURL('image/jpeg', 0.9), width: c.width, height: c.height }
}

export async function addLibraryFiles(kind: LibraryKind, files: File[]): Promise<LibraryAsset[]> {
  await ensureLoaded()
  const added: LibraryAsset[] = []
  for (const file of files.filter((f) => f.type.startsWith('image/'))) {
    const { url, width, height } = await readImageFile(file)
    added.push({
      id: crypto.randomUUID(),
      kind,
      name: file.name.replace(/\.[^.]+$/, '').slice(0, 40) || LIBRARY_KIND_LABEL[kind],
      note: '',
      url,
      width,
      height,
      createdAt: Date.now(),
    })
  }
  if (added.length) persist([...added, ...assets])
  return added
}

export async function addLibraryDataUrl(kind: LibraryKind, name: string, url: string): Promise<LibraryAsset> {
  await ensureLoaded()
  const img = new Image()
  img.src = url
  await img.decode().catch(() => {})
  const asset: LibraryAsset = {
    id: crypto.randomUUID(),
    kind,
    name: name.slice(0, 40) || LIBRARY_KIND_LABEL[kind],
    note: '',
    url,
    width: img.naturalWidth || 0,
    height: img.naturalHeight || 0,
    createdAt: Date.now(),
  }
  persist([asset, ...assets])
  return asset
}

export function updateLibraryAsset(id: string, patch: Partial<Pick<LibraryAsset, 'name' | 'note' | 'kind'>>) {
  persist(assets.map((a) => (a.id === id ? { ...a, ...patch } : a)))
}

export function removeLibraryAsset(id: string) {
  persist(assets.filter((a) => a.id !== id))
}

/** 把素材放进配方对应的槽位，返回新的配方 */
export function applyAssetToRecipe(recipe: RecipeState, asset: LibraryAsset): RecipeState {
  const label = asset.note ? `${asset.name}（${asset.note}）` : asset.name
  if (asset.kind === 'portrait' || asset.kind === 'costume' || asset.kind === 'pose') {
    const refs = uploadedReferences(label, asset.url, asset.width, asset.height, Math.round(asset.url.length * 0.75))
    const item = { ...refs[asset.kind], id: `lib:${asset.id}` }
    return { ...recipe, [asset.kind]: item }
  }
  const ref: SlotAssetRef = { id: asset.id, name: asset.name, note: asset.note, url: asset.url }
  return { ...recipe, [asset.kind]: ref }
}
