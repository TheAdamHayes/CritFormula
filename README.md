# AH CritFormula

A Foundry VTT (v14) module for the **dnd5e** system that replaces the critical hit damage rules with a formula
the GM writes.

## Default house rule

- **Weapons:** one maximised base die + the base die rolled normally.
- **Spells:** regular double dice.
- **Any dice beyond the base damage** (Sneak Attack, Hunter's Mark, extra damage parts...): double dice.
- **Flat numbers** (ability modifier, +1 weapon): added once.

Example, a rogue with a shortsword (+3) and 2d6 Sneak Attack:
`1d6 + 3 + 2d6` becomes `6 + 1d6 + 3 + 4d6` on a crit.

## Changing the formula (GM only)

Game Settings > Configure Settings > AH CritFormula > **Edit Crit Formula**.

The editor has the formula box, a live check that tells you which line is wrong, a "Try it out" preview with
example attacks (normal vs crit formula and average damage), quick-add buttons, and a legend of every part.
Click any part in the legend to add it at your cursor.

Each line is `what it applies to = what to roll`:

```
weapon  = max + dice
spell   = dice x2
feature = dice x2
extra   = dice x2
flat    = flat
bonus   = 0
```

### Left of `=`

| Target | Applies to |
|---|---|
| `weapon` | The weapon's own damage dice (incl. unarmed strikes and monster natural weapons) |
| `spell` | A spell's own damage dice |
| `feature` | Damage dice of anything else (class features rolled on their own, monster abilities, `[[/damage]]` links) |
| `extra` | Every die beyond the base damage |
| `weapon-extra`, `spell-extra`, `feature-extra` | Extra dice for that kind only |
| `flat` | Fixed numbers |
| `weapon-flat`, `spell-flat`, `feature-flat` | Fixed numbers for that kind only |
| `bonus` | Roll formula added once per crit (`1d6`, `@prof`, `0` for nothing) |
| `pc.` / `npc.` prefix | Rule only for player characters / NPCs, e.g. `npc.weapon = dice x2` |

Most specific wins: `npc.weapon-extra` → `npc.extra` → `weapon-extra` → `extra`.
Anything you don't write uses normal double dice (and flat numbers added once).

### Right of `=`

| Part | Meaning | 1d6 becomes |
|---|---|---|
| `dice` | Roll normally | `1d6` |
| `dice x2` (or `2*dice`, any number) | Roll that many times the dice | `2d6` |
| `max` | Maximum as a fixed number | `6` |
| `avg` | Average, rounded down | `3` |
| `explode` | Exploding dice | `1d6x` |
| `reroll` / `reroll2` | Reroll 1s (or 1-2s) once | `1d6ro1` |
| `min2` (any number) | Each die counts as at least 2 | `1d6min2` |
| `flat` / `flat x2` | Flat rules only: the number as is / doubled | |
| `5` | Add a fixed number | `5` |
| `none` or `0` | Nothing | `0` |

Join parts with `+`. Lines starting with `#` are notes.

## Notes

- dnd5e's own crit settings ("Max dice", "Multiply modifiers") are ignored while this module is on.
  Untick **Use AH CritFormula** in the module settings to go back to them.
- Extra crit dice from dnd5e (e.g. the melee critical dice flag) and an attack's own "critical bonus damage" are
  still added on top.
- In the SRD 2024 rogue, Sneak Attack is rolled on its own (a `feature`), so it's doubled by the `feature` rule.
  If it's added to the weapon roll instead (as a damage bonus), the `extra` rule doubles it. Same result by default.

## Install

Manifest URL:
`https://github.com/TheAdamHayes/CritFormula/releases/latest/download/module.json`
