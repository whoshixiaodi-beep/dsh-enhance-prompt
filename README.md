---
description: "A DSH Web bundle that rewrites a composer draft into a clearer, more specific prompt with the session's own model selection, for users improving prompts in place before sending."
kind: "package-bundle"
---

# dsh-enhance-prompt

English | [中文](README.zh.md)

A [DeepSeek Harness](https://github.com/deepseek-ai) (DSH) plugin that adds a
**prompt enhance button** beside the composer. Write a rough draft, click ✨, and
the draft is rewritten into a clearer, more specific prompt — in place, without
being sent.

The rewrite uses the model the current session has selected, so it follows
whatever provider/model you are already talking to.

## Features

- **Enhance button in the composer** — rewrites the draft and puts the result
  back in the input box. Nothing is sent automatically.
- **Two modes** — switch with the chip next to the button:
  - `workbuddy` (原版 / Original): polishes the draft, strictly preserving its
    intent, scope, and language.
  - `creative` (创意 / Creative): develops the idea into a fuller specification.
- **Undo** — after a successful rewrite an undo control appears and restores the
  draft from before the rewrite.
- **Route transparency** — while running, the control shows which
  `provider/model` it is asking; on success it reports the route that actually
  answered and how long it took. If the Host fell back to the deployment
  default, you can see that.
- **Visible progress and failure** — the button itself shows a rotating
  indicator while working, and turns red with the reason on hover if the request
  fails. A status line under the composer carries the same text.
- **`enhance_prompt` tool** — the same implementation is exposed to the agent as
  a tool, so you can also just ask the assistant to enhance a prompt.

## Installation

This plugin is a DSH **bundle**: it ships a `dsh.bundle` patch and a browser
half, so it is installed as a profile bundle rather than copied into a folder.

### From the Plugins page (recommended)

1. Open the **Plugins** page in the DSH sidebar.
2. Click **Add plugin** (添加插件).
3. Enter the repository address and confirm:

   ```
   github:whoshixiaodi-beep/dsh-enhance-prompt
   ```

4. Enable the plugin if it is not enabled already, then **reload the browser
   tab** so the client half is picked up.

### From the command line

```
dsh plugin --profile web add github:whoshixiaodi-beep/dsh-enhance-prompt
```

To remove it again:

```
dsh plugin --profile web remove dsh-enhance-prompt
```

The plugin declares no build step (it is plain ESM JavaScript with a
hand-written browser half), so installation needs no `allowBuilds` approval.

After installing, the enhance control appears in the **left of the composer
tool row**, next to the permission and plan controls.

## Usage

1. Type a rough draft in the composer — the button stays disabled until there is
   a draft to work with.
2. Optionally click the mode chip to switch between 原版 and 创意.
3. Click ✨. The button shows a rotating indicator while the model works.
4. On success the draft is replaced and a status line reports the route and
   elapsed time; click **撤销** to restore the previous text.
5. On failure the button turns red; hover it to read the reason. Your draft is
   never lost.

You can also ask the assistant to use the `enhance_prompt` tool directly.

## Configuration

Configuration lives in the bundle patch, which is merged into the profile. To
override a default, add a matching entry to your profile patch
(`~/.dsh/profiles/<profile>/cordis.patch.yml`):

```yaml
- id: dsh-enhance-prompt
  config:
    enabled: true
    mode: workbuddy
    timeoutMs: 30000
    tool: true
```

| Option | Type | Default | Meaning |
| --- | --- | --- | --- |
| `enabled` | boolean | `true` | `false` hides the button and the tool without uninstalling the plugin. |
| `mode` | string | `workbuddy` | Default mode: `workbuddy` or `creative`. The chip overrides it per browser session. |
| `timeoutMs` | number | `30000` | Hard per-request budget in milliseconds (clamped to 5000–600000). The request is aborted when it expires and the draft is kept. |
| `tool` | boolean | `true` | `false` keeps the button but stops registering the `enhance_prompt` tool. |

The plugin has no graphical settings page; these four values are edited in the
profile patch as shown above. Enabling and disabling the plugin itself can be
done from the Plugins page.

## Dependencies and compatibility

- **Host:** DSH `0.2.0-rc.2` (the version this plugin was developed and verified
  against) on the **web** profile. The client half declares
  `dsh.client.platform: web` and will not load on other platforms.
- **Peer packages**, provided by the DSH installation and not bundled here:
  - `@deepseek-ai/dsh-tools`
  - `@deepseek-ai/dsh-typert-protocol`
  - `@deepseek-ai/schemastery`
- **Node.js:** `>= 20` (no runtime dependency beyond the DSH-provided packages).
- **No build step** — `index.js` (Host half), `client.js` (browser half) and
  `prompts.js` (prompt templates) are shipped as-is.

The plugin calls the model through the Host's `llm` service using the session's
own model selection. Response time therefore depends entirely on the provider
you have selected; the `timeoutMs` budget is what turns a very slow provider
into a visible failure instead of a control that looks stuck.

## Repository layout

| Path | Role |
| --- | --- |
| `index.js` | Host half: the `wbEnhancePrompt` Remote service and the `enhance_prompt` tool. |
| `client.js` | Browser half: the composer control, the status line, and the Remote mount. |
| `prompts.js` | The prompt templates for both modes. |
| `cordis.patch.yml` | The bundle patch: the profile row and its defaults. |
| `icon.svg` | The plugin icon. |
| `locale/{en,zh}.json` | The locale strings. |
| `.build/` | The one-off helper used to transcribe the prompt templates. |
| `README.md` / `README.zh.md` | This documentation pair; `README.i18n.yaml` records its section hashes. |

## Credits

The rewrite behaviour and the prompt templates in `prompts.js` are transcribed
verbatim from the original **Codex++ `wb-enhance-prompt-share.js` userscript** by
its original author. They are included here to preserve the exact enhancement
behaviour, with attribution. All DSH plugin code (Host half, browser half, build
glue, docs) is original to this repository.

## License

[MIT](./LICENSE)
