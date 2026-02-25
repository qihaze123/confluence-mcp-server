// ─── Types ────────────────────────────────────────────────────────────────────

export interface ConfluenceConfig {
  baseUrl: string;
  username: string;
  authHeader: string; // pre-built Authorization header value
  defaultSpace?: string;
}

export interface PageSummary {
  id: string;
  title: string;
  spaceKey: string;
  url: string;
}

export interface PageDetail {
  id: string;
  title: string;
  spaceKey: string;
  version: number;
  bodyStorageValue: string;
}

export interface UpdateResult {
  id: string;
  title: string;
  newVersion: number;
  url: string;
}

// ─── Error helpers ────────────────────────────────────────────────────────────

/** Strip password/token fragments from error bodies before surfacing. */
function sanitize(text: string): string {
  return text
    .replace(/Basic\s+[A-Za-z0-9+/=]+/gi, "Basic ***")
    .replace(/Bearer\s+\S+/gi, "Bearer ***");
}

export class ConfluenceApiError extends Error {
  constructor(
    public readonly status: number,
    public readonly statusText: string,
    public readonly body: string,
  ) {
    const friendly = friendlyStatus(status);
    super(`${friendly} (HTTP ${status} ${statusText}): ${sanitize(body)}`);
    this.name = "ConfluenceApiError";
  }
}

function friendlyStatus(status: number): string {
  switch (status) {
    case 401:
      return "Authentication failed – check CONF_USERNAME and CONF_PASSWORD / CONF_TOKEN";
    case 403:
      return "Permission denied – the authenticated user lacks access to this resource";
    case 404:
      return "Not found – the requested page or space does not exist";
    case 409:
      return "Version conflict – another edit was made concurrently, retry with latest version";
    default:
      return "Confluence API error";
  }
}

// ─── HTTP helper with retry & timeout ─────────────────────────────────────────

const TIMEOUT_MS = 15_000;
const MAX_RETRIES = 2;
const BASE_DELAY_MS = 500;

