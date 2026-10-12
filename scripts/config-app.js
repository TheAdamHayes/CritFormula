import { MODULE_ID, MODULE_TITLE } from "./constants.js";
import { DEFAULT_FORMULA, parseFormula, previewSample } from "./formula.js";

const { ApplicationV2 } = foundry.applications.api;

/** Who a rule applies to (left of "="). */
const TARGET_LEGEND = [
  ["weapon", "The weapon's own damage dice on a weapon attack (incl. unarmed strikes and monster claws/bites). E.g. the 1d8 of a longsword."],
  ["spell", "A spell's own damage dice. E.g. the 2d10 of Fire Bolt."],
  ["feature", "The damage dice of anything else: class features like Sneak Attack (rolled on its own), monster abilities, potions, [[/damage]] links."],
  ["extra", "Every die beyond the base damage: bonus dice added to the attack, extra damage parts (Flame Tongue's fire), dice from effects like Hunter's Mark."],
  ["weapon-extra", "Like extra, but only on weapon attacks. Also spell-extra and feature-extra."],
  ["flat", "Fixed numbers in the damage: ability modifier, +1 weapon bonus, etc."],
  ["weapon-flat", "Like flat, but only on weapon attacks. Also spell-flat and feature-flat."],
  ["bonus", "Extra damage added once to every crit. Any roll formula: 1d6, @prof, @abilities.str.mod. 0 = nothing."],
  ["pc.", "Put in front to make a rule only for player characters, e.g. pc.weapon = max + dice"],
  ["npc.", "Put in front to make a rule only for monsters / NPCs, e.g. npc.weapon = dice x2"]
];

/** What to roll (right of "="). Example uses a 1d6 die. */
const PIECE_LEGEND = [
  ["dice", "Roll the dice normally.", "1d6 → 1d6"],
  ["dice x2", "Roll the dice that many times over (any whole number, x3, x4...). 2*dice works too.", "1d6 → 2d6"],
  ["max", "The highest the dice can roll, as a fixed number.", "1d6 → 6"],
  ["avg", "The average of the dice, rounded down.", "2d6 → 7"],
  ["explode", "Roll the dice; any die that rolls max is rolled again and added.", "1d6 → 1d6x"],
  ["reroll", "Roll the dice, rerolling 1s once. reroll2 rerolls 1s and 2s.", "1d6 → 1d6ro1"],
  ["min2", "Roll the dice, each die counts as at least 2 (any number). Like Great Weapon Fighting with min3.", "1d6 → 1d6min2"],
  ["flat", "Flat rules only: the fixed number as it is. flat x2 doubles it.", "+3 → +3"],
  ["5", "Add a fixed number (added once for each dice group the rule hits).", "1d6 → +5"],
  ["none", "No damage from this part on a crit (0 works too).", "1d6 → 0"],
  ["+", "Join parts together.", "max + dice → 6 + 1d6"]
];

/** Ready-made lines GMs often want. Clicking one adds it to the formula. */
const EXAMPLES = [
  ["Rules as written (2024)", "weapon = dice x2\nspell = dice x2\nfeature = dice x2\nextra = dice x2\nflat = flat"],
  ["Max + roll on everything", "weapon = max + dice\nspell = max + dice\nfeature = max + dice\nextra = max + dice"],
  ["Monsters use normal crits", "npc.weapon = dice x2"],
  ["Triple dice for weapons", "weapon = dice x3"],
  ["Double the modifier too", "flat = flat x2"],
  ["Proficiency bonus on every crit", "bonus = @prof"],
  ["Exploding crits", "weapon = max + explode"],
  ["Brutal: extra die of d8", "bonus = 1d8"]
];

/** Example attacks for the preview. */
const SAMPLES = {
  rogue: { label: "Rogue: shortsword (+3) with 2d6 Sneak Attack", source: "weapon", actor: "pc", base: "1d6", extra: "2d6", flat: "3" },
  fighter: { label: "Fighter: greatsword (+4)", source: "weapon", actor: "pc", base: "2d6", extra: "", flat: "4" },
  ranger: { label: "Ranger: longbow (+3) with Hunter's Mark", source: "weapon", actor: "pc", base: "1d8", extra: "1d6", flat: "3" },
  firebolt: { label: "Spell: Fire Bolt (level 5)", source: "spell", actor: "pc", base: "2d10", extra: "", flat: "" },
  inflict: { label: "Spell: Inflict Wounds", source: "spell", actor: "pc", base: "2d10", extra: "", flat: "" },
  sneak: { label: "Feature: Sneak Attack rolled on its own (3d6)", source: "feature", actor: "pc", base: "3d6", extra: "", flat: "" },
  ogre: { label: "Monster: Ogre greatclub (+4)", source: "weapon", actor: "npc", base: "2d8", extra: "", flat: "4" },
  custom: { label: "Custom…", source: "weapon", actor: "pc", base: "1d8", extra: "", flat: "3" }
};

const esc = s => String(s ?? "")
  .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

/**
 * GM editor for the crit formula.
 */
