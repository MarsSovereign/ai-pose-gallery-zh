# -*- coding: utf-8 -*-
"""ComfyUI 自定义节点：AI 角色三合一参考图集（姿势 + 服装 + 人像 + 三合一合成配方）。"""

from __future__ import annotations

from typing import TYPE_CHECKING

from .routes import find_item, resolve_safe_image_path

if TYPE_CHECKING:
    from PIL import Image

RESIZE_MODES = [
    "原图尺寸",
    "指定尺寸（居中裁剪）",
    "指定尺寸（留白填充）",
]

STYLE_PRESETS = {
    "高清日系动漫": (
        "日系二次元动漫插画风格，精致五官，赛璐璐与厚涂结合，光影通透，高画质杰作",
        "anime illustration, cel shading and soft lighting, clean lineart, masterpiece, best quality",
    ),
    "写实摄影人像": (
        "电影级写实人像摄影，85mm定焦镜头，真实皮肤质感，自然景深与柔美布光，8K超清",
        "photorealistic portrait photography, 85mm lens, realistic skin texture, cinematic lighting, 8k",
    ),
    "韩系半厚涂插画": (
        "韩系唯美半厚涂角色立绘，细腻丝滑高光，柔美体积感，高级色彩搭配",
        "semi-realistic anime character art, smooth rendering, luminous highlights, refined color palette",
    ),
    "干净角色设定图": (
        "游戏角色立绘设定图，干净浅灰/纯白背景，轮廓清晰，服装材质与褶皱细节丰富",
        "character design reference sheet, clean light background, crisp silhouette, detailed fabric folds",
    ),
}


def _pil_to_comfy_tensor(img: Image.Image):
    import numpy as np
    import torch

    rgb = img.convert("RGB")
    arr = np.asarray(rgb, dtype=np.float32) / 255.0
    return torch.from_numpy(arr).unsqueeze(0)


def _load_pil_image(
    rel_path: str,
    resize_mode: str = "原图尺寸",
    width: int = 1024,
    height: int = 1280,
    flip_horizontal: bool = False,
) -> Image.Image:
    from PIL import Image, ImageOps

    path = resolve_safe_image_path(rel_path)
    img = Image.open(path)
    img = ImageOps.exif_transpose(img).convert("RGB")

    if flip_horizontal:
        img = ImageOps.mirror(img)

    target_w = max(64, int(width))
    target_h = max(64, int(height))

    if resize_mode == "指定尺寸（居中裁剪）":
        img = ImageOps.fit(img, (target_w, target_h), method=Image.Resampling.LANCZOS)
    elif resize_mode == "指定尺寸（留白填充）":
        img = ImageOps.pad(
            img,
            (target_w, target_h),
            method=Image.Resampling.LANCZOS,
            color=(245, 245, 247),
        )

    return img


def _build_pose_prompts(item: dict) -> tuple[str, str]:
    title = item.get("姿势名称") or item.get("标题") or "标准姿势"
    system = item.get("体系", "")
    cat = item.get("分类", "")
    angle = item.get("角度", "正面")
    zh = f"{angle}视角，动作：{title}（{system}·{cat}）"
    en = f"{angle} view, pose: {title} ({cat})"
    return zh, en


def _build_costume_prompts(item: dict) -> tuple[str, str]:
    title = item.get("服装名称") or item.get("标题") or ""
    cat = item.get("分类", "")
    tags = "、".join(item.get("标签", [])[:8])
    desc_en = item.get("关键词", "") or title
    zh = f"身穿{cat}：{title}" + (f"（细节：{tags}）" if tags else "")
    return zh, desc_en


def _build_portrait_prompts(item: dict) -> tuple[str, str]:
    title = item.get("标题", "")
    section = item.get("分区", "")
    hair_len = item.get("发长", "")
    hair_style = item.get("发型名称") or item.get("发型") or ""
    zh = f"人物面部与发型：{hair_len}、{hair_style}（{section}，{title}）"
    en = f"character hairstyle and face reference: {hair_len}, {hair_style}"
    return zh, en


