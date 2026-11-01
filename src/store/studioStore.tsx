import { createContext, type ReactNode, useContext, useEffect, useRef, useState } from 'react'
import { toast } from 'sonner'
import { isNsfwCostume, isNsfwPose } from '@/api/gallery'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog'
import { idbGet, idbSet } from '@/lib/idbStorage'
import { recipeBackup } from '@/lib/recipeImages'
import {
  buildRecipePrompt,
  type PromptOptions,
  COMFYUI_WORKFLOW_TEMPLATES,
  DEFAULT_COMFY_PRESET,
  generateCharacterImage,
  type GenerationProgress,
  PROVIDER_META,
  stitchRecipeCanvas,
} from '@/services/aiGenerator'
import type {
  ApiConfig,
  ComfyUiParams,
  CostumeItem,
  DoubaoParams,
  ExtraReferenceImage,
  ExtraSlotKind,
  SlotAssetRef,
  VideoWorkflowParams,
  GeminiParams,
  GenerationHistoryItem,
  GptParams,
  ImageProviderId,
  PortraitItem,
  PoseItem,
  ProviderEndpointConfig,
  QwenParams,
  RecipeState,
} from '@/types/gallery'

const CFG_KEY = 'pose_atlas_api_config_v3'
const RECIPE_KEY = 'pose_atlas_recipe_v3'
const HISTORY_KEY = 'pose_atlas_history_v3'
const SAFE_MODE_KEY = 'pose_atlas_safe_mode_v1'

const COMFY_CONFIG_VERSION = 2

// 安全模式默认值：本机运行（pnpm dev / localhost）默认关闭，部署到公网的站点默认开启。
// 可用环境变量 VITE_SAFE_MODE=on / off 强制指定。页面顶部按钮切换后以用户的选择为准。
const DEFAULT_SAFE_MODE = (() => {
  const env = import.meta.env.VITE_SAFE_MODE as string | undefined
  if (env === 'on') return true
  if (env === 'off') return false
  if (import.meta.env.DEV) return false
  return !(typeof window !== 'undefined' && ['localhost', '127.0.0.1', '[::1]'].includes(window.location.hostname))
})()

const DEFAULT_API_CONFIG: ApiConfig = {
  activeProvider: 'gemini',
  imagePassMode: 'url',
  useProxy: true,
  stylePreset: 'realistic',
  promptLang: 'zh',
  customStyles: [],
  sendStitchedSheet: false,
  providers: {
    gemini: {
      baseUrl: PROVIDER_META.gemini.defaultBaseUrl,
      apiKey: '',
      model: PROVIDER_META.gemini.models[0].value,
      customModel: '',
    },
    gpt: {
      baseUrl: PROVIDER_META.gpt.defaultBaseUrl,
      apiKey: '',
      model: PROVIDER_META.gpt.models[0].value,
      customModel: '',
    },
    qwen: {
      baseUrl: PROVIDER_META.qwen.defaultBaseUrl,
      apiKey: '',
      model: PROVIDER_META.qwen.models[0].value,
      customModel: '',
    },
    doubao: {
      baseUrl: PROVIDER_META.doubao.defaultBaseUrl,
      apiKey: '',
      model: PROVIDER_META.doubao.models[0].value,
      customModel: '',
    },
    comfyui: {
      baseUrl: PROVIDER_META.comfyui.defaultBaseUrl,
      apiKey: '',
      model: PROVIDER_META.comfyui.models[0].value,
      customModel: '',
    },
  },
  gptParams: {
    endpointMode: 'images_edits_json',
    size: '1024x1536',
    quality: 'high',
    inputFidelity: 'high',
    background: 'auto',
    outputFormat: 'png',
    moderation: 'auto',
  },
  geminiParams: {
    endpointMode: 'native',
    aspectRatio: '3:4',
    imageSize: '2K',
  },
  qwenParams: {
    size: '1024*1536',
    promptExtend: true,
    watermark: false,
    negativePrompt: '',
    n: 1,
  },
  doubaoParams: {
    size: '2K',
    sequentialImageGeneration: 'disabled',
    watermark: false,
    responseFormat: 'b64_json',
  },
  comfyuiParams: {
    workflowPreset: DEFAULT_COMFY_PRESET,
    workflowJson: JSON.stringify(COMFYUI_WORKFLOW_TEMPLATES[DEFAULT_COMFY_PRESET].workflow, null, 2),
    ...COMFYUI_WORKFLOW_TEMPLATES[DEFAULT_COMFY_PRESET].defaults,
    randomizeSeed: true,
    timeoutSec: 600,
    configVersion: COMFY_CONFIG_VERSION,
  },
  videoParams: {
    workflowJson: '',
    imageNodeId: 'none',
    promptNodeId: 'none',
    timeoutSec: 1800,
    randomizeSeed: true,
  },
}

