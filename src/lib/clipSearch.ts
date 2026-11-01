// AI 语义搜索 / 以图搜图：浏览器内运行 Chinese-CLIP（transformers.js + onnxruntime-web）。
// 图库向量由 scripts/build_clip_index.mjs 预先计算好（data/clip-index.*），浏览器只需计算查询向量。
// 首次使用需下载约 190 MB 模型，之后由浏览器缓存。

export type ClipLibrary = 'pose' | 'costume' | 'portrait'

export const HF_HOST_KEY = 'pose_atlas_hf_host_v1'
export const HF_HOSTS = [
  { value: 'https://hf-mirror.com/', label: 'hf-mirror.com（国内镜像，推荐）' },
  { value: 'https://huggingface.co/', label: 'huggingface.co（官方）' },
]

export function getHfHost(): string {
  try {
    return localStorage.getItem(HF_HOST_KEY) || HF_HOSTS[0].value
  } catch {
    return HF_HOSTS[0].value
  }
}

export function setHfHost(host: string) {
  try {
    localStorage.setItem(HF_HOST_KEY, host)
  } catch {
    /* ignore */
  }
}

interface ClipIndex {
  model: string
  dtype: string
  dim: number
  items: Array<[ClipLibrary, string]>
  vectors: Int8Array
}

export interface ClipProgress {
  message: string
  percent?: number
}

let indexPromise: Promise<ClipIndex> | null = null
let enginePromise: Promise<{ embedText: (q: string) => Promise<Float32Array>; embedImage: (src: string) => Promise<Float32Array> }> | null = null

function loadIndex(): Promise<ClipIndex> {
  indexPromise ??= (async () => {
    const [metaRes, binRes] = await Promise.all([fetch('/data/clip-index.json'), fetch('/data/clip-index.bin')])
    if (!metaRes.ok || !binRes.ok) throw new Error('未找到图库向量索引 data/clip-index.*，请先运行 node scripts/build_clip_index.mjs')
    const meta = await metaRes.json()
    const vectors = new Int8Array(await binRes.arrayBuffer())
    return { ...meta, vectors }
  })().catch((e) => {
    indexPromise = null
    throw e
  })
  return indexPromise
}

function normalize(v: Float32Array): Float32Array {
  let n = 0
  for (const x of v) n += x * x
  n = Math.sqrt(n) || 1
  return v.map((x) => x / n)
}

function loadEngine(onProgress?: (p: ClipProgress) => void) {
  enginePromise ??= (async () => {
    const index = await loadIndex()
    onProgress?.({ message: '正在加载 AI 搜索引擎…' })
    const tf = await import('@huggingface/transformers')
    tf.env.allowLocalModels = false
    tf.env.remoteHost = getHfHost()
    const files = new Map<string, { loaded: number; total: number }>()
    const progress_callback = (p: any) => {
      if (p?.status === 'progress' && p.file) {
        files.set(p.file, { loaded: p.loaded ?? 0, total: p.total ?? 0 })
        let loaded = 0
        let total = 0
        for (const f of files.values()) {
          loaded += f.loaded
          total += f.total
        }
        onProgress?.({
          message: `首次使用，正在下载模型 ${(loaded / 1024 ** 2).toFixed(0)} / ${(total / 1024 ** 2).toFixed(0)} MB（之后会缓存）`,
          percent: total ? Math.round((loaded / total) * 100) : undefined,
        })
      }
    }
    const [model, processor, tokenizer] = await Promise.all([
      tf.ChineseCLIPModel.from_pretrained(index.model, { dtype: index.dtype as 'q8', progress_callback }),
      tf.AutoProcessor.from_pretrained(index.model, { progress_callback }),
      tf.AutoTokenizer.from_pretrained(index.model, { progress_callback }),
    ])
    onProgress?.({ message: '模型已就绪' })
    // 合并版 Chinese-CLIP 每次需要同时输入文本和图片：查文本时塞一张空白图，查图片时塞一段空文本
    const blankPixels = new tf.Tensor('float32', new Float32Array(3 * 224 * 224), [1, 3, 224, 224])
    const emptyText = tokenizer([''], { padding: true, truncation: true })

    return {
      embedText: async (q: string) => {
        const text = tokenizer([q], { padding: true, truncation: true })
        const out = await model({ ...text, pixel_values: blankPixels })
        return normalize(new Float32Array(out.text_embeds.data as Float32Array))
      },
      embedImage: async (src: string) => {
        const image = await tf.RawImage.fromURL(src)
        const { pixel_values } = await processor(image)
        const out = await model({ ...emptyText, pixel_values })
        return normalize(new Float32Array(out.image_embeds.data as Float32Array))
      },
    }
  })().catch((e) => {
    enginePromise = null
    throw e
  })
  return enginePromise
}

function rank(index: ClipIndex, query: Float32Array, lib: ClipLibrary, topK: number): Array<{ id: string; score: number }> {
  const { dim, vectors, items } = index
  const scored: Array<{ id: string; score: number }> = []
  for (let i = 0; i < items.length; i++) {
    if (items[i][0] !== lib) continue
    let s = 0
    const off = i * dim
    for (let d = 0; d < dim; d++) s += vectors[off + d] * query[d]
    scored.push({ id: items[i][1], score: s })
  }
  scored.sort((a, b) => b.score - a.score)
  return scored.slice(0, topK)
}

export async function searchByText(q: string, lib: ClipLibrary, topK = 120, onProgress?: (p: ClipProgress) => void) {
  const [index, engine] = await Promise.all([loadIndex(), loadEngine(onProgress)])
  return rank(index, await engine.embedText(q), lib, topK)
}

export async function searchByImage(src: string, lib: ClipLibrary, topK = 120, onProgress?: (p: ClipProgress) => void) {
  const [index, engine] = await Promise.all([loadIndex(), loadEngine(onProgress)])
  return rank(index, await engine.embedImage(src), lib, topK)
}

/** 用图库内已有图片的向量做「找相似」，无需加载模型 */
export async function searchSimilarTo(id: string, lib: ClipLibrary, topK = 120) {
  const index = await loadIndex()
  const i = index.items.findIndex(([l, x]) => l === lib && x === id)
  if (i < 0) throw new Error('该图片没有向量索引')
  const q = new Float32Array(index.dim)
  for (let d = 0; d < index.dim; d++) q[d] = index.vectors[i * index.dim + d] / 127
  return rank(index, normalize(q), lib, topK)
}
