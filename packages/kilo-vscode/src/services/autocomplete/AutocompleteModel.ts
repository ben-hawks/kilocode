import type { ResponseMetaData, AutocompleteProviderConfig } from "./types"
import { getTemplateForModel } from "./continuedev/core/autocomplete/templating/AutocompleteTemplate"
import type { KiloConnectionService } from "../cli-backend"

const DEFAULT_MODEL = "mistralai/codestral-2508"
const PROVIDER_DISPLAY_NAME = "Kilo Gateway"

/** Chunk from an LLM streaming response */
export type ApiStreamChunk =
  | { type: "text"; text: string }
  | {
      type: "usage"
      totalCost?: number
      inputTokens?: number
      outputTokens?: number
      cacheReadTokens?: number
      cacheWriteTokens?: number
    }

export class AutocompleteModel {
  private connectionService: KiloConnectionService | null = null
  private providerConfig: AutocompleteProviderConfig = { type: "kilo" }
  public profileName: string | null = null
  public profileType: string | null = null

  constructor(connectionService?: KiloConnectionService) {
    if (connectionService) {
      this.connectionService = connectionService
    }
  }

  /**
   * Set the connection service (can be called after construction when service becomes available)
   */
  public setConnectionService(service: KiloConnectionService): void {
    this.connectionService = service
  }

  /**
   * Update the provider configuration (e.g. switch between Kilo Gateway and OpenAI-compatible).
   */
  public setProviderConfig(config: AutocompleteProviderConfig): void {
    this.providerConfig = config
  }

  public getProviderConfig(): AutocompleteProviderConfig {
    return this.providerConfig
  }

  public supportsFim(): boolean {
    return true
  }

  /**
   * Generate a FIM (Fill-in-the-Middle) completion via the CLI backend.
   * Uses the SDK's kilo.fim() SSE endpoint which handles auth and streaming.
   *
   * @param signal - Optional AbortSignal to cancel the SSE stream early (e.g. when the user types again)
   */
  public async generateFimResponse(
    prefix: string,
    suffix: string,
    onChunk: (text: string) => void,
    signal?: AbortSignal,
  ): Promise<ResponseMetaData> {
    if (this.providerConfig.type === "openai-compatible") {
      return this.generateOpenAICompatibleFimResponse(prefix, suffix, onChunk, signal)
    }
    return this.generateKiloFimResponse(prefix, suffix, onChunk, signal)
  }

  private async generateKiloFimResponse(
    prefix: string,
    suffix: string,
    onChunk: (text: string) => void,
    signal?: AbortSignal,
  ): Promise<ResponseMetaData> {
    if (!this.connectionService) {
      throw new Error("Connection service is not available")
    }

    const client = await this.connectionService.getClientAsync()

    let cost = 0
    let inputTokens = 0
    let outputTokens = 0

    // Capture SSE-level errors so they propagate to the caller. The SDK's SSE
    // client catches HTTP errors (402, 401, 429, 5xx) internally and silently
    // ends the stream. Without this, errors never reach ErrorBackoff.
    let sseError: Error | undefined
    const { stream } = await client.kilo.fim(
      {
        prefix,
        suffix,
        model: DEFAULT_MODEL,
        maxTokens: 256,
        temperature: 0.2,
      },
      {
        signal,
        sseMaxRetryAttempts: 1,
        onSseError: (error) => {
          sseError = error instanceof Error ? error : new Error(String(error))
        },
      },
    )

    for await (const chunk of stream) {
      const content = chunk.choices?.[0]?.delta?.content
      if (content) onChunk(content)
      if (chunk.usage) {
        inputTokens = chunk.usage.prompt_tokens ?? 0
        outputTokens = chunk.usage.completion_tokens ?? 0
      }
      if (chunk.cost !== undefined) cost = chunk.cost
    }

    if (sseError) throw sseError

    return {
      cost,
      inputTokens,
      outputTokens,
      cacheWriteTokens: 0,
      cacheReadTokens: 0,
    }
  }

