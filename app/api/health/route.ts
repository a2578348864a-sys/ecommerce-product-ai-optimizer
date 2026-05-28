import { NextResponse } from "next/server";

const DEFAULT_MODEL = "gpt-5.5";
const DEFAULT_DEEPSEEK_MODEL = "deepseek-v4-flash";

function getProvider() {
  return process.env.AI_PROVIDER?.trim().toLowerCase() === "deepseek" ? "deepseek" : "openai";
}

export function GET() {
  const provider = getProvider();

  return NextResponse.json({
    ok: true,
    provider,
    hasOpenAIKey: provider === "openai" && Boolean(process.env.OPENAI_API_KEY),
    hasDeepSeekKey: provider === "deepseek" && Boolean(process.env.DEEPSEEK_API_KEY),
    hasAccessPassword: Boolean(process.env.APP_ACCESS_PASSWORD),
    model:
      provider === "deepseek"
        ? process.env.DEEPSEEK_MODEL?.trim() || DEFAULT_DEEPSEEK_MODEL
        : process.env.OPENAI_MODEL?.trim() || DEFAULT_MODEL,
  });
}
