#!/usr/bin/env node
/**
 * scripts/clean-urls.js — Move HTMLs para estrutura pasta/index.html e atualiza links.
 *
 * Transforma:
 *   sala.html → sala/index.html
 *   wiki/pagina.html → wiki/pagina/index.html
 *   href="sala.html" → href="sala"
 *   href="wiki/pagina.html?slug=..." → href="wiki/pagina?slug=..."
 *   css/style.css (em sala/index.html) → ../css/style.css
 *   js/config.js (em sala/index.html) → ../js/config.js
 *
 * index.html na raiz PERMANECE (GitHub Pages serve / automaticamente).
 * wiki/index.html PERMANECE (serve /wiki/ automaticamente).
 *
 * Uso: node scripts/clean-urls.js
 * Rodar UMA VEZ. Depois disso, o cache-bust.js ainda funciona normalmente.
 */

const fs = require("fs");
const path = require("path");

const ROOT = path.resolve(__dirname, "..");

// Arquivos HTML da raiz para mover (NÃO inclui index.html — fica na raiz)
const rootHtmls = [
  "admin.html", "change-password.html", "criar-personagem.html", "criar-sala.html",
  "edit.html", "entrar-sala.html", "gerenciar-sets-regras.html", "gerenciar-status.html",
  "history.html", "login.html", "meus-personagens.html", "page.html",
  "perfil.html", "sala.html",
];

// Arquivos HTML da wiki para mover (NÃO inclui wiki/index.html)
const wikiHtmls = ["editar.html", "historico.html", "pagina.html"];

// Padrões de link para atualizar em TODOS os arquivos (HTML + JS)
// Ordem importa: padrões mais específicos primeiro
const linkReplacements = [
  // Links wiki/ (de outros HTMLs ou JS)
  { from: /wiki\/pagina\.html/g, to: "wiki/pagina" },
  { from: /wiki\/editar\.html/g, to: "wiki/editar" },
  { from: /wiki\/historico\.html/g, to: "wiki/historico" },
  { from: /wiki\/index\.html/g, to: "wiki/" },
  // Links raiz .html → sem extensão (mas NÃO index.html que vira /)
  { from: /sala\.html/g, to: "sala" },
  { from: /criar-sala\.html/g, to: "criar-sala" },
  { from: /entrar-sala\.html/g, to: "entrar-sala" },
  { from: /criar-personagem\.html/g, to: "criar-personagem" },
  { from: /meus-personagens\.html/g, to: "meus-personagens" },
  { from: /gerenciar-status\.html/g, to: "gerenciar-status" },
  { from: /gerenciar-sets-regras\.html/g, to: "gerenciar-sets-regras" },
  { from: /login\.html/g, to: "login" },
  { from: /change-password\.html/g, to: "change-password" },
  { from: /admin\.html/g, to: "admin" },
  { from: /perfil\.html/g, to: "perfil" },
  { from: /page\.html/g, to: "page" },
  { from: /edit\.html/g, to: "edit" },
  { from: /history\.html/g, to: "history" },
];

