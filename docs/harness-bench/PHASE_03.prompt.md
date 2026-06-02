Read docs/harness-bench/PHASE_03.md and docs/harness-bench/README.md before starting. Work in the cpe repo on the single working branch feature/harness-bench; no per-phase branches or PRs - commit this phase on feature/harness-bench when green. Depends on Phase 02.

Goal: enable claude-code to run the local model gemma4-cpe:31b via an Anthropic-format proxy in front of Ollama, at zero Anthropic API cost, and add a reusable provider preset for it.

Do this first (research + direct test, before writing config):
- Evaluate LiteLLM in Anthropic mode versus a minimal dedicated Anthropic<->OpenAI shim for proxying Claude Code to Ollama. Pick one and record the reasoning in docs/harness-bench/proxy.md. The decisive factor is faithful tool-call / tool-use translation, since Claude Code depends on tools.
- Stand the proxy up locally pointing at Ollama gemma4-cpe:31b (desktop endpoint http://192.168.1.3:11434/v1) and directly verify with a real claude -p invocation (ANTHROPIC_BASE_URL set to the proxy) that it completes a small prompt AND can make a tool call. Capture the exact commands in proxy.md.

Files to create/modify and why:
- docs/harness-bench/proxy.md (new): the chosen proxy, why, the exact compose file or run command, required env, and a copy-pasteable validation (a claude -p run against the proxy that edits a file). Note the k3s endpoint (http://ollama.ollama.svc.homelab.cluster:11434/v1) as the eventual server-side target.
- src/commands/provider.ts: make adding the preset easy - either a --preset desktop-ollama-anthropic shortcut that fills in the ProviderEntry fields, or, if that is too invasive, document the exact interactive inputs. Reuse the existing provider add flow and the health_check probe in src/runner/provider.ts (checkProvider).
- Only touch src/config/repo-config.ts or src/types/meta.ts if a preset genuinely needs a config hook; prefer not to.

Conventions to follow:
- The ProviderEntry shape is fixed in src/types/meta.ts (name, model, anthropic_base_url, anthropic_api_key, anthropic_auth_token, health_check_url). Use a health_check_url that resolveProvider can probe (the proxy should answer a cheap GET).
- Do not hardcode secrets in committed files; the proxy/provider should read keys from env (anthropic_auth_token may be a dummy for a local proxy that ignores auth - document this).

Edge cases and error handling:
- If the proxy is down, resolveProvider's checkProvider should fail it over / surface a clear error rather than hanging (it already uses a 5s timeout - keep that).
- Document the tool-call translation limitation if any is found (some proxies mangle tool schemas) and note the workaround.

Acceptance criteria:
- bun run build and lint pass.
- A default claude-code cpe single-prompt run, using the new provider preset, executes a real prompt against gemma4-cpe:31b with NO calls to api.anthropic.com (verify via the proxy logs or network), and successfully edits a file.
- proxy.md is reproducible from scratch by someone else.
- Existing tests still pass.

When done, update docs/harness-bench/PROGRESS.md (Phase 03 complete, date, which proxy was chosen) and commit the phase on feature/harness-bench.