// v1 → v2：旧版默认的 Qwen 2.1 预设引用了本机通常不存在的模型，自动切换为 Qwen Image Edit 2509
const LEGACY_COMFY_BASE_URLS = ['http://127.0.0.1:8188', 'http://localhost:8188']

function migrateComfy(
  provider: ApiConfig['providers']['comfyui'],
  params: ApiConfig['comfyuiParams']
): { provider: ApiConfig['providers']['comfyui']; params: ApiConfig['comfyuiParams'] } {
  if ((params.configVersion ?? 1) >= COMFY_CONFIG_VERSION) return { provider, params }
  const nextParams = { ...params, configVersion: COMFY_CONFIG_VERSION }
  if (params.workflowPreset === 'qwen21_3img' || params.workflowPreset === 'qwen21_2img') {
    Object.assign(nextParams, {
      workflowPreset: DEFAULT_COMFY_PRESET,
      workflowJson: JSON.stringify(COMFYUI_WORKFLOW_TEMPLATES[DEFAULT_COMFY_PRESET].workflow, null, 2),
      ...COMFYUI_WORKFLOW_TEMPLATES[DEFAULT_COMFY_PRESET].defaults,
    })
  }
  const nextProvider = { ...provider }
  if (!nextProvider.baseUrl.trim() || LEGACY_COMFY_BASE_URLS.includes(nextProvider.baseUrl.trim())) {
    nextProvider.baseUrl = PROVIDER_META.comfyui.defaultBaseUrl
  }
  if (!PROVIDER_META.comfyui.models.some((m) => m.value === nextProvider.model)) {
    nextProvider.model = PROVIDER_META.comfyui.models[0].value
  }
  return { provider: nextProvider, params: nextParams }
}

function mergeStoredConfig(raw: unknown): ApiConfig {
  if (!raw || typeof raw !== 'object') return DEFAULT_API_CONFIG
  const obj = raw as Partial<ApiConfig>
  const comfy = migrateComfy(
    { ...DEFAULT_API_CONFIG.providers.comfyui, ...obj.providers?.comfyui },
    { ...DEFAULT_API_CONFIG.comfyuiParams, configVersion: 1, ...obj.comfyuiParams }
  )
  return {
    ...DEFAULT_API_CONFIG,
    ...obj,
    providers: {
      gemini: { ...DEFAULT_API_CONFIG.providers.gemini, ...obj.providers?.gemini },
      gpt: { ...DEFAULT_API_CONFIG.providers.gpt, ...obj.providers?.gpt },
      qwen: { ...DEFAULT_API_CONFIG.providers.qwen, ...obj.providers?.qwen },
      doubao: { ...DEFAULT_API_CONFIG.providers.doubao, ...obj.providers?.doubao },
      comfyui: comfy.provider,
    },
    gptParams: { ...DEFAULT_API_CONFIG.gptParams, ...obj.gptParams },
    geminiParams: { ...DEFAULT_API_CONFIG.geminiParams, ...obj.geminiParams },
    qwenParams: { ...DEFAULT_API_CONFIG.qwenParams, ...obj.qwenParams },
    doubaoParams: { ...DEFAULT_API_CONFIG.doubaoParams, ...obj.doubaoParams },
    comfyuiParams: comfy.params,
    videoParams: { ...DEFAULT_API_CONFIG.videoParams, ...obj.videoParams },
    customStyles: Array.isArray(obj.customStyles) ? obj.customStyles : [],
    promptLang: obj.promptLang === 'en' ? 'en' : 'zh',
  }
}

