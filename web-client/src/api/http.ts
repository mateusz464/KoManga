// The only place XHR lives (CLAUDE.md §5). XHR, not fetch, per the spike (KWC-102).

import { mapError, unwrap } from "./envelope.js";
import { NetworkError } from "./errors.js";
import { buildUrl, type QueryParams } from "./url.js";

export interface HttpClientOptions {
  readonly baseUrl?: string;
  // A callback (not a stored token) so credential storage stays in the auth
  // flow (KWC-303/304) and a later login is picked up per request.
  readonly getToken?: () => string | null;
}

export class HttpClient {
  private readonly baseUrl: string;
  private readonly getToken: () => string | null;

  constructor(options: HttpClientOptions = {}) {
    this.baseUrl = options.baseUrl ?? "";
    this.getToken = options.getToken ?? (() => null);
  }

  // For non-XHR uses (an <img> src or download link) — no auth header.
  url(path: string, query?: QueryParams): string {
    return buildUrl(this.baseUrl, path, query);
  }

  request<T>(
    method: string,
    path: string,
    query?: QueryParams,
    body?: unknown,
  ): Promise<T> {
    const url = buildUrl(this.baseUrl, path, query);

    return new Promise<T>((resolve, reject) => {
      const xhr = new XMLHttpRequest();
      xhr.open(method, url);

      const token = this.getToken();
      if (token) {
        xhr.setRequestHeader("Authorization", "Bearer " + token);
      }

      let payload: string | null = null;
      if (body !== undefined) {
        xhr.setRequestHeader("Content-Type", "application/json");
        payload = JSON.stringify(body);
      }

      xhr.onerror = function () {
        reject(new NetworkError());
      };

      xhr.onload = function () {
        const status = xhr.status;
        const text = xhr.responseText;
        if (status >= 200 && status < 300) {
          resolve(unwrap<T>(text));
          return;
        }
        reject(mapError(status, text));
      };

      xhr.send(payload);
    });
  }
}
