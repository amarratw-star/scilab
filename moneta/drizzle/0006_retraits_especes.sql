-- Nouvelle catégorie par défaut « Retraits d'espèces » pour les utilisateurs existants (placée juste avant « Autres »),
-- sauf s'ils ont déjà créé eux-mêmes une catégorie de retraits.
WITH targets AS (
  SELECT u.id AS user_id, a.id AS autres_id, a.sort_order
  FROM users u
  JOIN categories a ON a.user_id = u.id AND a.name = 'Autres' AND a.kind = 'expense' AND a.parent_id IS NULL
  WHERE NOT EXISTS (SELECT 1 FROM categories c WHERE c.user_id = u.id AND c.kind = 'expense' AND (c.name ILIKE 'retrait%' OR c.name ILIKE 'espèces%'))
), bumped AS (
  UPDATE categories c SET sort_order = c.sort_order + 1 FROM targets t WHERE c.id = t.autres_id RETURNING c.id
)
INSERT INTO categories (user_id, name, kind, icon, color, is_fixed, sort_order)
SELECT user_id, 'Retraits d''espèces', 'expense', 'banknote', '#64748b', false, sort_order FROM targets;
--> statement-breakpoint
-- Retraits rangés automatiquement dans « Autres » (jamais les choix de l'utilisateur) → nouvelle catégorie
UPDATE transactions t
SET category_id = r.id, category_confidence = GREATEST(coalesce(t.category_confidence, 0), 85), updated_at = now()
FROM categories a, categories r
WHERE t.category_id = a.id AND a.name = 'Autres' AND a.kind = 'expense'
  AND r.user_id = t.user_id AND r.name = 'Retraits d''espèces' AND r.kind = 'expense'
  AND coalesce(t.category_source, '') IN ('local', 'bank')
  AND (coalesce(t.bank_label, t.description, '') ~* '(retrait|\mdab\M|\mgab\M)' OR (t.payment_method = 'cash' AND t.imported_at IS NOT NULL));
