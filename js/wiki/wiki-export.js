// js/wiki/wiki-export.js — geração de CSV e ZIP da Wiki no navegador.

(function () {
  const encoder = new TextEncoder();

  function csvCell(value) {
    const text = String(value ?? "");
    return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
  }

  function toCsv(pages) {
    const headers = [
      "titulo", "categoria", "slug", "conteudo_markdown", "autor",
      "criada_em", "atualizada_em", "secreta", "revelada", "acesso_restrito",
    ];
    const lines = [headers.join(",")];
    pages.forEach((page) => {
      lines.push([
        page.title, page.category, page.slug, page.content_md, page.author,
        page.created_at, page.updated_at, page.secret ? "sim" : "não",
        page.revealed ? "sim" : "não", page.restricted ? "sim" : "não",
      ].map(csvCell).join(","));
    });
    // BOM: permite que o Excel reconheça UTF-8 automaticamente.
    return `\uFEFF${lines.join("\r\n")}\r\n`;
  }

  function safeSegment(value, fallback) {
    const normalized = String(value ?? "")
      .replace(/[<>:"/\\|?*\u0000-\u001f]/g, "-")
      .replace(/\s+/g, " ")
      .replace(/\.+$/g, "")
      .trim()
      .slice(0, 96);
    return normalized || fallback;
  }

  function uniqueSegment(value, used, fallback) {
    const base = safeSegment(value, fallback);
    let candidate = base;
    let suffix = 2;
    while (used.has(candidate.toLocaleLowerCase())) {
      candidate = `${base} (${suffix++})`;
    }
    used.add(candidate.toLocaleLowerCase());
    return candidate;
  }

  function pageMarkdown(page) {
    const metadata = [
      `> Categoria: ${page.category || "—"}`,
      `> Autor: ${page.author || "—"}`,
      `> Criada em: ${page.created_at || "—"}`,
      `> Atualizada em: ${page.updated_at || "—"}`,
    ];
    if (page.restricted) metadata.push("> Acesso restrito: o conteúdo não foi exportado.");
    const content = page.content_md || "";
    return `# ${page.title || "Sem título"}\r\n\r\n${metadata.join("\r\n")}\r\n\r\n${content}${content.endsWith("\n") ? "" : "\r\n"}`;
  }

  function u16(value) {
    const bytes = new Uint8Array(2);
    new DataView(bytes.buffer).setUint16(0, value, true);
    return bytes;
  }

  function u32(value) {
    const bytes = new Uint8Array(4);
    new DataView(bytes.buffer).setUint32(0, value >>> 0, true);
    return bytes;
  }

  function concatBytes(chunks) {
    const total = chunks.reduce((sum, chunk) => sum + chunk.length, 0);
    const output = new Uint8Array(total);
    let offset = 0;
    chunks.forEach((chunk) => {
      output.set(chunk, offset);
      offset += chunk.length;
    });
    return output;
  }

  let crcTable;
  function getCrcTable() {
    if (crcTable) return crcTable;
    crcTable = new Uint32Array(256);
    for (let n = 0; n < 256; n++) {
      let c = n;
      for (let k = 0; k < 8; k++) c = (c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1);
      crcTable[n] = c >>> 0;
    }
    return crcTable;
  }

  function crc32(bytes) {
    let crc = 0xFFFFFFFF;
    const table = getCrcTable();
    for (const byte of bytes) crc = table[(crc ^ byte) & 0xFF] ^ (crc >>> 8);
    return (crc ^ 0xFFFFFFFF) >>> 0;
  }

  function dosDateTime(date = new Date()) {
    return {
      time: (date.getHours() << 11) | (date.getMinutes() << 5) | Math.floor(date.getSeconds() / 2),
      date: ((date.getFullYear() - 1980) << 9) | ((date.getMonth() + 1) << 5) | date.getDate(),
    };
  }

  // ZIP sem compressão (método "store"): simples, compatível e sem dependência
  // externa. O conteúdo da Wiki normalmente é pequeno, então isso também evita
  // adicionar uma biblioteca inteira só para gerar o download.
  function createZip(files) {
    const localParts = [];
    const centralParts = [];
    const now = dosDateTime();
    let offset = 0;

    files.forEach((file) => {
      const name = encoder.encode(file.name);
      const data = encoder.encode(file.content);
      const crc = crc32(data);
      const flags = 0x0800; // nomes e conteúdo UTF-8
      const localHeader = concatBytes([
        u32(0x04034B50), u16(20), u16(flags), u16(0), u16(now.time), u16(now.date),
        u32(crc), u32(data.length), u32(data.length), u16(name.length), u16(0), name,
      ]);
      localParts.push(localHeader, data);

      centralParts.push(concatBytes([
        u32(0x02014B50), u16(20), u16(20), u16(flags), u16(0), u16(now.time), u16(now.date),
        u32(crc), u32(data.length), u32(data.length), u16(name.length), u16(0), u16(0),
        u16(0), u16(0), u32(0), u32(offset), name,
      ]));
      offset += localHeader.length + data.length;
    });

    const centralDirectory = concatBytes(centralParts);
    const localDirectory = concatBytes(localParts);
    const end = concatBytes([
      u32(0x06054B50), u16(0), u16(0), u16(files.length), u16(files.length),
      u32(centralDirectory.length), u32(localDirectory.length), u16(0),
    ]);
    return new Blob([localDirectory, centralDirectory, end], { type: "application/zip" });
  }

  function buildZipFiles(pages) {
    const usedCategories = new Set();
    const categoryFolders = new Map();
    const usedFilesByCategory = new Map();
    const files = [];
    const sorted = [...pages].sort((a, b) =>
      `${a.category}\0${a.title}`.localeCompare(`${b.category}\0${b.title}`, "pt-BR")
    );

    sorted.forEach((page) => {
      const category = page.category || "Sem categoria";
      if (!categoryFolders.has(category)) {
        categoryFolders.set(category, uniqueSegment(category, usedCategories, "Sem categoria"));
        usedFilesByCategory.set(category, new Set());
      }
      const usedNames = usedFilesByCategory.get(category);
      const folder = categoryFolders.get(category);
      const filename = uniqueSegment(page.slug || page.title, usedNames, "pagina") + ".md";
      files.push({ name: `${folder}/${filename}`, content: pageMarkdown(page) });
    });

    files.push({
      name: "wiki.csv",
      content: toCsv(pages),
    });
    files.push({
      name: "README.txt",
      content: `Exportação da Wiki\r\n\r\nPáginas exportadas: ${pages.length}\r\nAs pastas representam as categorias.\r\n`,
    });
    return files;
  }

  function download(blob, filename) {
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = filename;
    document.body.appendChild(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  function exportCsv(pages) {
    download(new Blob([toCsv(pages)], { type: "text/csv;charset=utf-8" }), "wiki.csv");
  }

  function exportZip(pages) {
    download(createZip(buildZipFiles(pages)), "wiki-por-categoria.zip");
  }

  window.wikiExport = { exportCsv, exportZip, toCsv, createZip, buildZipFiles };
})();
