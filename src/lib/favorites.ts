import { useSyncExternalStore } from 'react'

// 收藏夹：按图库分别保存条目 ID（localStorage，轻量）

export type FavoriteKind = 'pose' | 'costume' | 'portrait'

const KEY = 'pose_atlas_favorites_v1'
type FavMap = Record<FavoriteKind, string[]>

function read(): FavMap {
  try {
    const raw = JSON.parse(localStorage.getItem(KEY) || '{}')
    return { pose: raw.pose || [], costume: raw.costume || [], portrait: raw.portrait || [] }
  } catch {
    return { pose: [], costume: [], portrait: [] }
  }
}

let state: FavMap = read()
const sets: Record<FavoriteKind, Set<string>> = {
  pose: new Set(state.pose),
  costume: new Set(state.costume),
  portrait: new Set(state.portrait),
}
const listeners = new Set<() => void>()

function subscribe(cb: () => void) {
  listeners.add(cb)
  return () => listeners.delete(cb)
}

export function toggleFavorite(kind: FavoriteKind, id: string): boolean {
  const list = state[kind]
  const has = sets[kind].has(id)
  const next = has ? list.filter((x) => x !== id) : [id, ...list]
  state = { ...state, [kind]: next }
  sets[kind] = new Set(next)
  try {
    localStorage.setItem(KEY, JSON.stringify(state))
  } catch {
    /* ignore */
  }
  for (const l of listeners) l()
  return !has
}

/** 返回该图库的收藏 ID 集合（引用随收藏变化而变化，可直接作为 useMemo 依赖） */
export function useFavorites(kind: FavoriteKind): Set<string> {
  return useSyncExternalStore(subscribe, () => sets[kind], () => sets[kind])
}
