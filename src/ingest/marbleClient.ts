/**
 * World Labs Marble API client (terminal-first).
 *
 * Auth: WLT-Api-Key header. Key comes from the MARBLE_API_KEY env var —
 * never hardcoded, never committed.
 *
 * The API is young and the plan's reference facts (draft tier, scale
 * metadata) go beyond the published docs, so every response is persisted
 * RAW to disk alongside the normalized bundle: the first real generation
 * doubles as Gate D1 science about what the API actually ships.
 */
const BASE = "https://api.worldlabs.ai";

export interface MarbleOperation {
  operation_id?: string;
  name?: string;
  done: boolean;
  response?: MarbleWorld;
  error?: unknown;
  [k: string]: unknown;
}

export interface MarbleWorld {
  /** the live API returns world_id; early docs said id — accept both via worldIdOf() */
  world_id?: string;
  id?: string;
  display_name?: string;
  model?: string;
  assets?: {
    caption?: string;
    thumbnail_url?: string;
    splats?: { spz_urls?: Record<string, string> };
    mesh?: { collider_mesh_url?: string };
    imagery?: { pano_url?: string };
    [k: string]: unknown;
  };
  world_marble_url?: string;
  [k: string]: unknown; // scale/ground-plane metadata lands wherever it lands — we keep it all
}

export class MarbleClient {
  constructor(private apiKey: string) {
    if (!apiKey) throw new Error("MARBLE_API_KEY is not set. Get a key at platform.worldlabs.ai/api-keys");
  }

  private async request<T>(method: string, path: string, body?: unknown): Promise<T> {
    const res = await fetch(`${BASE}${path}`, {
      method,
      headers: {
        "WLT-Api-Key": this.apiKey,
        ...(body ? { "Content-Type": "application/json" } : {}),
      },
      body: body ? JSON.stringify(body) : undefined,
    });
    const text = await res.text();
    if (!res.ok) throw new Error(`Marble API ${method} ${path} -> ${res.status}: ${text.slice(0, 500)}`);
    return JSON.parse(text) as T;
  }

  /** Start a text-prompted generation. Returns the operation to poll. */
  async generateFromText(prompt: string, opts: { model?: string; displayName?: string } = {}): Promise<MarbleOperation> {
    return this.request<MarbleOperation>("POST", "/marble/v1/worlds:generate", {
      display_name: opts.displayName ?? prompt.slice(0, 60),
      model: opts.model ?? "marble-1.1",
      world_prompt: { type: "text", text_prompt: prompt },
    });
  }

  /** Start a panorama/image generation from a public URI or uploaded media asset. */
  async generateFromImage(
    image: { uri: string } | { mediaAssetId: string },
    opts: { model?: string; displayName?: string; textPrompt?: string; isPano?: boolean } = {},
  ): Promise<MarbleOperation> {
    const image_prompt =
      "uri" in image
        ? { source: "uri", uri: image.uri, ...(opts.isPano !== undefined ? { is_pano: opts.isPano } : {}) }
        : { source: "media_asset", media_asset_id: image.mediaAssetId, ...(opts.isPano !== undefined ? { is_pano: opts.isPano } : {}) };
    return this.request<MarbleOperation>("POST", "/marble/v1/worlds:generate", {
      display_name: opts.displayName ?? "image world",
      model: opts.model ?? "marble-1.1",
      world_prompt: { type: "image", image_prompt, ...(opts.textPrompt ? { text_prompt: opts.textPrompt } : {}) },
    });
  }

  /** Prepare a media upload; returns the signed URL and asset id. */
  async prepareUpload(): Promise<{ media_asset_id?: string; upload_url?: string; [k: string]: unknown }> {
    return this.request("POST", "/marble/v1/media-assets:prepare_upload", {});
  }

  async getOperation(operationId: string): Promise<MarbleOperation> {
    return this.request<MarbleOperation>("GET", `/marble/v1/operations/${operationId}`);
  }

  async getWorld(worldId: string): Promise<MarbleWorld> {
    return this.request<MarbleWorld>("GET", `/marble/v1/worlds/${worldId}`);
  }

  /** List generated worlds (undocumented but live: POST worlds:list). */
  async listWorlds(): Promise<{ worlds: MarbleWorld[]; next_page_token?: string | null }> {
    return this.request("POST", "/marble/v1/worlds:list", {});
  }

  /** Poll an operation until done (default: every 15 s, up to 15 min). */
  async waitForOperation(
    operationId: string,
    onTick?: (elapsedS: number) => void,
    intervalMs = 15_000,
    timeoutMs = 15 * 60_000,
  ): Promise<MarbleWorld> {
    const t0 = Date.now();
    for (;;) {
      const op = await this.getOperation(operationId);
      if (op.done) {
        if (op.error) throw new Error(`Marble operation failed: ${JSON.stringify(op.error).slice(0, 500)}`);
        if (!op.response) throw new Error("Marble operation done but carried no world in response");
        return op.response;
      }
      if (Date.now() - t0 > timeoutMs) throw new Error(`Marble operation ${operationId} timed out after ${timeoutMs / 1000}s`);
      onTick?.((Date.now() - t0) / 1000);
      await new Promise((r) => setTimeout(r, intervalMs));
    }
  }

  async downloadAsset(url: string): Promise<Buffer> {
    const res = await fetch(url);
    if (!res.ok) throw new Error(`asset download failed ${res.status}: ${url.slice(0, 120)}`);
    return Buffer.from(await res.arrayBuffer());
  }
}

export function worldIdOf(world: MarbleWorld): string {
  const id = world.world_id ?? world.id;
  if (!id) throw new Error(`Cannot find world id in: ${JSON.stringify(world).slice(0, 300)}`);
  return id;
}

export function operationIdOf(op: MarbleOperation): string {
  const id = op.operation_id ?? (typeof op.name === "string" ? op.name.split("/").pop() : undefined);
  if (!id) throw new Error(`Cannot find operation id in: ${JSON.stringify(op).slice(0, 300)}`);
  return id;
}
