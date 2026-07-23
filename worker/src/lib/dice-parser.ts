// lib/dice-parser.ts — parser seguro de notação de dados
//
// IMPORTANTE: NUNCA usa eval() nem new Function(). Implementa um parser
// manual (tokenizer + recursive descent) que só aceita a gramática definida.
// Qualquer entrada fora da gramática é rejeitada com erro claro.
//
// Gramática suportada:
//   NdS           — N dados de S lados (ex: 2d6, 1d20)
//   +X / -X       — modificador fixo
//   A+B+C         — múltiplos termos somados (ex: 1d20+2d6+3)
//   NdSkhK        — mantém os K maiores (ex: 2d20kh1 = vantagem)
//   NdSklK        — mantém os K menores (ex: 2d20kl1 = desvantagem)
//   NdSdhK        — descarta os K maiores (ex: 4d6dh1)
//   NdSdlK        — descarta os K menores (ex: 4d6dl1 = 4d6 descarta menor)
//
// Limites de segurança:
//   - Máximo 100 dados por termo
//   - Máximo 1000 lados por dado
//   - Máximo 20 termos por fórmula
//   - Modificador entre -1.000.000 e +1.000.000

export interface DieRoll {
  sides: number;
  value: number;          // valor rolado (1..sides)
  kept: boolean;          // true se foi mantido no total, false se foi descartado
  dropReason?: "kh" | "kl" | "dh" | "dl";
}

export interface TermResult {
  kind: "dice" | "modifier";
  // Para dice:
  dice?: DieRoll[];       // todos os dados rolados (incluindo descartados, kept=false)
  subtotal?: number;      // soma dos dados mantidos
  // Para modifier:
  modifier?: number;
}

export interface RollResult {
  formula: string;        // fórmula normalizada
  terms: TermResult[];    // detalhamento por termo
  total: number;          // soma final
}

const MAX_DICE = 100;
const MAX_SIDES = 1000;
const MAX_TERMS = 20;
const MAX_MODIFIER = 1_000_000;

export class DiceParseError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "DiceParseError";
  }
}

// ----- Tokenizer -----
type TokenType = "number" | "d" | "kh" | "kl" | "dh" | "dl" | "plus" | "minus" | "eof";
interface Token {
  type: TokenType;
  value: string;
  pos: number;
}

function tokenize(input: string): Token[] {
  const tokens: Token[] = [];
  let i = 0;
  const s = input.toLowerCase();
  while (i < s.length) {
    const ch = s[i];
    if (ch === " " || ch === "\t" || ch === "\n") { i++; continue; }
    if (ch >= "0" && ch <= "9") {
      let j = i;
      while (j < s.length && s[j] >= "0" && s[j] <= "9") j++;
      tokens.push({ type: "number", value: s.slice(i, j), pos: i });
      i = j;
      continue;
    }
    // Operadores keep/drop (kh/kl/dh/dl) — 2 letras.
    // Importante: checar ANTES do 'd' sozinho porque 'dl' começa com 'd'.
    if (i + 1 < s.length) {
      const two = s.slice(i, i + 2);
      if (two === "kh" || two === "kl" || two === "dh" || two === "dl") {
        tokens.push({ type: two as TokenType, value: two, pos: i });
        i += 2;
        continue;
      }
    }
    if (ch === "d") {
      // 'd' sozinho é o separador "NdS".
      tokens.push({ type: "d", value: "d", pos: i });
      i++;
      continue;
    }
    if (ch === "+") { tokens.push({ type: "plus", value: "+", pos: i }); i++; continue; }
    if (ch === "-") { tokens.push({ type: "minus", value: "-", pos: i }); i++; continue; }
    throw new DiceParseError(`Caractere inesperado '${ch}' na posição ${i + 1}.`);
  }
  tokens.push({ type: "eof", value: "", pos: s.length });
  return tokens;
}

// ----- Parser -----
// Gramática:
//   formula   := term (('+' | '-') term)*
//   term      := dice | modifier
//   dice      := number 'd' number modifier?
//   modifier  := ('kh' | 'kl' | 'dh' | 'dl') number
//   literal   := number  (modificador puro, sem 'd')

