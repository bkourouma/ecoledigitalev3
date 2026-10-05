-- Migration 2006 : frais d'examen intégrés à l'inscription (Q-E13) — barème vide par défaut, obligation par candidat, cycle, RLS.
\set R '''a9000000-0000-4000-8000-0000000000a1'''
\set R2 '''a9000000-0000-4000-8000-0000000000a2'''
SELECT ddltest.make_tenant(:R::uuid, 'ex-fee-a');
SELECT ddltest.make_tenant(:R2::uuid, 'ex-fee-b');

DO $do$
DECLARE
  R  constant uuid := 'a9000000-0000-4000-8000-0000000000a1';
  T  constant uuid := 'a9100000-0000-4000-8000-000000000001';
  I  constant uuid := 'a9200000-0000-4000-8000-000000000001';
  S  constant uuid := 'a9300000-0000-4000-8000-000000000001';
  K1 constant uuid := 'a9400000-0000-4000-8000-000000000001';
  K2 constant uuid := 'a9400000-0000-4000-8000-000000000002';
  K3 constant uuid := 'a9400000-0000-4000-8000-000000000003';
  F1 constant uuid := 'a9500000-0000-4000-8000-000000000001';
  INV constant uuid := 'a9600000-0000-4000-8000-000000000001';
  v_n integer;
BEGIN
  PERFORM ddltest.as_tenant(R);
  PERFORM ddltest.cepe_type(R, T);
  PERFORM ddltest.new_session(S, R, T, I, 'CEPE-FEE-2027');
  PERFORM ddltest.open_session(S);
  PERFORM ddltest.as_tenant(R);
  PERFORM ddltest.new_candidate(K1, R, S, I);
  PERFORM ddltest.new_candidate(K2, R, S, I);
  PERFORM ddltest.new_candidate(K3, R, S, I);

  -- ---------------------------------------------------------------- barème : vide par défaut, sans montant
  SELECT count(*) INTO v_n FROM examinations.exam_fee_items WHERE exam_type_id = T;
  PERFORM ddltest.ok(v_n = 0, 'le barème de frais d''examen est VIDE par défaut');
  SELECT count(*) INTO v_n FROM information_schema.columns WHERE table_schema = 'examinations' AND table_name = 'exam_fee_items' AND column_name ~ '(amount|price|montant|tarif)';
  PERFORM ddltest.ok(v_n = 0, 'le barème ne porte aucun montant (ils restent dans finance)');
  INSERT INTO examinations.exam_fee_items (id, tenant_id, exam_type_id, fee_id, applies_to) VALUES (gen_random_uuid(), R, T, F1, 'STUDENT');
  PERFORM ddltest.throws(format($q$INSERT INTO examinations.exam_fee_items (id, tenant_id, exam_type_id, fee_id) VALUES (gen_random_uuid(), %L, %L, %L)$q$, R, T, F1),
     'exam_fee_items_tenant_id_exam_type_id_fee_id_key', 'un frais ne figure qu''une fois au barème d''un type');
  PERFORM ddltest.throws(format($q$INSERT INTO examinations.exam_fee_items (id, tenant_id, exam_type_id, fee_id, applies_to) VALUES (gen_random_uuid(), %L, %L, gen_random_uuid(), 'TOUS')$q$, R, T),
     'exam_fee_items_applies_to_check', 'portée du frais : ALL, STUDENT ou EXTERNAL');
  PERFORM ddltest.throws(format($q$INSERT INTO examinations.exam_fee_items (id, tenant_id, exam_type_id, fee_id) VALUES (gen_random_uuid(), %L, gen_random_uuid(), gen_random_uuid())$q$, R),
     '23503', 'le type d''examen doit exister (clé composite)');

  -- ---------------------------------------------------------------- obligation d'un candidat
  PERFORM ddltest.throws(format($q$INSERT INTO examinations.candidate_fees (id, tenant_id, session_id, candidate_id, status, payer_kind, invoice_id, idempotency_key)
     VALUES (gen_random_uuid(), %L, %L, %L, 'INVOICED', 'STUDENT', %L, 'exam-fee-initial-state')$q$, R, S, K1, INV), 'fee_initial_state', 'une obligation naît sans facture');
  INSERT INTO examinations.candidate_fees (id, tenant_id, session_id, candidate_id, status, payer_kind, lines, idempotency_key)
    VALUES (gen_random_uuid(), R, S, K1, 'PENDING_INVOICE', 'STUDENT', '[{"feeId":"a9500000-0000-4000-8000-000000000001","label":null,"amountMinor":null}]', 'exam-fee-' || K1);
  INSERT INTO examinations.candidate_fees (id, tenant_id, session_id, candidate_id, status, payer_kind, idempotency_key)
    VALUES (gen_random_uuid(), R, S, K2, 'NOT_APPLICABLE', 'STUDENT', 'exam-fee-' || K2);
  INSERT INTO examinations.candidate_fees (id, tenant_id, session_id, candidate_id, status, payer_kind, lines, idempotency_key)
    VALUES (gen_random_uuid(), R, S, K3, 'PENDING_INVOICE', 'STUDENT', '[{"feeId":"a9500000-0000-4000-8000-000000000001","label":null,"amountMinor":null}]', 'exam-fee-' || K3);
  PERFORM ddltest.pass('une obligation par candidat : à facturer, ou sans objet');
  PERFORM ddltest.throws(format($q$INSERT INTO examinations.candidate_fees (id, tenant_id, session_id, candidate_id, status, payer_kind, idempotency_key)
     VALUES (gen_random_uuid(), %L, %L, %L, 'PENDING_INVOICE', 'STUDENT', 'exam-fee-doublon')$q$, R, S, K1), 'candidate_fees_tenant_id_candidate_id_key', 'une seule obligation par candidat');
  PERFORM ddltest.throws(format($q$INSERT INTO examinations.candidate_fees (id, tenant_id, session_id, candidate_id, status, payer_kind, lines, idempotency_key)
     VALUES (gen_random_uuid(), %L, %L, gen_random_uuid(), 'NOT_APPLICABLE', 'STUDENT', '[]', 'exam-fee-sans-objet-1')$q$, R, S), '23503', 'le candidat doit exister dans la session (clé composite)');

  -- ---------------------------------------------------------------- cycle de l'obligation
  PERFORM ddltest.throws(format($q$UPDATE examinations.candidate_fees SET status = 'INVOICED' WHERE candidate_id = %L$q$, K1), 'candidate_fees_check', 'INVOICED exige une facture');
  UPDATE examinations.candidate_fees SET status = 'INVOICED', invoice_id = INV, currency = 'XOF', total_minor = 15000,
         lines = '[{"feeId":"a9500000-0000-4000-8000-000000000001","label":"Frais d''examen (fictif)","amountMinor":15000}]' WHERE candidate_id = K1;
  PERFORM ddltest.pass('PENDING_INVOICE -> INVOICED avec la facture, l''instantané du total et des lignes');
  PERFORM ddltest.throws(format($q$UPDATE examinations.candidate_fees SET invoice_id = gen_random_uuid() WHERE candidate_id = %L$q$, K1), 'fee_invoice_immutable', 'la facture d''une obligation ne change pas');
  PERFORM ddltest.throws(format($q$UPDATE examinations.candidate_fees SET payer_kind = 'EXTERNAL' WHERE candidate_id = %L$q$, K1), 'fee_identity_immutable', 'le payeur est figé');
  PERFORM ddltest.throws(format($q$UPDATE examinations.candidate_fees SET status = 'PENDING_INVOICE' WHERE candidate_id = %L$q$, K1), 'fee_transition', 'on ne repasse pas à « à facturer »');
  PERFORM ddltest.throws(format($q$UPDATE examinations.candidate_fees SET status = 'REFUND_DONE', refund_confirmed_by = gen_random_uuid(), refund_confirmed_at = now() WHERE candidate_id = %L$q$, K1), 'fee_transition', 'un remboursement se confirme seulement s''il est dû');
  UPDATE examinations.candidate_fees SET status = 'REFUND_DUE', note = 'Facture encaissée : remboursement manuel' WHERE candidate_id = K1;
  PERFORM ddltest.pass('INVOICED -> REFUND_DUE (désinscription après paiement : remboursement MANUEL)');
  PERFORM ddltest.throws(format($q$UPDATE examinations.candidate_fees SET status = 'REFUND_DONE' WHERE candidate_id = %L$q$, K1), 'candidate_fees_check', 'REFUND_DONE exige l''auteur et la date de confirmation');
  UPDATE examinations.candidate_fees SET status = 'REFUND_DONE', refund_confirmed_by = gen_random_uuid(), refund_confirmed_at = now(), note = 'Remboursé en caisse' WHERE candidate_id = K1;
  PERFORM ddltest.pass('REFUND_DUE -> REFUND_DONE confirmé par une personne identifiée');
  PERFORM ddltest.throws(format($q$UPDATE examinations.candidate_fees SET status = 'CANCELLED' WHERE candidate_id = %L$q$, K1), 'fee_transition', 'REFUND_DONE est final');
  PERFORM ddltest.throws(format($q$UPDATE examinations.candidate_fees SET total_minor = 1 WHERE candidate_id = %L$q$, K2), 'fee_closed', 'sans objet : aucun total ne s''ajoute');
  PERFORM ddltest.throws(format($q$UPDATE examinations.candidate_fees SET status = 'INVOICED' WHERE candidate_id = %L$q$, K2), 'fee_transition', 'sans objet est final');
  UPDATE examinations.candidate_fees SET status = 'AWAITING_MANUAL_INVOICE' WHERE candidate_id = K3;
  UPDATE examinations.candidate_fees SET status = 'CANCELLED' WHERE candidate_id = K3;
  PERFORM ddltest.pass('candidat libre : à facturer à la main puis annulé à la désinscription');
  PERFORM ddltest.throws(format($q$UPDATE examinations.candidate_fees SET lines = '[]' WHERE candidate_id = %L$q$, K3), 'fee_closed', 'une obligation close ne change plus');
