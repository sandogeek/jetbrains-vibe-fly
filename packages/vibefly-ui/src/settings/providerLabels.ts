/**
 * Display names aligned with ProviderUiHelpers (Kotlin).
 * 与 ProviderUiHelpers（Kotlin）对齐的显示名。
 */
const DISPLAY_NAMES: Record<string, string> = {
    openai: "OpenAI",
    anthropic: "Anthropic",
    google: "Google",
    "google-gemini": "Google Gemini",
    deepseek: "DeepSeek",
    groq: "Groq",
    mistral: "Mistral",
    xai: "xAI",
    cohere: "Cohere",
    openrouter: "OpenRouter",
    azure: "Azure OpenAI",
    "amazon-bedrock": "Amazon Bedrock",
    ollama: "Ollama",
    "github-copilot": "GitHub Copilot",
    zai: "Z.ai",
    minimax: "MiniMax",
    moonshot: "Moonshot",
    qwen: "Qwen",
    cerebras: "Cerebras",
    together: "Together",
    fireworks: "Fireworks",
    perplexity: "Perplexity",
    huggingface: "Hugging Face",
    "vercel-ai-gateway": "Vercel AI Gateway",
    opencode: "OpenCode",
    "kimi-coding": "Kimi Coding",
}

/**
 * Hidden product-name aliases for the built-in provider search box.
 * Not shown in the list; only terms that are not already in id / displayName.
 * 内置提供商搜索框的隐藏产品名别名。不展示在列表中；只收录 id / 显示名里没有的词。
 */
const SEARCH_ALIASES: Record<string, readonly string[]> = {
    anthropic: ["claude"],
    openai: ["gpt"],
    google: ["gemini"],
    "google-gemini": ["gemini"],
    xai: ["grok"],
    moonshot: ["kimi"],
    zai: ["glm"],
}

export function displayName(id: string): string {
    const key = id.toLowerCase()
    return DISPLAY_NAMES[key] ?? id
}

export function searchAliases(id: string): readonly string[] {
    const key = id.toLowerCase()
    return SEARCH_ALIASES[key] ?? []
}
