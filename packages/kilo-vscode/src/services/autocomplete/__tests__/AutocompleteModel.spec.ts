import { describe, it, expect, vi, beforeEach } from "vitest"
import { AutocompleteModel } from "../AutocompleteModel"
import type { KiloConnectionService } from "../../cli-backend"

const mockClient = {
  kilo: {
    fim: vi.fn(),
  },
}

function createMockConnectionService(state: "connecting" | "connected" | "disconnected" | "error" = "connected") {
  return {
    getConnectionState: vi.fn().mockReturnValue(state),
    getClient: vi.fn().mockReturnValue(mockClient),
    getClientAsync:
      state === "connected"
        ? vi.fn().mockResolvedValue(mockClient)
        : vi.fn().mockRejectedValue(new Error(`CLI backend is not connected (state: ${state})`)),
    onStateChange: vi.fn().mockReturnValue(() => {}),
  } as unknown as KiloConnectionService
}

describe("AutocompleteModel", () => {
  beforeEach(() => {
    mockClient.kilo.fim.mockReset()
  })

  describe("constructor", () => {
    it("defaults profileName and profileType to null", () => {
      const model = new AutocompleteModel()
      expect(model.profileName).toBeNull()
      expect(model.profileType).toBeNull()
    })
  })

  describe("setConnectionService", () => {
    it("sets the connection service after construction", () => {
      const model = new AutocompleteModel()
      expect(model.hasValidCredentials()).toBe(false)

      const connection = createMockConnectionService("connected")
      model.setConnectionService(connection)
      expect(model.hasValidCredentials()).toBe(true)
    })
  })

  describe("hasValidCredentials", () => {
    it("returns true when connected", () => {
      const connection = createMockConnectionService("connected")
      const model = new AutocompleteModel(connection)
      expect(model.hasValidCredentials()).toBe(true)
    })

    it("returns false when disconnected", () => {
      const connection = createMockConnectionService("disconnected")
      const model = new AutocompleteModel(connection)
      expect(model.hasValidCredentials()).toBe(false)
    })

    it("returns false when connecting", () => {
      const connection = createMockConnectionService("connecting")
      const model = new AutocompleteModel(connection)
      expect(model.hasValidCredentials()).toBe(false)
    })

    it("returns false when in error state", () => {
      const connection = createMockConnectionService("error")
      const model = new AutocompleteModel(connection)
      expect(model.hasValidCredentials()).toBe(false)
    })

    it("returns false without connection service", () => {
      const model = new AutocompleteModel()
      expect(model.hasValidCredentials()).toBe(false)
    })

    it("returns true for openai-compatible when baseUrl and model are set", () => {
      const model = new AutocompleteModel()
      model.setProviderConfig({
        type: "openai-compatible",
        openai: { baseUrl: "http://localhost:11434/v1", apiKey: "", model: "codellama" },
      })
      expect(model.hasValidCredentials()).toBe(true)
    })

    it("returns false for openai-compatible when baseUrl is missing", () => {
      const model = new AutocompleteModel()
      model.setProviderConfig({
        type: "openai-compatible",
        openai: { baseUrl: "", apiKey: "", model: "codellama" },
      })
      expect(model.hasValidCredentials()).toBe(false)
    })

    it("returns false for openai-compatible when model is missing", () => {
      const model = new AutocompleteModel()
      model.setProviderConfig({
        type: "openai-compatible",
        openai: { baseUrl: "http://localhost:11434/v1", apiKey: "", model: "" },
      })
      expect(model.hasValidCredentials()).toBe(false)
    })
  })

  describe("supportsFim", () => {
    it("always returns true", () => {
      const model = new AutocompleteModel()
      expect(model.supportsFim()).toBe(true)
    })
  })

  describe("getModelName", () => {
    it("returns the default model", () => {
      const model = new AutocompleteModel()
      expect(model.getModelName()).toBe("mistralai/codestral-2508")
    })

    it("returns the openai-compatible model when configured", () => {
      const model = new AutocompleteModel()
      model.setProviderConfig({
        type: "openai-compatible",
        openai: { baseUrl: "http://localhost:11434/v1", apiKey: "", model: "qwen2.5-coder" },
      })
      expect(model.getModelName()).toBe("qwen2.5-coder")
    })
  })

  describe("getProviderDisplayName", () => {
    it("returns Kilo Gateway", () => {
      const model = new AutocompleteModel()
      expect(model.getProviderDisplayName()).toBe("Kilo Gateway")
    })

    it("returns OpenAI Compatible when configured", () => {
      const model = new AutocompleteModel()
      model.setProviderConfig({ type: "openai-compatible" })
      expect(model.getProviderDisplayName()).toBe("OpenAI Compatible")
    })
  })

  describe("setProviderConfig", () => {
    it("stores and returns provider config", () => {
      const model = new AutocompleteModel()
      const config = {
        type: "openai-compatible" as const,
        openai: { baseUrl: "http://localhost:11434/v1", apiKey: "sk-test", model: "codellama" },
      }
      model.setProviderConfig(config)
      expect(model.getProviderConfig()).toEqual(config)
    })
  })

  describe("hasBalance", () => {
    it("returns true for openai-compatible provider", async () => {
      const model = new AutocompleteModel()
      model.setProviderConfig({ type: "openai-compatible" })
      expect(await model.hasBalance()).toBe(true)
    })
  })

  describe("generateFimResponse", () => {
    it("throws when connection service is not available", async () => {
      const model = new AutocompleteModel()
      await expect(model.generateFimResponse("prefix", "suffix", vi.fn())).rejects.toThrow(
        "Connection service is not available",
      )
    })

    it("throws when not connected", async () => {
      const connection = createMockConnectionService("disconnected")
      const model = new AutocompleteModel(connection)
      await expect(model.generateFimResponse("prefix", "suffix", vi.fn())).rejects.toThrow(
        "CLI backend is not connected",
      )
    })

    it("streams chunks and returns metadata", async () => {
      const chunks = [
        { choices: [{ delta: { content: "hello" } }] },
        {
          choices: [{ delta: { content: " world" } }],
          usage: { prompt_tokens: 10, completion_tokens: 5 },
          cost: 0.001,
        },
      ]

      const connection = createMockConnectionService("connected")
      mockClient.kilo.fim.mockResolvedValue({
        stream: (async function* () {
          for (const chunk of chunks) yield chunk
        })(),
      })

      const model = new AutocompleteModel(connection)
      const received: string[] = []
      const result = await model.generateFimResponse("prefix", "suffix", (text) => received.push(text))

      expect(received).toEqual(["hello", " world"])
      expect(result).toEqual({
        cost: 0.001,
        inputTokens: 10,
        outputTokens: 5,
        cacheWriteTokens: 0,
        cacheReadTokens: 0,
      })
    })

    it("passes model parameters to fim call", async () => {
      const connection = createMockConnectionService("connected")
      mockClient.kilo.fim.mockResolvedValue({
        stream: (async function* () {})(),
      })

      const model = new AutocompleteModel(connection)
      const signal = new AbortController().signal
      await model.generateFimResponse("pre", "suf", vi.fn(), signal)

      expect(mockClient.kilo.fim).toHaveBeenCalledWith(
        {
          prefix: "pre",
          suffix: "suf",
          model: "mistralai/codestral-2508",
          maxTokens: 256,
          temperature: 0.2,
        },
        expect.objectContaining({ signal }),
      )
    })

    it("throws for openai-compatible when baseUrl is missing", async () => {
      const model = new AutocompleteModel()
      model.setProviderConfig({
        type: "openai-compatible",
        openai: { baseUrl: "", apiKey: "", model: "codellama" },
      })
      await expect(model.generateFimResponse("prefix", "suffix", vi.fn())).rejects.toThrow(
        "OpenAI-compatible provider requires baseUrl and model",
      )
    })

    it("throws for openai-compatible when model is missing", async () => {
      const model = new AutocompleteModel()
      model.setProviderConfig({
        type: "openai-compatible",
        openai: { baseUrl: "http://localhost:11434/v1", apiKey: "", model: "" },
      })
      await expect(model.generateFimResponse("prefix", "suffix", vi.fn())).rejects.toThrow(
        "OpenAI-compatible provider requires baseUrl and model",
      )
    })
  })

  describe("generateResponse", () => {
    it("throws because FIM is the primary strategy", async () => {
      const model = new AutocompleteModel()
      await expect(model.generateResponse("system", "user", vi.fn())).rejects.toThrow(
        "Chat-based completions are not supported via CLI backend",
      )
    })
  })
})