async function fetchWithRetry(
  url: string,
  init: RequestInit,
  retriesLeft = MAX_RETRIES,
): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);

  try {
    const res = await fetch(url, { ...init, signal: controller.signal });
    // Only retry on 5xx
    if (res.status >= 500 && retriesLeft > 0) {
      const delay = BASE_DELAY_MS * 2 ** (MAX_RETRIES - retriesLeft);
      await sleep(delay);
      return fetchWithRetry(url, init, retriesLeft - 1);
    }
    return res;
  } catch (err: unknown) {
    // Retry on network / abort errors
    if (retriesLeft > 0) {
      const delay = BASE_DELAY_MS * 2 ** (MAX_RETRIES - retriesLeft);
      await sleep(delay);
      return fetchWithRetry(url, init, retriesLeft - 1);
    }
    throw err;
  } finally {
    clearTimeout(timer);
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

// ─── Client ───────────────────────────────────────────────────────────────────

export class ConfluenceClient {
  private readonly baseUrl: string;
  private readonly headers: Record<string, string>;
  private readonly defaultSpace?: string;

  constructor(config: ConfluenceConfig) {
    // Strip trailing slash
    this.baseUrl = config.baseUrl.replace(/\/+$/, "");
    this.headers = {
      Authorization: config.authHeader,
      "Content-Type": "application/json",
      Accept: "application/json",
    };
    this.defaultSpace = config.defaultSpace;
  }

  // ── Search pages ──────────────────────────────────────────────────────────

  async searchPages(
    query: string,
    spaceKey?: string,
    limit = 10,
  ): Promise<PageSummary[]> {
    const space = spaceKey || this.defaultSpace;
    const cqlParts: string[] = ["type=page"];
    if (space) cqlParts.push(`space="${space}"`);
    // CQL text search – only add text predicate when query is non-empty
    if (query.trim()) {
      cqlParts.push(`(title~"${query}" OR text~"${query}")`);
    }
    const cql = cqlParts.join(" AND ");

    const params = new URLSearchParams({
      cql,
      limit: String(Math.min(limit, 25)),
      expand: "space",
    });

    const url = `${this.baseUrl}/rest/api/content/search?${params}`;
    const res = await this.request(url, "GET");
    const json = (await res.json()) as {
      results: Array<{
        id: string;
        title: string;
        space?: { key: string };
        _links?: { webui?: string };
      }>;
    };

    return (json.results || []).map((r) => ({
      id: r.id,
      title: r.title,
      spaceKey: r.space?.key ?? "",
      url: r._links?.webui
        ? `${this.baseUrl}${r._links.webui}`
        : `${this.baseUrl}/pages/viewpage.action?pageId=${r.id}`,
    }));
  }

  // ── Get page ──────────────────────────────────────────────────────────────

  async getPage(pageId: string, expand?: string): Promise<PageDetail> {
    const exp = expand ?? "body.storage,version,space";
    const url = `${this.baseUrl}/rest/api/content/${encodeURIComponent(pageId)}?expand=${encodeURIComponent(exp)}`;
    const res = await this.request(url, "GET");
    const json = (await res.json()) as {
      id: string;
      title: string;
      space?: { key: string };
      version?: { number: number };
      body?: { storage?: { value: string } };
    };

    return {
      id: json.id,
      title: json.title,
      spaceKey: json.space?.key ?? "",
      version: json.version?.number ?? 0,
      bodyStorageValue: json.body?.storage?.value ?? "",
    };
  }

  // ── Update page ───────────────────────────────────────────────────────────

  async updatePage(params: {
    pageId: string;
    title?: string;
    bodyStorageValue: string;
    minorEdit?: boolean;
    message?: string;
  }): Promise<UpdateResult> {
    // Step 1: fetch current page to get version and title
    const current = await this.getPage(params.pageId, "version,space");

    const newVersion = current.version + 1;
    const title = params.title ?? current.title;

    const body: Record<string, unknown> = {
      id: params.pageId,
      type: "page",
      title,
      version: {
        number: newVersion,
        minorEdit: params.minorEdit ?? true,
        ...(params.message ? { message: params.message } : {}),
      },
      body: {
        storage: {
          value: params.bodyStorageValue,
          representation: "storage",
        },
      },
    };

    const url = `${this.baseUrl}/rest/api/content/${encodeURIComponent(params.pageId)}`;
    const res = await this.request(url, "PUT", JSON.stringify(body));
    const json = (await res.json()) as {
      id: string;
      title: string;
      version?: { number: number };
      _links?: { webui?: string };
    };

    return {
      id: json.id,
      title: json.title,
      newVersion: json.version?.number ?? newVersion,
      url: json._links?.webui
        ? `${this.baseUrl}${json._links.webui}`
        : `${this.baseUrl}/pages/viewpage.action?pageId=${json.id}`,
    };
  }

  // ── Internal request helper ───────────────────────────────────────────────

  private async request(
    url: string,
    method: string,
    body?: string,
  ): Promise<Response> {
    const init: RequestInit = {
      method,
      headers: this.headers,
      ...(body ? { body } : {}),
    };

    const res = await fetchWithRetry(url, init);
    if (!res.ok) {
      const text = await res.text().catch(() => "");
      throw new ConfluenceApiError(res.status, res.statusText, text);
    }
    return res;
  }
}

// ─── Config builder ───────────────────────────────────────────────────────────

export function buildConfig(): ConfluenceConfig {
  const baseUrl = requireEnv("CONF_BASE_URL");
  const username = requireEnv("CONF_USERNAME");
  const token = process.env.CONF_TOKEN;
  const password = process.env.CONF_PASSWORD;
  const defaultSpace = process.env.CONF_DEFAULT_SPACE;

  if (!token && !password) {
    console.error("Error: Either CONF_TOKEN or CONF_PASSWORD must be set.");
    process.exit(1);
  }

  let authHeader: string;
  if (token) {
    authHeader = `Bearer ${token}`;
  } else {
    const encoded = Buffer.from(`${username}:${password}`).toString("base64");
    authHeader = `Basic ${encoded}`;
  }

  return { baseUrl, username, authHeader, defaultSpace };
}

function requireEnv(name: string): string {
  const val = process.env[name];
  if (!val) {
    console.error(`Error: Required environment variable ${name} is not set.`);
    process.exit(1);
  }
  return val;
}