/** 当前配置下应使用的提示词选项（语言、自定义画风、骨架预设） */
// oxlint-disable-next-line react/only-export-components
export function promptOptionsFor(config: ApiConfig): PromptOptions {
  return {
    lang: config.promptLang,
    customStyles: config.customStyles,
    poseSkeleton: config.activeProvider === 'comfyui' && config.comfyuiParams.workflowPreset === 'qwen2509_3img_dwpose',
  }
}

// oxlint-disable-next-line react/only-export-components
export function recipeSummaryText(recipe: RecipeState): string {
  const extraCount = (recipe.extraImages || []).length
  return [
    recipe.portrait?.发型名称,
    recipe.costume?.source === 'upload' ? recipe.costume.服装名称 : recipe.costume?.分类,
    recipe.pose ? `${recipe.pose.姿势名称}${recipe.pose.角度 ? `(${recipe.pose.角度})` : ''}` : null,
    recipe.scene ? `场景:${recipe.scene.name}` : null,
    recipe.expression ? `表情:${recipe.expression.name}` : null,
    recipe.prop ? `道具:${recipe.prop.name}` : null,
    extraCount ? `+${extraCount}附图` : null,
  ]
    .filter(Boolean)
    .join(' + ')
}

export interface BatchJob {
  label: string
  recipe: RecipeState
  /** 不传则按该配方自动生成提示词 */
  prompt?: string
}

export interface BatchResult {
  label: string
  imageUrl: string
  recipe: RecipeState
  prompt: string
}

export interface BatchState {
  title: string
  total: number
  done: number
  current: string
  results: BatchResult[]
  errors: string[]
  running: boolean
}

interface StudioContextValue {
  recipe: RecipeState
  apiConfig: ApiConfig
  history: GenerationHistoryItem[]
  safeMode: boolean
  toggleSafeMode: () => void
  requestUnlockNsfw: (onUnlocked?: () => void) => void
  // 全局持久化的合成台状态（切换页面不丢失、不断开请求）
  customPrompt: string | null
  setCustomPrompt: (val: string | null) => void
  previewUrl: string
  setPreviewUrl: (url: string) => void
  isGenerating: boolean
  generatingModel: string
  generationProgress: GenerationProgress | null
  generationError: string
  startGeneration: (overridePrompt?: string) => Promise<void>
  refreshStitchPreview: () => Promise<void>
  setPortrait: (item: PortraitItem | null) => void
  setCostume: (item: CostumeItem | null) => void
  setPose: (item: PoseItem | null) => void
  togglePortrait: (item: PortraitItem) => void
  toggleCostume: (item: CostumeItem) => void
  togglePose: (item: PoseItem) => void
  addExtraImage: (item: { name: string; url: string }) => void
  removeExtraImage: (id: string) => void
  updateExtraImageName: (id: string, name: string) => void
  clearRecipe: () => void
  randomizeRecipe: (pools: { portraits?: PortraitItem[]; costumes?: CostumeItem[]; poses?: PoseItem[] }) => void
  updateApiConfig: (patch: Partial<ApiConfig>) => void
  updateProviderConfig: (provider: ImageProviderId, patch: Partial<ProviderEndpointConfig>) => void
  updateGptParams: (patch: Partial<GptParams>) => void
  updateGeminiParams: (patch: Partial<GeminiParams>) => void
  updateQwenParams: (patch: Partial<QwenParams>) => void
  updateDoubaoParams: (patch: Partial<DoubaoParams>) => void
  updateComfyUiParams: (patch: Partial<ComfyUiParams>) => void
  updateVideoParams: (patch: Partial<VideoWorkflowParams>) => void
  setSlotAsset: (kind: ExtraSlotKind, ref: SlotAssetRef | null) => void
  replaceRecipe: (next: RecipeState) => void
  batch: BatchState | null
  runBatch: (title: string, jobs: BatchJob[]) => Promise<BatchResult[]>
  cancelBatch: () => void
  clearBatch: () => void
  addHistory: (item: Omit<GenerationHistoryItem, 'id' | 'createdAt'>) => void
  removeHistoryItem: (id: string) => void
  clearHistory: () => void
}

