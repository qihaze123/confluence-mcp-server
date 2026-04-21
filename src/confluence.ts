import { readFile } from "node:fs/promises";
import { homedir } from "node:os";
import { basename, extname, resolve } from "node:path";

// ---- Config types -----------------------------------------------------------

export type ConfluenceMode = "cloud" | "server";
export type ConfluenceAuthMode = "auto" | "basic" | "bearer";
export type ResolvedAuthMode = Exclude<ConfluenceAuthMode, "auto">;

export interface ConfluenceConfig {
  baseUrl: string;
  mode: ConfluenceMode;
  username?: string;
  authHeader: string; // pre-built Authorization header value
  resolvedAuthMode: ResolvedAuthMode;
  defaultSpace?: string;
}

// ---- Unified model types ----------------------------------------------------

export interface ConfluencePage {
  id: string;
  type: string;
  title: string;
  spaceKey: string;
  url: string;
  version?: number;
}

export interface PageDetail extends ConfluencePage {
  bodyStorageValue: string;
}

export interface ConfluenceAttachment {
  id: string;
  type: string;
  title: string;
  fileName: string;
  mediaType?: string;
  fileSize?: number;
  comment?: string;
  url: string;
  downloadUrl: string;
  version?: number;
  storageImageMarkup?: string;
}

export interface CurrentUser {
  id: string;
  accountId?: string;
  username?: string;
  userKey?: string;
  displayName: string;
  email?: string;
}

// ---- API response shapes ----------------------------------------------------

interface ContentApiResult {
  id?: string;
  type?: string;
  title?: string;
  space?: { key?: string };
  version?: { number?: number };
  body?: { storage?: { value?: string } };
  metadata?: {
    mediaType?: string;
    comment?: string;
  };
  extensions?: {
    mediaType?: string;
    fileSize?: number;
    comment?: string;
  };
  _links?: { webui?: string };
}

interface AttachmentApiResult extends ContentApiResult {
  _links?: {
    webui?: string;
    download?: string;
  };
}

// ---- Error helpers ----------------------------------------------------------

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
    case 400:
      return "Invalid request parameters";
    case 401:
      return "Authentication failed";
    case 403:
      return "Permission denied for current user";
    case 404:
      return "Requested Confluence resource was not found";
    case 409:
      return "Version conflict - retry with latest version";
    default:
      return "Confluence API error";
  }
}

