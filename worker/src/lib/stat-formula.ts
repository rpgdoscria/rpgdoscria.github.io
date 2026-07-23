// lib/stat-formula.ts — parser seguro de fórmulas de status (sem eval)
//
// Avalia expressões como "10 + {Constituição} * 2" substituindo {NomeDoStatus}
// pelo valor atual daquele status no personagem, e calculando o resultado
// com apenas operadores aritméticos básicos (+, -, *, /, parênteses).
//
// NUNCA usa eval() nem new Function(). Implementa um parser de expressão
// manual (tokenizer + shunting-yard + avaliação em RPN).

export class FormulaError extends Error {
  constructor(msg: string) { super(msg); this.name = "FormulaError"; }
}

// Extrai todas as referências {Nome} de uma fórmula
export function extractReferences(formula: string): string[] {
  const refs: string[] = [];
  const re = /\{([^}]+)\}/g;
  let m;
  while ((m = re.exec(formula)) !== null) {
    refs.push(m[1].trim());
  }
  return refs;
}

// Substitui {Nome} pelos valores e avalia a expressão
export function evaluateFormula(
  formula: string,
  statValues: Record<string, number>
): number {
  // Substitui {Nome} por valores numéricos
  let expr = formula.replace(/\{([^}]+)\}/g, (_, name) => {
    const key = name.trim();
    if (!(key in statValues)) {
      throw new FormulaError(`Status "${key}" não encontrado neste personagem.`);
    }
    const v = statValues[key];
    if (typeof v !== "number" || !Number.isFinite(v)) {
      throw new FormulaError(`Status "${key}" não é um número válido.`);
    }
    return String(v);
  });

  // Tokeniza
  const tokens = tokenize(expr);
  // Converte para RPN (shunting-yard)
  const rpn = toRPN(tokens);
  // Avalia RPN
  return evalRPN(rpn);
}

// Valida uma fórmula sem necessariamente avaliá-la
export function validateFormula(
  formula: string,
  existingStatNames: string[]
): { ok: boolean; error?: string; references?: string[] } {
  if (!formula || !formula.trim()) {
    return { ok: false, error: "Fórmula vazia." };
  }
  if (formula.length > 500) {
    return { ok: false, error: "Fórmula muito longa (máx 500 chars)." };
  }

  const refs = extractReferences(formula);
  for (const ref of refs) {
    if (!existingStatNames.includes(ref)) {
      return { ok: false, error: `Status "${ref}" não existe neste personagem.`, references: refs };
    }
  }

  // Tenta tokenizar e converter para RPN (validação sintática)
  try {
    let expr = formula.replace(/\{([^}]+)\}/g, "1"); // substitui refs por 1 pra testar sintaxe
    const tokens = tokenize(expr);
    const rpn = toRPN(tokens);
    evalRPN(rpn);
  } catch (e) {
    return { ok: false, error: `Sintaxe inválida: ${e instanceof Error ? e.message : "erro desconhecido"}`, references: refs };
  }

  return { ok: true, references: refs };
}

// Detecta dependências circulares num conjunto de fórmulas
// formulasByStatName: { statName -> formulaString }
// existingStatNames: todos os nomes de stats do personagem
export function detectCircularDependencies(
  formulasByStatName: Record<string, string>
): string[] | null {
  // Constrói grafo de dependências: statA -> [statB, statC, ...]
  const graph: Record<string, string[]> = {};
  for (const [statName, formula] of Object.entries(formulasByStatName)) {
    const refs = extractReferences(formula);
    graph[statName] = refs;
  }

  // DFS pra detectar ciclo
  const visited: Set<string> = new Set();
  const inStack: Set<string> = new Set();
  const path: string[] = [];

  function dfs(node: string): boolean {
    if (inStack.has(node)) {
      path.push(node);
      return true; // ciclo detectado
    }
    if (visited.has(node)) return false;
    visited.add(node);
    inStack.add(node);
    path.push(node);
    const deps = graph[node] || [];
    for (const dep of deps) {
      if (dfs(dep)) return true;
    }
    inStack.delete(node);
    path.pop();
    return false;
  }

  for (const node of Object.keys(graph)) {
    if (dfs(node)) {
      return path; // retorna o caminho do ciclo
    }
  }
  return null; // sem ciclo
}

