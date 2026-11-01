export interface AiResult {
  /** 结果说明，如「语义：红色连衣裙」 */
  label: string
  /** 按相关度排序的条目 ID */
  ids: string[]
}

/** 按 AI 结果过滤并排序列表 */
export function applyAiOrder<T extends { id: string }>(list: T[], ai: AiResult | null): T[] {
  if (!ai) return list
  const pos = new Map(ai.ids.map((id, i) => [id, i]))
  return list.filter((x) => pos.has(x.id)).sort((a, b) => pos.get(a.id)! - pos.get(b.id)!)
}

