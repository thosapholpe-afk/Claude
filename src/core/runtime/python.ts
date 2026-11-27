/**
 * Python / MicroPython → JavaScript transpiler (subset).
 * Indentation becomes braces, functions become async so `time.sleep()`
 * suspends, and Python operators/builtins map to small runtime helpers.
 */
import { TranspileError } from "./cxx";

const BLOCKING_CALLS = new Set([
  "sleep", "sleep_ms", "sleep_us", "pause",
  "time.sleep", "time.sleep_ms", "time.sleep_us", "utime.sleep", "utime.sleep_ms", "utime.sleep_us",
]);
const BLOCKING_METHODS = new Set(["wait_for_press", "wait_for_release", "wait_for_motion", "wait_for_no_motion", "wait_for_active", "wait_for_inactive", "wait_msg"]);

type PTok = { k: "id" | "num" | "str" | "op"; v: string };

const PYOPS = ["**=", "//=", ">>=", "<<=", "**", "//", "==", "!=", "<=", ">=", "+=", "-=", "*=", "/=", "%=", "&=", "|=", "^=", "->", ":=", "<<", ">>"];

function tokenizeExpr(src: string): PTok[] {
  const out: PTok[] = [];
  let i = 0;
  while (i < src.length) {
    const c = src[i];
    if (/\s/.test(c)) {
      i++;
      continue;
    }
    // string with optional prefix
    const sm = src.slice(i).match(/^([rRbBfFuU]{0,2})("""|'''|"|')/);
    if (sm && (sm[1] === "" || /[A-Za-z]/.test(sm[1]))) {
      const prefix = sm[1].toLowerCase();
      const q = sm[2];
      let j = i + sm[0].length;
      while (j < src.length && !src.startsWith(q, j)) {
        if (src[j] === "\\") j++;
        j++;
      }
      const body = src.slice(i + sm[0].length, j);
      out.push({ k: "str", v: convertString(prefix, body, q.length === 3) });
      i = j + q.length;
      continue;
    }
    if (/[A-Za-z_]/.test(c)) {
      let j = i + 1;
      while (j < src.length && /\w/.test(src[j])) j++;
      out.push({ k: "id", v: src.slice(i, j) });
      i = j;
      continue;
    }
    if (/\d/.test(c) || (c === "." && /\d/.test(src[i + 1] ?? ""))) {
      const m = src.slice(i).match(/^(0[xX][0-9a-fA-F_]+|0[bB][01_]+|0[oO][0-7_]+|\d[\d_]*\.?\d*(?:[eE][+-]?\d+)?|\.\d+(?:[eE][+-]?\d+)?)j?/);
      const v = (m ? m[1] : c).replace(/_/g, "").replace(/^0[oO]/, "0o");
      out.push({ k: "num", v });
      i += m ? m[0].length : 1;
      continue;
    }
    const op = PYOPS.find((o) => src.startsWith(o, i));
    if (op) {
      out.push({ k: "op", v: op });
      i += op.length;
      continue;
    }
    out.push({ k: "op", v: c });
    i++;
  }
  return out;
}

function convertString(prefix: string, body: string, triple: boolean): string {
  if (prefix.includes("f")) {
    // f-string → template literal
    let out = "`";
    let i = 0;
    while (i < body.length) {
      const ch = body[i];
      if (ch === "{" && body[i + 1] === "{") {
        out += "{";
        i += 2;
        continue;
      }
      if (ch === "}" && body[i + 1] === "}") {
        out += "}";
        i += 2;
        continue;
      }
      if (ch === "{") {
        let d = 1;
        let j = i + 1;
        while (j < body.length && d > 0) {
          if (body[j] === "{") d++;
          else if (body[j] === "}") d--;
          if (d > 0) j++;
        }
        let inner = body.slice(i + 1, j);
        let fmt = "";
        // format spec after a top-level ':' (ignore ':' inside brackets)
        let depth = 0;
        for (let k = 0; k < inner.length; k++) {
          const cc = inner[k];
          if ("([{".includes(cc)) depth++;
          else if (")]}".includes(cc)) depth--;
          else if (cc === ":" && depth === 0) {
            fmt = inner.slice(k + 1);
            inner = inner.slice(0, k);
            break;
          }
        }
        if (inner.endsWith("=")) {
          out += inner;
          inner = inner.slice(0, -1);
        }
        const js = convertExpr(tokenizeExpr(inner));
        out += fmt ? "${__fmt(" + js + ", " + JSON.stringify(fmt) + ")}" : "${__str(" + js + ")}";
        i = j + 1;
        continue;
      }
      if (ch === "`") out += "\\`";
      else if (ch === "$") out += "\\$";
      else if (ch === "\n") out += "\\n";
      else if (ch === "\\") {
        out += ch + (body[i + 1] ?? "");
        i += 2;
        continue;
      } else out += ch;
      i++;
    }
    return out + "`";
  }
  if (triple) return "`" + body.replace(/`/g, "\\`").replace(/\$\{/g, "\\${") + "`";
  if (prefix.includes("r")) return JSON.stringify(body);
  return '"' + body.replace(/(^|[^\\])"/g, '$1\\"') + '"';
}

const isOperandEnd = (t?: PTok) => !!t && (t.k === "id" || t.k === "num" || t.k === "str" || (t.k === "op" && [")", "]", "}"].includes(t.v)));

/** Index range [start, end) of the primary expression ending at index `end - 1`. */
function primaryBefore(toks: string[], end: number): number {
  let i = end - 1;
  for (;;) {
    if (i < 0) return 0;
    const v = toks[i];
    if (v === ")" || v === "]" || v === "}") {
      const open = v === ")" ? "(" : v === "]" ? "[" : "{";
      let d = 0;
      for (; i >= 0; i--) {
        if (toks[i] === v) d++;
        else if (toks[i] === open) {
          d--;
          if (d === 0) break;
        }
      }
      // call / index on something before
      if (i > 0 && /^[\w$.`"']/.test(toks[i - 1]) && !["and", "or", "not", "in", "return", "if", "else", "&&", "||"].includes(toks[i - 1])) {
        i--;
        continue;
      }
      return i;
    }
    if (toks[i - 1] === ".") {
      i -= 2;
      continue;
    }
    return i;
  }
}

function primaryAfter(toks: string[], start: number): number {
  let i = start;
  while (["-", "+", "~", "!"].includes(toks[i])) i++;
  const v = toks[i];
  if (v === "(" || v === "[" || v === "{") {
    i = closeOf(toks, i) + 1;
  } else i++;
  for (;;) {
    if (toks[i] === "." && toks[i + 1]) i += 2;
    else if (toks[i] === "(" || toks[i] === "[") i = closeOf(toks, i) + 1;
    else break;
  }
  return i;
}

function closeOf(toks: string[], i: number): number {
  const open = toks[i];
  const close = open === "(" ? ")" : open === "[" ? "]" : "}";
  let d = 0;
  for (let k = i; k < toks.length; k++) {
    if (toks[k] === open) d++;
    else if (toks[k] === close) {
      d--;
      if (d === 0) return k;
    }
  }
  return toks.length - 1;
}

export function convertExpr(input: PTok[]): string {
  let toks: string[] = [];
  // pass 1: keywords, kwargs, slices, negative indices
  const stack: { kind: "call" | "group" | "index"; kw: boolean; tuple?: boolean }[] = [];
  for (let i = 0; i < input.length; i++) {
    const t = input[i];
    const prev = input[i - 1];
    if (t.k === "id") {
      if (t.v === "True") toks.push("true");
      else if (t.v === "False") toks.push("false");
      else if (t.v === "None") toks.push("null");
      else if (t.v === "and") toks.push("&&");
      else if (t.v === "or") toks.push("||");
      else if (t.v === "is") {
        if (input[i + 1]?.v === "not") {
          toks.push("!=");
          i++;
        } else toks.push("==");
      } else if (t.v === "not" && input[i + 1]?.v === "in") {
        toks.push("@notin");
        i++;
      } else if (t.v === "in") toks.push("@in");
      else if (t.v === "not") toks.push("@not");
      else if (t.v === "lambda") toks.push("@lambda");
      else {
        // kwarg inside call: name=value
        const top = stack[stack.length - 1];
        if (top?.kind === "call" && input[i + 1]?.v === "=" && (prev?.v === "(" || prev?.v === ",")) {
          if (!top.kw) {
            toks.push("{", "__kw", ":", "1", ",");
            top.kw = true;
          }
          toks.push(t.v, ":");
          i++;
          continue;
        }
        toks.push(t.v);
      }
      continue;
    }
    if (t.k === "op") {
      if (t.v === "(") {
        const kind = isOperandEnd(prev) && prev.k !== "num" && prev.k !== "str" ? "call" : "group";
        let tuple = false;
        if (kind === "group") {
          let d = 0;
          for (let k = i; k < input.length; k++) {
            const v = input[k].v;
            if (input[k].k !== "op") continue;
            if (["(", "[", "{"].includes(v)) d++;
            else if ([")", "]", "}"].includes(v)) {
              d--;
              if (d === 0) break;
            } else if (v === "," && d === 1) tuple = true;
          }
        }
        stack.push({ kind, kw: false, tuple });
        toks.push(tuple ? "[" : "(");
        continue;
      }
      if (t.v === "[") {
        // negative literal index  x[-1]
        if (isOperandEnd(prev) && input[i + 1]?.v === "-" && input[i + 2]?.k === "num" && input[i + 3]?.v === "]") {
          toks.push(".", "at", "(", "-" + input[i + 2].v, ")");
          i += 3;
          continue;
        }
        // slice x[a:b]
        if (isOperandEnd(prev)) {
          let d = 0;
          let colon = -1;
          let end = -1;
          for (let k = i; k < input.length; k++) {
            const v = input[k].v;
            if (["(", "[", "{"].includes(v)) d++;
            else if ([")", "]", "}"].includes(v)) {
              d--;
              if (d === 0) {
                end = k;
                break;
              }
            } else if (v === ":" && d === 1 && colon < 0) colon = k;
          }
          if (colon > 0 && end > 0) {
            const a = convertExpr(input.slice(i + 1, colon));
            const b = convertExpr(input.slice(colon + 1, end));
            toks.push(".", "slice", "(", a || "0", ...(b ? [",", b] : []), ")");
            i = end;
            continue;
          }
        }
        stack.push({ kind: "index", kw: false });
        toks.push("[");
        continue;
      }
      if (t.v === ")" || t.v === "]") {
        const top = stack.pop();
        if (top?.kw) toks.push("}");
        toks.push(top?.tuple ? "]" : t.v);
        continue;
      }
      if (t.v === "{") {
        stack.push({ kind: "group", kw: false });
        toks.push("{");
        continue;
      }
      if (t.v === "}") {
        stack.pop();
        toks.push("}");
        continue;
      }
      if (t.v === "->") continue;
      toks.push(t.v);
      continue;
    }
    toks.push(t.v);
  }

  return transformTokens(toks);
}

/** Passes 2+ over pass-1 tokens; recursive for comprehensions and nested groups. */
function transformTokens(input: string[]): string {
  let toks = comprehensions(input);
  const rewriteBinary = (op: string, fn: (l: string, r: string) => string) => {
    for (let guard = 0; guard < 50; guard++) {
      const i = toks.indexOf(op);
      if (i < 0) break;
      let ls = primaryBefore(toks, i);
      // extend left across a multiplicative chain: a * b // c  ==  (a * b) // c
      while (op === "//" && ls >= 2 && ["*", "/", "%"].includes(toks[ls - 1])) ls = primaryBefore(toks, ls - 1);
      const re = primaryAfter(toks, i + 1);
      const l = toks.slice(ls, i).join(" ");
      const r = toks.slice(i + 1, re).join(" ");
      toks = [...toks.slice(0, ls), fn(l, r), ...toks.slice(re)];
    }
  };
  rewriteBinary("//", (l, r) => `__floordiv(${l}, ${r})`);
  for (let guard = 0; guard < 20; guard++) {
    // "%" formatting only when left side is a string literal
    const i = toks.findIndex((v, k) => v === "%" && /^["'`]/.test(toks[k - 1] ?? ""));
    if (i < 0) break;
    const re = primaryAfter(toks, i + 1);
    let arg = toks.slice(i + 1, re);
    if (arg[0] === "(" && closeOf(arg, 0) === arg.length - 1) arg = ["[", ...arg.slice(1, -1), "]"];
    toks = [...toks.slice(0, i - 1), `__pctfmt(${toks[i - 1]}, ${arg.join(" ")})`, ...toks.slice(re)];
  }
  rewriteBinary("@notin", (l, r) => `!__in(${l}, ${r})`);
  rewriteBinary("@in", (l, r) => `__in(${l}, ${r})`);

  for (let guard = 0; guard < 50; guard++) {
    const i = toks.indexOf("@not");
    if (i < 0) break;
    let d = 0;
    let k = i + 1;
    for (; k < toks.length; k++) {
      const v = toks[k];
      if (["(", "[", "{"].includes(v)) d++;
      else if ([")", "]", "}"].includes(v)) {
        if (d === 0) break;
        d--;
      } else if (d === 0 && ["&&", "||", ",", "if", "else", ":"].includes(v)) break;
    }
    toks = [...toks.slice(0, i), "!__t(", ...toks.slice(i + 1, k), ")", ...toks.slice(k)];
  }
  for (let guard = 0; guard < 20; guard++) {
    const i = toks.indexOf("@lambda");
    if (i < 0) break;
    const colon = toks.indexOf(":", i);
    const params = toks.slice(i + 1, colon).join(" ");
    let d = 0;
    let k = colon + 1;
    for (; k < toks.length; k++) {
      const v = toks[k];
      if (["(", "[", "{"].includes(v)) d++;
      else if ([")", "]", "}"].includes(v)) {
        if (d === 0) break;
        d--;
      } else if (d === 0 && v === ",") break;
    }
    toks = [...toks.slice(0, i), `((${params}) => (${transformTokens(toks.slice(colon + 1, k))}))`, ...toks.slice(k)];
  }
  return awaitBlocking(finishGroups(toks));
}

/** Ternaries and chained comparisons, applied inside every bracket group and comma item. */
function finishGroups(toks: string[]): string[] {
  const out: string[] = [];
  for (let i = 0; i < toks.length; i++) {
    const v = toks[i];
    if (v === "(" || v === "[" || v === "{") {
      const j = closeOf(toks, i);
      out.push(v, ...finishGroups(toks.slice(i + 1, j)), toks[j]);
      i = j;
      continue;
    }
    out.push(v);
  }
  // split by depth-0 commas
  const items: string[][] = [[]];
  let d = 0;
  for (const v of out) {
    if (["(", "[", "{"].includes(v)) d++;
    else if ([")", "]", "}"].includes(v)) d--;
    if (d === 0 && v === ",") {
      items.push([]);
      continue;
    }
    items[items.length - 1].push(v);
  }
  const res: string[] = [];
  items.forEach((item, idx) => {
    if (idx > 0) res.push(",");
    const chained = chainComparisons(item);
    const ifIdx = depth0(chained, "if");
    const elseIdx = ifIdx > 0 ? depth0(chained, "else", ifIdx) : -1;
    if (ifIdx > 0 && elseIdx > ifIdx) {
      const a = awaitBlocking(chained.slice(0, ifIdx));
      const c = awaitBlocking(chained.slice(ifIdx + 1, elseIdx));
      const b = awaitBlocking(chained.slice(elseIdx + 1));
      res.push(`(__t(${c}) ? (${a}) : (${b}))`);
    } else res.push(...chained);
  });
  return res;
}

/** [expr for x in it if cond]  →  [...__iter(it)].filter(...).map(...) */
function comprehensions(toks: string[]): string[] {
  for (let guard = 0; guard < 20; guard++) {
    let hit = -1;
    for (let i = 0; i < toks.length && hit < 0; i++) {
      if (toks[i] !== "[") continue;
      const j = closeOf(toks, i);
      let d = 0;
      for (let k = i + 1; k < j; k++) {
        const v = toks[k];
        if (["(", "[", "{"].includes(v)) d++;
        else if ([")", "]", "}"].includes(v)) d--;
        else if (d === 0 && v === "for") {
          hit = i;
          break;
        }
      }
    }
    if (hit < 0) return toks;
    const j = closeOf(toks, hit);
    const inner = toks.slice(hit + 1, j);
    const f = depth0(inner, "for");
    const inIdx = depth0(inner, "@in", f);
    const ifIdx = depth0(inner, "if", inIdx);
    const target = inner.slice(f + 1, inIdx).join(" ").replace(/^\(|\)$/g, "");
    const tgt = target.includes(",") ? `[${target}]` : target;
    const expr = transformTokens(inner.slice(0, f));
    const iter = transformTokens(inner.slice(inIdx + 1, ifIdx > 0 ? undefined : inner.length).slice(0, ifIdx > 0 ? ifIdx - inIdx - 1 : undefined));
    const cond = ifIdx > 0 ? transformTokens(inner.slice(ifIdx + 1)) : null;
    const js = `[...__iter(${iter})]${cond ? `.filter((${tgt}) => __t(${cond}))` : ""}.map((${tgt}) => (${expr}))`;
    toks = [...toks.slice(0, hit), js, ...toks.slice(j + 1)];
  }
  return toks;
}

const CMP = new Set(["<", ">", "<=", ">=", "==", "!="]);
function chainComparisons(toks: string[]): string[] {
  const out: string[] = [];
  let seg: string[] = [];
  let d = 0;
  const flush = () => {
    let dd = 0;
    const ops: number[] = [];
    seg.forEach((v, i) => {
      if (["(", "[", "{"].includes(v)) dd++;
      else if ([")", "]", "}"].includes(v)) dd--;
      else if (dd === 0 && CMP.has(v)) ops.push(i);
    });
    if (ops.length >= 2) {
      const operands: string[] = [];
      let start = 0;
      for (const o of ops) {
        operands.push(seg.slice(start, o).join(" "));
        start = o + 1;
      }
      operands.push(seg.slice(start).join(" "));
      const parts = ops.map((o, k) => `(${operands[k]} ${seg[o]} ${operands[k + 1]})`);
      out.push(`(${parts.join(" && ")})`);
    } else out.push(...seg);
    seg = [];
  };
  for (const v of toks) {
    if (["(", "[", "{"].includes(v)) d++;
    if ([")", "]", "}"].includes(v)) d--;
    if (d === 0 && ["&&", "||", ",", "if", "else", ":", "?", "@not"].includes(v)) {
      flush();
      out.push(v);
    } else seg.push(v);
  }
  flush();
  return out;
}

function depth0(toks: string[], word: string, from = 0): number {
  let d = 0;
  for (let i = from; i < toks.length; i++) {
    const v = toks[i];
    if (["(", "[", "{"].includes(v)) d++;
    else if ([")", "]", "}"].includes(v)) d--;
    else if (d === 0 && v === word) return i;
  }
  return -1;
}

let USER_FUNCS = new Set<string>();

function awaitBlocking(toks: string[]): string {
  const res = [...toks];
  const inserts: { at: number; s: string; after?: boolean }[] = [];
  for (let i = 0; i < res.length; i++) {
    if (res[i + 1] !== "(") continue;
    const name = res[i];
    const dotted = res[i - 1] === "." ? `${res[i - 2]}.${name}` : name;
    const isMethodBlocking = res[i - 1] === "." && BLOCKING_METHODS.has(name);
    const isUser = res[i - 1] !== "." && USER_FUNCS.has(name);
    if (BLOCKING_CALLS.has(dotted) || BLOCKING_CALLS.has(name) && res[i - 1] !== "." || isMethodBlocking || isUser) {
      const start = res[i - 1] === "." ? primaryBefore(res, i + 1) : i;
      const close = closeOf(res, i + 1);
      inserts.push({ at: start, s: "(await " });
      inserts.push({ at: close, s: ")", after: true });
    }
  }
  inserts.sort((a, b) => b.at - a.at || (a.after ? -1 : 1));
  for (const ins of inserts) {
    if (ins.after) res[ins.at] = res[ins.at] + ins.s;
    else res[ins.at] = ins.s + res[ins.at];
  }
  return res.join(" ").replace(/ \. /g, ".").replace(/ \( /g, "(").replace(/ \)/g, ")").replace(/\( /g, "(");
}

const expr = (s: string) => convertExpr(tokenizeExpr(s));

interface Block {
  indent: number;
  kind: string;
}

export function transpilePython(source: string): { js: string; warnings: string[] } {
  const warnings: string[] = [];
  // join physical lines into logical lines (brackets & backslashes), drop comments
  const raw = source.replace(/\r/g, "").split("\n");
  const logical: { text: string; line: number; indent: number }[] = [];
  let buf = "";
  let startLine = 0;
  let depth = 0;
  let inTriple: string | null = null;
  for (let li = 0; li < raw.length; li++) {
    let line = raw[li];
    // strip comments outside strings
    let out = "";
    let q: string | null = inTriple;
    for (let i = 0; i < line.length; i++) {
      const c = line[i];
      if (q) {
        out += c;
        if (c === "\\") {
          out += line[i + 1] ?? "";
          i++;
          continue;
        }
        if (line.startsWith(q, i)) {
          if (q.length === 3) {
            out += line.slice(i + 1, i + 3);
            i += 2;
          }
          q = null;
        }
        continue;
      }
      if (c === "#") break;
      if (line.startsWith('"""', i) || line.startsWith("'''", i)) {
        q = line.slice(i, i + 3);
        out += q;
        i += 2;
        continue;
      }
      if (c === '"' || c === "'") q = c;
      if ("([{".includes(c)) depth++;
      if (")]}".includes(c)) depth--;
      out += c;
    }
    inTriple = q && q.length === 3 ? q : null;
    line = out;
    if (!buf) startLine = li + 1;
    const cont = line.trimEnd().endsWith("\\");
    buf += (buf ? (inTriple ? "\n" : " ") : "") + (cont ? line.trimEnd().slice(0, -1) : line);
    if (depth > 0 || cont || inTriple) continue;
    if (buf.trim()) {
      const m = buf.match(/^[ \t]*/)![0];
      const indent = m.replace(/\t/g, "    ").length;
      logical.push({ text: buf.trim(), line: startLine, indent });
    }
    buf = "";
    depth = 0;
  }

  // pre-scan user function names
  USER_FUNCS = new Set(logical.map((l) => l.text.match(/^(?:async\s+)?def\s+(\w+)/)?.[1]).filter((x): x is string => !!x));

  // split single-line compound statements: "if x: y"
  const lines: { text: string; line: number; indent: number }[] = [];
  for (const l of logical) {
    const m = l.text.match(/^(if|elif|else|while|for|try|except|finally|def|with)\b/);
    if (m) {
      const colon = headerColon(l.text);
      if (colon > 0 && colon < l.text.length - 1) {
        lines.push({ text: l.text.slice(0, colon + 1), line: l.line, indent: l.indent });
        for (const part of l.text.slice(colon + 1).split(";")) if (part.trim()) lines.push({ text: part.trim(), line: l.line, indent: l.indent + 4 });
        continue;
      }
    }
    if (!m && l.text.includes(";")) {
      for (const part of splitTopLevel(l.text, ";")) if (part.trim()) lines.push({ text: part.trim(), line: l.line, indent: l.indent });
      continue;
    }
    lines.push(l);
  }

  const out: string[] = [];
  const stack: Block[] = [];
  const fnLocals: { idx: number; names: Set<string>; globals: Set<string>; params: Set<string> }[] = [];
  const moduleNames = new Set<string>();
  const currentScope = () => fnLocals[fnLocals.length - 1];
  const declare = (names: string[]) => {
    const sc = currentScope();
    for (const n of names) {
      if (!/^[A-Za-z_]\w*$/.test(n)) continue;
      if (sc) {
        if (!sc.globals.has(n) && !sc.params.has(n)) sc.names.add(n);
      } else moduleNames.add(n);
    }
  };

  const closeTo = (indent: number, cont: boolean): string => {
    let s = "";
    while (stack.length && stack[stack.length - 1].indent >= indent) {
      const b = stack[stack.length - 1];
      if (cont && b.indent === indent) {
        stack.pop();
        if (b.kind === "def") fnLocals.pop();
        return s + "}";
      }
      stack.pop();
      if (b.kind === "def") fnLocals.pop();
      s += "}\n";
    }
    return s;
  };

  let exceptCount = 0;
  for (const l of lines) {
    const t = l.text;
    const kw = t.match(/^(\w+)/)?.[1] ?? "";
    const isCont = ["elif", "else", "except", "finally"].includes(kw);
    let pre = closeTo(l.indent, isCont);
    const ind = " ".repeat(l.indent);
    try {
      if (kw === "class") throw new TranspileError("Defining a Python class is not supported by the simulator yet.", l.line);
      if (kw === "def" || t.startsWith("async def")) {
        const m = t.match(/^(?:async\s+)?def\s+(\w+)\s*\((.*)\)\s*(?:->.*)?:$/);
        if (!m) throw new TranspileError("Could not parse function definition", l.line);
        const params = splitTopLevel(m[2], ",").map((p) => p.trim()).filter(Boolean).map((p) => p.replace(/:\s*[^=]+/, "").replace(/^\*+/, "..."));
        const pnames = new Set(params.map((p) => p.split("=")[0].replace("...", "").trim()));
        out.push(pre + `${ind}async function ${m[1]}(${params.map((p) => (p.includes("=") ? `${p.split("=")[0].trim()} = ${expr(p.split("=").slice(1).join("="))}` : p)).join(", ")}) {`);
        fnLocals.push({ idx: out.length, names: new Set(), globals: new Set(), params: pnames });
        out.push("");
        stack.push({ indent: l.indent, kind: "def" });
        continue;
      }
      if (kw === "if" || kw === "elif" || kw === "while") {
        const cond = expr(t.slice(kw.length, -1).trim());
        const js = kw === "if" ? `if (__t(${cond})) {` : kw === "elif" ? ` else if (__t(${cond})) {` : `while (__t(${cond})) { await __y();`;
        out.push((isCont ? pre : pre + ind) + js);
        stack.push({ indent: l.indent, kind: kw });
        continue;
      }
      if (kw === "else") {
        out.push(pre + " else {");
        stack.push({ indent: l.indent, kind: "else" });
        continue;
      }
      if (kw === "for") {
        const m = t.match(/^for\s+(.+?)\s+in\s+(.+):$/);
        if (!m) throw new TranspileError("Could not parse for-loop", l.line);
        const targets = splitTopLevel(m[1].replace(/^\(|\)$/g, ""), ",").map((s) => s.trim());
        declare(targets);
        const target = targets.length > 1 ? `[${targets.join(", ")}]` : targets[0];
        out.push(pre + `${ind}for (${target} of __iter(${expr(m[2])})) { await __y();`);
        stack.push({ indent: l.indent, kind: "for" });
        continue;
      }
      if (kw === "try") {
        exceptCount = 0;
        out.push(pre + `${ind}try {`);
        stack.push({ indent: l.indent, kind: "try" });
        continue;
      }
      if (kw === "except") {
        const m = t.match(/\bas\s+(\w+)\s*:$/);
        exceptCount++;
        if (exceptCount > 1) out.push(pre + " if (false) {");
        else out.push(pre + ` catch (__e) { __rethrowStop(__e);${m ? ` let ${m[1]} = __e;` : ""}`);
        stack.push({ indent: l.indent, kind: "except" });
        continue;
      }
      if (kw === "finally") {
        out.push(pre + " finally {");
        stack.push({ indent: l.indent, kind: "finally" });
        continue;
      }
      if (kw === "with") {
        const m = t.match(/^with\s+(.+?)(?:\s+as\s+(\w+))?:$/);
        out.push(pre + `${ind}{ ${m?.[2] ? `let ${m[2]} = ` : ""}${expr(m?.[1] ?? "null")};`);
        stack.push({ indent: l.indent, kind: "with" });
        continue;
      }
      if (pre) out.push(pre.trimEnd());
      pre = "";
      // simple statements
      if (kw === "import") {
        for (const part of splitTopLevel(t.slice(6), ",")) {
          const m = part.trim().match(/^([\w.]+)(?:\s+as\s+(\w+))?$/);
          if (!m) continue;
          const alias = m[2] ?? m[1].split(".")[0];
          out.push(`${ind}var ${alias} = __mod(${JSON.stringify(m[2] ? m[1] : m[1].split(".")[0])});`);
        }
        continue;
      }
      if (kw === "from") {
        const m = t.match(/^from\s+([\w.]+)\s+import\s+(.+)$/);
        if (m) {
          const names = m[2].replace(/[()]/g, "").trim();
          if (names === "*") {
            out.push(`${ind}/* from ${m[1]} import * */`);
          } else {
            for (const part of splitTopLevel(names, ",")) {
              const mm = part.trim().match(/^(\w+)(?:\s+as\s+(\w+))?$/);
              if (!mm) continue;
              out.push(`${ind}var ${mm[2] ?? mm[1]} = __mod(${JSON.stringify(m[1])}).${mm[1]};`);
            }
          }
        }
        continue;
      }
      if (kw === "pass") {
        out.push(`${ind};`);
        continue;
      }
      if (kw === "global" || kw === "nonlocal") {
        const sc = currentScope();
        const names = t.slice(kw.length).split(",").map((n) => n.trim());
        for (const n of names) sc?.globals.add(n);
        out.push(`${ind}/*@global ${names.join(",")}*/`);
        continue;
      }
      if (kw === "return") {
        const rest = t.slice(6).trim();
        out.push(`${ind}return${rest ? " " + (splitTopLevel(rest, ",").length > 1 ? `[${expr(rest)}]` : expr(rest)) : ""};`);
        continue;
      }
      if (kw === "raise") {
        out.push(`${ind}throw __raise(${expr(t.slice(5).trim() || "None")});`);
        continue;
      }
      if (kw === "del") continue;
      if (kw === "assert") {
        out.push(`${ind}__assert(${expr(t.slice(6))});`);
        continue;
      }
      if (kw === "break" || kw === "continue") {
        out.push(`${ind}${kw};`);
        continue;
      }
      // assignment?
      const asg = findAssign(t);
      if (asg) {
        const { lhs, op, rhs } = asg;
        const targets = splitTopLevel(lhs, ",").map((s) => s.trim());
        if (op === "=") {
          // chained a = b = 0
          const chain = splitAssignChain(lhs + " = " + rhs);
          if (chain.length > 2) {
            const value = expr(chain[chain.length - 1]);
            const names = chain.slice(0, -1).map((s) => s.trim());
            declare(names);
            out.push(`${ind}${names.join(" = ")} = ${value};`);
            continue;
          }
          const simple = targets.filter((x) => /^[A-Za-z_]\w*$/.test(x));
          declare(simple);
          const rhsParts = splitTopLevel(rhs, ",");
          const rhsJs = rhsParts.length > 1 ? `[${rhsParts.map((p) => expr(p)).join(", ")}]` : expr(rhs);
          const lhsJs = targets.length > 1 ? `[${targets.map((x) => expr(x)).join(", ")}]` : expr(lhs);
          out.push(`${ind}${lhsJs} = ${rhsJs};`);
        } else {
          const name = expr(lhs);
          if (/^[A-Za-z_]\w*$/.test(lhs.trim())) declare([lhs.trim()]);
          if (op === "//=") out.push(`${ind}${name} = __floordiv(${name}, (${expr(rhs)}));`);
          else if (op === "**=") out.push(`${ind}${name} = ${name} ** (${expr(rhs)});`);
          else out.push(`${ind}${name} ${op} ${expr(rhs)};`);
        }
        continue;
      }
      out.push(`${ind}${expr(t)};`);
    } catch (e) {
      if (e instanceof TranspileError) throw e;
      throw new TranspileError(`Could not understand: ${t}`, l.line);
    }
  }
  out.push(closeTo(-1, false));
  // fill function locals
  // (fnLocals were popped as blocks closed; recompute by scanning markers)
  const js = out.join("\n");
  return { js: hoist(js, moduleNames), warnings };
}

