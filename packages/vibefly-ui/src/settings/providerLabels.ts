/** Display names aligned with ProviderUiHelpers (Kotlin). */
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

/** English strings aligned with VibeflyBundle.properties provider.description.* */
const DESCRIPTIONS: Record<string, string> = {
    openai: "GPT models via OpenAI API",
    anthropic: "Direct access to Claude models",
    google: "Gemini models via Google AI",
    "google-gemini": "Gemini models via Google AI",
    deepseek: "DeepSeek chat and reasoner models",
    groq: "Fast inference via Groq",
    mistral: "Mistral and Mixtral models",
    xai: "Grok models via xAI",
    openrouter: "Unified access to many model providers",
    ollama: "Local models via Ollama",
    azure: "Azure-hosted OpenAI models",
    "amazon-bedrock": "Models on Amazon Bedrock",
    "github-copilot": "Models via GitHub Copilot",
    cohere: "Command models via Cohere",
    together: "Open models via Together AI",
    fireworks: "Fast open models via Fireworks",
    perplexity: "Sonar models via Perplexity",
    huggingface: "Models via Hugging Face Inference",
    cerebras: "Fast inference via Cerebras",
    minimax: "MiniMax language models",
    moonshot: "Kimi models via Moonshot",
    qwen: "Qwen models",
    zai: "Z.ai models",
    "vercel-ai-gateway": "Models via Vercel AI Gateway",
    opencode: "OpenCode provider catalog",
    "kimi-coding": "Kimi Coding models",
}

const DEFAULT_DESCRIPTION = "Bundled models from pi catalog"

export function displayName(id: string): string {
    const key = id.toLowerCase()
    return DISPLAY_NAMES[key] ?? id
}

export function description(id: string): string {
    const key = id.toLowerCase()
    return DESCRIPTIONS[key] ?? DEFAULT_DESCRIPTION
}
