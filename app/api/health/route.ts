import { NextResponse } from "next/server";

const DEFAULT_MODEL = "gpt-5.5";
const DEFAULT_DEEPSEEK_MODEL = "deepseek-chat";

function getProvider() {
  return process.env.AI_PROVIDER?.trim().toLowerCase() === "deepseek" ? "deepseek" : "openai";
}

function getAccessPassword() {
  return process.env.ACCESS_PASSWORD || process.env.APP_ACCESS_PASSWORD;
}

export function GET() {
  const provider = getProvider();

  return NextResponse.json({
    ok: true,
    app: "hot-material-agent",
    name: "爆款素材识别 Agent",
    provider,
    hasOpenAIKey: provider === "openai" && Boolean(process.env.OPENAI_API_KEY),
    hasDeepSeekKey: provider === "deepseek" && Boolean(process.env.DEEPSEEK_API_KEY),
    hasAccessPassword: Boolean(getAccessPassword()),
    model:
      provider === "deepseek"
        ? process.env.DEEPSEEK_MODEL?.trim() || DEFAULT_DEEPSEEK_MODEL
        : process.env.OPENAI_MODEL?.trim() || DEFAULT_MODEL,
  });
}