// ---- HTTP helper with retry & timeout --------------------------------------

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
    // Retry on 5xx responses.
    if (res.status >= 500 && retriesLeft > 0) {
      const delay = BASE_DELAY_MS * 2 ** (MAX_RETRIES - retriesLeft);
      await sleep(delay);
      return fetchWithRetry(url, init, retriesLeft - 1);
    }
    return res;
  } catch (err: unknown) {
    // Retry on network/timeout errors.
    if (retriesLeft > 0) {
      const delay = BASE_DELAY_MS * 2 ** (MAX_RETRIES - retriesLeft);
      await sleep(delay);
      return fetchWithRetry(url, init, retriesLeft - 1);
    }
    if (err instanceof Error) {
      throw err;
    }
    throw new Error(String(err));
  } finally {
    clearTimeout(timer);
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

function escapeCqlString(input: string): string {
  return input.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
}

function normalizeSiteBaseUrl(baseUrl: string, mode: ConfluenceMode): string {
  const trimmed = baseUrl.replace(/\/+$/, "");
  if (mode === "cloud" && trimmed.endsWith("/wiki")) {
    return trimmed.slice(0, -"/wiki".length);
  }
  return trimmed;
}

function expandUserPath(filePath: string): string {
  if (filePath === "~") {
    return homedir();
  }
  if (filePath.startsWith("~/")) {
    return resolve(homedir(), filePath.slice(2));
  }
  return resolve(filePath);
}

function stripDataUrlPrefix(value: string): string {
  const match = value.match(/^data:[^,]+,(.*)$/s);
  return match ? match[1] : value;
}

function inferContentType(fileName: string): string {
  switch (extname(fileName).toLowerCase()) {
    case ".apng":
      return "image/apng";
    case ".avif":
      return "image/avif";
    case ".bmp":
      return "image/bmp";
    case ".gif":
      return "image/gif";
    case ".jpeg":
    case ".jpg":
      return "image/jpeg";
    case ".png":
      return "image/png";
    case ".svg":
      return "image/svg+xml";
    case ".webp":
      return "image/webp";
    case ".pdf":
      return "application/pdf";
    case ".txt":
      return "text/plain";
    default:
      return "application/octet-stream";
  }
}

function escapeXmlAttribute(input: string): string {
  return input
    .replace(/&/g, "&amp;")
    .replace(/"/g, "&quot;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

// ---- Confluence client ------------------------------------------------------

export class ConfluenceClient {
  private readonly mode: ConfluenceMode;
  private readonly siteBaseUrl: string;
  private readonly uiBaseUrl: string;
  private readonly apiBaseUrl: string;
  private readonly baseHeaders: Record<string, string>;
  private readonly jsonHeaders: Record<string, string>;
  private readonly defaultSpace?: string;

  constructor(config: ConfluenceConfig) {
    this.mode = config.mode;
    this.siteBaseUrl = normalizeSiteBaseUrl(config.baseUrl, config.mode);
    this.uiBaseUrl =
      config.mode === "cloud"
        ? `${this.siteBaseUrl}/wiki`
        : this.siteBaseUrl;
    this.apiBaseUrl =
      config.mode === "cloud"
        ? `${this.siteBaseUrl}/wiki/rest/api`
        : `${this.siteBaseUrl}/rest/api`;

    this.baseHeaders = {
      Authorization: config.authHeader,
      Accept: "application/json",
    };
    this.jsonHeaders = {
      ...this.baseHeaders,
      "Content-Type": "application/json",
    };
    this.defaultSpace = config.defaultSpace;
  }

  async getCurrentUser(): Promise<CurrentUser> {
    const res = await this.request(`${this.apiBaseUrl}/user/current`, "GET");
    const json = (await res.json()) as {
      accountId?: string;
      username?: string;
      userKey?: string;
      displayName?: string;
      email?: string;
    };

    return {
      id: json.accountId ?? json.userKey ?? json.username ?? "",
      accountId: json.accountId,
      username: json.username,
      userKey: json.userKey,
      displayName: json.displayName ?? "",
      email: json.email,
    };
  }

  async searchPages(
    query: string,
    spaceKey?: string,
    limit = 10,
  ): Promise<ConfluencePage[]> {
    const space = spaceKey || this.defaultSpace;
    const cqlParts: string[] = ["type=page"];

    if (space) {
      cqlParts.push(`space="${escapeCqlString(space)}"`);
    }

    const trimmedQuery = query.trim();
    if (trimmedQuery) {
      const safe = escapeCqlString(trimmedQuery);
      cqlParts.push(`(title~"${safe}" OR text~"${safe}")`);
    }

    return this.executeCqlSearch(cqlParts.join(" AND "), limit, "space,version");
  }

  async executeCqlSearch(
    cql: string,
    limit = 10,
    expand = "space,version",
  ): Promise<ConfluencePage[]> {
    const params = new URLSearchParams({
      cql,
      limit: String(Math.min(Math.max(limit, 1), 50)),
    });
    if (expand.trim()) {
      params.set("expand", expand);
    }

    const res = await this.request(
      `${this.apiBaseUrl}/content/search?${params.toString()}`,
      "GET",
    );
    const json = (await res.json()) as { results?: ContentApiResult[] };

    return (json.results ?? []).map((item) => this.toPageRecord(item));
  }

  async getPage(pageId: string, expand?: string): Promise<PageDetail> {
    const exp = expand ?? "body.storage,version,space";
    const res = await this.request(
      `${this.apiBaseUrl}/content/${encodeURIComponent(pageId)}?expand=${encodeURIComponent(exp)}`,
      "GET",
    );
    const json = (await res.json()) as ContentApiResult;
    const page = this.toPageRecord(json);

    return {
      ...page,
      bodyStorageValue: json.body?.storage?.value ?? "",
    };
  }

  async createPage(params: {
    title: string;
    bodyStorageValue: string;
    spaceKey?: string;
    parentId?: string;
  }): Promise<ConfluencePage> {
    const spaceKey = params.spaceKey ?? this.defaultSpace;
    if (!spaceKey) {
      throw new Error(
        "spaceKey is required (or set CONF_DEFAULT_SPACE in environment).",
      );
    }

    const body: Record<string, unknown> = {
      type: "page",
      title: params.title,
      space: { key: spaceKey },
      body: {
        storage: {
          value: params.bodyStorageValue,
          representation: "storage",
        },
      },
    };
    if (params.parentId) {
      body.ancestors = [{ id: params.parentId }];
    }

    const res = await this.request(
      `${this.apiBaseUrl}/content`,
      "POST",
      JSON.stringify(body),
    );
    const json = (await res.json()) as ContentApiResult;
    return this.toPageRecord(json);
  }

  async updatePage(params: {
    pageId: string;
    title?: string;
    bodyStorageValue: string;
    minorEdit?: boolean;
    message?: string;
  }): Promise<ConfluencePage> {
    // Need current version and title before update.
    const current = await this.getPage(params.pageId, "version,space");
    const nextVersion = (current.version ?? 0) + 1;
    const nextTitle = params.title ?? current.title;

    const body: Record<string, unknown> = {
      id: params.pageId,
      type: "page",
      title: nextTitle,
      version: {
        number: nextVersion,
        minorEdit: params.minorEdit ?? true,
        ...(params.message ? { message: params.message } : {}),
      },
      body: {
        storage: {
          value: params.bodyStorageValue,
          representation: "storage",
        },
      },
      ...(current.spaceKey ? { space: { key: current.spaceKey } } : {}),
    };

    const res = await this.request(
      `${this.apiBaseUrl}/content/${encodeURIComponent(params.pageId)}`,
      "PUT",
      JSON.stringify(body),
    );
    const json = (await res.json()) as ContentApiResult;
    return this.toPageRecord(json);
  }

  async uploadAttachment(params: {
    pageId: string;
    filePath?: string;
    base64Data?: string;
    fileName?: string;
    contentType?: string;
    comment?: string;
    minorEdit?: boolean;
    overwrite?: boolean;
  }): Promise<ConfluenceAttachment> {
    const file = await this.readAttachmentInput(params);
    let uploadUrl =
      `${this.apiBaseUrl}/content/${encodeURIComponent(params.pageId)}/child/attachment`;

    if (params.overwrite !== false) {
      const existing = await this.findAttachmentByFileName(
        params.pageId,
        file.fileName,
      );
      if (existing?.id) {
        uploadUrl =
          `${this.apiBaseUrl}/content/${encodeURIComponent(params.pageId)}` +
          `/child/attachment/${encodeURIComponent(existing.id)}/data`;
      }
    }

    const res = await this.requestForm(
      uploadUrl,
      "POST",
      this.buildAttachmentForm(file, params),
    );
    const json = (await res.json()) as { results?: AttachmentApiResult[] };
    const attachment = json.results?.[0];
    if (!attachment) {
      throw new Error("Confluence did not return an uploaded attachment record.");
    }
    return this.toAttachmentRecord(attachment, file.fileName);
  }

  private async findAttachmentByFileName(
    pageId: string,
    fileName: string,
  ): Promise<AttachmentApiResult | undefined> {
    const params = new URLSearchParams({
      filename: fileName,
      expand: "version,metadata,extensions",
    });
    const res = await this.request(
      `${this.apiBaseUrl}/content/${encodeURIComponent(pageId)}/child/attachment?${params.toString()}`,
      "GET",
    );
    const json = (await res.json()) as { results?: AttachmentApiResult[] };
    return (json.results ?? []).find((item) => item.title === fileName);
  }

  private buildAttachmentForm(
    file: { data: Buffer; fileName: string; contentType: string },
    params: { comment?: string; minorEdit?: boolean },
  ): FormData {
    const form = new FormData();
    const blob = new Blob([file.data as unknown as BlobPart], {
      type: file.contentType,
    });

    form.append("file", blob, file.fileName);
    form.append("minorEdit", String(params.minorEdit ?? true));
    if (params.comment) {
      form.append("comment", params.comment);
    }
    return form;
  }

  private toPageRecord(item: ContentApiResult): ConfluencePage {
    const pageId = String(item.id ?? "");
    const result: ConfluencePage = {
      id: pageId,
      type: item.type ?? "page",
      title: item.title ?? "",
      spaceKey: item.space?.key ?? "",
      url: this.resolvePageUrl(item._links?.webui, pageId),
    };
    if (typeof item.version?.number === "number") {
      result.version = item.version.number;
    }
    return result;
  }

  private toAttachmentRecord(
    item: AttachmentApiResult,
    fallbackFileName: string,
  ): ConfluenceAttachment {
    const attachmentId = String(item.id ?? "");
    const fileName = item.title || fallbackFileName;
    const mediaType = item.metadata?.mediaType ?? item.extensions?.mediaType;
    const result: ConfluenceAttachment = {
      id: attachmentId,
      type: item.type ?? "attachment",
      title: item.title ?? fileName,
      fileName,
      url: this.resolvePageUrl(item._links?.webui, attachmentId),
      downloadUrl: this.resolveDownloadUrl(item._links?.download),
    };
    if (mediaType) {
      result.mediaType = mediaType;
    }
    if (typeof item.extensions?.fileSize === "number") {
      result.fileSize = item.extensions.fileSize;
    }
    const comment = item.metadata?.comment ?? item.extensions?.comment;
    if (comment) {
      result.comment = comment;
    }
    if (typeof item.version?.number === "number") {
      result.version = item.version.number;
    }
    if ((mediaType ?? inferContentType(fileName)).startsWith("image/")) {
      result.storageImageMarkup =
        `<ac:image><ri:attachment ri:filename="${escapeXmlAttribute(fileName)}" /></ac:image>`;
    }
    return result;
  }

  private resolvePageUrl(webui: string | undefined, pageId: string): string {
    if (webui) {
      if (/^https?:\/\//i.test(webui)) {
        return webui;
      }
      const path = webui.startsWith("/") ? webui : `/${webui}`;
      if (this.mode === "cloud") {
        return path.startsWith("/wiki/")
          ? `${this.siteBaseUrl}${path}`
          : `${this.uiBaseUrl}${path}`;
      }
      return `${this.siteBaseUrl}${path}`;
    }

    const fallbackPath =
      this.mode === "cloud"
        ? `/wiki/pages/viewpage.action?pageId=${encodeURIComponent(pageId)}`
        : `/pages/viewpage.action?pageId=${encodeURIComponent(pageId)}`;
    return `${this.siteBaseUrl}${fallbackPath}`;
  }

  private resolveDownloadUrl(download: string | undefined): string {
    if (download) {
      if (/^https?:\/\//i.test(download)) {
        return download;
      }
      const path = download.startsWith("/") ? download : `/${download}`;
      if (this.mode === "cloud") {
        return path.startsWith("/wiki/")
          ? `${this.siteBaseUrl}${path}`
          : `${this.uiBaseUrl}${path}`;
      }
      return `${this.siteBaseUrl}${path}`;
    }
    return "";
  }

  private async readAttachmentInput(params: {
    filePath?: string;
    base64Data?: string;
    fileName?: string;
    contentType?: string;
  }): Promise<{ data: Buffer; fileName: string; contentType: string }> {
    if (params.filePath && params.base64Data) {
      throw new Error("Provide either filePath or base64Data, not both.");
    }
    if (!params.filePath && !params.base64Data) {
      throw new Error("Either filePath or base64Data is required.");
    }

    if (params.filePath) {
      const absolutePath = expandUserPath(params.filePath);
      const fileName = params.fileName || basename(absolutePath);
      if (!fileName) {
        throw new Error("fileName could not be inferred from filePath.");
      }
      const data = await readFile(absolutePath);
      return {
        data,
        fileName,
        contentType: params.contentType ?? inferContentType(fileName),
      };
    }

    const fileName = params.fileName?.trim();
    if (!fileName) {
      throw new Error("fileName is required when using base64Data.");
    }
    return {
      data: Buffer.from(stripDataUrlPrefix(params.base64Data ?? ""), "base64"),
      fileName,
      contentType: params.contentType ?? inferContentType(fileName),
    };
  }

  private async request(
    url: string,
    method: string,
    body?: string,
  ): Promise<Response> {
    const init: RequestInit = {
      method,
      headers: this.jsonHeaders,
      ...(body ? { body } : {}),
    };

    const res = await fetchWithRetry(url, init);
    if (!res.ok) {
      const text = await res.text().catch(() => "");
      throw new ConfluenceApiError(res.status, res.statusText, text);
    }
    return res;
  }

  private async requestForm(
    url: string,
    method: string,
    body: FormData,
  ): Promise<Response> {
    const init: RequestInit = {
      method,
      headers: {
        ...this.baseHeaders,
        "X-Atlassian-Token": "nocheck",
      },
      body,
    };

    const res = await fetchWithRetry(url, init);
    if (!res.ok) {
      const text = await res.text().catch(() => "");
      throw new ConfluenceApiError(res.status, res.statusText, text);
    }
    return res;
  }
}

// ---- Config builder ---------------------------------------------------------

export function buildConfig(): ConfluenceConfig {
  const baseUrl = requireEnv("CONF_BASE_URL");
  const mode = parseMode(
    optionalEnv("CONF_MODE") ?? optionalEnv("CONF_DEPLOYMENT_MODE") ?? "server",
  );
  const authMode = parseAuthMode(optionalEnv("CONF_AUTH_MODE") ?? "auto");

  const username = optionalEnv("CONF_USERNAME");
  const token = optionalEnv("CONF_TOKEN", false);
  const password = optionalEnv("CONF_PASSWORD", false);
  const defaultSpace = optionalEnv("CONF_DEFAULT_SPACE");

  const auth = resolveAuthHeader({
    mode,
    authMode,
    username,
    token,
    password,
  });

  return {
    baseUrl,
    mode,
    username: auth.username,
    authHeader: auth.authHeader,
    resolvedAuthMode: auth.resolvedAuthMode,
    defaultSpace,
  };
}

function parseMode(value: string): ConfluenceMode {
  const normalized = value.toLowerCase();
  if (normalized === "cloud") return "cloud";
  if (
    normalized === "server" ||
    normalized === "dc" ||
    normalized === "datacenter" ||
    normalized === "data-center"
  ) {
    return "server";
  }
  return fatalConfig(
    "CONF_MODE must be one of: cloud, server (or CONF_DEPLOYMENT_MODE).",
  );
}

function parseAuthMode(value: string): ConfluenceAuthMode {
  const normalized = value.toLowerCase();
  if (normalized === "auto" || normalized === "basic" || normalized === "bearer") {
    return normalized;
  }
  return fatalConfig("CONF_AUTH_MODE must be one of: auto, basic, bearer.");
}

function resolveAuthHeader(input: {
  mode: ConfluenceMode;
  authMode: ConfluenceAuthMode;
  username?: string;
  token?: string;
  password?: string;
}): { username?: string; authHeader: string; resolvedAuthMode: ResolvedAuthMode } {
  if (input.mode === "cloud") {
    const user = requireValue(
      input.username,
      "CONF_USERNAME is required in cloud mode.",
    );
    const secret = input.token ?? input.password;
    const credential = requireValue(
      secret,
      "Cloud mode requires CONF_TOKEN (preferred) or CONF_PASSWORD.",
    );
    return {
      username: user,
      authHeader: `Basic ${Buffer.from(`${user}:${credential}`).toString("base64")}`,
      resolvedAuthMode: "basic",
    };
  }

  if (input.authMode === "bearer") {
    const token = requireValue(
      input.token,
      "CONF_AUTH_MODE=bearer requires CONF_TOKEN.",
    );
    return {
      username: input.username,
      authHeader: `Bearer ${token}`,
      resolvedAuthMode: "bearer",
    };
  }

  if (input.authMode === "basic") {
    const user = requireValue(
      input.username,
      "CONF_AUTH_MODE=basic requires CONF_USERNAME.",
    );
    const secret = input.password ?? input.token;
    const credential = requireValue(
      secret,
      "CONF_AUTH_MODE=basic requires CONF_PASSWORD (or CONF_TOKEN as password).",
    );
    return {
      username: user,
      authHeader: `Basic ${Buffer.from(`${user}:${credential}`).toString("base64")}`,
      resolvedAuthMode: "basic",
    };
  }

  // Server auto: token -> Bearer, else username/password -> Basic.
  if (input.token) {
    return {
      username: input.username,
      authHeader: `Bearer ${input.token}`,
      resolvedAuthMode: "bearer",
    };
  }

  if (input.password) {
    const user = requireValue(
      input.username,
      "Server auto mode with CONF_PASSWORD requires CONF_USERNAME.",
    );
    return {
      username: user,
      authHeader: `Basic ${Buffer.from(`${user}:${input.password}`).toString("base64")}`,
      resolvedAuthMode: "basic",
    };
  }

  return fatalConfig(
    "Server mode requires CONF_TOKEN (Bearer) or CONF_USERNAME + CONF_PASSWORD.",
  );
}

function requireEnv(name: string): string {
  const val = optionalEnv(name);
  if (!val) {
    return fatalConfig(`Required environment variable ${name} is not set.`);
  }
  return val;
}

function optionalEnv(name: string, trim = true): string | undefined {
  const raw = process.env[name];
  if (raw === undefined) return undefined;
  const normalized = trim ? raw.trim() : raw;
  return normalized === "" ? undefined : normalized;
}

function requireValue(value: string | undefined, message: string): string {
  if (!value) return fatalConfig(message);
  return value;
}

function fatalConfig(message: string): never {
  console.error(`Error: ${message}`);
  process.exit(1);
}