/** Inject `let` declarations for function locals and `var` for module names. */
function hoist(js: string, moduleNames: Set<string>): string {
  // second pass over the generated JS: every `async function NAME(params) {` followed by an empty line
  // gets the names assigned (`x = `) directly inside it.
  const lines = js.split("\n");
  const result: string[] = [];
  const stack: { names: Set<string>; params: Set<string>; insertAt: number; globals: Set<string> }[] = [];
  let depth = 0;
  const fnDepths: number[] = [];
  for (const line of lines) {
    const fm = line.match(/^\s*async function \w+\((.*)\) \{$/);
    result.push(line);
    if (fm) {
      const params = new Set(fm[1].split(",").map((p) => p.split("=")[0].replace("...", "").trim()).filter(Boolean));
      stack.push({ names: new Set(), params, insertAt: result.length, globals: new Set() });
      fnDepths.push(depth);
    }
    for (const ch of line.replace(/(["'`])(?:\\.|(?!\1).)*\1/g, "")) {
      if (ch === "{") depth++;
      else if (ch === "}") {
        depth--;
        if (fnDepths.length && depth === fnDepths[fnDepths.length - 1]) {
          const sc = stack.pop()!;
          fnDepths.pop();
          const names = [...sc.names].filter((n) => !sc.params.has(n) && !sc.globals.has(n));
          if (names.length) result.splice(sc.insertAt, 0, `  let ${names.join(", ")};`);
        }
      }
    }
    const sc = stack[stack.length - 1];
    const gm = line.match(/\/\*@global (.*)\*\//);
    if (gm && sc) for (const n of gm[1].split(",")) sc.globals.add(n.trim());
    if (sc) {
      const am = line.match(/^\s*([A-Za-z_]\w*)\s*(?:=(?!=)|\+=|-=|\*=|\/=|%=|\|=|&=|\^=)/);
      if (am) sc.names.add(am[1]);
      const dm = line.match(/^\s*\[([\w\s,]+)\]\s*=(?!=)/);
      if (dm) for (const n of dm[1].split(",")) sc.names.add(n.trim());
      const fm2 = line.match(/^\s*for \(\[?([\w\s,]+)\]? of /);
      if (fm2) for (const n of fm2[1].split(",")) sc.names.add(n.trim());
    }
  }
  const header = moduleNames.size ? `var ${[...moduleNames].join(", ")};\n` : "";
  return header + result.join("\n");
}

function headerColon(text: string): number {
  let d = 0;
  let q: string | null = null;
  let lambdaDepth = 0;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (q) {
      if (c === "\\") i++;
      else if (c === q) q = null;
      continue;
    }
    if (c === '"' || c === "'") q = c;
    else if ("([{".includes(c)) d++;
    else if (")]}".includes(c)) d--;
    else if (d === 0 && text.startsWith("lambda", i)) lambdaDepth++;
    else if (c === ":" && d === 0) {
      if (lambdaDepth > 0) {
        lambdaDepth--;
        continue;
      }
      return i;
    }
  }
  return -1;
}

function splitTopLevel(s: string, sep: string): string[] {
  const parts: string[] = [];
  let d = 0;
  let q: string | null = null;
  let cur = "";
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (q) {
      cur += c;
      if (c === "\\") {
        cur += s[i + 1] ?? "";
        i++;
      } else if (c === q) q = null;
      continue;
    }
    if (c === '"' || c === "'") q = c;
    if ("([{".includes(c)) d++;
    if (")]}".includes(c)) d--;
    if (c === sep && d === 0) {
      parts.push(cur);
      cur = "";
      continue;
    }
    cur += c;
  }
  parts.push(cur);
  return parts;
}

function findAssign(t: string): { lhs: string; op: string; rhs: string } | null {
  let d = 0;
  let q: string | null = null;
  for (let i = 0; i < t.length; i++) {
    const c = t[i];
    if (q) {
      if (c === "\\") i++;
      else if (c === q) q = null;
      continue;
    }
    if (c === '"' || c === "'") q = c;
    else if ("([{".includes(c)) d++;
    else if (")]}".includes(c)) d--;
    else if (d === 0) {
      for (const op of ["//=", "**=", ">>=", "<<=", "+=", "-=", "*=", "/=", "%=", "&=", "|=", "^="]) {
        if (t.startsWith(op, i)) return { lhs: t.slice(0, i).trim(), op, rhs: t.slice(i + op.length).trim() };
      }
      if (c === "=" && t[i + 1] !== "=" && !"=!<>:".includes(t[i - 1] ?? "")) {
        return { lhs: t.slice(0, i).trim(), op: "=", rhs: t.slice(i + 1).trim() };
      }
    }
  }
  return null;
}

function splitAssignChain(t: string): string[] {
  const parts: string[] = [];
  let rest = t;
  for (let guard = 0; guard < 8; guard++) {
    const a = findAssign(rest);
    if (!a || a.op !== "=") break;
    parts.push(a.lhs);
    rest = a.rhs;
  }
  parts.push(rest);
  return parts;
}