interface DiceTermSpec {
  kind: "dice";
  count: number;
  sides: number;
  modifier?: { op: "kh" | "kl" | "dh" | "dl"; count: number };
}
interface ModifierTermSpec {
  kind: "modifier";
  sign: 1 | -1;
  value: number;
}
type TermSpec = DiceTermSpec | ModifierTermSpec;

class Parser {
  private tokens: Token[];
  private pos = 0;
  constructor(tokens: Token[]) { this.tokens = tokens; }
  private peek(): Token { return this.tokens[this.pos]; }
  private next(): Token { return this.tokens[this.pos++]; }

  parseFormula(): TermSpec[] {
    const terms: TermSpec[] = [];
    // Primeiro termo sem sinal obrigatório; mas aceita leading +/-
    let sign: 1 | -1 = 1;
    if (this.peek().type === "plus") { this.next(); }
    else if (this.peek().type === "minus") { this.next(); sign = -1; }

    terms.push(this.parseTerm(sign));

    while (this.peek().type === "plus" || this.peek().type === "minus") {
      const op = this.next().type;
      sign = op === "plus" ? 1 : -1;
      terms.push(this.parseTerm(sign));
    }

    if (this.peek().type !== "eof") {
      throw new DiceParseError(`Token inesperado '${this.peek().value}' na posição ${this.peek().pos + 1}.`);
    }
    return terms;
  }

  private parseTerm(sign: 1 | -1): TermSpec {
    const numTok = this.peek();
    if (numTok.type !== "number") {
      throw new DiceParseError(`Esperado número na posição ${numTok.pos + 1}, obtido '${numTok.value || "fim"}.`);
    }
    const count = parseInt(numTok.value, 10);
    this.next();
    if (count < 0) throw new DiceParseError("Número negativo não permitido como contagem de dados.");

    // Se vier 'd', é um termo de dados. Senão, é um modificador.
    if (this.peek().type === "d") {
      this.next(); // consome 'd'
      const sidesTok = this.peek();
      if (sidesTok.type !== "number") {
        throw new DiceParseError(`Esperado número de lados após 'd' na posição ${sidesTok.pos + 1}.`);
      }
      const sides = parseInt(sidesTok.value, 10);
      this.next();
      if (sign === -1) {
        throw new DiceParseError("Termo de dados não pode ter sinal negativo. Use modificador separado.");
      }
      let mod: DiceTermSpec["modifier"];
      const t = this.peek().type;
      if (t === "kh" || t === "kl" || t === "dh" || t === "dl") {
        this.next();
        const cntTok = this.peek();
        if (cntTok.type !== "number") {
          throw new DiceParseError(`Esperado número após '${t}' na posição ${cntTok.pos + 1}.`);
        }
        const cnt = parseInt(cntTok.value, 10);
        this.next();
        if (cnt <= 0) throw new DiceParseError(`Contagem de '${t}' deve ser >= 1.`);
        mod = { op: t, count: cnt };
      }
      return { kind: "dice", count, sides, modifier: mod };
    }
    // Modificador puro
    const value = count;
    return { kind: "modifier", sign, value: sign === 1 ? value : -value };
  }
}

function validateSpecs(specs: TermSpec[]): void {
  if (specs.length > MAX_TERMS) {
    throw new DiceParseError(`Máximo de ${MAX_TERMS} termos por fórmula (recebido ${specs.length}).`);
  }
  for (const s of specs) {
    if (s.kind === "dice") {
      if (s.count < 1) throw new DiceParseError("Deve rolar ao menos 1 dado.");
      if (s.count > MAX_DICE) throw new DiceParseError(`Máximo de ${MAX_DICE} dados por termo (recebido ${s.count}).`);
      if (s.sides < 2) throw new DiceParseError("Dado deve ter ao menos 2 lados.");
      if (s.sides > MAX_SIDES) throw new DiceParseError(`Máximo de ${MAX_SIDES} lados por dado (recebido ${s.sides}).`);
      if (s.modifier) {
        if (s.modifier.count >= s.count) {
          throw new DiceParseError(`'${s.modifier.op}${s.modifier.count}' manteria 0 dados (termo tem ${s.count} dados).`);
        }
      }
    } else {
      if (Math.abs(s.value) > MAX_MODIFIER) {
        throw new DiceParseError(`Modificador deve estar entre -${MAX_MODIFIER} e +${MAX_MODIFIER}.`);
      }
    }
  }
}

