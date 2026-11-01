import type { CostumeItem, PortraitItem, PoseItem, RecipeState } from '@/types/gallery'

// 配方分享链接：只编码图库条目 ID 与画风（本机上传的图片无法放进链接）

export interface SharedRecipe {
  /** portrait id */
  r?: string
  /** costume id */
  c?: string
  /** pose id */
  p?: string
  /** style preset */
  s?: string
}

function b64urlEncode(text: string): string {
  const bytes = new TextEncoder().encode(text)
  let bin = ''
  for (const b of bytes) bin += String.fromCharCode(b)
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

function b64urlDecode(code: string): string {
  const b64 = code.replace(/-/g, '+').replace(/_/g, '/')
  const bin = atob(b64 + '='.repeat((4 - (b64.length % 4)) % 4))
  return new TextDecoder().decode(Uint8Array.from(bin, (c) => c.charCodeAt(0)))
}

export function encodeRecipe(recipe: RecipeState, stylePreset?: string): { code: string; skipped: string[] } {
  const data: SharedRecipe = {}
  const skipped: string[] = []
  if (recipe.portrait) {
    if (recipe.portrait.source === 'upload') skipped.push('人像')
    else data.r = recipe.portrait.id
  }
  if (recipe.costume) {
    if (recipe.costume.source === 'upload') skipped.push('服装')
    else data.c = recipe.costume.id
  }
  if (recipe.pose) {
    if (recipe.pose.source === 'upload') skipped.push('姿势')
    else data.p = recipe.pose.id
  }
  if (recipe.scene) skipped.push('场景')
  if (recipe.expression) skipped.push('表情')
  if (recipe.prop) skipped.push('道具')
  if (recipe.extraImages?.length) skipped.push('附加参考图')
  if (stylePreset && !stylePreset.startsWith('custom:')) data.s = stylePreset
  return { code: b64urlEncode(JSON.stringify(data)), skipped }
}

export function decodeRecipe(code: string): SharedRecipe | null {
  try {
    const obj = JSON.parse(b64urlDecode(code))
    return obj && typeof obj === 'object' ? (obj as SharedRecipe) : null
  } catch {
    return null
  }
}

export function shareUrl(code: string): string {
  return `${window.location.origin}/studio?r=${code}`
}

export function resolveSharedRecipe(
  shared: SharedRecipe,
  pools: { portraits: PortraitItem[]; costumes: CostumeItem[]; poses: PoseItem[] }
): { recipe: RecipeState; missing: string[] } {
  const missing: string[] = []
  const portrait = shared.r ? pools.portraits.find((x) => x.id === shared.r) ?? null : null
  const costume = shared.c ? pools.costumes.find((x) => x.id === shared.c) ?? null : null
  const pose = shared.p ? pools.poses.find((x) => x.id === shared.p) ?? null : null
  if (shared.r && !portrait) missing.push('人像')
  if (shared.c && !costume) missing.push('服装')
  if (shared.p && !pose) missing.push('姿势')
  return { recipe: { portrait, costume, pose, extraImages: [] }, missing }
}
