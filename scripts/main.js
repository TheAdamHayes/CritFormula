import { MODULE_ID, MODULE_TITLE } from "./constants.js";
import { DEFAULT_FORMULA, parseFormula } from "./formula.js";
import { applyCustomCritical } from "./crit.js";
import { CritFormulaConfig } from "./config-app.js";

/** Parsed rules, refreshed whenever the GM saves the formula. */
let cachedRules = null;

export function getRules() {
  if ( !cachedRules ) {
    const { rules, errors } = parseFormula(game.settings.get(MODULE_ID, "formula"));
    if ( errors.length ) console.warn(`${MODULE_TITLE} | Formula has problems, those lines are ignored:`, errors);
    cachedRules = rules;
  }
  return cachedRules;
}

function isEnabled() {
  try {
    return game.settings.get(MODULE_ID, "enabled");
  } catch(err) {
    return false;
  }
}

/* -------------------------------------------- */
/*  Settings                                    */
/* -------------------------------------------- */

Hooks.once("init", () => {
  game.settings.register(MODULE_ID, "enabled", {
    name: "Use AH CritFormula",
    hint: "Replace the dnd5e critical damage rules with the GM's crit formula. Untick to go back to the system rules.",
    scope: "world",
    config: true,
    type: Boolean,
    default: true
  });

  game.settings.register(MODULE_ID, "formula", {
    scope: "world",
    config: false,
    type: String,
    default: DEFAULT_FORMULA,
    onChange: () => { cachedRules = null; }
  });

  game.settings.registerMenu(MODULE_ID, "editor", {
    name: "Crit formula",
    label: "Edit Crit Formula",
    hint: "Set how critical hit damage is worked out. GM only.",
    icon: "fa-solid fa-burst",
    type: CritFormulaConfig,
    restricted: true
  });
});

/* -------------------------------------------- */
/*  Patch dnd5e's critical damage               */
/* -------------------------------------------- */

Hooks.once("setup", () => {
  const DamageRoll = CONFIG.Dice.DamageRoll;
  if ( !DamageRoll?.prototype?.configureDamage ) {
    console.error(`${MODULE_TITLE} | Couldn't find dnd5e's DamageRoll. The module won't change crits.`);
    return;
  }
  const original = DamageRoll.prototype.configureDamage;

  DamageRoll.prototype.configureDamage = function(options={}) {
    if ( this.options.configured || !this.isCritical || !isEnabled() ) return original.call(this, options);
    const critical = foundry.utils.mergeObject(options.critical ?? {}, this.options.critical ?? {}, { inplace: false });
    try {
      applyCustomCritical(this, critical, getRules());
    } catch(err) {
      console.error(`${MODULE_TITLE} | Failed to apply crit formula, using the dnd5e rules instead.`, err);
      return original.call(this, options);
    }
    this.resetFormula();
    this.options.configured = true;
  };
  console.log(`${MODULE_TITLE} | Critical damage rules patched.`);
});

/* -------------------------------------------- */
/*  Tag each damage roll with where it came from */
/* -------------------------------------------- */

/** weapon, spell or feature */
function classifySource(activity) {
  const item = activity?.item;
  const classification = activity?.attack?.type?.classification;
  if ( (item?.type === "spell") || (classification === "spell") ) return "spell";
  if ( (item?.type === "weapon") || (classification === "weapon") || (classification === "unarmed") ) return "weapon";
  return "feature";
}

Hooks.on("dnd5e.preRollDamageV2", (config) => {
  const rolls = config.rolls ?? [];
  if ( !rolls.length ) return;
  const activity = config.subject;
  const actorDoc = activity?.actor ?? activity?.item?.actor ?? null;
  const actor = (!actorDoc || (actorDoc.type === "character")) ? "pc" : "npc";
  const source = classifySource(activity);
  let baseIndex = rolls.findIndex(r => r.base);
  if ( baseIndex < 0 ) baseIndex = 0;

  rolls.forEach((r, i) => {
    r.options ??= {};
    r.options[MODULE_ID] = {
      source,
      actor,
      base: i === baseIndex,
      basePart: i === baseIndex ? String(r.parts?.[0] ?? "") : ""
    };
  });
});