class PoseGalleryNode:
    """从 1,439 张 3D 素体姿势库中选择姿势参考图并输出 IMAGE 与提示词。"""

    @classmethod
    def INPUT_TYPES(cls):
        return {
            "required": {
                "image_id": (
                    "STRING",
                    {"default": "full_single_P001_front", "multiline": False},
                ),
                "resize_mode": (RESIZE_MODES, {"default": "原图尺寸"}),
                "width": ("INT", {"default": 1024, "min": 64, "max": 4096, "step": 8}),
                "height": ("INT", {"default": 1280, "min": 64, "max": 4096, "step": 8}),
                "flip_horizontal": ("BOOLEAN", {"default": False}),
            }
        }

    RETURN_TYPES = ("IMAGE", "STRING", "STRING")
    RETURN_NAMES = ("姿势图", "图片ID", "姿势提示词")
    FUNCTION = "load_pose"
    CATEGORY = "AI角色三合一参考图集"

    def load_pose(
        self,
        image_id: str = "full_single_P001_front",
        resize_mode: str = "原图尺寸",
        width: int = 1024,
        height: int = 1280,
        flip_horizontal: bool = False,
    ):
        item = find_item("pose", image_id)
        pil_img = _load_pil_image(
            item["原图"],
            resize_mode=resize_mode,
            width=width,
            height=height,
            flip_horizontal=flip_horizontal,
        )
        zh_prompt, _ = _build_pose_prompts(item)
        return (_pil_to_comfy_tensor(pil_img), item["id"], zh_prompt)


class CostumeGalleryNode:
    """从 1,407 套穿搭服装库中选择服装参考图并输出 IMAGE 与中英文服装 Prompt。"""

    @classmethod
    def INPUT_TYPES(cls):
        return {
            "required": {
                "image_id": ("STRING", {"default": "SPR-0001", "multiline": False}),
                "resize_mode": (RESIZE_MODES, {"default": "原图尺寸"}),
                "width": ("INT", {"default": 1024, "min": 64, "max": 4096, "step": 8}),
                "height": ("INT", {"default": 1280, "min": 64, "max": 4096, "step": 8}),
                "flip_horizontal": ("BOOLEAN", {"default": False}),
            }
        }

    RETURN_TYPES = ("IMAGE", "STRING", "STRING", "STRING")
    RETURN_NAMES = ("服装图", "图片ID", "中文服装描述", "英文服装Prompt")
    FUNCTION = "load_costume"
    CATEGORY = "AI角色三合一参考图集"

    def load_costume(
        self,
        image_id: str = "SPR-0001",
        resize_mode: str = "原图尺寸",
        width: int = 1024,
        height: int = 1280,
        flip_horizontal: bool = False,
    ):
        item = find_item("costume", image_id)
        pil_img = _load_pil_image(
            item["原图"],
            resize_mode=resize_mode,
            width=width,
            height=height,
            flip_horizontal=flip_horizontal,
        )
        zh_prompt, en_prompt = _build_costume_prompts(item)
        return (_pil_to_comfy_tensor(pil_img), item["id"], zh_prompt, en_prompt)


class PortraitGalleryNode:
    """从 1,499 张精细人像与发型库中选择人像参考图并输出 IMAGE 与发型描述。"""

    @classmethod
    def INPUT_TYPES(cls):
        return {
            "required": {
                "image_id": ("STRING", {"default": "f71f980dde3", "multiline": False}),
                "resize_mode": (RESIZE_MODES, {"default": "原图尺寸"}),
                "width": ("INT", {"default": 1024, "min": 64, "max": 4096, "step": 8}),
                "height": ("INT", {"default": 1280, "min": 64, "max": 4096, "step": 8}),
                "flip_horizontal": ("BOOLEAN", {"default": False}),
            }
        }

    RETURN_TYPES = ("IMAGE", "STRING", "STRING")
    RETURN_NAMES = ("人像图", "图片ID", "人像发型描述")
    FUNCTION = "load_portrait"
    CATEGORY = "AI角色三合一参考图集"

    def load_portrait(
        self,
        image_id: str = "f71f980dde3",
        resize_mode: str = "原图尺寸",
        width: int = 1024,
        height: int = 1280,
        flip_horizontal: bool = False,
    ):
        item = find_item("portrait", image_id)
        pil_img = _load_pil_image(
            item["原图"],
            resize_mode=resize_mode,
            width=width,
            height=height,
            flip_horizontal=flip_horizontal,
        )
        zh_prompt, _ = _build_portrait_prompts(item)
        return (_pil_to_comfy_tensor(pil_img), item["id"], zh_prompt)


