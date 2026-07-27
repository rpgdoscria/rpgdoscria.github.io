#!/usr/bin/env node
/**
 * scripts/cache-bust.js — Atualiza a versão de cache-busting em todos os HTMLs.
 *
 * Como funciona:
 * 1. Gera um timestamp YYYYMMDDHHMM baseado em agora.
 * 2. Procura todos os arquivos .html na raiz do projeto (e em /wiki/).
 * 3. Substitui `?v=ANTIGO` por `?v=NOVO` em todas as tags <link> e <script>
 *    que tenham src/href apontando para arquivos locais (css/, js/, vendor/).
 *
 * Uso:
 *   node scripts/cache-bust.js           # usa timestamp agora
 *   node scripts/cache-bust.js --check  # só mostra o que mudaria (dry-run)
 *   node scripts/cache-bust.js 202607271200  # usa versão específica
 *
 * Rodar ANTES de fazer git push pro GitHub Pages.
 * Pode ser integrado em CI/CD (GitHub Action) também.
 */

const fs = require("fs");
const path = require("path");

// Diretório raiz do frontend (este script fica em /scripts/, frontend em /)
// Em produção o usuário pode rodar de qualquer lugar — usamos __dirname relativo.
const ROOT = path.resolve(__dirname, "..");

// Diretórios onde procurar HTMLs
const HTML_DIRS = [
  ROOT,                          // *.html na raiz
  path.join(ROOT, "wiki"),      // wiki/*.html
];

// Padrão: ?v=ALGUMA-COISA (qualquer string não-vazia até as aspas)
// Match em: href="css/style.css?v=202607232121" e src="js/api.js?v=202607232121"
const VERSION_RE = /(\?v=)[^"'&\s]+/g;

function generateVersion() {
  // Formato compacto: YYYYMMDDHHMM (12 dígitos)
  const d = new Date();
  const pad = (n) => String(n).padStart(2, "0");
  return (
    d.getFullYear() +
    pad(d.getMonth() + 1) +
    pad(d.getDate()) +
    pad(d.getHours()) +
    pad(d.getMinutes())
  );
}

function findHtmlFiles(dir) {
  const out = [];
  if (!fs.existsSync(dir)) return out;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.isFile() && entry.name.endsWith(".html")) {
      out.push(path.join(dir, entry.name));
    }
  }
  return out;
}

function main() {
  const args = process.argv.slice(2);
  const dryRun = args.includes("--check");
  const customVersion = args.find((a) => !a.startsWith("--"));
  const newVersion = customVersion || generateVersion();

  console.log(`\n📦 Cache-bust script`);
  console.log(`   Nova versão: ?v=${newVersion}`);
  console.log(`   Dry-run:     ${dryRun ? "SIM (não escreve)" : "NÃO (vai alterar arquivos)"}\n`);

  let totalFiles = 0;
  let totalReplacements = 0;

  for (const dir of HTML_DIRS) {
    const files = findHtmlFiles(dir);
    if (files.length === 0) continue;
    console.log(`📁 ${path.relative(ROOT, dir) || "(raiz)"}/`);
    for (const file of files) {
      const original = fs.readFileSync(file, "utf8");
      const matches = original.match(VERSION_RE) || [];
      if (matches.length === 0) {
        console.log(`   • ${path.basename(file)} — sem versões para atualizar`);
        continue;
      }
      const updated = original.replace(VERSION_RE, `$1${newVersion}`);
      const relPath = path.relative(ROOT, file);
      console.log(`   ✓ ${path.basename(file)} — ${matches.length} ocorrências atualizadas`);
      if (!dryRun) {
        fs.writeFileSync(file, updated, "utf8");
      }
      totalFiles++;
      totalReplacements += matches.length;
    }
  }

  console.log(`\n📊 Resumo:`);
  console.log(`   Arquivos modificados: ${totalFiles}`);
  console.log(`   Substituições:        ${totalReplacements}`);
  console.log(`   Nova versão:          ?v=${newVersion}\n`);

  if (dryRun) {
    console.log(`💡 Rode novamente sem --check para aplicar as mudanças.\n`);
  } else if (totalFiles > 0) {
    console.log(`✅ Pronto! Agora faça git add . && git commit -m "cache-bust: ${newVersion}" && git push\n`);
  } else {
    console.log(`ℹ️  Nada para fazer — todos os HTMLs já estavam sem versão ou não foram encontrados.\n`);
  }
}

main();
