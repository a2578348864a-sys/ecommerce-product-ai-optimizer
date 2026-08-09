export type SafeApiResponse =
  | { ok: true; payload: unknown; status: number }
  | { ok: false; error: { code: "unexpected_non_json_response"; status: number } };

function isJsonContentType(value: string | null) {
  if (!value) return false;
  const mediaType = value.split(";", 1)[0]?.trim().toLowerCase() ?? "";
  return mediaType === "application/json" || mediaType.endsWith("+json");
}

/**
 * 浏览器 API 响应的安全 JSON 边界。
 *
 * Nginx/代理/Next 错误页可能返回 HTML。此处不读取非 JSON body，也不把解析异常或
 * 上游正文交给 UI；调用方只接收稳定 code + HTTP status。
 */
export async function readJsonApiResponse(response: Response): Promise<SafeApiResponse> {
  if (!isJsonContentType(response.headers.get("content-type"))) {
    return {
      ok: false,
      error: { code: "unexpected_non_json_response", status: response.status },
    };
  }

  try {
    return { ok: true, payload: await response.json(), status: response.status };
  } catch {
    return {
      ok: false,
      error: { code: "unexpected_non_json_response", status: response.status },
    };
  }
}
