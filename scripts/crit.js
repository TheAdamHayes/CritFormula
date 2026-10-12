/**
 * AH CritFormula - applies the GM's formula to a dnd5e DamageRoll's terms on a critical hit.
 */
import { MODULE_ID } from "./constants.js";
import { resolveRule, resolveBonus } from "./formula.js";

const BINDING = new Set(["*", "/", "%"]);

/** Terms that hold dice (plain dice, pools, parentheticals, functions...). */
function isDiceLike(term) {
  const { OperatorTerm, NumericTerm, StringTerm } = foundry.dice.terms;
  return !(term instanceof OperatorTerm) && !(term instanceof NumericTerm) && !(term instanceof StringTerm);
}

/** Count the top-level dice terms in a formula. */
export function countDiceTerms(formula, data) {
  if ( !formula ) return 0;
  try {
    return new Roll(String(formula), data).terms.filter(isDiceLike).length;
  } catch(err) {
    return 0;
  }
}

/** Copy a term. */
function cloneTerm(term) {
  const { RollTerm } = foundry.dice.terms;
  return RollTerm.fromData(foundry.utils.deepClone(term.toJSON()));
}

/** Is this a simple die like 2d6 (no keep/drop/reroll modifiers already)? */
function isPlainDie(term) {
  const { Die } = foundry.dice.terms;
  return (term instanceof Die) && !term.modifiers.length && Number.isInteger(term.number);
}

/** Max or min total of a term, or null if it can't be worked out. */
function extremeOf(term, mode) {
  try {
    return Roll.create(term.formula).evaluateSync({ [mode]: true }).total;
  } catch(err) {
    return null;
  }
}

/**
 * Build the replacement terms for one dice term.
 * @param {RollTerm} term
 * @param {object[]} pieces
 * @param {number} bonusDice   Extra dice from dnd5e (e.g. meleeCriticalDamageDice flag), only on the first term.
 * @returns {RollTerm[]}
 */
function buildDicePieces(term, pieces, bonusDice=0) {
  const { NumericTerm } = foundry.dice.terms;
  const flavor = term.flavor || undefined;
  const out = [];
  const numeric = n => new NumericTerm({ number: n, options: { flavor, critical: true } });

  const diceCopies = (mult, modifier) => {
    if ( mult <= 0 ) return;
    if ( isPlainDie(term) ) {
      const c = cloneTerm(term);
      c.number = term.number * mult;
      if ( modifier ) c.modifiers = [modifier];
      c.options.critical = true;
      out.push(c);
    } else {
      for ( let i = 0; i < mult; i++ ) {
        const c = cloneTerm(term);
        c.options.critical = true;
        out.push(c);
      }
    }
  };

  for ( const p of pieces ) {
    switch ( p.kind ) {
      case "dice": diceCopies(p.mult); break;
      case "explode": diceCopies(p.mult, isPlainDie(term) ? "x" : null); break;
      case "reroll": diceCopies(p.mult, isPlainDie(term) ? (p.value === 1 ? "ro1" : `ro<=${p.value}`) : null); break;
      case "min": diceCopies(p.mult, isPlainDie(term) ? `min${p.value}` : null); break;
      case "max": {
        const v = extremeOf(term, "maximize");
        if ( v === null ) diceCopies(p.mult);
        else out.push(numeric(v * p.mult));
        break;
      }
      case "avg": {
        const hi = extremeOf(term, "maximize");
        const lo = extremeOf(term, "minimize");
        if ( (hi === null) || (lo === null) ) diceCopies(p.mult);
        else out.push(numeric(Math.floor((hi + lo) / 2) * p.mult));
        break;
      }
      case "const": out.push(numeric(p.value)); break;
    }
  }

  // dnd5e's own "extra crit dice" (e.g. Savage Attacks style flags) are kept on top.
  if ( bonusDice && isPlainDie(term) ) {
    const c = cloneTerm(term);
    c.number = Number(bonusDice);
    c.options.critical = true;
    if ( c.number > 0 ) out.push(c);
  }

  if ( !out.length ) out.push(numeric(0));
  return out;
}

/**
 * Put a term's replacement pieces in its place, keeping its sign, or wrapping in brackets when it's
 * next to a *, / or %.
 */