const StudioContext = createContext<StudioContextValue | null>(null)

export function StudioProvider({ children }: { children: ReactNode }) {
  const [recipe, setRecipe] = useState<RecipeState>(() => {
    try {
      const raw = localStorage.getItem(RECIPE_KEY)
      if (!raw) return { portrait: null, costume: null, pose: null, extraImages: [] }
      const parsed = JSON.parse(raw)
      return {
        portrait: parsed.portrait ?? null,
        costume: parsed.costume ?? null,
        pose: parsed.pose ?? null,
        scene: parsed.scene ?? null,
        expression: parsed.expression ?? null,
        prop: parsed.prop ?? null,
        extraImages: Array.isArray(parsed.extraImages) ? parsed.extraImages : [],
      }
    } catch {
      return { portrait: null, costume: null, pose: null, extraImages: [] }
    }
  })

  const [apiConfig, setApiConfig] = useState<ApiConfig>(() => {
    try {
      const raw = localStorage.getItem(CFG_KEY)
      return raw ? mergeStoredConfig(JSON.parse(raw)) : DEFAULT_API_CONFIG
    } catch {
      return DEFAULT_API_CONFIG
    }
  })

  const [history, setHistory] = useState<GenerationHistoryItem[]>(() => {
    try {
      const raw = localStorage.getItem(HISTORY_KEY)
      return raw ? JSON.parse(raw) : []
    } catch {
      return []
    }
  })

  const [safeMode, setSafeMode] = useState<boolean>(() => {
    try {
      const raw = localStorage.getItem(SAFE_MODE_KEY)
      return raw === null ? DEFAULT_SAFE_MODE : raw !== 'false'
    } catch {
      return DEFAULT_SAFE_MODE
    }
  })
  const [ageGateOpen, setAgeGateOpen] = useState(false)
  const pendingUnlockCbRef = useRef<(() => void) | null>(null)

  // 提升到根部 Provider 的生成状态，路由切换不会卸载或中断
  const [customPrompt, setCustomPrompt] = useState<string | null>(null)
  const [previewUrl, setPreviewUrl] = useState<string>(() => {
    try {
      const raw = localStorage.getItem(HISTORY_KEY)
      const list = raw ? JSON.parse(raw) : []
      return list[0]?.imageUrl || ''
    } catch {
      return ''
    }
  })
  const [isGenerating, setIsGenerating] = useState(false)
  const [generatingModel, setGeneratingModel] = useState('')
  const [generationProgress, setGenerationProgress] = useState<GenerationProgress | null>(null)
  const [generationError, setGenerationError] = useState('')
  const isGeneratingRef = useRef(false)
  const [idbHydrated, setIdbHydrated] = useState(false)

  // 从 IndexedDB 异步恢复大容量历史记录与含附图的配方
  useEffect(() => {
    let active = true
    Promise.all([
      idbGet<RecipeState>(RECIPE_KEY),
      idbGet<GenerationHistoryItem[]>(HISTORY_KEY),
    ]).then(([savedRecipe, savedHistory]) => {
      if (!active) return
      if (savedRecipe) {
        setRecipe({
          portrait: savedRecipe.portrait ?? null,
          costume: savedRecipe.costume ?? null,
          pose: savedRecipe.pose ?? null,
          scene: savedRecipe.scene ?? null,
          expression: savedRecipe.expression ?? null,
          prop: savedRecipe.prop ?? null,
          extraImages: Array.isArray(savedRecipe.extraImages) ? savedRecipe.extraImages : [],
        })
      }
      if (Array.isArray(savedHistory) && savedHistory.length > 0) {
        setHistory(savedHistory)
        setPreviewUrl((prev) => prev || savedHistory[0]?.imageUrl || '')
      }
      setIdbHydrated(true)
    })
    return () => {
      active = false
    }
  }, [])

  useEffect(() => {
    if (!idbHydrated) return
    void idbSet(RECIPE_KEY, recipe)
    try {
      // 上传图片和附图完整保存在 IndexedDB，轻量备份不包含它们。
      localStorage.setItem(
        RECIPE_KEY,
        JSON.stringify(recipeBackup(recipe))
      )
    } catch {}
  }, [recipe, idbHydrated])

  useEffect(() => {
    try {
      localStorage.setItem(CFG_KEY, JSON.stringify(apiConfig))
    } catch {}
  }, [apiConfig])

  useEffect(() => {
    try {
      localStorage.setItem(SAFE_MODE_KEY, String(safeMode))
    } catch {}
  }, [safeMode])

  const requestUnlockNsfw = (onUnlocked?: () => void) => {
    if (!safeMode) {
      onUnlocked?.()
      return
    }
    pendingUnlockCbRef.current = onUnlocked || null
    setAgeGateOpen(true)
  }

  const confirmUnlockNsfw = () => {
    setSafeMode(false)
    setAgeGateOpen(false)
    toast.success('已解锁 18+ 完整图库模式')
    const cb = pendingUnlockCbRef.current
    pendingUnlockCbRef.current = null
    cb?.()
  }

  const toggleSafeMode = () => {
    if (safeMode) {
      requestUnlockNsfw()
    } else {
      setSafeMode(true)
      toast.success('已开启安全模式（已隐藏 18+ 敏感分类）')
    }
  }

  useEffect(() => {
    if (!idbHydrated) return
    void idbSet(HISTORY_KEY, history.slice(0, 30))
  }, [history, idbHydrated])

  const setPortrait = (portrait: PortraitItem | null) => setRecipe((r) => ({ ...r, portrait }))
  const setCostume = (costume: CostumeItem | null) => setRecipe((r) => ({ ...r, costume }))
  const setPose = (pose: PoseItem | null) => setRecipe((r) => ({ ...r, pose }))

  const togglePortrait = (item: PortraitItem) => {
    setRecipe((r) => {
      const remove = r.portrait?.id === item.id
      toast.success(remove ? '已移除人像' : `已选人像：${item.发型名称}`)
      return { ...r, portrait: remove ? null : item }
    })
  }

  const toggleCostume = (item: CostumeItem) => {
    setRecipe((r) => {
      const remove = r.costume?.id === item.id
      toast.success(remove ? '已移除服装' : `已选服装：${item.服装名称}`)
      return { ...r, costume: remove ? null : item }
    })
  }

  const togglePose = (item: PoseItem) => {
    setRecipe((r) => {
      const remove = r.pose?.id === item.id
      toast.success(remove ? '已移除姿势' : `已选姿势：${item.姿势名称}（${item.角度}）`)
      return { ...r, pose: remove ? null : item }
    })
  }

  const addExtraImage = (item: { name: string; url: string }) => {
    const newImg: ExtraReferenceImage = {
      id: `${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
      name: item.name || '附加参考',
      url: item.url,
    }
    setRecipe((r) => ({
      ...r,
      extraImages: [...(r.extraImages || []), newImg],
    }))
    toast.success('已添加附加参考图')
  }

  const removeExtraImage = (id: string) => {
    setRecipe((r) => ({
      ...r,
      extraImages: (r.extraImages || []).filter((x) => x.id !== id),
    }))
  }

  const updateExtraImageName = (id: string, name: string) => {
    setRecipe((r) => ({
      ...r,
      extraImages: (r.extraImages || []).map((x) => (x.id === id ? { ...x, name } : x)),
    }))
  }

  const setSlotAsset = (kind: ExtraSlotKind, ref: SlotAssetRef | null) => {
    setRecipe((r) => ({ ...r, [kind]: ref }))
  }

  const replaceRecipe = (next: RecipeState) => {
    setRecipe({ scene: null, expression: null, prop: null, extraImages: [], ...next })
  }

  const clearRecipe = () => {
    setRecipe({ portrait: null, costume: null, pose: null, scene: null, expression: null, prop: null, extraImages: [] })
    toast.success('已清空配方')
  }

  const randomizeRecipe = (pools: { portraits?: PortraitItem[]; costumes?: CostumeItem[]; poses?: PoseItem[] }) => {
    const posePool = safeMode ? (pools.poses || []).filter((p) => !isNsfwPose(p)) : pools.poses || []
    const costumePool = safeMode ? (pools.costumes || []).filter((c) => !isNsfwCostume(c)) : pools.costumes || []
    const portraitPool = pools.portraits || []

    setRecipe((prev) => ({
      ...prev,
      portrait: portraitPool.length
        ? portraitPool[Math.floor(Math.random() * portraitPool.length)]
        : prev.portrait,
      costume: costumePool.length
        ? costumePool[Math.floor(Math.random() * costumePool.length)]
        : prev.costume,
      pose: posePool.length ? posePool[Math.floor(Math.random() * posePool.length)] : prev.pose,
    }))
    toast.success(safeMode ? '已随机抽取一套角色配方（安全模式）' : '已随机抽取一套角色配方')
  }

  const updateApiConfig = (patch: Partial<ApiConfig>) => {
    setApiConfig((prev) => ({ ...prev, ...patch }))
  }

  const updateProviderConfig = (provider: ImageProviderId, patch: Partial<ProviderEndpointConfig>) => {
    setApiConfig((prev) => ({
      ...prev,
      providers: {
        ...prev.providers,
        [provider]: {
          ...prev.providers[provider],
          ...patch,
        },
      },
    }))
  }

  const updateGptParams = (patch: Partial<GptParams>) => {
    setApiConfig((prev) => ({ ...prev, gptParams: { ...prev.gptParams, ...patch } }))
  }

  const updateGeminiParams = (patch: Partial<GeminiParams>) => {
    setApiConfig((prev) => ({ ...prev, geminiParams: { ...prev.geminiParams, ...patch } }))
  }

  const updateQwenParams = (patch: Partial<QwenParams>) => {
    setApiConfig((prev) => ({ ...prev, qwenParams: { ...prev.qwenParams, ...patch } }))
  }

  const updateDoubaoParams = (patch: Partial<DoubaoParams>) => {
    setApiConfig((prev) => ({ ...prev, doubaoParams: { ...prev.doubaoParams, ...patch } }))
  }

  const updateComfyUiParams = (patch: Partial<ComfyUiParams>) => {
    setApiConfig((prev) => ({ ...prev, comfyuiParams: { ...prev.comfyuiParams, ...patch } }))
  }

  const updateVideoParams = (patch: Partial<VideoWorkflowParams>) => {
    setApiConfig((prev) => ({ ...prev, videoParams: { ...prev.videoParams, ...patch } }))
  }

  const addHistory = (item: Omit<GenerationHistoryItem, 'id' | 'createdAt'>) => {
    setHistory((prev) => [
      { ...item, id: `${Date.now()}-${Math.random().toString(36).slice(2, 6)}`, createdAt: Date.now() },
      ...prev.slice(0, 29),
    ])
  }

  const removeHistoryItem = (id: string) => {
    setHistory((prev) => prev.filter((x) => x.id !== id))
    toast.success('已删除该条记录')
  }

  const clearHistory = () => {
    setHistory([])
    void idbSet(HISTORY_KEY, [])
    try {
      localStorage.removeItem(HISTORY_KEY)
    } catch {}
    toast.success('已清空记录')
  }

  const refreshStitchPreview = async () => {
    try {
      const url = await stitchRecipeCanvas(recipe)
      setPreviewUrl(url)
      toast.success('已合成参考拼图')
    } catch (e) {
      toast.error(e instanceof Error ? e.message : '拼图失败')
    }
  }

  const startGeneration = async (overridePrompt?: string) => {
    if (isGeneratingRef.current) return
    const recipeSnapshot = recipe
    const configSnapshot = apiConfig
    const pCfg = configSnapshot.providers[configSnapshot.activeProvider]
    const modelName = configSnapshot.activeProvider === 'comfyui'
      ? 'ComfyUI 工作流'
      : pCfg.model === 'custom' ? pCfg.customModel || 'custom' : pCfg.model
    const finalPrompt =
      overridePrompt ??
      customPrompt ??
      buildRecipePrompt(recipeSnapshot, configSnapshot.stylePreset, promptOptionsFor(configSnapshot))

    isGeneratingRef.current = true
    setIsGenerating(true)
    setGeneratingModel(modelName)
    setGenerationError('')
    setGenerationProgress(null)

    try {
      const { imageUrl, modelUsed, providerUsed } = await generateCharacterImage({
        recipe: recipeSnapshot,
        prompt: finalPrompt,
        config: configSnapshot,
        onProgress: setGenerationProgress,
      })
      setPreviewUrl(imageUrl)
      addHistory({
        provider: providerUsed,
        model: modelUsed,
        prompt: finalPrompt,
        imageUrl,
        recipeSummary: recipeSummaryText(recipeSnapshot) || '自定义合成',
        recipe: recipeBackup(recipeSnapshot),
        kind: 'image',
      })
      toast.success(`角色图生成完成 (${modelUsed})`)
    } catch (e) {
      const msg = e instanceof Error ? e.message : '调用失败'
      setGenerationError(msg)
      toast.error(msg.split('\n')[0])
    } finally {
      isGeneratingRef.current = false
      setIsGenerating(false)
      setGenerationProgress(null)
    }
  }

  // 批量生成：按顺序逐个调用当前接口（ComfyUI 本地队列 / 云端接口都只能串行，避免显存溢出与限流）
  const [batch, setBatch] = useState<BatchState | null>(null)
  const batchCancelRef = useRef(false)

  const runBatch = async (title: string, jobs: BatchJob[]): Promise<BatchResult[]> => {
    if (isGeneratingRef.current) {
      toast.error('当前有生成任务在进行，请稍后再试')
      return []
    }
    const configSnapshot = apiConfig
    const results: BatchResult[] = []
    const errors: string[] = []
    batchCancelRef.current = false
    isGeneratingRef.current = true
    setIsGenerating(true)
    setGenerationError('')
    setBatch({ title, total: jobs.length, done: 0, current: jobs[0]?.label || '', results: [], errors: [], running: true })
    try {
      for (let i = 0; i < jobs.length; i++) {
        if (batchCancelRef.current) break
        const job = jobs[i]
        setGeneratingModel(`${title} ${i + 1}/${jobs.length}`)
        setBatch((b) => (b ? { ...b, current: job.label } : b))
        const prompt =
          job.prompt ?? buildRecipePrompt(job.recipe, configSnapshot.stylePreset, promptOptionsFor(configSnapshot))
        try {
          const { imageUrl, modelUsed, providerUsed } = await generateCharacterImage({
            recipe: job.recipe,
            prompt,
            config: configSnapshot,
            onProgress: setGenerationProgress,
          })
          const r = { label: job.label, imageUrl, recipe: job.recipe, prompt }
          results.push(r)
          setPreviewUrl(imageUrl)
          addHistory({
            provider: providerUsed,
            model: modelUsed,
            prompt,
            imageUrl,
            recipeSummary: `[${title}] ${job.label}`,
            recipe: recipeBackup(job.recipe),
            kind: 'batch',
          })
        } catch (e) {
          const msg = `${job.label}：${e instanceof Error ? e.message.split('\n')[0] : '调用失败'}`
          errors.push(msg)
          toast.error(msg)
        }
        setBatch((b) => (b ? { ...b, done: i + 1, results: [...results], errors: [...errors] } : b))
      }
    } finally {
      isGeneratingRef.current = false
      setIsGenerating(false)
      setGenerationProgress(null)
      setBatch((b) => (b ? { ...b, running: false, current: '' } : b))
    }
    toast.success(
      batchCancelRef.current
        ? `已停止批量任务（完成 ${results.length}/${jobs.length}）`
        : `批量任务完成：成功 ${results.length} 张${errors.length ? `，失败 ${errors.length} 张` : ''}`
    )
    return results
  }

  const cancelBatch = () => {
    batchCancelRef.current = true
    toast.message('将在当前这张生成完成后停止')
  }

  const clearBatch = () => setBatch(null)

  return (
    <StudioContext.Provider
      value={{
        recipe,
        apiConfig,
        history,
        safeMode,
        toggleSafeMode,
        requestUnlockNsfw,
        customPrompt,
        setCustomPrompt,
        previewUrl,
        setPreviewUrl,
        isGenerating,
        generatingModel,
        generationProgress,
        generationError,
        startGeneration,
        refreshStitchPreview,
        setPortrait,
        setCostume,
        setPose,
        togglePortrait,
        toggleCostume,
        togglePose,
        addExtraImage,
        removeExtraImage,
        updateExtraImageName,
        clearRecipe,
        randomizeRecipe,
        updateApiConfig,
        updateProviderConfig,
        updateGptParams,
        updateGeminiParams,
        updateQwenParams,
        updateDoubaoParams,
        updateComfyUiParams,
        updateVideoParams,
        setSlotAsset,
        replaceRecipe,
        batch,
        runBatch,
        cancelBatch,
        clearBatch,
        addHistory,
        removeHistoryItem,
        clearHistory,
      }}
    >
      {children}

      <AlertDialog open={ageGateOpen} onOpenChange={setAgeGateOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>🔞 年龄确认与免责声明（NSFW 18+）</AlertDialogTitle>
            <AlertDialogDescription className="space-y-2 text-left leading-relaxed">
              <span className="block">
                关闭「安全模式 (SFW)」后，图库将显示包含成人向艺术参考的敏感分类：
              </span>
              <span className="block rounded-lg bg-muted p-2.5 text-xs text-foreground">
                • <strong>动作姿势库</strong>：全身单人・性感系（399 张）、双人缠绵（275 张）
                <br />• <strong>服装穿搭库</strong>：内衣・睡衣（199 套）、性感穿搭（140 套）
              </span>
              <span className="block text-xs">
                <strong>免责声明</strong>：
                <br />1. <strong>年龄限制</strong>：未满 18 周岁的未成年人严禁关闭安全模式或浏览上述敏感分类。
                <br />2. <strong>来源说明</strong>：图鉴素材源自原作者 ギア（@giaaibusi）公开分享，仅供个人学习交流，严禁商业倒卖。
                <br />3. <strong>合法使用</strong>：本工具与素材<strong>仅供 AI 绘画学习与合法艺术创作使用，严禁用于任何违法违规、色情传播或侵害他人肖像权（如未经授权的真人换脸）等用途</strong>，使用者须自行承担一切法律责任。
              </span>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel
              onClick={() => {
                pendingUnlockCbRef.current = null
              }}
            >
              保持安全模式
            </AlertDialogCancel>
            <AlertDialogAction onClick={confirmUnlockNsfw}>
              我已年满 18 岁并同意免责声明
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </StudioContext.Provider>
  )
}

// oxlint-disable-next-line react/only-export-components
export function useStudio() {
  const ctx = useContext(StudioContext)
  if (!ctx) throw new Error('useStudio must be used within StudioProvider')
  return ctx
}
