/**
 * Host half of the WB prompt-enhancement plugin.
 *
 * The operation is implemented once, as the `enhance` Remote method on the
 * `wbEnhancePrompt` service. Two callers reach it: the composer button through
 * the Client Remote carrier, and the `enhance_prompt` agent tool through
 * `ctx.tools`. Both call the same method, so neither path owns separate logic.
 *
 * The prompt text itself lives in `./prompts.js`, transcribed verbatim from the
 * original userscript.
 */
import z from '@deepseek-ai/schemastery'
import { defineTool } from '@deepseek-ai/dsh-tools'
import { Remote, TypertRemoteService } from '@deepseek-ai/dsh-typert-protocol'
import { normalizeEnhanceMode, renderSystemPrompt, renderUserPrompt } from './prompts.js'

export const name = 'wb-enhance-prompt'
export const inject = ['llm', 'timer', 'tools']

/** Row config. `cordis.patch.yml` overrides survive upgrades. */
export const Config = z.object({
  enabled: z.boolean().default(true),
  mode: z.string().default('workbuddy'),
  timeoutMs: z.number().default(90000),
  tool: z.boolean().default(true),
})

/** Cordis service key, and therefore the Client Remote namespace. */
const SERVICE_KEY = 'wbEnhancePrompt'
const DEFAULT_TIMEOUT_MS = 90000
const MIN_TIMEOUT_MS = 5000
const MAX_TIMEOUT_MS = 600000
const MAX_DRAFT_CHARS = 100000

/**
 * Apply the typert `@Remote` marker to one prototype method.
 *
 * Plain JavaScript has no decorator syntax, so the decorator is built and
 * invoked by hand. `Remote(name)` returns exactly the function a TypeScript
 * `@Remote(name)` compiles to; all it needs is a context object exposing
 * `addInitializer`. That initializer resolves the prototype from the instance
 * it is called on, so running it against a throwaway object created from the
 * target prototype marks the class prototype itself.
 * @param prototype - class prototype carrying the method.
 * @param method - public instance method name to expose over Remote.
 */
function declareRemote(prototype, method) {
  const initializers = []
  Remote(method)(prototype[method], {
    kind: 'method',
    name: method,
    static: false,
    private: false,
    addInitializer(initializer) {
      initializers.push(initializer)
    },
  })
  const probe = Object.create(prototype)
  for (const initializer of initializers) initializer.call(probe)
}

/** Clamp a configured timeout into a range that cannot hang a caller for hours. */
function clampTimeout(value) {
  if (typeof value !== 'number' || !Number.isFinite(value)) return DEFAULT_TIMEOUT_MS
  return Math.min(MAX_TIMEOUT_MS, Math.max(MIN_TIMEOUT_MS, Math.round(value)))
}

/** Render any thrown value as one readable line. */
function describeError(error) {
  if (error === null || error === undefined) return '未知错误'
  if (typeof error === 'string') return error
  const message = error.message
  return typeof message === 'string' && message !== '' ? message : String(error)
}

/**
 * The enhancer, published as the `wbEnhancePrompt` service.
 *
 * Configuration is injected rather than read from the environment so one
 * profile edit changes behaviour without touching this file.
 */
class EnhanceGateway extends TypertRemoteService {
  /**
   * @param ctx - owning plugin context; carries `llm` and `timer`.
   * @param config - resolved row config.
   */
  constructor(ctx, config) {
    super(ctx, SERVICE_KEY)
    this.config = config
  }

  /**
   * Report the settings the composer button needs before it renders.
   * @returns whether the feature is on and which mode is the default.
   */
  async state() {
    return {
      enabled: this.config.enabled !== false,
      mode: normalizeEnhanceMode(this.config.mode),
    }
  }

  /**
   * Rewrite one draft into a more specific prompt.
   *
   * The parameters are positional because the Typert Gateway dispatches a
   * Remote call as `Reflect.apply(method, receiver, args)` where `args` holds
   * one element per descriptor parameter, in declaration order. The Client
   * mirror-image of that rule is enforced before the call even leaves the
   * browser: `prepareInvocation` compares the caller's argument COUNT with the
   * declared parameter count and rejects anything else ("expected 4
   * argument(s), got 1"), so the Client must call
   * `remote.enhance(prompt, mode, provider, model)` positionally. A missing
   * optional value is passed as an explicit `undefined`, which the Client drops
   * from the wire object and the Host accepts through `acceptsUndefined`.
   *
   * @param prompt - the draft to rewrite.
   * @param mode - optional `workbuddy`/`creative` override.
   * @param provider - optional explicit provider route.
   * @param model - optional explicit model id.
   * @returns the rewritten text with the route and timing that produced it.
   */
  async enhance(prompt, mode, provider, model) {
    const draft = typeof prompt === 'string' ? prompt : ''
    if (draft.trim() === '') throw new Error('草稿是空的：先写点内容再增强。')
    if (draft.length > MAX_DRAFT_CHARS) {
      throw new Error(`草稿太长（${draft.length} 字符，上限 ${MAX_DRAFT_CHARS}），请先精简。`)
    }
    const resolvedMode = normalizeEnhanceMode(
      typeof mode === 'string' && mode !== '' ? mode : this.config.mode,
    )
    return this.run(draft, resolvedMode, this.resolveRoute({ provider, model }), clampTimeout(this.config.timeoutMs))
  }

