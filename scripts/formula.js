/**
 * AH CritFormula - formula language.
 *
 * This file has no Foundry dependencies so it can be tested in Node.
 *
 * A formula is a list of rules, one per line (or separated by ";"). Text after "#" is a comment.
 *
 *   weapon  = max + dice
 *   spell   = dice x2
 *   npc.weapon = dice x2
 *   bonus   = 1d6
 *
 * Left of "=" says WHICH damage the rule applies to, right of "=" says WHAT to roll instead on a crit.
 */

export const DEFAULT_FORMULA = `# AH CritFormula - house rules
# Weapons: one maximised base die + the base die rolled normally
weapon  = max + dice
# Spells: regular double dice
spell   = dice x2
# Features (Sneak Attack, monster abilities, etc.): double dice
feature = dice x2
# Any dice beyond the base damage (bonus dice, extra damage parts): double dice
extra   = dice x2
# Flat numbers (ability modifier, +1 weapon...): added once, not doubled
flat    = flat
# Extra damage added once per crit (any roll formula, 0 = nothing)
bonus   = 0`;

export const SOURCES = ["weapon", "spell", "feature"];
export const ACTORS = ["pc", "npc"];

const DICE_TARGETS = new Set([
  "weapon", "spell", "feature", "extra", "weapon-extra", "spell-extra", "feature-extra"
]);
const FLAT_TARGETS = new Set(["flat", "weapon-flat", "spell-flat", "feature-flat"]);
const ALL_TARGETS = [...DICE_TARGETS, ...FLAT_TARGETS, "bonus"];

/** Built-in fallbacks when a rule is not written at all (standard 5e crit). */
const FALLBACK = {
  base: [{ kind: "dice", name: "dice", mult: 2 }],
  extra: [{ kind: "dice", name: "dice", mult: 2 }],
  flat: [{ kind: "flat", name: "flat", mult: 1 }]
};

/* -------------------------------------------- */
/*  Parsing                                     */
/* -------------------------------------------- */

/**
 * Parse one piece of a right-hand side, e.g. "dice x2", "max", "2*dice", "reroll2", "5".
 * @param {string} raw
 * @returns {{piece?: object, error?: string}}
 */
export function parsePiece(raw) {
  const text = raw.trim().toLowerCase().replace(/\s+/g, " ");
  if ( !text ) return { error: "Empty part (check for a doubled or trailing +)." };
  if ( /^\d+$/.test(text) ) return { piece: { kind: "const", name: "const", value: Number(text), mult: 1 } };
  if ( (text === "none") ) return { piece: { kind: "none", name: "none", mult: 0 } };

  const m = text.match(/^(?:(\d+)\s*(?:x|\*)\s*)?([a-z]+\d*)(?:\s*(?:x|\*)\s*(\d+))?$/);
  if ( !m ) return { error: `Didn't understand "${raw.trim()}".` };
  const [, pre, word, post] = m;
  if ( pre && post ) return { error: `"${raw.trim()}" has two multipliers.` };
  const mult = Number(pre ?? post ?? 1);

  let piece;
  let r;
  if ( word === "dice" ) piece = { kind: "dice", name: "dice" };
  else if ( word === "max" ) piece = { kind: "max", name: "max" };
  else if ( word === "avg" ) piece = { kind: "avg", name: "avg" };
  else if ( word === "explode" ) piece = { kind: "explode", name: "explode" };
  else if ( word === "reroll" ) piece = { kind: "reroll", name: "reroll", value: 1 };
  else if ( (r = word.match(/^reroll(\d+)$/)) ) piece = { kind: "reroll", name: word, value: Number(r[1]) };
  else if ( (r = word.match(/^min(\d+)$/)) ) piece = { kind: "min", name: word, value: Number(r[1]) };
  else if ( word === "flat" ) piece = { kind: "flat", name: "flat" };
  else if ( word === "min" ) return { error: `"min" needs a number, e.g. min2 (each die counts as at least 2).` };
  else return { error: `Unknown part "${word}". See the legend for the parts you can use.` };

  if ( (piece.kind === "reroll") && (piece.value < 1) ) return { error: "reroll needs a number of at least 1." };
  if ( (piece.kind === "min") && (piece.value < 1) ) return { error: "min needs a number of at least 1." };
  piece.mult = mult;
  return { piece };
}

/**
 * Parse a full formula.
 * @param {string} text
 * @returns {{rules: Object<string, object>, errors: {line: number, message: string}[]}}
 */