  /**
   * Generate a FIM completion via an OpenAI-compatible /v1/completions endpoint.
   * Applies the FIM template locally and streams the response using SSE.
   */
  private async generateOpenAICompatibleFimResponse(
    prefix: string,
    suffix: string,
    onChunk: (text: string) => void,
    signal?: AbortSignal,
  ): Promise<ResponseMetaData> {
    const cfg = this.providerConfig.openai
    if (!cfg?.baseUrl || !cfg?.model) {
      throw new Error("OpenAI-compatible provider requires baseUrl and model")
    }

    const template = getTemplateForModel(cfg.model)
    const prompt = template.template(prefix, suffix, "", "", "", [], [])
    const stop = template.completionOptions?.stop ?? []

    const url = `${cfg.baseUrl.replace(/\/+$/, "")}/completions`
    const headers: Record<string, string> = { "Content-Type": "application/json" }
    if (cfg.apiKey) {
      headers["Authorization"] = `Bearer ${cfg.apiKey}`
    }

    const body = JSON.stringify({
      model: cfg.model,
      prompt,
      max_tokens: 256,
      temperature: 0.2,
      stream: true,
      stop,
    })

    const response = await fetch(url, { method: "POST", headers, body, signal })

    if (!response.ok) {
      const status = response.status
      const text = await response.text().catch(() => "")
      throw Object.assign(new Error(`OpenAI-compatible API error: ${status} ${text}`), { status })
    }

    if (!response.body) {
      throw new Error("OpenAI-compatible API returned no body")
    }

    let inputTokens = 0
    let outputTokens = 0

    const reader = response.body.getReader()
    const decoder = new TextDecoder()
    let buf = ""

    // eslint-disable-next-line no-constant-condition
    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      buf += decoder.decode(value, { stream: true })

      const lines = buf.split("\n")
      buf = lines.pop() ?? ""

      for (const line of lines) {
        const trimmed = line.trim()
        if (!trimmed || !trimmed.startsWith("data:")) continue
        const payload = trimmed.slice(5).trim()
        if (payload === "[DONE]") continue

        const parsed = JSON.parse(payload) as {
          choices?: Array<{ text?: string; delta?: { content?: string } }>
          usage?: { prompt_tokens?: number; completion_tokens?: number }
        }

        // Support both /v1/completions (text) and /v1/chat/completions (delta.content)
        const text = parsed.choices?.[0]?.text ?? parsed.choices?.[0]?.delta?.content
        if (text) onChunk(text)

        if (parsed.usage) {
          inputTokens = parsed.usage.prompt_tokens ?? 0
          outputTokens = parsed.usage.completion_tokens ?? 0
        }
      }
    }

    return { cost: 0, inputTokens, outputTokens, cacheWriteTokens: 0, cacheReadTokens: 0 }
  }

  /**
   * Generate response via chat completions (holefiller fallback).
   * Not used when FIM is supported, but kept for compatibility.
   */
  public async generateResponse(
    systemPrompt: string,
    userPrompt: string,
    onChunk: (chunk: ApiStreamChunk) => void,
  ): Promise<ResponseMetaData> {
    // FIM is the primary strategy; this method is a fallback.
    // For now, throw — callers should use generateFimResponse via supportsFim().
    throw new Error("Chat-based completions are not supported via CLI backend. Use FIM (supportsFim() returns true).")
  }

  public getModelName(): string {
    if (this.providerConfig.type === "openai-compatible" && this.providerConfig.openai?.model) {
      return this.providerConfig.openai.model
    }
    return DEFAULT_MODEL
  }

  public getProviderDisplayName(): string {
    if (this.providerConfig.type === "openai-compatible") {
      return "OpenAI Compatible"
    }
    return PROVIDER_DISPLAY_NAME
  }

  /**
   * Check if the model has valid credentials.
   * For Kilo Gateway, credentials are managed by the backend — we just need a connection.
   * For OpenAI-compatible, we consider it valid if baseUrl and model are configured.
   */
  public hasValidCredentials(): boolean {
    if (this.providerConfig.type === "openai-compatible") {
      const cfg = this.providerConfig.openai
      return !!(cfg?.baseUrl && cfg?.model)
    }
    if (!this.connectionService) {
      return false
    }
    return this.connectionService.getConnectionState() === "connected"
  }

  /**
   * Check the user's credit balance via the profile endpoint.
   * Returns true if the user has a positive balance, false otherwise.
   * Returns false on any error (not connected, fetch failed, etc.).
   * For OpenAI-compatible, always returns true (no balance concept).
   */
  public async hasBalance(): Promise<boolean> {
    if (this.providerConfig.type === "openai-compatible") return true
    if (!this.connectionService) return false
    try {
      const client = await this.connectionService.getClientAsync()
      const result = await client.kilo.profile().catch(() => null)
      return (result?.data?.balance?.balance ?? 0) > 0
    } catch {
      return false
    }
  }
}
