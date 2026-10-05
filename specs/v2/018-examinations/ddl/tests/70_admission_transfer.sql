-- Migration 2007 : transmission aux admissions (Q-E18) — paramètre par type d'examen, désactivé par défaut.
\set R '''aa000000-0000-4000-8000-0000000000a1'''
SELECT ddltest.make_tenant(:R::uuid, 'ex-adm-a');

DO $do$
DECLARE
  R constant uuid := 'aa000000-0000-4000-8000-0000000000a1';
  T constant uuid := 'aa100000-0000-4000-8000-000000000001';
  v_flag boolean;
BEGIN
  PERFORM ddltest.as_tenant(R);
  PERFORM ddltest.cepe_type(R, T);
  SELECT transmits_to_admission INTO v_flag FROM examinations.exam_types WHERE id = T;
  PERFORM ddltest.ok(v_flag = false, 'un type d''examen ne transmet RIEN aux admissions par défaut');
  UPDATE examinations.exam_types SET transmits_to_admission = true WHERE id = T;
  SELECT transmits_to_admission INTO v_flag FROM examinations.exam_types WHERE id = T;
  PERFORM ddltest.ok(v_flag = true, 'la transmission se décide par type d''examen');
  PERFORM ddltest.throws(format($q$UPDATE examinations.exam_types SET transmits_to_admission = NULL WHERE id = %L$q$, T), '23502', 'le paramètre est toujours renseigné');
END
$do$;
