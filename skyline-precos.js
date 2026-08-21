/**
 * API da Lista de Preços (webhook n8n). Sem lógica de produção/CQE.
 */
const SkylinePrecos = {
  API_LISTA_PRECOS: "https://automacao.skylinemobile.com.br/webhook/listaprecos",
  DEFAULT_FETCH_TIMEOUT_MS: 120000,

  normalizeRows(payload) {
    if (Array.isArray(payload)) return payload;
    if (!payload || typeof payload !== "object") return [];
    const keys = Object.keys(payload);
    for (const key of keys) {
      const k = String(key).trim().toLowerCase();
      if (k === "data" || k.startsWith("data ")) {
        if (Array.isArray(payload[key])) return payload[key];
      }
    }
    for (const key of keys) {
      if (Array.isArray(payload[key])) return payload[key];
    }
    return [];
  },

  async fetchWebhook(url, timeoutMs = this.DEFAULT_FETCH_TIMEOUT_MS) {
    const sep = url.includes("?") ? "&" : "?";
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const res = await fetch(`${url}${sep}_t=${Date.now()}`, {
        cache: "no-store",
        mode: "cors",
        signal: controller.signal,
        headers: { "Cache-Control": "no-cache", Pragma: "no-cache" }
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const text = await res.text();
      try {
        return JSON.parse(text);
      } catch {
        throw new Error("Resposta inválida (não é JSON)");
      }
    } catch (err) {
      if (err.name === "AbortError") {
        throw new Error(`Timeout ao carregar dados (${Math.round(timeoutMs / 1000)}s)`);
      }
      if (String(err.message || err).includes("Failed to fetch")) {
        throw new Error("Falha de rede ou CORS — verifique conexão e atualize a página");
      }
      throw err;
    } finally {
      clearTimeout(timer);
    }
  },

  crc32(bytes) {
    if (!this._crcTable) {
      const table = new Uint32Array(256);
      for (let i = 0; i < 256; i++) {
        let c = i;
        for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
        table[i] = c >>> 0;
      }
      this._crcTable = table;
    }
    let crc = 0xffffffff;
    for (let i = 0; i < bytes.length; i++) {
      crc = this._crcTable[(crc ^ bytes[i]) & 0xff] ^ (crc >>> 8);
    }
    return (crc ^ 0xffffffff) >>> 0;
  },

  concatBytes(parts) {
    const total = parts.reduce((n, p) => n + p.length, 0);
    const out = new Uint8Array(total);
    let offset = 0;
    for (const part of parts) {
      out.set(part, offset);
      offset += part.length;
    }
    return out;
  },

  u16(n) {
    return new Uint8Array([n & 255, (n >>> 8) & 255]);
  },

  u32(n) {
    return new Uint8Array([
      n & 255,
      (n >>> 8) & 255,
      (n >>> 16) & 255,
      (n >>> 24) & 255
    ]);
  },

  async deflateRaw(bytes) {
    if (typeof CompressionStream === "undefined") return null;
    try {
      const stream = new Blob([bytes]).stream().pipeThrough(new CompressionStream("deflate-raw"));
      return new Uint8Array(await new Response(stream).arrayBuffer());
    } catch {
      return null;
    }
  },

  async makeZip(files) {
    const encoder = new TextEncoder();
    const locals = [];
    const centrals = [];
    let offset = 0;

    for (const file of files) {
      const name = encoder.encode(file.name);
      const data = typeof file.data === "string" ? encoder.encode(file.data) : file.data;
      const crc = this.crc32(data);
      const deflated = await this.deflateRaw(data);
      const useDeflate = deflated && deflated.length < data.length;
      const payload = useDeflate ? deflated : data;
      const method = useDeflate ? 8 : 0;
      const local = this.concatBytes([
        encoder.encode("PK\x03\x04"),
        this.u16(20),
        this.u16(0),
        this.u16(method),
        this.u16(0),
        this.u16(0),
        this.u32(crc),
        this.u32(payload.length),
        this.u32(data.length),
        this.u16(name.length),
        this.u16(0),
        name,
        payload
      ]);
      const central = this.concatBytes([
        encoder.encode("PK\x01\x02"),
        this.u16(20),
        this.u16(20),
        this.u16(0),
        this.u16(method),
        this.u16(0),
        this.u16(0),
        this.u32(crc),
        this.u32(payload.length),
        this.u32(data.length),
        this.u16(name.length),
        this.u16(0),
        this.u16(0),
        this.u16(0),
        this.u16(0),
        this.u32(0),
        this.u32(offset),
        name
      ]);
      locals.push(local);
      centrals.push(central);
      offset += local.length;
    }

    const centralDir = this.concatBytes(centrals);
    const end = this.concatBytes([
      encoder.encode("PK\x05\x06"),
      this.u16(0),
      this.u16(0),
      this.u16(files.length),
      this.u16(files.length),
      this.u32(centralDir.length),
      this.u32(offset),
      this.u16(0)
    ]);
    return this.concatBytes([...locals, centralDir, end]);
  },

  async makeXlsxBlob(files) {
    const zip = await this.makeZip(files);
    return new Blob([zip], {
      type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
    });
  },

  saveBlob(blob, filename) {
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    a.rel = "noopener";
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 30_000);
  }
};
