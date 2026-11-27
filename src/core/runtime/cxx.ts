/**
 * Arduino C/C++ → JavaScript transpiler.
 *
 * It is not a full C++ compiler: it rewrites the subset that Arduino sketches
 * use (globals, functions, arrays, casts, String, library objects) into async
 * JavaScript so `delay()` can suspend without blocking the browser.
 */

export interface TranspileResult {
  js: string;
  includes: string[];
  functions: string[];
  warnings: string[];
}

export class TranspileError extends Error {
  line: number;
  constructor(msg: string, line: number) {
    super(msg);
    this.line = line;
  }
}

interface Tok {
  k: "id" | "num" | "str" | "chr" | "op" | "ws";
  v: string;
  line: number;
}

const PRIMS = new Set([
  "void", "int", "long", "short", "char", "float", "double", "bool", "boolean", "byte", "word", "unsigned", "signed",
  "size_t", "uint8_t", "int8_t", "uint16_t", "int16_t", "uint32_t", "int32_t", "uint64_t", "int64_t", "auto", "String",
]);
const QUALIFIERS = new Set(["const", "static", "volatile", "extern", "inline", "IRAM_ATTR", "PROGMEM", "constexpr", "register"]);
export const CLASSES = new Set([
  "Servo", "DHT", "LiquidCrystal_I2C", "Adafruit_NeoPixel", "WiFiClient", "PubSubClient", "IPAddress", "WiFiClientSecure",
  "ESP32PWM", "HTTPClient", "Preferences",
]);
const INTEGRAL = new Set(["int", "long", "short", "byte", "word", "unsigned", "signed", "size_t", "uint8_t", "int8_t", "uint16_t", "int16_t", "uint32_t", "int32_t", "uint64_t", "int64_t"]);
const BLOCKING = new Set(["delay", "delayMicroseconds", "yield"]);
const KEYWORDS = new Set(["if", "else", "while", "for", "do", "switch", "case", "default", "return", "break", "continue", "new", "delete", "sizeof", "true", "false", "this", "goto"]);

function stripComments(src: string): string {
  let out = "";
  let i = 0;
  while (i < src.length) {
    const c = src[i];
    const n = src[i + 1];
    if (c === '"' || c === "'") {
      const q = c;
      out += c;
      i++;
      while (i < src.length && src[i] !== q) {
        if (src[i] === "\\") {
          out += src[i] + (src[i + 1] ?? "");
          i += 2;
          continue;
        }
        if (src[i] === "\n") break;
        out += src[i++];
      }
      out += src[i] ?? "";
      i++;
    } else if (c === "/" && n === "/") {
      while (i < src.length && src[i] !== "\n") i++;
    } else if (c === "/" && n === "*") {
      i += 2;
      while (i < src.length && !(src[i] === "*" && src[i + 1] === "/")) {
        if (src[i] === "\n") out += "\n";
        i++;
      }
      i += 2;
    } else {
      out += c;
      i++;
    }
  }
  return out;
}

