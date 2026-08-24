/**
 * score.js — από αποτελέσματα κανόνων σε βαθμό.
 *
 * Δύο αποφάσεις που καθορίζουν αν ο βαθμός σημαίνει κάτι:
 *
 * 1. Οι κανόνες `na` βγαίνουν από τον παρονομαστή. Ένα site δεν χάνει βαθμούς
 *    επειδή δεν έχει εικόνες ή επειδή έληξε ο δικός μας χρόνος. Αν τιμωρούσαμε
 *    τα δικά μας κενά ως αποτυχίες του site, ο βαθμός θα ήταν θόρυβος.
 *
 * 2. Αν μια ολόκληρη κατηγορία βγει `na`, το βάρος της μοιράζεται αναλογικά στις
 *    υπόλοιπες. Αλλιώς ένα site θα είχε οροφή 80/100 χωρίς να φταίει σε τίποτα.
 */

import { CATEGORIES, RULES_VERSION } from "./rules.js";

const CREDIT = { pass: 1, partial: 0.5, fail: 0, na: 0 };

const GRADES = [
  { min: 90, id: "excellent", label: "Άριστα", summary: "Το site είναι σε πολύ καλή κατάσταση. Μένουν λεπτομέρειες." },
  { min: 75, id: "good", label: "Καλά", summary: "Οι βάσεις είναι σωστές, αλλά υπάρχουν σημεία που κοστίζουν." },
  { min: 50, id: "needs-work", label: "Χρειάζεται δουλειά", summary: "Αρκετά βασικά λείπουν. Οι διορθώσεις είναι εφικτές και θα φανούν." },
  { min: 0, id: "critical", label: "Κρίσιμο", summary: "Λείπουν θεμελιώδη πράγματα σε ασφάλεια ή ευρετηρίαση. Χρειάζεται άμεση παρέμβαση." },
];

const gradeFor = (score) => GRADES.find((grade) => score >= grade.min);

/**
 * Πόσο κοστίζει στον τελικό βαθμό το να μη διορθωθεί ένας κανόνας — σε μονάδες
 * του τελικού 100άρι. Έτσι η λίστα προτεραιότητας δεν είναι γνώμη αλλά αριθμός.
 */
function impactOf(result, category) {
  const missing = 1 - CREDIT[result.state];
  if (missing === 0 || result.state === "na") return 0;
  return (result.units / category.applicableUnits) * category.weight * missing;
}

export function score(results) {
  const categories = CATEGORIES.map((definition) => {
    const rules = results.filter((result) => result.category === definition.id);
    const applicable = rules.filter((result) => result.state !== "na");
    const applicableUnits = applicable.reduce((sum, result) => sum + result.units, 0);
    const earnedUnits = applicable.reduce((sum, result) => sum + result.units * CREDIT[result.state], 0);

    return {
      id: definition.id,
      label: definition.label,
      weight: definition.weight,
      rules,
      applicableUnits,
      earnedUnits,
      skipped: rules.length - applicable.length,
      // null σημαίνει «δεν ελέγχθηκε τίποτα εδώ», όχι μηδέν.
      score: applicableUnits === 0 ? null : Math.round((earnedUnits / applicableUnits) * 100),
    };
  });

  const scored = categories.filter((category) => category.score !== null);
  const totalWeight = scored.reduce((sum, category) => sum + category.weight, 0);

  const total =
    totalWeight === 0
      ? null
      : Math.round(
          scored.reduce((sum, category) => sum + (category.earnedUnits / category.applicableUnits) * category.weight, 0) *
            (100 / totalWeight)
        );

  // Οι προτεραιότητες: πρώτα ό,τι κοστίζει περισσότερους βαθμούς. Ισοπαλία
  // σπάει υπέρ των αποτυχιών, γιατί ένα «μισό» είναι πιο κοντά στο σωστό.
  const weightByCategory = new Map(scored.map((category) => [category.id, category]));
  const priorities = results
    .filter((result) => result.state === "fail" || result.state === "partial")
    .map((result) => ({
      ...result,
      impact: Math.round(impactOf(result, weightByCategory.get(result.category) || { applicableUnits: 1, weight: 0 }) * 10) / 10,
    }))
    .sort((a, b) => b.impact - a.impact || (a.state === "fail" ? -1 : 1));

  const counts = results.reduce(
    (acc, result) => ({ ...acc, [result.state]: acc[result.state] + 1 }),
    { pass: 0, partial: 0, fail: 0, na: 0 }
  );

  return {
    version: RULES_VERSION,
    total,
    grade: total === null ? null : gradeFor(total),
    counts,
    categories: categories.map(({ rules, ...rest }) => ({ ...rest, rules })),
    priorities,
  };
}
