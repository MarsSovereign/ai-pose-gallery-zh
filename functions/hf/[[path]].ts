// Cloudflare Pages Function: /hf/<source>/<repo>/resolve/<rev>/<file>
// 同源转发 AI 语义搜索所需的 Chinese-CLIP 模型文件，绕开浏览器对 Hugging Face / 镜像站的跨域限制。
// 只允许转发白名单内的模型仓库，避免被当作开放代理。

export const HF_UPSTREAMS: Record<string, string> = {
  mirror: 'https://hf-mirror.com',
  hf: 'https://huggingface.co',
}

const ALLOWED = /^Xenova\/chinese-clip-vit-base-patch16\/resolve\/[\w.-]+\/[\w./-]+$/

export async function proxyHfModel(request: Request): Promise<Response> {
  const url = new URL(request.url)
  const m = url.pathname.match(/^\/hf\/(mirror|hf)\/(.+)$/)
  if (!m || !ALLOWED.test(m[2]) || m[2].includes('..')) {
    return new Response('Not allowed', { status: 403 })
  }
  const upstream = await fetch(`${HF_UPSTREAMS[m[1]]}/${m[2]}`, { redirect: 'follow' })
  const headers = new Headers()
  for (const key of ['content-type', 'content-length', 'etag', 'last-modified']) {
    const v = upstream.headers.get(key)
    if (v) headers.set(key, v)
  }
  headers.set('Cache-Control', upstream.ok ? 'public, max-age=2592000, immutable' : 'no-store')
  return new Response(upstream.body, { status: upstream.status, headers })
}

export const onRequestGet = (context: { request: Request }) => proxyHfModel(context.request)
