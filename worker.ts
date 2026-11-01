import { onRequestPost } from './functions/api/proxy'
import { proxyHfModel } from './functions/hf/[[path]]'

export interface Env {
  ASSETS: {
    fetch: (request: Request) => Promise<Response>
  }
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url)

    // Handle /api/proxy CORS forwarding for DashScope (Qwen) & Volcengine Ark (Doubao)
    if (url.pathname === '/api/proxy') {
      if (request.method === 'POST') {
        return onRequestPost({ request })
      }
      return new Response(JSON.stringify({ error: { message: 'Method Not Allowed' } }), {
        status: 405,
        headers: { 'Content-Type': 'application/json; charset=utf-8' },
      })
    }

    // AI 语义搜索模型文件同源转发
    if (url.pathname.startsWith('/hf/') && request.method === 'GET') {
      return proxyHfModel(request)
    }

    // Fallback to static assets binding
    return env.ASSETS.fetch(request)
  },
}
