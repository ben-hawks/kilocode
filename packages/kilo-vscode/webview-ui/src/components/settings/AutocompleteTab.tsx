import { Component, createSignal, onCleanup, Show } from "solid-js"
import { Switch } from "@kilocode/kilo-ui/switch"
import { Select } from "@kilocode/kilo-ui/select"
import { TextField } from "@kilocode/kilo-ui/text-field"
import { Card } from "@kilocode/kilo-ui/card"
import { useVSCode } from "../../context/vscode"
import { useLanguage } from "../../context/language"
import type { ExtensionMessage } from "../../types/messages"
import SettingsRow from "./SettingsRow"

interface ProviderOption {
  value: string
  labelKey: string
}

const PROVIDER_OPTIONS: ProviderOption[] = [
  { value: "kilo", labelKey: "settings.autocomplete.provider.kilo" },
  { value: "openai-compatible", labelKey: "settings.autocomplete.provider.openaiCompatible" },
]

const AutocompleteTab: Component = () => {
  const vscode = useVSCode()
  const language = useLanguage()

  const [enableAutoTrigger, setEnableAutoTrigger] = createSignal(true)
  const [enableSmartInlineTaskKeybinding, setEnableSmartInlineTaskKeybinding] = createSignal(false)
  const [enableChatAutocomplete, setEnableChatAutocomplete] = createSignal(false)
  const [providerType, setProviderType] = createSignal("kilo")
  const [openaiBaseUrl, setOpenaiBaseUrl] = createSignal("")
  const [openaiApiKey, setOpenaiApiKey] = createSignal("")
  const [openaiModel, setOpenaiModel] = createSignal("")

  const unsubscribe = vscode.onMessage((message: ExtensionMessage) => {
    if (message.type !== "autocompleteSettingsLoaded") {
      return
    }
    setEnableAutoTrigger(message.settings.enableAutoTrigger)
    setEnableSmartInlineTaskKeybinding(message.settings.enableSmartInlineTaskKeybinding)
    setEnableChatAutocomplete(message.settings.enableChatAutocomplete)
    setProviderType(message.settings.providerType)
    setOpenaiBaseUrl(message.settings.openaiBaseUrl)
    setOpenaiApiKey(message.settings.openaiApiKey)
    setOpenaiModel(message.settings.openaiModel)
  })

  onCleanup(unsubscribe)

  vscode.postMessage({ type: "requestAutocompleteSettings" })

  const updateSetting = (
    key:
      | "enableAutoTrigger"
      | "enableSmartInlineTaskKeybinding"
      | "enableChatAutocomplete"
      | "providerType"
      | "openaiBaseUrl"
      | "openaiApiKey"
      | "openaiModel",
    value: boolean | string,
  ) => {
    vscode.postMessage({ type: "updateAutocompleteSetting", key, value })
  }

  return (
    <div data-component="autocomplete-settings">
      <Card>
        <SettingsRow
          title={language.t("settings.autocomplete.autoTrigger.title")}
          description={language.t("settings.autocomplete.autoTrigger.description")}
        >
          <Switch
            checked={enableAutoTrigger()}
            onChange={(checked) => updateSetting("enableAutoTrigger", checked)}
            hideLabel
          >
            {language.t("settings.autocomplete.autoTrigger.title")}
          </Switch>
        </SettingsRow>

        <SettingsRow
          title={language.t("settings.autocomplete.smartKeybinding.title")}
          description={language.t("settings.autocomplete.smartKeybinding.description")}
        >
          <Switch
            checked={enableSmartInlineTaskKeybinding()}
            onChange={(checked) => updateSetting("enableSmartInlineTaskKeybinding", checked)}
            hideLabel
          >
            {language.t("settings.autocomplete.smartKeybinding.title")}
          </Switch>
        </SettingsRow>

        <SettingsRow
          title={language.t("settings.autocomplete.chatAutocomplete.title")}
          description={language.t("settings.autocomplete.chatAutocomplete.description")}
        >
          <Switch
            checked={enableChatAutocomplete()}
            onChange={(checked) => updateSetting("enableChatAutocomplete", checked)}
            hideLabel
          >
            {language.t("settings.autocomplete.chatAutocomplete.title")}
          </Switch>
        </SettingsRow>

        <SettingsRow
          title={language.t("settings.autocomplete.provider.title")}
          description={language.t("settings.autocomplete.provider.description")}
          last={providerType() === "kilo"}
        >
          <Select
            options={PROVIDER_OPTIONS}
            current={PROVIDER_OPTIONS.find((o) => o.value === providerType())}
            value={(o) => o.value}
            label={(o) => language.t(o.labelKey)}
            onSelect={(o) => {
              if (!o) return
              if (o.value === providerType()) return
              setProviderType(o.value)
              updateSetting("providerType", o.value)
            }}
            variant="secondary"
            size="small"
            triggerVariant="settings"
          />
        </SettingsRow>
      </Card>

      <Show when={providerType() === "openai-compatible"}>
        <h4 style={{ "margin-top": "16px", "margin-bottom": "8px" }}>
          {language.t("settings.autocomplete.provider.openaiCompatible")}
        </h4>
        <Card>
          <SettingsRow
            title={language.t("settings.autocomplete.openai.baseUrl.title")}
            description={language.t("settings.autocomplete.openai.baseUrl.description")}
          >
            <TextField
              value={openaiBaseUrl()}
              placeholder={language.t("settings.autocomplete.openai.baseUrl.placeholder")}
              onChange={(val) => {
                setOpenaiBaseUrl(val)
                updateSetting("openaiBaseUrl", val)
              }}
            />
          </SettingsRow>

          <SettingsRow
            title={language.t("settings.autocomplete.openai.apiKey.title")}
            description={language.t("settings.autocomplete.openai.apiKey.description")}
          >
            <TextField
              value={openaiApiKey()}
              placeholder={language.t("settings.autocomplete.openai.apiKey.placeholder")}
              onChange={(val) => {
                setOpenaiApiKey(val)
                updateSetting("openaiApiKey", val)
              }}
            />
          </SettingsRow>

          <SettingsRow
            title={language.t("settings.autocomplete.openai.model.title")}
            description={language.t("settings.autocomplete.openai.model.description")}
            last
          >
            <TextField
              value={openaiModel()}
              placeholder={language.t("settings.autocomplete.openai.model.placeholder")}
              onChange={(val) => {
                setOpenaiModel(val)
                updateSetting("openaiModel", val)
              }}
            />
          </SettingsRow>
        </Card>
      </Show>
    </div>
  )
}

export default AutocompleteTab
