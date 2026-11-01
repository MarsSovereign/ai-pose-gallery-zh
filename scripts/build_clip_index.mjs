// 预计算三大图库缩略图的 Chinese-CLIP 图像向量，供前端「AI 语义搜索 / 以图搜图」使用。
// 用法：node scripts/build_clip_index.mjs [--limit N]
// 国内网络可设置 HF_ENDPOINT=https://hf-mirror.com
// 输出：data/clip-index.json（id 列表与元信息）+ data/clip-index.bin（int8 量化、L2 归一化的 512 维向量）
import fs from 'node:fs'
import path from 'node:path'
import { AutoProcessor, AutoTokenizer, ChineseCLIPModel, RawImage, env } from '@huggingface/transformers'

const ROOT = path.resolve(import.meta.dirname, '..')
const MODEL_ID = 'Xenova/chinese-clip-vit-base-patch16'
const DTYPE = 'q8'
if (process.env.HF_ENDPOINT) env.remoteHost = process.env.HF_ENDPOINT.replace(/\/?$/, '/')

const limitArg = process.argv.indexOf('--limit')
const LIMIT = limitArg > 0 ? Number(process.argv[limitArg + 1]) : Infinity

function load(file) {
  return JSON.parse(fs.readFileSync(path.join(ROOT, 'data', file), 'utf8'))
}

const entries = [
  ...load('pose-zh.json').map((x) => ({ lib: 'pose', id: x.id, thumb: x.缩略图 })),
  ...load('costume-zh.json').map((x) => ({ lib: 'costume', id: x.id, thumb: x.缩略图 })),
  ...load('portrait-zh.json').map((x) => ({ lib: 'portrait', id: x.id, thumb: x.缩略图 })),
].slice(0, LIMIT)

console.log(`共 ${entries.length} 张缩略图，加载模型 ${MODEL_ID} (${DTYPE})…`)
const model = await ChineseCLIPModel.from_pretrained(MODEL_ID, { dtype: DTYPE })
const processor = await AutoProcessor.from_pretrained(MODEL_ID)
const tokenizer = await AutoTokenizer.from_pretrained(MODEL_ID)
const dummyText = tokenizer([''], { padding: true, truncation: true })

const DIM = 512
const out = new Int8Array(entries.length * DIM)
const ok = []
const BATCH = 16
const started = Date.now()
for (let i = 0; i < entries.length; i += BATCH) {
  const batch = entries.slice(i, i + BATCH)
  const images = []
  const kept = []
  for (const e of batch) {
    try {
      images.push(await RawImage.read(path.join(ROOT, e.thumb)))
      kept.push(e)
    } catch (err) {
      console.warn(`跳过 ${e.thumb}: ${err.message}`)
    }
  }
  if (!images.length) continue
  const pixel = await processor(images)
  const textIds = tokenizer(new Array(images.length).fill(''), { padding: true, truncation: true })
  const { image_embeds } = await model({ ...textIds, pixel_values: pixel.pixel_values })
  const data = image_embeds.data
  for (let b = 0; b < kept.length; b++) {
    let norm = 0
    for (let d = 0; d < DIM; d++) norm += data[b * DIM + d] ** 2
    norm = Math.sqrt(norm) || 1
    const row = ok.length
    for (let d = 0; d < DIM; d++) {
      out[row * DIM + d] = Math.max(-127, Math.min(127, Math.round((data[b * DIM + d] / norm) * 127 * 4)))
    }
    ok.push(kept[b])
  }
  const done = Math.min(i + BATCH, entries.length)
  if (done % 160 === 0 || done === entries.length) {
    const s = (Date.now() - started) / 1000
    console.log(`${done}/${entries.length}  ${s.toFixed(0)}s`)
  }
}
void dummyText

fs.writeFileSync(path.join(ROOT, 'data/clip-index.bin'), Buffer.from(out.buffer, 0, ok.length * DIM))
fs.writeFileSync(
  path.join(ROOT, 'data/clip-index.json'),
  JSON.stringify({ model: MODEL_ID, dtype: DTYPE, dim: DIM, scale: 127 * 4, items: ok.map((e) => [e.lib, e.id]) })
)
console.log(`完成：${ok.length} 条向量 → data/clip-index.bin`)