END
$do$;

-- ---------------------------------------------------------------- isolation et droits
SET ROLE app_user;
SELECT ddltest.as_tenant('a9000000-0000-4000-8000-0000000000a2');
DO $do$
BEGIN
  PERFORM ddltest.ok((SELECT count(*) FROM examinations.exam_fee_items) = 0, 'RLS : le tenant B ne voit aucun barème de A');
  PERFORM ddltest.ok((SELECT count(*) FROM examinations.candidate_fees) = 0, 'RLS : le tenant B ne voit aucune obligation de A');
  PERFORM ddltest.throws($q$DELETE FROM examinations.candidate_fees$q$, '42501', 'GRANT : une obligation ne se supprime jamais');
  PERFORM ddltest.throws($q$DELETE FROM examinations.exam_fee_items$q$, '42501', 'GRANT : un frais du barème se désactive, il ne se supprime pas');
  PERFORM ddltest.throws($q$INSERT INTO examinations.exam_fee_items (id, tenant_id, exam_type_id, fee_id) VALUES (gen_random_uuid(), 'a9000000-0000-4000-8000-0000000000a1', 'a9100000-0000-4000-8000-000000000001', gen_random_uuid())$q$, '42501', 'RLS : barème écrit pour un autre tenant refusé');
END $do$;
RESET ROLE;