  /**
   * Resolve which provider/model to call: the caller's explicit route first,
   * then the deployment's current default selection.
   * @param request - caller arguments.
   * @returns the resolved route.
   */
  resolveRoute(request) {
    let provider = typeof request.provider === 'string' ? request.provider.trim() : ''
    let model = typeof request.model === 'string' ? request.model.trim() : ''
    if (provider === '' || model === '') {
      const service = this.ctx.get('agentDefaultModel')
      const fallback = typeof service?.currentSelection === 'function' ? service.currentSelection() : undefined
      if (fallback !== null && typeof fallback === 'object') {
        if (provider === '') provider = String(fallback.provider ?? '')
        if (model === '') model = String(fallback.model ?? '')
      }
    }
    if (provider === '' || model === '') {
      throw new Error('没有取到模型：请先在输入框上方选一个模型，或显式传 provider 与 model。')
    }
    return { provider, model }
  }

  /**
   * Stream one enhancement and turn the chunk sequence into either text or a
   * failure that names the route and what arrived.
   *
   * The timeout aborts the upstream request through the documented
   * `GenerateOptions.signal`, so a provider that never sends a byte releases
   * its connection instead of leaving the caller waiting forever.
   * @param draft - the user's draft.
   * @param mode - `workbuddy` or `creative`.
   * @param route - resolved provider and model.
   * @param timeoutMs - hard per-request budget.
   * @returns the enhanced text plus diagnostics.
   */
  async run(draft, mode, route, timeoutMs) {
    const startedAt = Date.now()
    const controller = new AbortController()
    let timedOut = false
    const stopTimer = this.ctx.timeout(() => {
      timedOut = true
      controller.abort()
    }, timeoutMs)

    const parts = []
    let finish = undefined
    let failure = undefined
    let chunks = 0

    try {
      const stream = this.ctx.llm.stream({
        provider: route.provider,
        model: route.model,
        system: renderSystemPrompt(mode),
        messages: [{ role: 'user', content: [{ type: 'text', text: renderUserPrompt(draft, mode) }] }],
        signal: controller.signal,
      })
      for await (const chunk of stream) {
        chunks += 1
        if (chunk.type === 'text-delta') parts.push(chunk.text)
        else if (chunk.type === 'finish') finish = chunk.reason
      }
    } catch (error) {
      failure = error
    } finally {
      stopTimer()
    }

    const elapsedMs = Date.now() - startedAt
    const text = parts.join('').trim()
    const where = `${route.provider}/${route.model}`

    if (timedOut) {
      throw new Error(
        `${where} 在 ${timeoutMs} 毫秒内没有返回完整结果（收到 ${chunks} 个分片），已中止，草稿保留。`,
      )
    }
    if (finish !== undefined && finish.kind === 'error') {
      throw new Error(`${where} 报错：${finish.failure?.message ?? '未知错误'}`)
    }
    if (finish !== undefined && finish.kind === 'aborted') {
      throw new Error(`${where} 被中止：${finish.failure?.message ?? '请求已取消'}`)
    }
    if (failure !== undefined && text === '') {
      throw new Error(`调用 ${where} 失败：${describeError(failure)}`)
    }
    if (finish !== undefined && finish.kind === 'max-tokens') {
      throw new Error(`${where} 的输出被长度上限截断（max-tokens），草稿保留；可以调大模型输出上限后重试。`)
    }
    if (finish !== undefined && finish.kind === 'tool-calls') {
      throw new Error(`${where} 返回了工具调用而不是文本，换一个不带工具的模型再试。`)
    }
    if (text === '') {
      throw new Error(`${where} 没有返回文本（收到 ${chunks} 个分片）。`)
    }

    return { text, mode, provider: route.provider, model: route.model, elapsedMs, chunks }
  }
}

declareRemote(EnhanceGateway.prototype, 'state')
declareRemote(EnhanceGateway.prototype, 'enhance')

/**
 * Build the model-facing tool. It calls the same `enhance` method the button
 * uses, so the two callers cannot drift apart.
 * @param gateway - the live service instance.
 * @returns a tool definition ready for `ctx.tools.register`.
 */
function enhanceTool(gateway) {
  return defineTool({
    name: 'enhance_prompt',
    description:
      'Rewrite a draft prompt into a clearer, more specific one, using the same enrichment the composer button runs. Use it when the user asks to improve, expand, or sharpen a prompt they are about to send; it never executes the prompt. Returns only the rewritten text.',
    parameters: {
      prompt: {
        type: 'string',
        required: true,
        description: 'The draft prompt to rewrite.',
      },
      mode: {
        type: 'string',
        enum: ['workbuddy', 'creative'],
        description:
          'workbuddy keeps the rewrite close to the original and language-matched; creative develops the idea into a fuller specification. Defaults to the configured mode.',
      },
      provider: {
        type: 'string',
        description: 'Provider route to call. Defaults to the deployment default selection.',
      },
      model: {
        type: 'string',
        description: 'Exact model id to call. Defaults to the deployment default selection.',
      },
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          text: { type: 'string', required: true },
          mode: { type: 'string', required: true },
          provider: { type: 'string', required: true },
          model: { type: 'string', required: true },
          elapsedMs: { type: 'integer', required: true },
          chunks: { type: 'integer', required: true },
        },
      },
      render: (_args, value) => [{ type: 'text', text: String(value?.text ?? '') }],
    },
    execute: (args) => gateway.enhance(args.prompt, args.mode, args.provider, args.model),
  })
}

/**
 * Mount the enhancer. The Remote service is always published so the Client can
 * read `state()` and hide its button when the feature is off; the agent tool is
 * registered only while it is on.
 * @param ctx - plugin context.
 * @param config - resolved row config.
 */
export function apply(ctx, config) {
  const resolved = {
    enabled: config?.enabled !== false,
    mode: normalizeEnhanceMode(config?.mode),
    timeoutMs: clampTimeout(config?.timeoutMs),
    tool: config?.tool !== false,
  }
  const gateway = new EnhanceGateway(ctx, resolved)
  if (resolved.enabled && resolved.tool) ctx.tools.register(enhanceTool(gateway))
}