// ---------- Tokenizer ----------
type TokenType = "number" | "op" | "lparen" | "rparen";
interface Token { type: TokenType; value: string; }

function tokenize(expr: string): Token[] {
  const tokens: Token[] = [];
  let i = 0;
  const s = expr.replace(/\s/g, "");
  while (i < s.length) {
    const ch = s[i];
    if (ch >= "0" && ch <= "9" || ch === ".") {
      let j = i;
      while (j < s.length && (s[j] >= "0" && s[j] <= "9" || s[j] === ".")) j++;
      const num = s.slice(i, j);
      if (isNaN(Number(num))) throw new FormulaError(`Número inválido: ${num}`);
      tokens.push({ type: "number", value: num });
      i = j;
      continue;
    }
    if (ch === "+" || ch === "-" || ch === "*" || ch === "/") {
      tokens.push({ type: "op", value: ch });
      i++;
      continue;
    }
    if (ch === "(") { tokens.push({ type: "lparen", value: ch }); i++; continue; }
    if (ch === ")") { tokens.push({ type: "rparen", value: ch }); i++; continue; }
    throw new FormulaError(`Caractere inválido na fórmula: '${ch}'`);
  }
  return tokens;
}

// ---------- Shunting-yard (infix -> RPN) ----------
const PRECEDENCE: Record<string, number> = { "+": 1, "-": 1, "*": 2, "/": 2 };

function toRPN(tokens: Token[]): Token[] {
  const output: Token[] = [];
  const stack: Token[] = [];
  for (const t of tokens) {
    if (t.type === "number") { output.push(t); continue; }
    if (t.type === "op") {
      while (stack.length > 0 && stack[stack.length - 1].type === "op" &&
             PRECEDENCE[stack[stack.length - 1].value] >= PRECEDENCE[t.value]) {
        output.push(stack.pop()!);
      }
      stack.push(t);
      continue;
    }
    if (t.type === "lparen") { stack.push(t); continue; }
    if (t.type === "rparen") {
      while (stack.length > 0 && stack[stack.length - 1].type !== "lparen") {
        output.push(stack.pop()!);
      }
      if (stack.length === 0) throw new FormulaError("Parênteses desbalanceados.");
      stack.pop(); // remove o lparen
      continue;
    }
  }
  while (stack.length > 0) {
    const t = stack.pop()!;
    if (t.type === "lparen" || t.type === "rparen") throw new FormulaError("Parênteses desbalanceados.");
    output.push(t);
  }
  return output;
}

// ---------- Avaliação RPN ----------
function evalRPN(rpn: Token[]): number {
  const stack: number[] = [];
  for (const t of rpn) {
    if (t.type === "number") {
      stack.push(Number(t.value));
      continue;
    }
    if (t.type === "op") {
      if (stack.length < 2) throw new FormulaError("Expressão inválida (operandos insuficientes).");
      const b = stack.pop()!;
      const a = stack.pop()!;
      switch (t.value) {
        case "+": stack.push(a + b); break;
        case "-": stack.push(a - b); break;
        case "*": stack.push(a * b); break;
        case "/":
          if (b === 0) throw new FormulaError("Divisão por zero.");
          stack.push(a / b);
          break;
      }
    }
  }
  if (stack.length !== 1) throw new FormulaError("Expressão inválida.");
  const result = stack[0];
  if (!Number.isFinite(result)) throw new FormulaError("Resultado não é um número finito.");
  return Math.round(result * 100) / 100; // arredonda pra 2 casas
}