export function parseFormula(text) {
  const rules = {};
  const errors = [];
  const lines = String(text ?? "").split(/\r?\n/);

  lines.forEach((rawLine, lineIndex) => {
    const line = lineIndex + 1;
    const content = rawLine.replace(/#.*$/, "");
    for ( const statement of content.split(";") ) {
      if ( !statement.trim() ) continue;
      const eq = statement.indexOf("=");
      if ( eq < 0 ) {
        errors.push({ line, message: `Missing "=" in "${statement.trim()}". Write it like: weapon = dice x2` });
        continue;
      }
      const lhs = statement.slice(0, eq).trim().toLowerCase();
      const rhs = statement.slice(eq + 1).trim();

      // Target and optional pc./npc. prefix
      const lm = lhs.match(/^(?:(pc|npc)\.)?([a-z-]+)$/);
      if ( !lm || !ALL_TARGETS.includes(lm[2]) ) {
        errors.push({ line, message: `Unknown target "${lhs}". Use one of: ${ALL_TARGETS.join(", ")} `
          + "(optionally starting with pc. or npc.)." });
        continue;
      }
      const [, actor, target] = lm;
      const key = actor ? `${actor}.${target}` : target;
      if ( key in rules ) {
        errors.push({ line, message: `"${key}" is set twice (also on line ${rules[key].line}).` });
        continue;
      }
      if ( !rhs ) {
        errors.push({ line, message: `Nothing after "=" for "${key}". Use 0 or none for no damage.` });
        continue;
      }

      // Bonus is a raw Foundry roll formula
      if ( target === "bonus" ) {
        rules[key] = { key, target, actor: actor ?? null, line, bonus: rhs === "0" ? "" : rhs };
        continue;
      }

      if ( /[-\/]/.test(rhs) ) {
        errors.push({ line, message: `Only "+" can join parts (found "-" or "/") in "${rhs}".` });
        continue;
      }

      const pieces = [];
      let ok = true;
      for ( const raw of rhs.split("+") ) {
        const { piece, error } = parsePiece(raw);
        if ( error ) { errors.push({ line, message: error }); ok = false; break; }
        const isFlatRule = FLAT_TARGETS.has(target);
        if ( isFlatRule && !["flat", "const", "none"].includes(piece.kind) ) {
          errors.push({ line, message: `"${key}" is for flat numbers, so it can only use flat, a number or none `
            + `(not "${piece.name}").` });
          ok = false; break;
        }
        if ( !isFlatRule && (piece.kind === "flat") ) {
          errors.push({ line, message: `"flat" can only be used in flat rules (flat, weapon-flat...), not "${key}".` });
          ok = false; break;
        }
        if ( (piece.kind !== "none") && (piece.mult !== 0) ) pieces.push(piece);
      }
      if ( ok ) rules[key] = { key, target, actor: actor ?? null, line, pieces };
    }
  });

  return { rules, errors };
}

/* -------------------------------------------- */
/*  Rule lookup                                 */
/* -------------------------------------------- */

/**
 * Find the pieces to use for one part of a damage roll.
 * Lookup order (first found wins): npc.weapon-extra, npc.extra, weapon-extra, extra.
 * @param {object} rules             Parsed rules.
 * @param {"base"|"extra"|"flat"} kind
 * @param {string} source            weapon, spell or feature.
 * @param {string} actor             pc or npc.
 * @returns {object[]}               Pieces.
 */
export function resolveRule(rules, kind, source, actor) {
  const names = kind === "base" ? [source] : [`${source}-${kind}`, kind];
  for ( const prefix of [actor ? `${actor}.` : null, ""] ) {
    if ( prefix === null ) continue;
    for ( const n of names ) {
      const rule = rules[`${prefix}${n}`];
      if ( rule ) return rule.pieces;
    }
  }
  return FALLBACK[kind];
}

/** Get the once-per-crit bonus formula. */
export function resolveBonus(rules, actor) {
  const rule = rules[`${actor}.bonus`] ?? rules.bonus;
  return rule?.bonus ?? "";
}

/* -------------------------------------------- */
/*  Preview (text only, used by the GM editor)  */
/* -------------------------------------------- */

/** Expected value of one die with the given piece applied. */
function dieExpectation(piece, faces) {
  const plain = (faces + 1) / 2;
  if ( piece.kind === "explode" ) return faces > 1 ? plain * faces / (faces - 1) : plain;
  if ( piece.kind === "reroll" ) {
    const n = Math.min(piece.value, faces);
    let sum = 0;
    for ( let k = n + 1; k <= faces; k++ ) sum += k;
    return ((n / faces) * plain) + (sum / faces);
  }
  if ( piece.kind === "min" ) {
    let sum = 0;
    for ( let k = 1; k <= faces; k++ ) sum += Math.max(k, piece.value);
    return sum / faces;
  }
  return plain;
}

/**
 * Turn a simple dice string ("2d6") into crit text and expected values using the given pieces.
 * @returns {{text: string[], avg: number, normalAvg: number}|null}
 */
export function previewDice(pieces, diceText) {
  const m = String(diceText).trim().toLowerCase().match(/^(\d*)d(\d+)$/);
  if ( !m ) return null;
  const n = Number(m[1] || 1);
  const f = Number(m[2]);
  const text = [];
  let avg = 0;
  for ( const p of pieces ) {
    const k = p.mult;
    switch ( p.kind ) {
      case "dice": text.push(`${n * k}d${f}`); avg += n * k * dieExpectation(p, f); break;
      case "max": text.push(String(n * f * k)); avg += n * f * k; break;
      case "avg": {
        const v = Math.floor(n * (f + 1) / 2) * k;
        text.push(String(v)); avg += v; break;
      }
      case "explode": text.push(`${n * k}d${f}x`); avg += n * k * dieExpectation(p, f); break;
      case "reroll": text.push(`${n * k}d${f}${p.value === 1 ? "ro1" : `ro<=${p.value}`}`);
        avg += n * k * dieExpectation(p, f); break;
      case "min": text.push(`${n * k}d${f}min${p.value}`); avg += n * k * dieExpectation(p, f); break;
      case "const": text.push(String(p.value)); avg += p.value; break;
    }
  }
  return { text, avg, normalAvg: n * (f + 1) / 2 };
}

/** Apply flat pieces to a number. */
export function applyFlat(pieces, value) {
  let total = 0;
  for ( const p of pieces ) {
    if ( p.kind === "flat" ) total += value * p.mult;
    else if ( p.kind === "const" ) total += p.value;
  }
  return total;
}

/**
 * Build a full text preview of one example attack.
 * @param {object} rules
 * @param {{source: string, actor: string, base: string, extra: string, flat: string}} sample
 *        base/extra are dice like "1d6" or "2d6 + 1d4" (extra may be empty), flat is a number.
 * @returns {{crit: string, normal: string, critAvg: number, normalAvg: number, problems: string[]}}
 */
export function previewSample(rules, sample) {
  const out = [];
  const normal = [];
  const problems = [];
  let critAvg = 0;
  let normalAvg = 0;
  const groups = [
    ["base", sample.base],
    ["extra", sample.extra]
  ];
  for ( const [kind, str] of groups ) {
    for ( const d of String(str ?? "").split("+").map(s => s.trim()).filter(Boolean) ) {
      const pieces = resolveRule(rules, kind, sample.source, sample.actor);
      const r = previewDice(pieces, d);
      if ( !r ) { problems.push(`"${d}" isn't a simple dice like 2d6.`); continue; }
      normal.push(d);
      normalAvg += r.normalAvg;
      out.push(...r.text);
      critAvg += r.avg;
    }
  }
  const flatValue = Number(sample.flat);
  if ( String(sample.flat ?? "").trim() !== "" ) {
    if ( !Number.isFinite(flatValue) ) problems.push(`"${sample.flat}" isn't a number.`);
    else if ( flatValue !== 0 ) {
      const v = applyFlat(resolveRule(rules, "flat", sample.source, sample.actor), flatValue);
      normal.push(String(flatValue));
      normalAvg += flatValue;
      if ( v !== 0 ) out.push(String(v));
      critAvg += v;
    }
  }
  const bonus = resolveBonus(rules, sample.actor);
  if ( bonus ) {
    out.push(bonus);
    const b = previewDice([{ kind: "dice", mult: 1 }], bonus);
    if ( b ) critAvg += b.avg;
    else if ( /^\d+$/.test(bonus.trim()) ) critAvg += Number(bonus);
  }
  return {
    crit: out.join(" + ").replace(/\+ -/g, "- ") || "0",
    normal: normal.join(" + ").replace(/\+ -/g, "- ") || "0",
    critAvg, normalAvg, problems
  };
}
