/**
 * Client half of the WB prompt-enhancement plugin.
 *
 * Renders the composer control next to the send row: a mode chip, the enhance
 * button, an undo button that appears after a successful rewrite, and a status
 * line under the composer carrying any failure text.
 *
 * The rewrite itself is not implemented here. The button calls
 * `ctx.remote.wbEnhancePrompt.enhance`, which is the same Host method the
 * `enhance_prompt` tool calls.
 */
window.__ModuleLoader__.load({
  id: 'dsh-enhance-prompt',
  factory(require) {
    const React = require('react')
    const h = React.createElement
    const useState = React.useState
    const useEffect = React.useEffect

    const NAMESPACE = 'wb-enhance-prompt'
    const ENHANCE_ICON_COLOR = 'currentColor'

    // ── shared view state ───────────────────────────────────────────────────
    // One small store per module instance; the button, the chip, and the status
    // line all read it, so a rewrite started in one place shows everywhere.

    let shared = { phase: 'idle', message: '', mode: 'workbuddy', undo: null, enabled: true }
    const listeners = new Set()

    function publish(patch) {
      shared = { ...shared, ...patch }
      for (const listener of listeners) listener()
    }

    function useShared() {
      const [snapshot, setSnapshot] = useState(shared)
      useEffect(() => {
        const listener = () => setSnapshot(shared)
        listeners.add(listener)
        listener()
        return () => {
          listeners.delete(listener)
        }
      }, [])
      return snapshot
    }

    // Bound in `apply`: the Remote namespace and the namespace translator.
    let remote = null
    let translate = (key) => key

    // ── styles ──────────────────────────────────────────────────────────────
    // Only theme tokens, so the control follows light and dark themes.

    function Styles() {
      return h('style', {
        // eslint-disable-next-line react/no-danger
        dangerouslySetInnerHTML: {
          __html: `
.wbx-row { display: inline-flex; align-items: center; gap: 2px; }
.wbx-btn {
  display: inline-flex; align-items: center; justify-content: center;
  height: 30px; min-width: 30px; padding: 0 6px;
  border: none; border-radius: 6px; background: transparent;
  color: var(--dsw-alias-label-secondary);
  font: inherit; line-height: 1; cursor: pointer;
  transition: background-color .12s ease, color .12s ease;
}
.wbx-btn:hover:not(:disabled) { background: var(--dsw-alias-bg-layer-2); color: var(--dsw-alias-label-primary); }
.wbx-btn:focus-visible { outline: 2px solid var(--dsw-alias-brand-primary); outline-offset: 1px; }
.wbx-btn:disabled { cursor: default; opacity: .45; }
.wbx-chip { font-size: 11px; letter-spacing: .02em; }
.wbx-error { color: var(--dsw-alias-state-error-primary); }
.wbx-busy { color: var(--dsw-alias-brand-primary); }
.wbx-undo { color: var(--dsw-alias-label-secondary); }
.wbx-error-btn { color: var(--dsw-alias-state-error-primary); }
.wbx-spin { animation: wbx-spin .9s linear infinite; transform-origin: 50% 50%; }
@keyframes wbx-spin { from { transform: rotate(0deg) } to { transform: rotate(360deg) } }
.wbx-status {
  padding: 2px 10px 0; font-size: 12px; line-height: 1.5;
  color: var(--dsw-alias-label-secondary);
}
.wbx-status-error { color: var(--dsw-alias-state-error-primary); }
.wbx-status-done { color: var(--dsw-alias-brand-primary); }
`,
        },
      })
    }

    /** The sparkle mark; inherits `currentColor` so it tracks the theme. */
    function EnhanceIcon() {
      return h(
        'svg',
        { viewBox: '0 0 24 24', width: 18, height: 18, 'aria-hidden': true, style: { display: 'block' } },
        h('path', {
          d: 'M11 2.6l1.75 4.65L17.4 9l-4.65 1.75L11 15.4 9.25 10.75 4.6 9l4.65-1.75L11 2.6z',
          fill: ENHANCE_ICON_COLOR,
        }),
        h('path', {
          d: 'M18.4 14.1l.95 2.45 2.45.95-2.45.95-.95 2.45-.95-2.45-2.45-.95 2.45-.95.95-2.45z',
          fill: ENHANCE_ICON_COLOR,
          opacity: 0.7,
        }),
      )
    }

    /**
     * The busy mark: a rotating arc drawn in the button itself, so "the click
     * landed and a request is in flight" is visible without reading the status
     * line (which only renders inside an established conversation).
     */
    function BusyIcon() {
      return h(
        'svg',
        {
          viewBox: '0 0 24 24',
          width: 18,
          height: 18,
          'aria-hidden': true,
          className: 'wbx-spin',
          style: { display: 'block' },
        },
        h('circle', {
          cx: 12,
          cy: 12,
          r: 9,
          fill: 'none',
          stroke: ENHANCE_ICON_COLOR,
          strokeWidth: 2.5,
          opacity: 0.25,
        }),
        h('path', {
          d: 'M21 12a9 9 0 0 0-9-9',
          fill: 'none',
          stroke: ENHANCE_ICON_COLOR,
          strokeWidth: 2.5,
          strokeLinecap: 'round',
        }),
      )
    }

    /** Read the session's selected route, tolerating an absent projection. */
    function selectionOf(projection) {
      if (projection === null || typeof projection !== 'object') return undefined
      return projection.next ?? projection.lastUsed
    }

    /**
     * The composer control: mode chip, enhance button, and undo.
     *
     * Session data arrives through the slot props' selector hooks; the draft is
     * read from `InputState.draft` and written back with `setDraft`.
     */
    function EnhanceControl(props) {
      const { useInput, inputActions, useProjection } = props
      const draft = useInput((state) => state.draft)
      const inputPhase = useInput((state) => state.phase)
      const projection = useProjection('modelSelection')
      const view = useShared()

      const busy = view.phase === 'busy'
      const hasDraft = typeof draft === 'string' && draft.trim() !== ''
      const locked = inputPhase !== undefined && inputPhase !== 'plain'
      const canEnhance = view.enabled && !busy && !locked && hasDraft

      async function onEnhance() {
        if (!canEnhance) return
        const original = draft
        // The route this request will take: the conversation's own selection
        // when it has one, otherwise nothing — the Host then falls back to the
        // deployment default, and the result reports which one answered.
        const selection = selectionOf(projection)
        const asked =
          typeof selection?.provider === 'string' && typeof selection?.model === 'string'
            ? `${selection.provider}/${selection.model}`
            : ''
        publish({
          phase: 'busy',
          message: asked === '' ? translate('enhancing') : `${translate('enhancing')} ${asked}`,
        })
        try {
          // Positional, in descriptor order. `prepareInvocation` checks
          // `values.length` against the declared parameter count BEFORE it reads
          // any value, so a single object argument fails with "expected 4
          // argument(s), got 1". An explicit `undefined` still occupies a
          // position; the gateway then omits that wire field, which is exactly
          // what the Host's `acceptsUndefined` parameters declare.
          const result = await remote.enhance(
            original,
            view.mode,
            selection?.provider,
            selection?.model,
          )
          if (result === null || typeof result !== 'object' || result.ok !== true) {
            throw new Error(result?.error?.message ?? translate('failed'))
          }
          const value = result.value ?? {}
          const text = typeof value.text === 'string' ? value.text : ''
          if (text === '') throw new Error(translate('empty'))
          inputActions.setDraft(text)
          // Name the route that actually answered, not the one requested: the
          // Host may have fallen back, and this line is the only place the user
          // can see which model rewrote the draft.
          const used =
            typeof value.provider === 'string' && typeof value.model === 'string'
              ? `${value.provider}/${value.model}`
              : asked
          const seconds =
            typeof value.elapsedMs === 'number' ? `${(value.elapsedMs / 1000).toFixed(1)}s` : ''
          const parts = [translate('done'), used, seconds].filter((part) => part !== '')
          publish({ phase: 'done', message: parts.join(' · '), undo: original })
        } catch (error) {
          publish({ phase: 'error', message: String(error?.message ?? error) })
        }
      }

      function onUndo() {
        if (typeof view.undo !== 'string' || busy) return
        inputActions.setDraft(view.undo)
        publish({ phase: 'idle', message: '', undo: null })
      }

      function onCycleMode() {
        if (busy) return
        publish({ mode: view.mode === 'creative' ? 'workbuddy' : 'creative' })
      }

      if (!view.enabled) return null

      const children = [
        h(Styles, { key: 'styles' }),
        h(
          'div',
          { className: 'wbx-row', key: 'row' },
          typeof view.undo === 'string'
            ? h(
                'button',
                {
                  key: 'undo',
                  type: 'button',
                  className: 'wbx-btn wbx-undo',
                  onClick: onUndo,
                  disabled: busy,
                  title: translate('undoHint'),
                  'aria-label': translate('undo'),
                },
                translate('undo'),
              )
            : null,
          h(
            'button',
            {
              key: 'mode',
              type: 'button',
              className: 'wbx-btn wbx-chip',
              onClick: onCycleMode,
              disabled: busy,
              title: translate('modeHint'),
              'aria-label': translate('modeHint'),
            },
            view.mode === 'creative' ? translate('modeCreative') : translate('modeWorkbuddy'),
          ),
          h(
            'button',
            {
              key: 'enhance',
              type: 'button',
              className: busy
                ? 'wbx-btn wbx-busy'
                : view.phase === 'error'
                  ? 'wbx-btn wbx-error-btn'
                  : 'wbx-btn',
              onClick: onEnhance,
              disabled: !canEnhance,
              // On failure the button carries the reason itself: the status line
              // only renders inside an established conversation.
              title:
                view.phase === 'error' && view.message !== ''
                  ? view.message
                  : hasDraft
                    ? translate('enhanceHint')
                    : translate('needsDraft'),
              'aria-label': translate('enhance'),
            },
            busy ? h(BusyIcon, {}) : h(EnhanceIcon, {}),
          ),
        ),
      ]

      return h(React.Fragment, {}, ...children)
    }

    /** Failure text under the composer; renders nothing while idle. */
    function StatusLine() {
      const view = useShared()
      if (view.message === '') return null
      const isError = view.phase === 'error'
      return h(
        'div',
        {
          className: isError
            ? 'wbx-status wbx-status-error'
            : view.phase === 'done'
              ? 'wbx-status wbx-status-done'
              : 'wbx-status',
          role: isError ? 'alert' : 'status',
        },
        view.message,
      )
    }

    // Strict-codec schema factory.
    //
    // The gateway only checks that a strict codec carries a `create()` function
    // and a non-empty `typeSymbol`; it never calls `create()` on the Client side,
    // and the Host resolves it lazily. The generated descriptors normally return a
    // zod schema, but zod is bundled into the official Client halves rather than
    // exposed as a require-able module, so a hand-written Client bundle cannot
    // import it. This lazy JSON-passthrough schema satisfies both sides without
    // pulling in a validator: the wire values are produced by the Host method
    // itself, which already validates its own input.
    const passthrough = () => ({
      parse: (value) => value,
      safeParse: (value) => ({ success: true, data: value }),
      parseAsync: async (value) => value,
      safeParseAsync: async (value) => ({ success: true, data: value }),
    })

    // Remote descriptor for the Host `wbEnhancePrompt` service.
    //
    // The client `remote.X` namespaces are mounted from descriptors. The stable
    // API set is inlined into `@deepseek-ai/dsh-api-remotes`, so a plugin outside
    // that set must mount its own namespace with `ctx.remote.$mount(...)` before
    // any fiber can inject `remote.wbEnhancePrompt`. Declaring it in `inject`
    // without mounting it leaves the fiber pending forever, which is what
    // "pending (waiting for service: remote.wbEnhancePrompt)" reports.
    //
    // Every parameter and the result need a `mode: 'strict'` codec: the gateway
    // rejects a descriptor whose fields lack one with "has no strict codec",
    // and the whole contribution then fails to mount.
    const TYPERT_REMOTE = {
      package: 'dsh-enhance-prompt',
      descriptors: [
        {
          id: 'dsh-enhance-prompt#wbEnhancePrompt/state',
          service: 'wbEnhancePrompt',
          namespace: 'wbEnhancePrompt',
          method: 'state',
          invocation: { kind: 'direct' },
          parameters: [],
          result: {
            mode: 'strict',
            typeSymbol: 'dsh-enhance-prompt#wbEnhancePrompt/state:result',
            create: passthrough,
          },
        },
        {
          id: 'dsh-enhance-prompt#wbEnhancePrompt/enhance',
          service: 'wbEnhancePrompt',
          namespace: 'wbEnhancePrompt',
          method: 'enhance',
          invocation: { kind: 'direct' },
          parameters: [
            {
              name: 'prompt',
              wire: 'prompt',
              source: 'json',
              codec: {
                mode: 'strict',
                typeSymbol: 'dsh-enhance-prompt#wbEnhancePrompt/enhance:prompt',
                create: passthrough,
              },
            },
            {
              name: 'mode',
              wire: 'mode',
              source: 'json',
              // The three optional fields accept absence. A JSON round trip drops
              // `undefined` values entirely, so an unset provider/model arrives as
              // a missing wire field; without this flag the Gateway rejects the
              // call with `args fields do not match the descriptor: missing ...`.
              // A missing parameter reaches the Host as `undefined`, which is
              // exactly what the fallback path expects.
              acceptsUndefined: true,
              codec: {
                mode: 'strict',
                typeSymbol: 'dsh-enhance-prompt#wbEnhancePrompt/enhance:mode',
                create: passthrough,
              },
            },
            {
              name: 'provider',
              wire: 'provider',
              source: 'json',
              acceptsUndefined: true,
              codec: {
                mode: 'strict',
                typeSymbol: 'dsh-enhance-prompt#wbEnhancePrompt/enhance:provider',
                create: passthrough,
              },
            },
            {
              name: 'model',
              wire: 'model',
              source: 'json',
              acceptsUndefined: true,
              codec: {
                mode: 'strict',
                typeSymbol: 'dsh-enhance-prompt#wbEnhancePrompt/enhance:model',
                create: passthrough,
              },
            },
          ],
          result: {
            mode: 'strict',
            typeSymbol: 'dsh-enhance-prompt#wbEnhancePrompt/enhance:result',
            create: passthrough,
          },
        },
      ],
    }

    // UI half, mounted only once the Remote namespace is live.
    function registerUi(ctx) {
      remote = ctx.remote.wbEnhancePrompt
      translate = ctx.locale.bind(NAMESPACE)

      ctx.locale.register(NAMESPACE, 'zh', {
          enhance: '增强提示词',
          enhanceHint: '用当前模型把草稿改写得更具体',
          needsDraft: '先写点内容',
          enhancing: '正在增强…',
          done: '已增强',
          undo: '撤销',
          undoHint: '恢复增强前的草稿',
          modeWorkbuddy: '原版',
          modeCreative: '创意',
          modeHint: '切换增强模式（本次会话有效）',
          failed: '增强失败',
          empty: '模型返回了空文本',
        })
        ctx.locale.register(NAMESPACE, 'en', {
          enhance: 'Enhance prompt',
          enhanceHint: 'Rewrite the draft into a more specific prompt',
          needsDraft: 'Write something first',
          enhancing: 'Enhancing…',
          done: 'Enhanced',
          undo: 'Undo',
          undoHint: 'Restore the draft from before the rewrite',
          modeWorkbuddy: 'Original',
          modeCreative: 'Creative',
          modeHint: 'Switch enhancement mode (this session)',
          failed: 'Enhancement failed',
          empty: 'The model returned no text',
        })

        // Ask the Host whether the feature is on before rendering anything.
        Promise.resolve(remote.state()).then(
          (result) => {
            if (result === null || typeof result !== 'object' || result.ok !== true) return
            const value = result.value ?? {}
            publish({
              enabled: value.enabled !== false,
              mode: value.mode === 'creative' ? 'creative' : 'workbuddy',
            })
          },
          () => {},
        )

      ctx.slots.inject('conversation.input.left', () =>
        ctx.slots.register(
          { name: 'conversation.input.left', id: 'wb-enhance', order: 40, label: '增强提示词' },
          EnhanceControl,
        ),
      )
      ctx.slots.inject('conversation.composer.dock', () =>
        ctx.slots.register(
          { name: 'conversation.composer.dock', id: 'wb-enhance-status', order: 20 },
          StatusLine,
        ),
      )
    }

    return {
      // Only `remote` and the slot/locale services are injected. The
      // `remote.wbEnhancePrompt` namespace is not requested here because it does
      // not exist until this plugin mounts it below.
      inject: ['remote', 'slots', 'locale'],
      async apply(ctx) {
        const disposeRemote = await ctx.remote.$mount(TYPERT_REMOTE)
        const ui = ctx.inject(['remote.wbEnhancePrompt', 'slots', 'locale'], registerUi)
        try {
          await ui
        } catch (error) {
          ui.dispose()
          await disposeRemote()
          throw error
        }
        return async () => {
          await ui.dispose()
          await disposeRemote()
        }
      },
    }
  },
})