// ----- Roller -----
function rollDie(sides: number): number {
  // crypto.getRandomValues garante rolagem não-enviesada.
  // Re-rola se cair no "modulo bias" range.
  const maxUint32 = 0xFFFFFFFF;
  const limit = maxUint32 - (maxUint32 % sides);
  const buf = new Uint32Array(1);
  for (let attempt = 0; attempt < 16; attempt++) {
    crypto.getRandomValues(buf);
    if (buf[0] < limit) {
      return (buf[0] % sides) + 1;
    }
  }
  // Fallback (extremamente raro): aceita bias.
  return (buf[0] % sides) + 1;
}

function rollDiceTerm(spec: DiceTermSpec): TermResult {
  const dice: DieRoll[] = [];
  for (let i = 0; i < spec.count; i++) {
    dice.push({ sides: spec.sides, value: rollDie(spec.sides), kept: true });
  }
  // Aplica modificador keep/drop
  if (spec.modifier) {
    const { op, count } = spec.modifier;
    // Ordena por valor (cópia, não muta o array original de ordem de rolagem)
    const indices = dice.map((_, i) => i).sort((a, b) => dice[a].value - dice[b].value);
    let toDropIdx: number[] = [];
    if (op === "kh") {
      // Mantém os K maiores → descarta todos os menores
      toDropIdx = indices.slice(0, dice.length - count);
    } else if (op === "kl") {
      // Mantém os K menores → descarta todos os maiores
      toDropIdx = indices.slice(count);
    } else if (op === "dh") {
      // Descarta os K maiores
      toDropIdx = indices.slice(dice.length - count);
    } else if (op === "dl") {
      // Descarta os K menores
      toDropIdx = indices.slice(0, count);
    }
    for (const idx of toDropIdx) {
      dice[idx].kept = false;
      dice[idx].dropReason = op;
    }
  }
  const subtotal = dice.filter(d => d.kept).reduce((a, d) => a + d.value, 0);
  return { kind: "dice", dice, subtotal };
}

// ----- API pública -----
export function parseFormula(input: string): TermSpec[] {
  if (!input || typeof input !== "string") {
    throw new DiceParseError("Fórmula vazia.");
  }
  if (input.length > 200) {
    throw new DiceParseError("Fórmula muito longa (máx 200 caracteres).");
  }
  const trimmed = input.trim();
  if (!trimmed) throw new DiceParseError("Fórmula vazia.");
  const tokens = tokenize(trimmed);
  const parser = new Parser(tokens);
  const specs = parser.parseFormula();
  validateSpecs(specs);
  return specs;
}

export function rollFormula(input: string): RollResult {
  const specs = parseFormula(input);
  const terms: TermResult[] = specs.map(s => {
    if (s.kind === "dice") return rollDiceTerm(s);
    return { kind: "modifier", modifier: s.value };
  });
  const total = terms.reduce((a, t) => {
    if (t.kind === "dice") return a + (t.subtotal ?? 0);
    return a + (t.modifier ?? 0);
  }, 0);
  return { formula: input.trim(), terms, total };
}

// Para exibição amigável do breakdown (ex: "2d6: [3, 5] = 8").
export function formatBreakdown(result: RollResult): string {
  const parts: string[] = [];
  for (const t of result.terms) {
    if (t.kind === "dice") {
      const kept = (t.dice ?? []).filter(d => d.kept).map(d => d.value).join(", ");
      const dropped = (t.dice ?? []).filter(d => !d.kept).map(d => `~${d.value}~`).join(", ");
      parts.push(`[${kept}${dropped ? ` (descartados: ${dropped})` : ""}] = ${t.subtotal}`);
    } else {
      const v = t.modifier ?? 0;
      parts.push(v >= 0 ? `+${v}` : `${v}`);
    }
  }
  return parts.join("  ") + `  →  ${result.total}`;
}