class CharacterRecipeNode:
    """三合一角色合成配方节点：同时输出人像图、服装图、姿势图、三合一横向拼图，以及自动组装的中英文合成 Prompt。"""

    @classmethod
    def INPUT_TYPES(cls):
        return {
            "required": {
                "portrait_id": (
                    "STRING",
                    {"default": "f71f980dde3", "multiline": False},
                ),
                "costume_id": ("STRING", {"default": "SPR-0001", "multiline": False}),
                "pose_id": (
                    "STRING",
                    {"default": "full_single_P001_front", "multiline": False},
                ),
                "style_preset": (
                    list(STYLE_PRESETS.keys()),
                    {"default": "高清日系动漫"},
                ),
                "extra_prompt": (
                    "STRING",
                    {
                        "default": "",
                        "multiline": True,
                        "placeholder": "可选补充提示词（例如：银色双眸、教室窗边逆光、微风吹拂发丝）",
                    },
                ),
                "resize_mode": (RESIZE_MODES, {"default": "指定尺寸（居中裁剪）"}),
                "width": ("INT", {"default": 1024, "min": 64, "max": 4096, "step": 8}),
                "height": ("INT", {"default": 1280, "min": 64, "max": 4096, "step": 8}),
                "flip_pose_horizontal": ("BOOLEAN", {"default": False}),
            }
        }

    RETURN_TYPES = ("IMAGE", "IMAGE", "IMAGE", "IMAGE", "STRING", "STRING")
    RETURN_NAMES = (
        "人像图",
        "服装图",
        "姿势图",
        "三合一拼图",
        "中文合成Prompt",
        "英文合成Prompt",
    )
    FUNCTION = "build_recipe"
    CATEGORY = "AI角色三合一参考图集"

    def build_recipe(
        self,
        portrait_id: str = "f71f980dde3",
        costume_id: str = "SPR-0001",
        pose_id: str = "full_single_P001_front",
        style_preset: str = "高清日系动漫",
        extra_prompt: str = "",
        resize_mode: str = "指定尺寸（居中裁剪）",
        width: int = 1024,
        height: int = 1280,
        flip_pose_horizontal: bool = False,
    ):
        portrait_item = find_item("portrait", portrait_id)
        costume_item = find_item("costume", costume_id)
        pose_item = find_item("pose", pose_id)

        portrait_pil = _load_pil_image(
            portrait_item["原图"], resize_mode=resize_mode, width=width, height=height
        )
        costume_pil = _load_pil_image(
            costume_item["原图"], resize_mode=resize_mode, width=width, height=height
        )
        pose_pil = _load_pil_image(
            pose_item["原图"],
            resize_mode=resize_mode,
            width=width,
            height=height,
            flip_horizontal=flip_pose_horizontal,
        )

        # 生成三合一横向参考拼图（人像 | 服装 | 姿势）
        from PIL import Image, ImageOps

        panel_h = max(256, int(height))
        panel_w = max(256, int(width))
        p1 = ImageOps.fit(
            portrait_pil, (panel_w, panel_h), method=Image.Resampling.LANCZOS
        )
        p2 = ImageOps.fit(
            costume_pil, (panel_w, panel_h), method=Image.Resampling.LANCZOS
        )
        p3 = ImageOps.fit(pose_pil, (panel_w, panel_h), method=Image.Resampling.LANCZOS)
        gap = 12
        composite = Image.new("RGB", (panel_w * 3 + gap * 2, panel_h), (24, 24, 29))
        composite.paste(p1, (0, 0))
        composite.paste(p2, (panel_w + gap, 0))
        composite.paste(p3, ((panel_w + gap) * 2, 0))

        portrait_zh, portrait_en = _build_portrait_prompts(portrait_item)
        costume_zh, costume_en = _build_costume_prompts(costume_item)
        pose_zh, pose_en = _build_pose_prompts(pose_item)
        style_zh, style_en = STYLE_PRESETS.get(
            style_preset, STYLE_PRESETS["高清日系动漫"]
        )

        extra_clean = (extra_prompt or "").strip()
        zh_parts = [
            f"请融合参考图生成一张完整的角色立绘：{style_zh}。",
            f"【人像与发型】{portrait_zh}；",
            f"【服装与配饰】{costume_zh}；",
            f"【身体姿势与构图】{pose_zh}。",
        ]
        if extra_clean:
            zh_parts.append(f"【补充细节】{extra_clean}。")
        zh_parts.append(
            "要求人物面部自然生动，服装穿戴贴合身体动态，肢体透视与手部结构准确，光影和谐统一。"
        )

        en_parts = [
            style_en,
            portrait_en,
            f"wearing {costume_en}",
            pose_en,
        ]
        if extra_clean:
            en_parts.append(extra_clean)

        return (
            _pil_to_comfy_tensor(portrait_pil),
            _pil_to_comfy_tensor(costume_pil),
            _pil_to_comfy_tensor(pose_pil),
            _pil_to_comfy_tensor(composite),
            "".join(zh_parts),
            ", ".join(en_parts),
        )