export class CritFormulaConfig extends ApplicationV2 {
  static DEFAULT_OPTIONS = {
    id: `${MODULE_ID}-config`,
    tag: "div",
    classes: [MODULE_ID],
    window: { title: MODULE_TITLE, icon: "fa-solid fa-burst", resizable: true },
    position: { width: 860, height: 760 },
    actions: {
      save: CritFormulaConfig.#onSave,
      reset: CritFormulaConfig.#onReset,
      insert: CritFormulaConfig.#onInsert,
      example: CritFormulaConfig.#onExample,
      cancel: CritFormulaConfig.#onCancel
    }
  };

  /** Current text in the editor (kept across re-renders). */
  #text = null;

  #sampleKey = "rogue";

  #sample = { ...SAMPLES.rogue };

  /* -------------------------------------------- */

  /** @override */
  async _renderHTML(context, options) {
    if ( this.#text === null ) this.#text = game.settings.get(MODULE_ID, "formula");
    const isGM = game.user.isGM;

    const targetRows = TARGET_LEGEND.map(([t, d]) => `
      <tr><td><a class="ahcf-chip" data-action="insert" data-text="${esc(t.endsWith(".") ? t : `${t} = `)}"
        title="Click to add">${esc(t)}</a></td><td>${esc(d)}</td></tr>`).join("");
    const pieceRows = PIECE_LEGEND.map(([p, d, ex]) => `
      <tr><td><a class="ahcf-chip" data-action="insert" data-text="${esc(p === "+" ? " + " : p)}"
        title="Click to add">${esc(p)}</a></td><td>${esc(d)}</td><td class="ahcf-ex">${esc(ex)}</td></tr>`).join("");
    const exampleChips = EXAMPLES.map(([label, text], i) => `
      <a class="ahcf-example" data-action="example" data-index="${i}" title="${esc(text)}">
        <i class="fa-solid fa-plus"></i> ${esc(label)}</a>`).join("");
    const sampleOptions = Object.entries(SAMPLES).map(([k, s]) =>
      `<option value="${k}" ${k === this.#sampleKey ? "selected" : ""}>${esc(s.label)}</option>`).join("");
    const s = this.#sample;
    const sel = (v, cur) => (v === cur ? "selected" : "");

    return `
    <div class="ahcf-body">
      ${isGM ? "" : `<p class="ahcf-warning">Only the GM can change the crit formula.</p>`}
      <p class="ahcf-intro">Each line is a rule: <b>what it applies to</b> <code>=</code> <b>what to roll on a crit</b>.
        Anything not written uses normal double dice. Lines starting with <code>#</code> are notes.</p>

      <div class="ahcf-columns">
        <section class="ahcf-editor">
          <label class="ahcf-label" for="${MODULE_ID}-formula">Crit formula</label>
          <textarea id="${MODULE_ID}-formula" name="formula" spellcheck="false" ${isGM ? "" : "readonly"}>${esc(this.#text)}</textarea>
          <div class="ahcf-status"></div>

          <div class="ahcf-preview">
            <label class="ahcf-label">Try it out</label>
            <select name="sample">${sampleOptions}</select>
            <div class="ahcf-sample-fields">
              <label>Type <select name="source">
                <option value="weapon" ${sel("weapon", s.source)}>Weapon</option>
                <option value="spell" ${sel("spell", s.source)}>Spell</option>
                <option value="feature" ${sel("feature", s.source)}>Feature</option>
              </select></label>
              <label>Attacker <select name="actor">
                <option value="pc" ${sel("pc", s.actor)}>Player</option>
                <option value="npc" ${sel("npc", s.actor)}>NPC</option>
              </select></label>
              <label>Base dice <input type="text" name="base" value="${esc(s.base)}"></label>
              <label>Extra dice <input type="text" name="extra" value="${esc(s.extra)}" placeholder="e.g. 2d6"></label>
              <label>Flat <input type="text" name="flat" value="${esc(s.flat)}" placeholder="e.g. 3"></label>
            </div>
            <div class="ahcf-result"></div>
          </div>

          <label class="ahcf-label">Quick add</label>
          <div class="ahcf-examples">${exampleChips}</div>
        </section>

        <section class="ahcf-legend">
          <label class="ahcf-label">Left of = (what it applies to)</label>
          <table><tbody>${targetRows}</tbody></table>
          <label class="ahcf-label">Right of = (what to roll)</label>
          <table><tbody>${pieceRows}</tbody></table>
          <p class="ahcf-note">If more than one rule fits, the most specific wins:
            <code>npc.weapon-extra</code> → <code>npc.extra</code> → <code>weapon-extra</code> → <code>extra</code>.
            Click any part in the legend to add it where your cursor is.</p>
        </section>
      </div>

      <footer class="ahcf-buttons">
        <button type="button" data-action="reset" ${isGM ? "" : "disabled"}><i class="fa-solid fa-rotate-left"></i> Reset to default</button>
        <button type="button" data-action="cancel"><i class="fa-solid fa-xmark"></i> Cancel</button>
        <button type="button" class="ahcf-save" data-action="save" ${isGM ? "" : "disabled"}><i class="fa-solid fa-floppy-disk"></i> Save</button>
      </footer>
    </div>`;
  }

  /** @override */
  _replaceHTML(result, content, options) {
    content.innerHTML = result;
  }

  /** @override */
  _onRender(context, options) {
    const root = this.element;
    const textarea = root.querySelector("textarea[name=formula]");
    textarea.addEventListener("input", () => {
      this.#text = textarea.value;
      this.#refresh();
    });

    root.querySelector("select[name=sample]").addEventListener("change", ev => {
      this.#sampleKey = ev.target.value;
      this.#sample = { ...SAMPLES[this.#sampleKey] };
      for ( const k of ["source", "actor", "base", "extra", "flat"] ) {
        root.querySelector(`[name=${k}]`).value = this.#sample[k];
      }
      this.#refresh();
    });
    for ( const k of ["source", "actor", "base", "extra", "flat"] ) {
      root.querySelector(`[name=${k}]`).addEventListener("input", ev => {
        this.#sample[k] = ev.target.value;
        this.#refresh();
      });
    }
    this.#refresh();
  }

  /* -------------------------------------------- */

  /** Check the formula and update the preview. */
  #refresh() {
    const root = this.element;
    const { rules, errors } = parseFormula(this.#text);

    // Check the bonus formulas with Foundry's own roll parser
    for ( const rule of Object.values(rules) ) {
      if ( (rule.target !== "bonus") || !rule.bonus ) continue;
      const testFormula = rule.bonus.replace(/@[\w.-]+/g, "1");
      let valid = false;
      try { valid = Roll.validate(testFormula); } catch(err) { valid = false; }
      if ( !valid ) errors.push({ line: rule.line, message: `"${rule.bonus}" isn't a roll formula Foundry understands.` });
    }

    const status = root.querySelector(".ahcf-status");
    if ( errors.length ) {
      status.className = "ahcf-status ahcf-bad";
      status.innerHTML = errors.map(e => `<div><i class="fa-solid fa-triangle-exclamation"></i>
        Line ${e.line}: ${esc(e.message)}</div>`).join("");
    } else {
      status.className = "ahcf-status ahcf-good";
      status.innerHTML = `<i class="fa-solid fa-check"></i> Formula looks good.`;
    }
    root.querySelector(".ahcf-save").disabled = !!errors.length || !game.user.isGM;

    const result = root.querySelector(".ahcf-result");
    const p = previewSample(rules, this.#sample);
    const fmt = n => (Math.round(n * 10) / 10).toString();
    result.innerHTML = `
      <div><span>Normal hit</span><code>${esc(p.normal)}</code><em>avg ${fmt(p.normalAvg)}</em></div>
      <div class="ahcf-crit"><span>Critical hit</span><code>${esc(p.crit)}</code><em>avg ${fmt(p.critAvg)}</em></div>
      ${p.problems.map(x => `<div class="ahcf-bad">${esc(x)}</div>`).join("")}`;
  }

  /** Insert text at the cursor. */
  #insertText(text) {
    const textarea = this.element.querySelector("textarea[name=formula]");
    if ( textarea.readOnly ) return;
    const start = textarea.selectionStart ?? textarea.value.length;
    const end = textarea.selectionEnd ?? start;
    textarea.setRangeText(text, start, end, "end");
    textarea.focus();
    this.#text = textarea.value;
    this.#refresh();
  }

  /* -------------------------------------------- */
  /*  Actions                                     */
  /* -------------------------------------------- */

  static #onInsert(event, target) {
    this.#insertText(target.dataset.text);
  }

