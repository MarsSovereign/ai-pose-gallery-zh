// 角色多视角设定图：把同一角色的多张生成结果拼成一张带标注的设定图

function loadImg(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image()
    img.crossOrigin = 'anonymous'
    img.onload = () => resolve(img)
    img.onerror = () => reject(new Error('加载生成结果失败'))
    img.src = src
  })
}

export async function composeCharacterSheet(
  items: Array<{ label: string; imageUrl: string }>,
  opts: { title: string; subtitle?: string; background?: 'light' | 'dark' } = { title: '角色设定图' }
): Promise<string> {
  if (!items.length) throw new Error('没有可拼接的图片')
  const imgs = await Promise.all(items.map((x) => loadImg(x.imageUrl)))
  const cols = items.length <= 4 ? items.length : Math.ceil(items.length / 2)
  const rows = Math.ceil(items.length / cols)
  const cellH = 900
  const ratio = Math.min(1, Math.max(0.5, imgs.reduce((n, i) => n + i.width / i.height, 0) / imgs.length))
  const cellW = Math.round(cellH * ratio)
  const pad = 28
  const head = 110
  const label = 46
  const dark = opts.background === 'dark'

  const canvas = document.createElement('canvas')
  canvas.width = cols * cellW + (cols + 1) * pad
  canvas.height = head + rows * (cellH + label) + (rows + 1) * pad
  const ctx = canvas.getContext('2d')!
  ctx.fillStyle = dark ? '#121418' : '#f7f7f5'
  ctx.fillRect(0, 0, canvas.width, canvas.height)

  const font = 'Inter, -apple-system, BlinkMacSystemFont, "PingFang SC", "Microsoft YaHei", sans-serif'
  ctx.fillStyle = dark ? '#ffffff' : '#18181b'
  ctx.font = `700 40px ${font}`
  ctx.fillText(opts.title.slice(0, 40), pad, pad + 44)
  if (opts.subtitle) {
    ctx.fillStyle = dark ? '#a1a1aa' : '#71717a'
    ctx.font = `500 22px ${font}`
    ctx.fillText(opts.subtitle.slice(0, 90), pad, pad + 82)
  }

  imgs.forEach((img, i) => {
    const c = i % cols
    const r = Math.floor(i / cols)
    const x = pad + c * (cellW + pad)
    const y = head + pad + r * (cellH + label + pad)
    ctx.fillStyle = dark ? '#1e222b' : '#ffffff'
    ctx.fillRect(x, y, cellW, cellH + label)
    const scale = Math.min(cellW / img.width, cellH / img.height)
    const dw = img.width * scale
    const dh = img.height * scale
    ctx.drawImage(img, x + (cellW - dw) / 2, y + (cellH - dh) / 2, dw, dh)
    ctx.fillStyle = dark ? '#e4e4e7' : '#27272a'
    ctx.font = `600 24px ${font}`
    const text = items[i].label.slice(0, 24)
    const tw = ctx.measureText(text).width
    ctx.fillText(text, x + (cellW - tw) / 2, y + cellH + 32)
  })

  return canvas.toDataURL('image/jpeg', 0.92)
}
