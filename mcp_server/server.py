#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
AI 角色三合一参考图集 · MCP 服务（stdio，零依赖，仅需 Python 3.9+）

让 Claude Code / Claude Desktop 等 Agent 直接：
  - 检索姿势 / 服装 / 人像三大图库（返回本地图片绝对路径）
  - 组装三图合成提示词
  - 调用本机 ComfyUI（Qwen Image Edit 2509 三图合成工作流）生成角色图并保存到本地

注册到 Claude Code：
  claude mcp add pose-gallery -- python /绝对路径/ai-pose-gallery-zh/mcp_server/server.py
环境变量：
  COMFYUI_URL   ComfyUI 地址，默认 http://127.0.0.1:8188（Desktop 版一般是 8000）
  POSE_GALLERY_OUTPUT  生成图保存目录，默认 <仓库>/output
"""

from __future__ import annotations

import json
import os
import random
import sys
import time
import urllib.error
import urllib.parse
import urllib.request
import uuid
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
DATA = ROOT / "data"
WORKFLOW = ROOT / "src" / "workflows" / "qwen_image_edit_2509_3img.api.json"
PROTOCOL_VERSIONS = ["2025-06-18", "2025-03-26", "2024-11-05"]
SERVER_INFO = {"name": "ai-pose-gallery", "version": "1.0.0"}

NSFW_POSE = {"全身单人・性感系", "双人缠绵"}
NSFW_COSTUME = {"内衣・睡衣", "性感穿搭"}
LIB_FILES = {"pose": "pose-zh.json", "costume": "costume-zh.json", "portrait": "portrait-zh.json"}
_cache: dict[str, list[dict]] = {}


def load(lib: str) -> list[dict]:
    if lib not in LIB_FILES:
        raise ValueError(f"library 只能是 pose / costume / portrait，收到：{lib}")
    if lib not in _cache:
        _cache[lib] = json.loads((DATA / LIB_FILES[lib]).read_text(encoding="utf-8"))
    return _cache[lib]


def is_nsfw(lib: str, it: dict) -> bool:
    return (lib == "pose" and it.get("体系") in NSFW_POSE) or (lib == "costume" and it.get("分类") in NSFW_COSTUME)


def find(lib: str, item_id: str) -> dict:
    for it in load(lib):
        if it.get("id") == item_id:
            return it
    raise ValueError(f"{lib} 图库中没有 id={item_id}")


def image_path(it: dict, lib: str) -> str:
    rel = it.get("预览图") if lib == "costume" and it.get("预览图") else it.get("原图")
    return str((ROOT / rel).resolve())


def summarize(lib: str, it: dict) -> dict:
    base = {"id": it["id"], "image": image_path(it, lib), "thumb": str((ROOT / it["缩略图"]).resolve())}
    if lib == "pose":
        base.update(name=it["姿势名称"], system=it["体系"], category=it["分类"], angle=it["角度"], number=it["姿势编号"])
    elif lib == "costume":
        base.update(name=it["服装名称"], category=it["分类"], tags=it.get("标签", []), keywords_en=it.get("关键词", ""))
    else:
        base.update(name=it["标题"], section=it["分区"], hair_length=it["发长"], hairstyle=it["发型名称"], hot=it.get("热门", False))
    return base


# ---------------------------------------------------------------------------
# 工具实现
# ---------------------------------------------------------------------------


def tool_search(args: dict) -> dict:
    lib = args.get("library", "pose")
    tokens = [t.lower() for t in str(args.get("query", "")).split() if t]
    category = args.get("category") or ""
    angle = args.get("angle") or ""
    hair = args.get("hair_length") or ""
    include_nsfw = bool(args.get("include_nsfw", False))
    limit = max(1, min(int(args.get("limit", 20)), 100))
    out = []
    for it in load(lib):
        if not include_nsfw and is_nsfw(lib, it):
            continue
        if category and category not in (it.get("分类", ""), it.get("体系", ""), it.get("分区", "")):
            continue
        if angle and it.get("角度") != angle:
            continue
        if hair and it.get("发长") != hair:
            continue
        hay = (it.get("检索", "") + " " + " ".join(it.get("标签", []) or []) + " " + it.get("关键词", "")).lower()
        if all(t in hay for t in tokens):
            out.append(summarize(lib, it))
    if args.get("shuffle"):
        random.shuffle(out)
    return {"total": len(out), "items": out[:limit]}


def tool_categories(args: dict) -> dict:
    lib = args.get("library", "pose")
    items = load(lib)
    result: dict = {}
    if lib == "pose":
        result["systems"] = sorted({i["体系"] for i in items})
        result["categories"] = sorted({i["分类"] for i in items})
        result["angles"] = sorted({i["角度"] for i in items})
    elif lib == "costume":
        result["categories"] = sorted({i["分类"] for i in items})
        result["tags"] = sorted({t for i in items for t in i.get("标签", [])})
    else:
        result["sections"] = sorted({i["分区"] for i in items})
        result["hair_lengths"] = sorted({i["发长"] for i in items})
        result["hairstyles"] = sorted({i["发型名称"] for i in items})
    result["nsfw_note"] = "带 18+ 标记的分类默认不返回，需显式 include_nsfw=true"
    return result


def tool_get(args: dict) -> dict:
    lib = args["library"]
    it = find(lib, args["id"])
    return {**it, "image_abs": image_path(it, lib)}


STYLE = {
    "realistic": ("写实商业摄影级质感，85mm 人像镜头，自然柔和光影，真实肌肤纹理与织物细节，8k 高清画质。",
                  "Photorealistic commercial portrait photography, 85mm lens, soft natural lighting, real skin texture and fabric detail, 8k."),
    "anime": ("日系精致二次元插画风格，细腻赛璐璐与厚涂光影过渡，动漫角色立绘质感，色彩通透干净。",
              "Polished Japanese anime illustration, cel shading blended with painterly lighting, clean vivid colors."),
    "film": ("35mm 富士胶片摄影质感，轻微胶片颗粒，柔和复古暖调，自然街拍光影与电影呼吸感。",
             "35mm Fujifilm look, subtle film grain, soft vintage warm tones, cinematic feel."),
    "concept_sheet": ("标准角色设定集全身立绘，纯白干净无杂物背景，均匀漫反射布光，清晰展示全身服装结构与配饰细节。",
                      "Character design sheet, full body, pure white background, even lighting, clear outfit details."),
    "none": ("", ""),
}


def build_prompt(portrait: dict | None, costume: dict | None, pose: dict | None, style: str = "realistic", lang: str = "zh") -> str:
    zh_style, en_style = STYLE.get(style, STYLE["realistic"])
    photo = style in ("realistic", "film", "none")
    lines, idx, cidx = [], 1, 0
    if lang == "en":
        if portrait:
            lines.append(f"• Person: the person in image {idx}. Keep the same face shape, facial features, hairstyle and hair color.")
            idx += 1
        if costume:
            cidx = idx
            lines.append(f"• Outfit: dress the person in the complete outfit and accessories shown in image {idx} (reference keywords: {costume.get('关键词', '')}). Every item must follow image {idx}.")
            idx += 1
        if pose:
            wear = f", wearing the outfit from image {cidx}" if cidx else ""
            lines.append(f"• Pose: copy the pose and camera angle of the mannequin in image {idx}. Image {idx} is only a pose guide. {'The final person is a real human with natural skin' if photo else 'Render skin according to the style'}{wear}.")
            idx += 1
        head = f"Using the {len(lines)} reference images provided, generate one complete {'photograph of a real person' if photo else 'character image'}:"
        tail = ([f"• Style: {en_style} Natural proportions, natural hands and face, consistent lighting."] if en_style else []) + ["No text, logos or watermarks anywhere in the image."]
        return "\n".join([head, *lines, *tail])
    if portrait:
        hair = portrait["标题"] if portrait.get("发型名称") not in (None, "", "标准基础款") else portrait.get("发长", "")
        lines.append(f"• 人物：图{idx}中的人物，保持其脸型、五官、发型（{hair}）和发色一致。")
        idx += 1
    if costume:
        cidx = idx
        lines.append(f"• 服装：让人物穿上图{idx}中展示的整套服装和配饰（参考名称：{costume['服装名称']}），每件单品的颜色、款式、面料与配饰都以图{idx}为准，名称仅作辅助说明。")
        idx += 1
    if pose:
        wear = f"，穿着图{cidx}的服装" if cidx else ""
        body = f"最终画面中的人物是真人，皮肤真实自然{wear}" if photo else f"人物的肤色与质感按风格要求呈现{wear}"
        lines.append(f"• 姿势：按照图{idx}中人体模型的动作和镜头角度摆姿势（{pose['姿势名称']}，{pose['角度']}）；图{idx}只是动作示意，{body}。")
        idx += 1
    head = f"请根据提供的 {len(lines)} 张参考图，生成一张完整的{'真实人物照片' if photo else '人物图像'}："
    tail = ([f"• 风格：{zh_style} 人物比例协调，手部与五官自然，光影统一。"] if zh_style else []) + ["画面中没有任何文字、标志或水印。"]
    return "\n".join([head, *lines, *tail])


def _recipe_items(args: dict):
    p = find("portrait", args["portrait_id"]) if args.get("portrait_id") else None
    c = find("costume", args["costume_id"]) if args.get("costume_id") else None
    s = find("pose", args["pose_id"]) if args.get("pose_id") else None
    return p, c, s


def tool_prompt(args: dict) -> dict:
    p, c, s = _recipe_items(args)
    if not (p or c or s):
        raise ValueError("至少提供 portrait_id / costume_id / pose_id 之一")
    return {
        "prompt": build_prompt(p, c, s, args.get("style", "realistic"), args.get("lang", "zh")),
        "images_in_order": [image_path(x, lib) for x, lib in ((p, "portrait"), (c, "costume"), (s, "pose")) if x],
    }


def tool_random(args: dict) -> dict:
    nsfw = bool(args.get("include_nsfw", False))
    pick = lambda lib: random.choice([i for i in load(lib) if nsfw or not is_nsfw(lib, i)])  # noqa: E731
    return {lib: summarize(lib, pick(lib)) for lib in ("portrait", "costume", "pose")}


# ---------------------------------------------------------------------------
# ComfyUI
# ---------------------------------------------------------------------------


def _comfy_url() -> str:
    return os.environ.get("COMFYUI_URL", "http://127.0.0.1:8188").rstrip("/")


def _http(method: str, url: str, data: bytes | None = None, headers: dict | None = None, timeout: int = 60) -> bytes:
    req = urllib.request.Request(url, data=data, method=method, headers=headers or {})
    try:
        with urllib.request.urlopen(req, timeout=timeout) as r:  # noqa: S310 - 本机 ComfyUI
            return r.read()
    except urllib.error.HTTPError as e:
        raise RuntimeError(f"ComfyUI {url} 返回 HTTP {e.code}：{e.read()[:400].decode('utf-8', 'replace')}") from e
    except urllib.error.URLError as e:
        raise RuntimeError(f"无法连接 ComfyUI（{url}）：{e.reason}。请确认 ComfyUI 已启动，或设置 COMFYUI_URL 环境变量") from e


def _upload(base: str, path: str, name: str) -> str:
    boundary = uuid.uuid4().hex
    content = Path(path).read_bytes()
    ext = Path(path).suffix.lower().lstrip(".") or "png"
    parts = [
        f'--{boundary}\r\nContent-Disposition: form-data; name="image"; filename="{name}.{ext}"\r\nContent-Type: image/{ext}\r\n\r\n'.encode(),
        content,
        f'\r\n--{boundary}\r\nContent-Disposition: form-data; name="subfolder"\r\n\r\npose_studio\r\n'.encode(),
        f'--{boundary}\r\nContent-Disposition: form-data; name="overwrite"\r\n\r\ntrue\r\n--{boundary}--\r\n'.encode(),
    ]
    res = json.loads(_http("POST", f"{base}/upload/image", b"".join(parts), {"Content-Type": f"multipart/form-data; boundary={boundary}"}))
    return f"{res['subfolder']}/{res['name']}" if res.get("subfolder") else res["name"]


def tool_generate(args: dict) -> dict:
    p, c, s = _recipe_items(args)
    if not (p and c and s):
        raise ValueError("ComfyUI 三图合成需要同时提供 portrait_id、costume_id、pose_id")
    base = (args.get("comfy_url") or _comfy_url()).rstrip("/")
    prompt = args.get("prompt") or build_prompt(p, c, s, args.get("style", "realistic"), args.get("lang", "zh"))
    wf = json.loads(WORKFLOW.read_text(encoding="utf-8"))
    for node, item, lib in (("1", p, "portrait"), ("2", c, "costume"), ("3", s, "pose")):
        wf[node]["inputs"]["image"] = _upload(base, image_path(item, lib), f"mcp_{lib}_{item['id']}")
    wf["12"]["inputs"]["prompt"] = prompt
    seed = int(args.get("seed") or random.randint(1, 2**48))
    wf["14"]["inputs"]["seed"] = seed
    client_id = uuid.uuid4().hex
    res = json.loads(_http("POST", f"{base}/prompt", json.dumps({"prompt": wf, "client_id": client_id}).encode(), {"Content-Type": "application/json"}))
    if "prompt_id" not in res:
        raise RuntimeError(f"提交失败：{json.dumps(res, ensure_ascii=False)[:600]}")
    pid = res["prompt_id"]
    deadline = time.time() + int(args.get("timeout_sec", 600))
    while time.time() < deadline:
        time.sleep(2)
        hist = json.loads(_http("GET", f"{base}/history/{pid}", timeout=15)).get(pid)
        if not hist:
            continue
        status = hist.get("status", {})
        if status.get("status_str") == "error":
            raise RuntimeError(f"ComfyUI 执行出错：{json.dumps(status.get('messages', []), ensure_ascii=False)[:800]}")
        images = [im for out in hist.get("outputs", {}).values() for im in out.get("images", []) if im.get("type") == "output"]
        if not images:
            continue
        out_dir = Path(args.get("output_dir") or os.environ.get("POSE_GALLERY_OUTPUT") or (ROOT / "output"))
        out_dir.mkdir(parents=True, exist_ok=True)
        saved = []
        for im in images:
            qs = urllib.parse.urlencode({"filename": im["filename"], "subfolder": im.get("subfolder", ""), "type": "output"})
            dest = out_dir / f"{time.strftime('%Y%m%d_%H%M%S')}_{p['id']}_{c['id']}_{s['id']}.png"
            dest.write_bytes(_http("GET", f"{base}/view?{qs}", timeout=120))
            saved.append(str(dest.resolve()))
        return {"saved": saved, "seed": seed, "prompt": prompt}
    raise RuntimeError("等待 ComfyUI 结果超时")


# ---------------------------------------------------------------------------
# MCP 协议（JSON-RPC 2.0 over stdio，换行分隔）
# ---------------------------------------------------------------------------

LIB_ENUM = {"type": "string", "enum": ["pose", "costume", "portrait"], "description": "pose=姿势库 costume=服装库 portrait=人像库"}
RECIPE_PROPS = {
    "portrait_id": {"type": "string", "description": "人像 ID（来自 search_gallery）"},
    "costume_id": {"type": "string", "description": "服装 ID"},
    "pose_id": {"type": "string", "description": "姿势 ID"},
    "style": {"type": "string", "enum": list(STYLE.keys()), "default": "realistic"},
    "lang": {"type": "string", "enum": ["zh", "en"], "default": "zh"},
}

TOOLS = [
    {
        "name": "search_gallery",
        "description": "按中文关键词检索姿势 / 服装 / 人像参考图库，返回条目 ID、中文名称、分类和本地图片绝对路径。多个关键词用空格分隔（AND）。18+ 分类默认排除。",
        "inputSchema": {
            "type": "object",
            "properties": {
                "library": LIB_ENUM,
                "query": {"type": "string", "description": "关键词，如「坐姿 抱膝」「牛仔 短裤」「短发 刘海」，可为空"},
                "category": {"type": "string", "description": "可选：分类 / 体系 / 分区名称（用 list_categories 查看）"},
                "angle": {"type": "string", "description": "仅姿势库：正面 / 俯视 / 仰视 / 侧面 / 斜侧"},
                "hair_length": {"type": "string", "description": "仅人像库：短发 / 中发 / 中长发 / 长发"},
                "limit": {"type": "integer", "default": 20},
                "shuffle": {"type": "boolean", "default": False},
                "include_nsfw": {"type": "boolean", "default": False, "description": "是否包含 18+ 分类（仅限成年用户合法创作）"},
            },
            "required": ["library"],
        },
    },
    {
        "name": "list_categories",
        "description": "列出某个图库的全部分类、体系、视角、标签或发型，用于构造检索条件。",
        "inputSchema": {"type": "object", "properties": {"library": LIB_ENUM}, "required": ["library"]},
    },
    {
        "name": "get_item",
        "description": "按 ID 获取图库条目的完整中文元数据和图片绝对路径。",
        "inputSchema": {"type": "object", "properties": {"library": LIB_ENUM, "id": {"type": "string"}}, "required": ["library", "id"]},
    },
    {
        "name": "build_recipe_prompt",
        "description": "根据人像 / 服装 / 姿势 ID 组装多图编辑模型（Qwen Image Edit、Seedream、Gemini、GPT Image 等）用的合成提示词，并按「图1/图2/图3」顺序返回参考图路径。",
        "inputSchema": {"type": "object", "properties": RECIPE_PROPS},
    },
    {
        "name": "random_recipe",
        "description": "随机抽取一套人像 + 服装 + 姿势配方。",
        "inputSchema": {"type": "object", "properties": {"include_nsfw": {"type": "boolean", "default": False}}},
    },
    {
        "name": "comfyui_generate",
        "description": "用本机 ComfyUI（Qwen Image Edit 2509 三图合成工作流）把人像 + 服装 + 姿势合成为一张角色图，保存到本地并返回文件路径。需要 ComfyUI 已启动并装好 docs/comfyui-local.md 中的模型。",
        "inputSchema": {
            "type": "object",
            "properties": {
                **RECIPE_PROPS,
                "prompt": {"type": "string", "description": "可选：覆盖自动生成的提示词"},
                "seed": {"type": "integer"},
                "comfy_url": {"type": "string", "description": "默认读取 COMFYUI_URL 环境变量，否则 http://127.0.0.1:8188"},
                "output_dir": {"type": "string"},
                "timeout_sec": {"type": "integer", "default": 600},
            },
            "required": ["portrait_id", "costume_id", "pose_id"],
        },
    },
]

HANDLERS = {
    "search_gallery": tool_search,
    "list_categories": tool_categories,
    "get_item": tool_get,
    "build_recipe_prompt": tool_prompt,
    "random_recipe": tool_random,
    "comfyui_generate": tool_generate,
}


def handle(msg: dict) -> dict | None:
    method = msg.get("method")
    mid = msg.get("id")
    if mid is None:  # 通知，无需回复
        return None
    if method == "initialize":
        requested = (msg.get("params") or {}).get("protocolVersion")
        version = requested if requested in PROTOCOL_VERSIONS else PROTOCOL_VERSIONS[0]
        result = {"protocolVersion": version, "capabilities": {"tools": {}}, "serverInfo": SERVER_INFO}
    elif method == "ping":
        result = {}
    elif method == "tools/list":
        result = {"tools": TOOLS}
    elif method == "tools/call":
        params = msg.get("params") or {}
        fn = HANDLERS.get(params.get("name"))
        if not fn:
            return {"jsonrpc": "2.0", "id": mid, "error": {"code": -32602, "message": f"未知工具：{params.get('name')}"}}
        try:
            data = fn(params.get("arguments") or {})
            result = {"content": [{"type": "text", "text": json.dumps(data, ensure_ascii=False, indent=1)}]}
        except Exception as e:  # noqa: BLE001 - 工具错误以 isError 返回给模型
            result = {"content": [{"type": "text", "text": f"错误：{e}"}], "isError": True}
    else:
        return {"jsonrpc": "2.0", "id": mid, "error": {"code": -32601, "message": f"不支持的方法：{method}"}}
    return {"jsonrpc": "2.0", "id": mid, "result": result}


def main() -> None:
    stdin = open(sys.stdin.fileno(), encoding="utf-8", closefd=False)
    for line in stdin:
        line = line.strip()
        if not line:
            continue
        try:
            msg = json.loads(line)
        except json.JSONDecodeError:
            continue
        reply = handle(msg)
        if reply is not None:
            sys.stdout.write(json.dumps(reply, ensure_ascii=False) + "\n")
            sys.stdout.flush()


if __name__ == "__main__":
    main()
