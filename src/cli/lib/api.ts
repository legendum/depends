import type { Config } from "./config";
import { getToken } from "./config";

export async function api(
  config: Config,
  path: string,
  opts: {
    method?: string;
    body?: string;
    contentType?: string;
    headers?: Record<string, string>;
    auth?: boolean;
  } = {},
): Promise<Response> {
  const headers: Record<string, string> = { ...opts.headers };
  if (opts.auth !== false) {
    headers.Authorization = `Bearer ${getToken(config)}`;
  }
  if (opts.contentType) {
    headers["Content-Type"] = opts.contentType;
  }

  return fetch(`${config.api_url}${path}`, {
    method: opts.method ?? "GET",
    headers,
    body: opts.body,
  });
}

export async function errorMsg(res: Response): Promise<string> {
  const text = await res.text();
  try {
    return JSON.parse(text).error || text;
  } catch {
    return text;
  }
}