  static #onExample(event, target) {
    const [, text] = EXAMPLES[Number(target.dataset.index)];
    const textarea = this.element.querySelector("textarea[name=formula]");
    if ( textarea.readOnly ) return;
    const { rules } = parseFormula(textarea.value);

    // Replace lines that set the same thing, add the rest at the end.
    let lines = textarea.value.split(/\r?\n/);
    for ( const newLine of text.split("\n") ) {
      const key = newLine.split("=")[0].trim().toLowerCase();
      if ( rules[key] ) lines[rules[key].line - 1] = newLine;
      else lines.push(newLine);
    }
    textarea.value = lines.join("\n");
    this.#text = textarea.value;
    this.#refresh();
  }

  static async #onReset() {
    const ok = await foundry.applications.api.DialogV2.confirm({
      window: { title: MODULE_TITLE },
      content: "<p>Put the crit formula back to the default? (It isn't saved until you click Save.)</p>"
    });
    if ( !ok ) return;
    const textarea = this.element.querySelector("textarea[name=formula]");
    textarea.value = DEFAULT_FORMULA;
    this.#text = DEFAULT_FORMULA;
    this.#refresh();
  }

  static async #onSave() {
    if ( !game.user.isGM ) return ui.notifications.warn("Only the GM can change the crit formula.");
    const { errors } = parseFormula(this.#text);
    if ( errors.length ) return ui.notifications.error("Fix the formula problems before saving.");
    await game.settings.set(MODULE_ID, "formula", this.#text);
    ui.notifications.info(`${MODULE_TITLE}: crit formula saved.`);
    this.close();
  }

  static #onCancel() {
    this.close();
  }
}