function placePieces(roll, index, pieces, original) {
  const { OperatorTerm, ParentheticalTerm } = foundry.dice.terms;
  const bound = t => (t instanceof OperatorTerm) && BINDING.has(t.operator);
  const prev = roll.terms[index - 1];
  const next = roll.terms[index + 1];

  if ( bound(prev) || bound(next) ) {
    if ( pieces.length === 1 ) return pieces;
    const options = foundry.utils.deepClone(original.options);
    const group = [];
    pieces.forEach((p, i) => {
      if ( i ) group.push(new OperatorTerm({ operator: "+" }));
      p.options.flavor = "";
      group.push(p);
    });
    return [ParentheticalTerm.fromTerms(group, options)];
  }

  const sign = (prev instanceof OperatorTerm) ? prev.operator : "+";
  const placed = [];
  pieces.forEach((p, i) => {
    if ( i ) placed.push(new OperatorTerm({ operator: sign }));
    placed.push(p);
  });
  return placed;
}

/**
 * Replace the roll's terms with crit terms following the GM's rules.
 * Does not mutate the original terms, so if anything throws the roll is left as it was.
 * @param {DamageRoll} roll
 * @param {object} critical   dnd5e's critical config (bonusDice, bonusDamage are kept).
 * @param {object} rules      Parsed rules.
 */
export function applyCustomCritical(roll, critical, rules) {
  const { OperatorTerm, NumericTerm, DiceTerm } = foundry.dice.terms;
  const tag = roll.options?.[MODULE_ID] ?? null;
  const source = tag?.source ?? "feature";
  const actor = tag?.actor ?? "pc";

  // How many dice terms at the start of this roll are the "base" damage?
  let baseCount;
  if ( !tag ) baseCount = Infinity;                       // Not from an activity: treat all dice as base
  else if ( tag.base ) baseCount = countDiceTerms(tag.basePart, roll.data);
  else baseCount = 0;                                     // Other damage parts of the activity are "extra"

  const newTerms = [];
  let diceIndex = 0;
  for ( const [i, term] of roll.terms.entries() ) {
    if ( term instanceof OperatorTerm ) { newTerms.push(term); continue; }

    // Flat numbers
    if ( term instanceof NumericTerm ) {
      const prev = roll.terms[i - 1];
      const next = roll.terms[i + 1];
      const bound = t => (t instanceof OperatorTerm) && BINDING.has(t.operator);
      if ( bound(prev) || bound(next) ) { newTerms.push(term); continue; }
      const pieces = resolveRule(rules, "flat", source, actor);
      let total = 0;
      for ( const p of pieces ) {
        if ( p.kind === "flat" ) total += term.number * p.mult;
        else if ( p.kind === "const" ) total += p.value;
      }
      const c = new NumericTerm({ number: total, options: foundry.utils.deepClone(term.options) });
      newTerms.push(c);
      continue;
    }

    if ( !isDiceLike(term) ) { newTerms.push(term); continue; }

    // Same as dnd5e: a dice count that's a fixed formula (e.g. "(1+1)d6") is flattened to a number.
    if ( (term instanceof DiceTerm) && (term._number instanceof Roll) && term._number.isDeterministic ) {
      term.number = term._number.evaluateSync().total;
    }

    const kind = diceIndex < baseCount ? "base" : "extra";
    const pieces = resolveRule(rules, kind, source, actor);
    const bonusDice = (diceIndex === 0 && critical?.bonusDice) ? critical.bonusDice : 0;
    diceIndex++;
    newTerms.push(...placePieces(roll, i, buildDicePieces(term, pieces, bonusDice), term));
  }

  // Once-per-crit additions: the GM's "bonus" rule and dnd5e's own activity crit bonus.
  const additions = [];
  if ( !tag || tag.base ) {
    const bonus = resolveBonus(rules, actor);
    if ( bonus ) additions.push(bonus);
  }
  if ( critical?.bonusDamage ) additions.push(critical.bonusDamage);
  for ( const formula of additions ) {
    const terms = new Roll(formula, roll.data).terms;
    for ( const t of terms ) t.options.critical = true;
    if ( !(terms[0] instanceof OperatorTerm) ) newTerms.push(new OperatorTerm({ operator: "+" }));
    newTerms.push(...terms);
  }

  roll.terms = newTerms;
}
