# Changelog

All notable changes to this project are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [1.0.0] - 2026-10-11

Initial public release.

### Added

- Composer enhance button (✨) that rewrites the current draft into a more
  specific prompt without sending it.
- Two enhancement modes: `workbuddy` (keeps the original intent and language)
  and `creative` (expands the idea into a fuller specification), switchable
  from a chip beside the button.
- Undo control that restores the draft from before the rewrite.
- Route transparency: while a rewrite is running the control names the
  `provider/model` it is asking, and on completion it reports the route that
  actually answered plus the elapsed time.
- In-button progress indicator (a rotating arc) and an error state that turns
  the button red and carries the failure reason on the button itself.
- Host-side `enhance_prompt` agent tool, sharing one implementation with the
  composer button.
- Localization for Simplified Chinese and English.
- Row configuration (`enabled`, `mode`, `timeoutMs`, `tool`) through the
  bundle's `cordis.patch.yml`.

### Fixed

- Remote call convention: the Client now invokes `enhance` with the four
  positional arguments its descriptor declares. The Client gateway validates
  the argument count before reading any value, so the previous single-object
  call failed with `client api: expected 4 argument(s), got 1`.
- Optional-parameter handling: `mode`, `provider` and `model` are declared
  `acceptsUndefined`, so omitting them no longer fails strict wire validation
  and the Host falls back to the session's model selection.
- Client Remote namespace mounting: the plugin mounts `wbEnhancePrompt` itself
  through `ctx.remote.$mount`, because the namespace is not part of the stable
  Remote set the client runtime pre-installs.

### Changed

- Default per-request timeout lowered from 90000 ms to 30000 ms, so a stalled
  or very slow provider surfaces as a visible failure quickly instead of
  appearing unresponsive.

[1.0.0]: https://github.com/whoshixiaodi-beep/dsh-enhance-prompt/releases/tag/v1.0.0