function preprocess(src: string, includes: string[]): string {
  const lines = src.replace(/\\\r?\n/g, " ").split("\n");
  return lines
    .map((line) => {
      const t = line.trim();
      if (!t.startsWith("#")) return line;
      const inc = t.match(/^#\s*include\s*[<"]([^>"]+)[>"]/);
      if (inc) {
        includes.push(inc[1]);
        return "";
      }
      const fdef = t.match(/^#\s*define\s+([A-Za-z_]\w*)\(([^)]*)\)\s+(.+)$/);
      if (fdef) return `const ${fdef[1]} = (${fdef[2]}) => (${fdef[3]});`;
      const def = t.match(/^#\s*define\s+([A-Za-z_]\w*)\s*(.*)$/);
      if (def) return `const ${def[1]} = ${def[2].trim() === "" ? "1" : def[2].trim()};`;
      return "";
    })
    .join("\n");
}

const OPS = ["<<=", ">>=", "...", "->", "++", "--", "<<", ">>", "<=", ">=", "==", "!=", "&&", "||", "+=", "-=", "*=", "/=", "%=", "&=", "|=", "^=", "::"];

function tokenize(src: string): Tok[] {
  const toks: Tok[] = [];
  let i = 0;
  let line = 1;
  while (i < src.length) {
    const c = src[i];
    if (c === "\n") {
      toks.push({ k: "ws", v: "\n", line });
      line++;
      i++;
      continue;
    }
    if (/\s/.test(c)) {
      let j = i;
      while (j < src.length && /\s/.test(src[j]) && src[j] !== "\n") j++;
      toks.push({ k: "ws", v: " ", line });
      i = j;
      continue;
    }
    if (/[A-Za-z_]/.test(c)) {
      let j = i + 1;
      while (j < src.length && /\w/.test(src[j])) j++;
      toks.push({ k: "id", v: src.slice(i, j), line });
      i = j;
      continue;
    }
    if (/\d/.test(c) || (c === "." && /\d/.test(src[i + 1] ?? ""))) {
      const m = src.slice(i).match(/^(0[xX][0-9a-fA-F]+|0[bB][01]+|\d*\.?\d+(?:[eE][+-]?\d+)?\.?)([uUlLfF]*)/);
      const text = m ? m[1] : c;
      toks.push({ k: "num", v: text.endsWith(".") ? text + "0" : text, line });
      i += m ? m[0].length : 1;
      continue;
    }
    if (c === '"' || c === "'") {
      let j = i + 1;
      while (j < src.length && src[j] !== c) {
        if (src[j] === "\\") j++;
        j++;
      }
      toks.push({ k: c === '"' ? "str" : "chr", v: src.slice(i, j + 1), line });
      i = j + 1;
      continue;
    }
    const op = OPS.find((o) => src.startsWith(o, i));
    if (op) {
      toks.push({ k: "op", v: op, line });
      i += op.length;
      continue;
    }
    toks.push({ k: "op", v: c, line });
    i++;
  }
  return toks;
}

function charCode(lit: string): number {
  const body = lit.slice(1, -1);
  if (body.startsWith("\\")) {
    const esc: Record<string, number> = { n: 10, r: 13, t: 9, "0": 0, "\\": 92, "'": 39, '"': 34, a: 7, b: 8, f: 12, v: 11 };
    if (body[1] === "x") return parseInt(body.slice(2), 16);
    return esc[body[1]] ?? body.charCodeAt(1);
  }
  return body.charCodeAt(0) || 0;
}

function castFn(types: string[], intBits: number): string | null {
  const t = types.filter((x) => !QUALIFIERS.has(x));
  if (!t.length) return null;
  const s = t.join(" ");
  if (t.includes("float") || t.includes("double")) return null;
  if (t.includes("bool") || t.includes("boolean")) return "__bool";
  if (s === "char" || s === "signed char") return "__char";
  if (s === "String") return "__String";
  if (t.includes("uint8_t") || t.includes("byte") || s === "unsigned char") return "__u8";
  if (t.includes("int8_t")) return "__i8";
  if (t.includes("uint16_t") || t.includes("word")) return "__u16";
  if (t.includes("int16_t") || t.includes("short")) return s.includes("unsigned") ? "__u16" : "__i16";
  if (t.includes("uint32_t") || t.includes("size_t") || s === "unsigned long" || s === "unsigned long int") return "__u32";
  if (t.includes("int32_t") || t.includes("long")) return "__i32";
  if (t.includes("uint64_t") || t.includes("int64_t")) return "__trunc";
  if (s === "unsigned" || s === "unsigned int") return intBits === 16 ? "__u16" : "__u32";
  if (t.includes("int")) return intBits === 16 ? "__i16" : "__i32";
  return null;
}

export function transpileArduino(source: string, opts: { intBits: 16 | 32 } = { intBits: 32 }): TranspileResult {
  const includes: string[] = [];
  const warnings: string[] = [];
  const pre = preprocess(stripComments(source), includes);
  const toks = tokenize(pre);
  const sig: number[] = [];
  toks.forEach((t, i) => {
    if (t.k !== "ws") sig.push(i);
  });
  // position in sig[] for each token index
  const sigPos = new Map<number, number>();
  sig.forEach((ti, si) => sigPos.set(ti, si));
  const S = (si: number): Tok | undefined => (si >= 0 && si < sig.length ? toks[sig[si]] : undefined);

  const isType = (v: string | undefined) => !!v && (PRIMS.has(v) || QUALIFIERS.has(v) || CLASSES.has(v));
  const isClass = (v: string | undefined) => !!v && CLASSES.has(v);

  // ---- find matching bracket in sig space
  const match = (si: number): number => {
    const open = S(si)!.v;
    const close = open === "(" ? ")" : open === "[" ? "]" : "}";
    let d = 0;
    for (let k = si; k < sig.length; k++) {
      const v = S(k)!.v;
      if (S(k)!.k !== "op") continue;
      if (v === open) d++;
      else if (v === close) {
        d--;
        if (d === 0) return k;
      }
    }
    throw new TranspileError(`Unbalanced '${open}'`, S(si)!.line);
  };
  /** first sig index at depth 0 whose value is in stops (or an unbalanced closer) */
  const exprEnd = (si: number, stops: Set<string>): number => {
    let d = 0;
    for (let k = si; k < sig.length; k++) {
      const t = S(k)!;
      if (t.k === "op") {
        if (t.v === "(" || t.v === "[" || t.v === "{") d++;
        else if (t.v === ")" || t.v === "]" || t.v === "}") {
          if (d === 0) return k;
          d--;
        } else if (d === 0 && stops.has(t.v)) return k;
      }
    }
    return sig.length;
  };
  /** end (exclusive, sig index) of a unary operand starting at si */
  const operandEnd = (si: number): number => {
    let k = si;
    while (S(k)?.k === "op" && ["-", "+", "!", "~", "*", "&"].includes(S(k)!.v)) k++;
    const t = S(k);
    if (!t) return k;
    if (t.k === "op" && t.v === "(") k = match(k) + 1;
    else k++;
    for (;;) {
      const n = S(k);
      if (!n) break;
      if (n.k === "op" && (n.v === "." || n.v === "->") && S(k + 1)?.k === "id") k += 2;
      else if (n.k === "op" && (n.v === "(" || n.v === "[")) k = match(k) + 1;
      else if (n.k === "op" && (n.v === "++" || n.v === "--")) k++;
      else break;
    }
    return k;
  };

  // ---- pre-scan user functions (name followed by params and body at depth 0)
  const userFns = new Set<string>();
  {
    let depth = 0;
    for (let si = 0; si < sig.length; si++) {
      const t = S(si)!;
      if (t.k === "op" && t.v === "{") depth++;
      else if (t.k === "op" && t.v === "}") depth--;
      else if (depth === 0 && t.k === "id" && !isType(t.v) && S(si + 1)?.v === "(" && isType(S(si - 1)?.v) ) {
        const close = match(si + 1);
        if (S(close + 1)?.v === "{") userFns.add(t.v);
      } else if (depth === 0 && t.k === "id" && t.v === "struct") {
        throw new TranspileError("`struct` is not supported by the simulator yet — use separate variables or arrays.", t.line);
      } else if (depth === 0 && t.k === "id" && t.v === "class") {
        throw new TranspileError("Defining a `class` is not supported by the simulator yet.", t.line);
      }
    }
  }

  // ---- emission
  const before = new Map<number, string>(); // sig index → text to insert before
  const after = new Map<number, string>(); // sig index → text to insert after
  const replace = new Map<number, string>();
  const skip = new Set<number>();
  const addBefore = (si: number, s: string) => before.set(si, (before.get(si) ?? "") + s);
  const addAfter = (si: number, s: string) => after.set(si, s + (after.get(si) ?? ""));

  const globalTypes = new Map<string, string[]>();
  let localTypes = new Map<string, string[]>();
  let fnDepth = -1;
  let fnReturnCast: string | null = null;
  let depth = 0;
  const typeOf = (name: string) => localTypes.get(name) ?? globalTypes.get(name);
  const declNames = new Set<number>();

  const prevSig = (si: number) => S(si - 1);
  const atStatementStart = (si: number) => {
    const p = prevSig(si);
    if (!p) return true;
    if (p.k === "op" && [";", "{", "}"].includes(p.v)) return true;
    if (p.k === "op" && p.v === "(" && S(si - 2)?.v === "for") return true;
    if (p.k === "id" && p.v === "else") return true;
    if (p.k === "op" && p.v === ":" && (S(si - 3)?.v === "case" || S(si - 2)?.v === "default" || S(si - 2)?.v === "public" || S(si - 2)?.v === "private")) return true;
    if (p.k === "op" && p.v === ")") {
      // `if (x) int y` is rare; treat `)` before a type as statement start only for control headers
      return false;
    }
    return false;
  };

  /** Wrap a control-statement body so loops yield to the browser. */
  const loopBody = (bodyStart: number) => {
    const b = S(bodyStart);
    if (!b) return;
    if (b.v === "{") addAfter(bodyStart, " await __y();");
    else if (b.v === ";") {
      replace.set(bodyStart, "{ await __y(); }");
    } else {
      addBefore(bodyStart, "{ await __y(); ");
      const end = exprEnd(bodyStart, new Set([";"]));
      addAfter(end, " }");
    }
  };

  for (let si = 0; si < sig.length; si++) {
    if (skip.has(si)) continue;
    const t = S(si)!;

    if (t.k === "op") {
      if (t.v === "{") depth++;
      if (t.v === "}") {
        depth--;
        if (depth === fnDepth) {
          fnDepth = -1;
          fnReturnCast = null;
          localTypes = new Map();
        }
      }
      if (t.v === "->") replace.set(si, ".");
      if (t.v === "::") replace.set(si, ".");
      // C-style cast: (type) operand
      if (t.v === "(" && isType(S(si + 1)?.v) && !isClass(S(si + 1)?.v)) {
        let k = si + 1;
        const types: string[] = [];
        while (isType(S(k)?.v) || S(k)?.v === "*") {
          if (S(k)!.v !== "*") types.push(S(k)!.v);
          k++;
        }
        if (S(k)?.v === ")" && types.length && S(k + 1) && !(S(k + 1)!.k === "op" && [")", ";", ",", "]", "}"].includes(S(k + 1)!.v))) {
          const fn = castFn(types, opts.intBits);
          for (let x = si; x <= k; x++) skip.add(x);
          const opEnd = operandEnd(k + 1);
          if (fn) {
            addBefore(k + 1, `${fn}(`);
            addBefore(opEnd, ")");
          }
          continue;
        }
      }
      continue;
    }

    if (t.k === "chr") {
      const code = charCode(t.v);
      replace.set(si, prevSig(si)?.v === "case" ? String(code) : `__ch(${code})`);
      continue;
    }

    if (t.k === "num") {
      continue;
    }

    if (t.k !== "id") continue;

    // member names: String helpers, never declarations / user functions
    if (prevSig(si)?.v === "." || prevSig(si)?.v === "->") {
      if (t.v === "length" && S(si + 1)?.v === "(" && S(si + 2)?.v === ")") {
        skip.add(si + 1);
        skip.add(si + 2);
      } else if (t.v === "charAt") replace.set(si, "__charAt");
      else if (["trim", "toUpperCase", "toLowerCase"].includes(t.v) && S(si + 1)?.v === "(" && S(si + 2)?.v === ")" && S(si + 3)?.v === ";" && S(si - 2)?.k === "id" && atStatementStart(si - 2)) {
        addBefore(si - 2, `${S(si - 2)!.v} = `);
      }
      continue;
    }

    // binary literal B10101
    if (/^B[01]{1,8}$/.test(t.v)) {
      replace.set(si, `0b${t.v.slice(1)}`);
      continue;
    }
    if (t.v === "NULL" || t.v === "nullptr") {
      replace.set(si, "null");
      continue;
    }
    if (t.v === "switch" && S(si + 1)?.v === "(") {
      addAfter(si + 1, "__num(");
      addBefore(match(si + 1), ")");
      continue;
    }
    if ((t.v === "while" || t.v === "for") && S(si + 1)?.v === "(") {
      const close = match(si + 1);
      // `do { } while (x);` — the while after a do-body has no body of its own
      const isDoWhile = t.v === "while" && prevSig(si)?.v === "}" && (() => {
        // walk back to the matching '{' and check for `do`
        let d = 0;
        for (let k = si - 1; k >= 0; k--) {
          const v = S(k)!.v;
          if (v === "}") d++;
          else if (v === "{") {
            d--;
            if (d === 0) return S(k - 1)?.v === "do";
          }
        }
        return false;
      })();
      if (!isDoWhile) loopBody(close + 1);
      continue;
    }
    if (t.v === "do" && S(si + 1)?.v === "{") {
      loopBody(si + 1);
      continue;
    }
    if (t.v === "sizeof" && S(si + 1)?.v === "(") {
      if (isType(S(si + 2)?.v)) {
        const close = match(si + 1);
        const tn: string[] = [];
        for (let k = si + 2; k < close; k++) tn.push(S(k)!.v);
        for (let k = si + 1; k <= close; k++) skip.add(k);
        replace.set(si, `__sizeofT(${JSON.stringify(tn.join(" "))})`);
      } else replace.set(si, "__sizeof");
      continue;
    }
    if (t.v === "return" && fnReturnCast && S(si + 1)?.v !== ";") {
      const end = exprEnd(si + 1, new Set([";"]));
      addBefore(si + 1, `${fnReturnCast}(`);
      addBefore(end, ")");
      continue;
    }

    // ---- declarations & function definitions
    if (isType(t.v) && atStatementStart(si) && !(t.v === "String" && S(si + 1)?.v === "(")) {
      let k = si;
      const types: string[] = [];
      while (S(k) && (isType(S(k)!.v) || (types.length && ["*", "&"].includes(S(k)!.v)))) {
        if (!["*", "&"].includes(S(k)!.v)) types.push(S(k)!.v);
        k++;
      }
      // const char* const  →  skip trailing const
      while (S(k)?.v === "const" || S(k)?.v === "*") k++;
      const nameTok = S(k);
      if (!nameTok || nameTok.k !== "id" || KEYWORDS.has(nameTok.v)) continue;
      const cls = types.find((x) => CLASSES.has(x));
      const after1 = S(k + 1);

      // function definition / prototype / constructor-call declaration
      if (after1?.v === "(") {
        const close = match(k + 1);
        const nextAfter = S(close + 1);
        if (nextAfter?.v === "{" && depth === 0) {
          // function definition
          for (let x = si; x < k; x++) skip.add(x);
          addBefore(k, "async function ");
          // params
          const params: string[] = [];
          let cur: Tok[] = [];
          let pd = 0;
          const flush = () => {
            const names = cur.filter((p) => p.k === "id" && !isType(p.v));
            const eq = cur.findIndex((p) => p.v === "=");
            if (names.length) {
              const nm = (eq >= 0 ? cur.slice(0, eq) : cur).filter((p) => p.k === "id" && !isType(p.v)).pop();
              if (nm) {
                const ptypes = cur.filter((p) => isType(p.v)).map((p) => p.v);
                localTypes.set(nm.v, ptypes);
                params.push(nm.v + (eq >= 0 ? " = " + cur.slice(eq + 1).map((p) => p.v).join(" ") : ""));
              }
            }
            cur = [];
          };
          for (let x = k + 2; x < close; x++) {
            const p = S(x)!;
            if (p.v === "(" || p.v === "[") pd++;
            if (p.v === ")" || p.v === "]") pd--;
            if (p.v === "," && pd === 0) flush();
            else cur.push(p);
            skip.add(x);
          }
          flush();
          addAfter(k + 1, params.join(", "));
          fnDepth = depth;
          fnReturnCast = types.includes("void") ? null : castFn(types, opts.intBits);
          si = close;
          continue;
        }
        if (nextAfter?.v === ";" && !cls && depth === 0) {
          // prototype — drop the whole statement
          for (let x = si; x <= close + 1; x++) skip.add(x);
          si = close + 1;
          continue;
        }
        if (cls) {
          // Servo s(…);  DHT dht(PIN, DHT22);
          for (let x = si; x < k; x++) skip.add(x);
          addBefore(k, "let ");
          addAfter(k, ` = new ${cls}`);
          (fnDepth >= 0 ? localTypes : globalTypes).set(nameTok.v, types);
          si = k;
          continue;
        }
        continue;
      }

      // variable declaration(s)
      for (let x = si; x < k; x++) skip.add(x);
      addBefore(k, "let ");
      const cast = castFn(types, opts.intBits);
      let d = k;
      for (;;) {
        const name = S(d);
        if (!name || name.k !== "id") break;
        (fnDepth >= 0 ? localTypes : globalTypes).set(name.v, types);
        let x = d + 1;
        const dims: string[] = [];
        let dimStart = -1;
        while (S(x)?.v === "[") {
          const c = match(x);
          if (dimStart < 0) dimStart = x;
          const inner: string[] = [];
          for (let y = x + 1; y < c; y++) inner.push(S(y)!.v);
          dims.push(inner.join("") || "0");
          x = c + 1;
        }
        if (dimStart >= 0) for (let y = dimStart; y < x; y++) skip.add(y);
        const isArray = dims.length > 0;
        if (S(x)?.v === "=") {
          const end = exprEnd(x + 1, new Set([",", ";"]));
          if (S(x + 1)?.v === "{") {
            // brace initializer → array literal
            let dd = 0;
            for (let y = x + 1; y < end; y++) {
              const v = S(y)!.v;
              if (v === "{") {
                replace.set(y, "[");
                dd++;
              } else if (v === "}") {
                replace.set(y, "]");
                dd--;
              }
            }
          } else if (!isArray && cast) {
            addBefore(x + 1, `${cast}(`);
            addBefore(end, ")");
          }
          x = end;
        } else if (isArray) {
          addAfter(x - 1, ` = __arr(${dims.join(", ")})`);
        } else if (cls) {
          addAfter(d, ` = new ${cls}()`);
        } else if (types.includes("String")) {
          addAfter(d, ' = ""');
        } else if (types.includes("bool") || types.includes("boolean")) {
          addAfter(d, " = false");
        } else {
          addAfter(d, cast === "__char" ? " = __ch(0)" : " = 0");
        }
        declNames.add(d);
        if (S(x)?.v === ",") {
          d = x + 1;
          while (S(d)?.v === "*" || S(d)?.v === "&") {
            skip.add(d);
            d++;
          }
          continue;
        }
        break;
      }
      // keep scanning the initializers so casts / awaits inside them are rewritten
      si = k;
      continue;
    }

    // functional casts: int(x), float(x), byte(x)
    if (PRIMS.has(t.v) && S(si + 1)?.v === "(" && t.v !== "String") {
      const fn = castFn([t.v], opts.intBits);
      replace.set(si, fn ?? "Number");
      continue;
    }
    if (t.v === "String" && S(si + 1)?.v === "(") {
      replace.set(si, "__String");
      continue;
    }
    // class constructor in expression: Adafruit_NeoPixel(…)
    if (isClass(t.v) && S(si + 1)?.v === "(" && prevSig(si)?.v !== "new") {
      addBefore(si, "new ");
      continue;
    }

    // assignment to an integral variable: x = expr;  x += expr;
    const ty = declNames.has(si) ? undefined : typeOf(t.v);
    if (ty && prevSig(si)?.v !== "." && S(si + 1)?.k === "op") {
      const op = S(si + 1)!.v;
      const cast = castFn(ty, opts.intBits);
      if (cast && ["=", "+=", "-=", "*=", "/=", "%=", "<<=", ">>=", "&=", "|=", "^="].includes(op)) {
        const end = exprEnd(si + 2, new Set([";", ","]));
        if (op === "=") {
          addBefore(si + 2, `${cast}(`);
          addBefore(end, ")");
        } else if (cast === "__String" && op === "+=") {
          replace.set(si + 1, "=");
          addBefore(si + 2, `__cat(${t.v}, (`);
          addBefore(end, "))");
        } else {
          replace.set(si + 1, "=");
          addBefore(si + 2, `${cast}(${t.v} ${op.slice(0, -1)} (`);
          addBefore(end, "))");
        }
        continue;
      }
    }

    // await user functions and blocking calls
    if ((userFns.has(t.v) || BLOCKING.has(t.v)) && S(si + 1)?.v === "(" && prevSig(si)?.v !== "." && prevSig(si)?.v !== "function") {
      const close = match(si + 1);
      addBefore(si, "(await ");
      addAfter(close, ")");
      continue;
    }
    if (INTEGRAL.has(t.v)) warnings.push(`line ${t.line}: unexpected type '${t.v}'`);
  }

  // ---- render
  let out = "";
  let sIdx = 0;
  for (let ti = 0; ti < toks.length; ti++) {
    const tk = toks[ti];
    if (tk.k === "ws") {
      out += tk.v;
      continue;
    }
    const si = sigPos.get(ti)!;
    sIdx = si;
    if (before.has(si)) out += before.get(si);
    if (!skip.has(si)) out += replace.has(si) ? replace.get(si) : tk.v;
    if (after.has(si)) out += after.get(si);
  }
  if (before.has(sig.length)) out += before.get(sig.length);
  void sIdx;
  return { js: out, includes, functions: [...userFns], warnings };
}
