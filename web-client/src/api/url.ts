// Hand-rolled because the Kobo's WebKit lacks `URL`/`URLSearchParams` (KWC-102).

export type QueryParams = Record<string, string | number | undefined>;

export function encodeToken(value: string): string {
  return encodeURIComponent(value);
}

export function buildQuery(params?: QueryParams): string {
  if (!params) return "";
  const parts: string[] = [];
  const keys = Object.keys(params);
  for (let i = 0; i < keys.length; i++) {
    const key = keys[i];
    const value = params[key];
    if (value === undefined) continue;
    parts.push(
      encodeURIComponent(key) + "=" + encodeURIComponent(String(value)),
    );
  }
  return parts.length ? "?" + parts.join("&") : "";
}

export function buildUrl(
  baseUrl: string,
  path: string,
  query?: QueryParams,
): string {
  return baseUrl + path + buildQuery(query);
}