POSE_SYSTEMS = ["全部", "全身单人・标准系", "上半身单人", "全身单人・性感系", "双人缠绵"]
POSE_ANGLES = ["全部", "正面", "俯视", "仰视", "侧面", "斜侧"]
NSFW_POSE_SYSTEMS = {"全身单人・性感系", "双人缠绵"}


def _pose_categories() -> list[str]:
    try:
        from .routes import load_library

        cats = sorted({it.get("分类", "") for it in load_library("pose") if it.get("分类")})
    except Exception:  # noqa: BLE001 - 数据缺失时仍允许节点注册
        cats = []
    return ["全部"] + cats


def select_pose_batch(
    system: str = "全部",
    category: str = "全部",
    angle: str = "全部",
    start_index: int = 0,
    count: int = 8,
    shuffle: bool = False,
    seed: int = 0,
    include_nsfw: bool = False,
) -> list[dict]:
    """按条件筛选姿势条目（纯数据逻辑，便于单独测试）。"""
    import random

    from .routes import load_library

    items = load_library("pose")
    out = [
        it
        for it in items
        if (include_nsfw or it.get("体系") not in NSFW_POSE_SYSTEMS)
        and (system == "全部" or it.get("体系") == system)
        and (category == "全部" or it.get("分类") == category)
        and (angle == "全部" or it.get("角度") == angle)
    ]
    if shuffle:
        random.Random(seed).shuffle(out)
    start = max(0, int(start_index))
    return out[start : start + max(1, int(count))]


class PoseBatchNode:
    """按体系 / 分类 / 视角批量遍历姿势库，输出图片列表。

    下游节点会对列表中的每一张姿势图各执行一次：固定人像和服装、只换姿势，
    一次排队就能批量生成同一角色的多张图（适合做角色 LoRA 训练集或多镜头素材）。
    """

    @classmethod
    def INPUT_TYPES(cls):
        return {
            "required": {
                "体系": (POSE_SYSTEMS, {"default": "全身单人・标准系"}),
                "分类": (_pose_categories(), {"default": "全部"}),
                "视角": (POSE_ANGLES, {"default": "正面"}),
                "起始序号": ("INT", {"default": 0, "min": 0, "max": 2000}),
                "数量": ("INT", {"default": 8, "min": 1, "max": 200}),
                "随机打乱": ("BOOLEAN", {"default": False}),
                "随机种子": ("INT", {"default": 0, "min": 0, "max": 0xFFFFFFFF}),
                "包含18+": ("BOOLEAN", {"default": False}),
                "resize_mode": (RESIZE_MODES, {"default": "原图尺寸"}),
                "width": ("INT", {"default": 1024, "min": 64, "max": 4096, "step": 8}),
                "height": ("INT", {"default": 1280, "min": 64, "max": 4096, "step": 8}),
            }
        }

    RETURN_TYPES = ("IMAGE", "STRING", "STRING", "STRING", "INT")
    RETURN_NAMES = ("姿势图列表", "图片ID列表", "中文姿势提示词列表", "英文姿势提示词列表", "数量")
    OUTPUT_IS_LIST = (True, True, True, True, False)
    FUNCTION = "load_batch"
    CATEGORY = "AI角色三合一参考图集"

    def load_batch(self, **kw):
        picked = select_pose_batch(
            system=kw.get("体系", "全部"),
            category=kw.get("分类", "全部"),
            angle=kw.get("视角", "全部"),
            start_index=kw.get("起始序号", 0),
            count=kw.get("数量", 8),
            shuffle=kw.get("随机打乱", False),
            seed=kw.get("随机种子", 0),
            include_nsfw=kw.get("包含18+", False),
        )
        if not picked:
            raise ValueError("没有符合条件的姿势，请放宽体系 / 分类 / 视角筛选")
        images, ids, zh_list, en_list = [], [], [], []
        for item in picked:
            pil = _load_pil_image(
                item["原图"],
                resize_mode=kw.get("resize_mode", "原图尺寸"),
                width=kw.get("width", 1024),
                height=kw.get("height", 1280),
            )
            zh, en = _build_pose_prompts(item)
            images.append(_pil_to_comfy_tensor(pil))
            ids.append(item["id"])
            zh_list.append(zh)
            en_list.append(en)
        return (images, ids, zh_list, en_list, len(picked))


