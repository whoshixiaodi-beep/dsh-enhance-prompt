---
description: "一个 DSH Web bundle：用当前会话自身的模型把输入框里的草稿改写为更清晰、更具体的提示词，供希望在发送前就地改进提示词的用户使用。"
kind: "package-bundle"
---

# dsh-enhance-prompt

[English](README.md) | 中文

一个 [DeepSeek Harness](https://github.com/deepseek-ai)（DSH）插件，在输入框旁加一个**提示词增强按钮**。写下粗糙的草稿，点一下 ✨，草稿就会就地改写为更清晰、更具体的提示词——不会自动发送。

改写使用当前会话已选中的模型，因此它跟随你正在对话的那个 provider/model。

## 功能特性

- **输入框内的增强按钮** —— 改写草稿并把结果放回输入框，不会自动发送任何内容。
- **两种模式** —— 用按钮旁的切换标签切换：
  - `workbuddy`（原版）：润色草稿，严格保留其意图、范围与语言。
  - `creative`（创意）：把想法展开成更完整的规格说明。
- **撤销** —— 改写成功后出现撤销控件，可恢复改写前的草稿。
- **路由透明** —— 运行时会显示它正在请求哪个 `provider/model`；成功后报告真正作答的路由以及耗时。如果 Host 回退到了部署默认值，你也能看到。
- **可见的进度与失败** —— 工作时按钮自身显示旋转指示器；请求失败时按钮变红，悬停即可看到原因。输入框下方的状态行承载同样的文字。
- **`enhance_prompt` 工具** —— 同一份实现也以工具形式暴露给 agent，所以你也可以直接让助手增强一段提示词。

## 安装

本插件是一个 DSH **bundle**：它带有 `dsh.bundle` 补丁和一个浏览器侧实现，因此按 profile bundle 安装，而不是复制到某个目录。

### 从插件页面安装（推荐）

1. 打开 DSH 侧边栏里的**插件**页面。
2. 点击**添加插件**。
3. 填入仓库地址并确认：

   ```
   github:whoshixiaodi-beep/dsh-enhance-prompt
   ```

4. 若插件尚未启用，启用它，然后**重新加载浏览器标签页**以加载浏览器侧实现。

### 从命令行安装

```
dsh plugin --profile web add github:whoshixiaodi-beep/dsh-enhance-prompt
```

要移除它：

```
dsh plugin --profile web remove dsh-enhance-prompt
```

本插件不声明任何构建步骤（它是纯 ESM JavaScript，浏览器侧也是手写的），因此安装不需要 `allowBuilds` 批准。

安装后，增强控件出现在**输入框工具栏左侧**，紧邻权限与计划控件。

## 使用方法

1. 在输入框中写下粗糙的草稿 —— 没有草稿时按钮保持禁用。
2. 可选：点击模式标签，在「原版」与「创意」之间切换。
3. 点击 ✨。模型工作期间按钮显示旋转指示器。
4. 成功后草稿被替换，状态行报告路由与耗时；点击**撤销**可恢复先前的文字。
5. 失败时按钮变红，悬停即可读到原因。你的草稿绝不会丢失。

你也可以直接让助手使用 `enhance_prompt` 工具。

## 配置

配置位于 bundle 补丁中，它会合并进 profile。要覆盖某个默认值，在 profile 补丁（`~/.dsh/profiles/<profile>/cordis.patch.yml`）中加入匹配的条目：

```yaml
- id: dsh-enhance-prompt
  config:
    enabled: true
    mode: workbuddy
    timeoutMs: 30000
    tool: true
```

| 选项 | 类型 | 默认值 | 含义 |
| --- | --- | --- | --- |
| `enabled` | boolean | `true` | 设为 `false` 会隐藏按钮与工具，但不必卸载插件。 |
| `mode` | string | `workbuddy` | 默认模式：`workbuddy` 或 `creative`。切换标签会在每个浏览器会话内覆盖它。 |
| `timeoutMs` | number | `30000` | 单次请求的硬性预算，单位毫秒（被限制在 5000–600000）。超时即中止请求，并保留草稿。 |
| `tool` | boolean | `true` | 设为 `false` 保留按钮，但不再注册 `enhance_prompt` 工具。 |

本插件没有图形化设置页；这四个值如上所示在 profile 补丁中编辑。插件自身的启用与停用可在插件页面完成。

## 依赖与兼容性

- **Host：** DSH `0.2.0-rc.2`（本插件开发与验证所依据的版本），运行在 **web** profile 上。浏览器侧声明了 `dsh.client.platform: web`，不会在其他平台加载。
- **对等包**，由 DSH 安装提供，此处不打包：
  - `@deepseek-ai/dsh-tools`
  - `@deepseek-ai/dsh-typert-protocol`
  - `@deepseek-ai/schemastery`
- **Node.js：** `>= 20`（除 DSH 提供的包外没有运行时依赖）。
- **无构建步骤** —— `index.js`（Host 侧）、`client.js`（浏览器侧）与 `prompts.js`（提示词模板）按原样发布。

本插件通过 Host 的 `llm` 服务、使用会话自身的模型选择来调用模型。因此响应时间完全取决于你所选的提供方；`timeoutMs` 预算的作用是把一个极慢的提供方变成可见的失败，而不是一个看起来卡住的控件。

## 仓库结构

| 路径 | 作用 |
| --- | --- |
| `index.js` | Host 侧：`wbEnhancePrompt` Remote 服务与 `enhance_prompt` 工具。 |
| `client.js` | 浏览器侧：输入框控件、状态行与 Remote 挂载。 |
| `prompts.js` | 两种模式的提示词模板。 |
| `cordis.patch.yml` | bundle 补丁：profile 行及其默认值。 |
| `icon.svg` | 插件图标。 |
| `locale/{en,zh}.json` | 本地化字符串。 |
| `.build/` | 用于转写提示词模板的一次性辅助脚本。 |
| `README.md` / `README.zh.md` | 本双语文档对；`README.i18n.yaml` 记录其分节哈希。 |

## 致谢

`prompts.js` 中的改写行为与提示词模板逐字转写自原始的 **Codex++ `wb-enhance-prompt-share.js` 用户脚本**，原作者为其原始作者。此处收录它们是为了保留完全一致的增强行为，并已注明出处。本仓库所有 DSH 插件代码（Host 侧、浏览器侧、构建粘合、文档）均为原创。

## 许可证

[MIT](./LICENSE)