// Caminhos de assets que precisam de ajuste de profundidade
// Em arquivos movidos para /foo/index.html (depth 1): css/ → ../css/
// Em arquivos movidos para /wiki/foo/index.html (depth 2): css/ → ../../css/
const assetPaths = [
  { regex: /href="css\//g, depth1: 'href="../css/', depth2: 'href="../../css/' },
  { regex: /src="js\//g, depth1: 'src="../js/', depth2: 'src="../../js/' },
  { regex: /src="vendor\//g, depth1: 'src="../vendor/', depth2: 'src="../../vendor/' },
  { regex: /href="favicon/g, depth1: 'href="../favicon', depth2: 'href="../../favicon' },
  { regex: /href="css\/theme-custom/g, depth1: 'href="../css/theme-custom', depth2: 'href="../../css/theme-custom' },
];

function updateLinks(content) {
  let result = content;
  for (const { from, to } of linkReplacements) {
    result = result.replace(from, to);
  }
  return result;
}

function updateAssetPaths(content, depth) {
  let result = content;
  for (const ap of assetPaths) {
    const replacement = depth === 2 ? ap.depth2 : ap.depth1;
    result = result.replace(ap.regex, replacement);
  }
  return result;
}

function moveFile(srcPath, destDir, depth) {
  const fileName = path.basename(srcPath);
  const destPath = path.join(destDir, "index.html");

  // Lê conteúdo
  let content = fs.readFileSync(srcPath, "utf8");

  // Atualiza links .html → sem extensão
  content = updateLinks(content);

  // Atualiza paths de assets (css/, js/, vendor/) baseado na profundidade
  content = updateAssetPaths(content, depth);

  // Cria diretório de destino
  fs.mkdirSync(destDir, { recursive: true });

  // Escreve novo arquivo
  fs.writeFileSync(destPath, content, "utf8");

  // Deleta arquivo original
  fs.unlinkSync(srcPath);

  console.log(`  ✓ ${fileName} → ${path.relative(ROOT, destPath)}`);
}

function updateFile(filePath, depth = 0) {
  if (!fs.existsSync(filePath)) return;
  let content = fs.readFileSync(filePath, "utf8");
  const original = content;
  content = updateLinks(content);
  if (depth > 0) {
    content = updateAssetPaths(content, depth);
  }
  if (content !== original) {
    fs.writeFileSync(filePath, content, "utf8");
    console.log(`  ~ Atualizado: ${path.relative(ROOT, filePath)}`);
  }
}

console.log("\n📦 Clean URLs — movendo HTMLs para pasta/index.html\n");

// 1. Move HTMLs da raiz
console.log("📁 Raiz:");
for (const f of rootHtmls) {
  const src = path.join(ROOT, f);
  if (!fs.existsSync(src)) { console.log(`  ⚠ ${f} não encontrado — pulando`); continue; }
  const name = f.replace(".html", "");
  const destDir = path.join(ROOT, name);
  moveFile(src, destDir, 1);
}

// 2. Move HTMLs da wiki
console.log("📁 Wiki:");
for (const f of wikiHtmls) {
  const src = path.join(ROOT, "wiki", f);
  if (!fs.existsSync(src)) { console.log(`  ⚠ wiki/${f} não encontrado — pulando`); continue; }
  const name = f.replace(".html", "");
  const destDir = path.join(ROOT, "wiki", name);
  moveFile(src, destDir, 2);
}

// 3. Atualiza links em index.html (raiz) — depth 0 (não precisa ajustar assets)
console.log("📁 Atualizando index.html (raiz):");
updateFile(path.join(ROOT, "index.html"), 0);

// 4. Atualiza links em wiki/index.html — depth 0 (já está na wiki, assets relativos)
console.log("📁 Atualizando wiki/index.html:");
updateFile(path.join(ROOT, "wiki", "index.html"), 0);

// 5. Atualiza links em TODOS os JS files
console.log("📁 Atualizando JS files:");
const jsDir = path.join(ROOT, "js");
for (const f of fs.readdirSync(jsDir)) {
  if (f.endsWith(".js")) {
    updateFile(path.join(jsDir, f), 0);
  }
}

// 6. Atualiza links em scripts/cache-bust.js (precisa achar HTMLs em pastas agora)
console.log("📁 Atualizando cache-bust.js:");
const cacheBustPath = path.join(ROOT, "scripts", "cache-bust.js");
if (fs.existsSync(cacheBustPath)) {
  let content = fs.readFileSync(cacheBustPath, "utf8");
  // O cache-bust.js precisa percorrer subpastas agora — substitui a função findHtmlFiles
  const oldFindHtmlFiles = /function findHtmlFiles\(dir\) \{[\s\S]*?\n  return out;\n\}/;
  const newFindHtmlFiles = `function findHtmlFiles(dir) {
  const out = [];
  if (!fs.existsSync(dir)) return out;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.isDirectory()) {
      // Procura index.html dentro da subpasta (ex: sala/index.html)
      const subIndex = path.join(dir, entry.name, "index.html");
      if (fs.existsSync(subIndex)) out.push(subIndex);
    } else if (entry.isFile() && entry.name.endsWith(".html") && entry.name !== "index.html") {
      // Arquivos .html soltos (não move — legado)
      out.push(path.join(dir, entry.name));
    }
  }
  return out;
}`;
  content = content.replace(oldFindHtmlFiles, newFindHtmlFiles);
  fs.writeFileSync(cacheBustPath, content, "utf8");
  console.log("  ~ cache-bust.js atualizado para percorrer subpastas");
}

console.log("\n✅ URLs limpas aplicadas! Todos os HTMLs agora em pasta/index.html.");
console.log("⚠️  IMPORTANTE: rode 'node scripts/cache-bust.js' para gerar nova versão.\n");