def save_lora_dataset(images, captions: list[str], trigger: str, out_dir) -> int:
    """把图片与打标文本成对保存为 0001.png + 0001.txt（纯逻辑，便于测试）。"""
    from pathlib import Path

    from PIL import Image

    out = Path(out_dir)
    out.mkdir(parents=True, exist_ok=True)
    existing = sorted(out.glob("*.png"))
    idx = len(existing)
    saved = 0
    for i, img in enumerate(images):
        batch = img if getattr(img, "ndim", 3) == 4 else [img]
        caption = captions[i] if i < len(captions) else (captions[-1] if captions else "")
        for frame in batch:
            import numpy as np

            arr = np.clip(np.asarray(frame.cpu() if hasattr(frame, "cpu") else frame) * 255.0, 0, 255).astype(np.uint8)
            idx += 1
            Image.fromarray(arr).save(out / f"{idx:04d}.png")
            text = ", ".join(x for x in [trigger.strip(), caption.strip()] if x)
            (out / f"{idx:04d}.txt").write_text(text, encoding="utf-8")
            saved += 1
    return saved


class LoraDatasetSaverNode:
    """把批量生成的角色图和对应提示词保存成 LoRA 训练集（图片 + 同名 .txt 打标文件）。"""

    INPUT_IS_LIST = True

    @classmethod
    def INPUT_TYPES(cls):
        return {
            "required": {
                "图片": ("IMAGE",),
                "打标文本": ("STRING", {"forceInput": True}),
                "触发词": ("STRING", {"default": "mychar", "multiline": False}),
                "数据集文件夹": ("STRING", {"default": "lora_dataset/mychar", "multiline": False}),
            }
        }

    RETURN_TYPES = ("STRING",)
    RETURN_NAMES = ("保存目录",)
    OUTPUT_NODE = True
    FUNCTION = "save"
    CATEGORY = "AI角色三合一参考图集"

    def save(self, **kw):
        from pathlib import Path

        try:
            import folder_paths

            base = Path(folder_paths.get_output_directory())
        except ImportError:
            base = Path.cwd() / "output"
        folder = (kw.get("数据集文件夹") or ["lora_dataset"])[0].strip().strip("/\\") or "lora_dataset"
        target = (base / folder).resolve()
        if not target.is_relative_to(base.resolve()):
            raise ValueError("数据集文件夹必须位于 ComfyUI output 目录内")
        trigger = (kw.get("触发词") or [""])[0]
        n = save_lora_dataset(kw.get("图片") or [], list(kw.get("打标文本") or []), trigger, target)
        return {"ui": {"text": [f"已保存 {n} 张到 {target}"]}, "result": (str(target),)}


NODE_CLASS_MAPPINGS = {
    "PoseGalleryNode": PoseGalleryNode,
    "CostumeGalleryNode": CostumeGalleryNode,
    "PortraitGalleryNode": PortraitGalleryNode,
    "CharacterRecipeNode": CharacterRecipeNode,
    "PoseBatchNode": PoseBatchNode,
    "LoraDatasetSaverNode": LoraDatasetSaverNode,
}

NODE_DISPLAY_NAME_MAPPINGS = {
    "PoseGalleryNode": "AI 姿势参考图 (Pose Gallery)",
    "CostumeGalleryNode": "AI 服装参考图 (Costume Gallery)",
    "PortraitGalleryNode": "AI 人像参考图 (Portrait Gallery)",
    "CharacterRecipeNode": "AI 角色三合一合成配方 (3-in-1 Recipe)",
    "PoseBatchNode": "AI 姿势批量遍历 (Pose Batch)",
    "LoraDatasetSaverNode": "保存 LoRA 训练集 (图片+打标)",
}
