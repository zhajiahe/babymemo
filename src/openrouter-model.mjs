// Canonical default for installations without a persisted model preference.
export const DEFAULT_OPENROUTER_MODEL='meta/muse-spark-1.3-contributor';
export const DEEPSEEK_V41_FLASH='deepseek/deepseek-v4.1-flash';
export const GPT_6_LUNA='openai/gpt-6-luna';
export const CLAUDE_HAIKU_55='anthropic/claude-haiku-5.5';
// Curated suggestions only: arbitrary valid OpenRouter model IDs remain supported.
export const OPENROUTER_MODEL_PRESETS=Object.freeze([
 {id:DEFAULT_OPENROUTER_MODEL,label:'Muse Spark 1.3 Contributor',thinking:'沿用原有模型配置'},
 {id:DEEPSEEK_V41_FLASH,label:'DeepSeek V4.1 Flash · Relace',thinking:'关闭思考，固定 Relace'},
 {id:GPT_6_LUNA,label:'GPT-6 Luna',thinking:'优先关闭思考；不支持则 minimal'},
 {id:CLAUDE_HAIKU_55,label:'Claude Haiku 5.5',thinking:'优先关闭思考；不支持则 low'}
]);
export function openRouterModelDescription(id){
 return OPENROUTER_MODEL_PRESETS.find(x=>x.id===id)?.thinking||'使用模型自身默认的思考配置';
}
