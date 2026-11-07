// The running AfterFrame app, over its MCP endpoint (Streamable HTTP JSON-RPC on 127.0.0.1). Read-only here:
// the publisher lists folder collections and browses their members; nothing is ever written back.
const PROTOCOL = "2025-03-26";

export class AfterFrame {
  constructor({ port = 41706, host = "127.0.0.1" } = {}) {
    this.url = `http://${host}:${port}/mcp`;
    this.session = null;
    this.nextId = 1;
  }

  async connect() {
    const init = await this.rpc("initialize", { protocolVersion: PROTOCOL, capabilities: {}, clientInfo: { name: "yiwang-photography-publisher", version: "1" } }, { init: true });
    await this.notify("notifications/initialized");
    return init.serverInfo;
  }

  async call(tool, args = {}) {
    const res = await this.rpc("tools/call", { name: tool, arguments: args });
    const text = (res.content ?? []).filter((c) => c.type === "text").map((c) => c.text).join("");
    if (res.isError) throw new Error(`${tool}: ${text.slice(0, 400)}`);
    try { return JSON.parse(text); } catch { return text; }
  }

  async collections() {
    return (await this.call("manage_collections", { action: "list" })).collections;
  }

  async members(collectionId) {
    const out = [];
    for (let offset = 0; ; offset += 200) {
      const page = await this.call("manage_collections", { action: "browse", collection_id: collectionId, limit: 200, offset });
      const assets = page.assets ?? [];
      out.push(...assets);
      if (assets.length < 200) break;
    }
    return out;
  }

  async rpc(method, params, { init = false } = {}) {
    const id = this.nextId++;
    const res = await this.post({ jsonrpc: "2.0", id, method, params }, init);
    if (res.error) throw new Error(`${method}: ${res.error.message ?? JSON.stringify(res.error)}`);
    return res.result;
  }

  async notify(method, params = {}) { await this.post({ jsonrpc: "2.0", method, params }); }

  async post(body, init = false) {
    const headers = { "content-type": "application/json", accept: "application/json, text/event-stream", "mcp-protocol-version": PROTOCOL };
    if (this.session) headers["mcp-session-id"] = this.session;
    let res;
    try { res = await fetch(this.url, { method: "POST", headers, body: JSON.stringify(body) }); }
    catch (err) { throw new Error(`AfterFrame is not reachable at ${this.url} — open the app (or set AFTERFRAME_MCP_PORT). ${err.cause?.code ?? err.message}`); }
    if (init) this.session = res.headers.get("mcp-session-id") ?? this.session;
    if (res.status === 202 || res.status === 204) return {};
    if (!res.ok) throw new Error(`${this.url} ${res.status}: ${(await res.text()).slice(0, 300)}`);
    const type = res.headers.get("content-type") ?? "";
    const text = await res.text();
    if (type.includes("text/event-stream")) {
      // One response per request; take the last JSON data line.
      const data = text.split("\n").filter((l) => l.startsWith("data:")).map((l) => l.slice(5).trim()).filter(Boolean);
      return JSON.parse(data[data.length - 1]);
    }
    return text ? JSON.parse(text) : {};
  }
}
