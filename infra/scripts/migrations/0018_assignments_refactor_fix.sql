-- Migration corrective pour le refactoring des assignments
-- Cette migration s'adapte à la structure existante

-- Set tenant context
SELECT set_config('app.tenant_id', 'imhotepacademy', true);

-- Ajouter les colonnes manquantes à assignment_instances si elles n'existent pas
DO $$
BEGIN
    -- Ajouter teacher_id si elle n'existe pas
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns 
                   WHERE table_name = 'assignment_instances' AND column_name = 'teacher_id') THEN
        ALTER TABLE assignment_instances ADD COLUMN teacher_id UUID;
        COMMENT ON COLUMN assignment_instances.teacher_id IS 'ID de l''enseignant qui a assigné';
    END IF;

    -- Ajouter duration_minutes si elle n'existe pas
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns 
                   WHERE table_name = 'assignment_instances' AND column_name = 'duration_minutes') THEN
        ALTER TABLE assignment_instances ADD COLUMN duration_minutes INTEGER;
        COMMENT ON COLUMN assignment_instances.duration_minutes IS 'Durée en minutes (override de l''assignment)';
    END IF;

    -- Ajouter max_attempts si elle n'existe pas
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns 
                   WHERE table_name = 'assignment_instances' AND column_name = 'max_attempts') THEN
        ALTER TABLE assignment_instances ADD COLUMN max_attempts INTEGER;
        COMMENT ON COLUMN assignment_instances.max_attempts IS 'Nombre maximum de tentatives (override)';
    END IF;

    -- Ajouter shuffle_questions si elle n'existe pas
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns 
                   WHERE table_name = 'assignment_instances' AND column_name = 'shuffle_questions') THEN
        ALTER TABLE assignment_instances ADD COLUMN shuffle_questions BOOLEAN;
        COMMENT ON COLUMN assignment_instances.shuffle_questions IS 'Mélanger les questions (override)';
    END IF;

    -- Ajouter show_results_mode si elle n'existe pas
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns 
                   WHERE table_name = 'assignment_instances' AND column_name = 'show_results_mode') THEN
        ALTER TABLE assignment_instances ADD COLUMN show_results_mode TEXT;
        COMMENT ON COLUMN assignment_instances.show_results_mode IS 'Mode d''affichage des résultats (override)';
    END IF;

    -- Ajouter late_submission_allowed si elle n'existe pas
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns 
                   WHERE table_name = 'assignment_instances' AND column_name = 'late_submission_allowed') THEN
        ALTER TABLE assignment_instances ADD COLUMN late_submission_allowed BOOLEAN DEFAULT FALSE;
        COMMENT ON COLUMN assignment_instances.late_submission_allowed IS 'Autoriser les soumissions tardives';
    END IF;

    -- Ajouter late_penalty_percent si elle n'existe pas
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns 
                   WHERE table_name = 'assignment_instances' AND column_name = 'late_penalty_percent') THEN
        ALTER TABLE assignment_instances ADD COLUMN late_penalty_percent DECIMAL(5,2) DEFAULT 0;
        COMMENT ON COLUMN assignment_instances.late_penalty_percent IS 'Pourcentage de pénalité pour retard';
    END IF;

    -- Ajouter created_at si elle n'existe pas
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns 
                   WHERE table_name = 'assignment_instances' AND column_name = 'created_at') THEN
        ALTER TABLE assignment_instances ADD COLUMN created_at TIMESTAMPTZ DEFAULT NOW();
    END IF;

    -- Ajouter updated_at si elle n'existe pas
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns 
                   WHERE table_name = 'assignment_instances' AND column_name = 'updated_at') THEN
        ALTER TABLE assignment_instances ADD COLUMN updated_at TIMESTAMPTZ DEFAULT NOW();
    END IF;

    RAISE NOTICE 'Colonnes ajoutées à assignment_instances';
END $$;

-- Créer les index manquants
CREATE INDEX IF NOT EXISTS idx_assignment_instances_assignment_id ON assignment_instances(assignment_id);
CREATE INDEX IF NOT EXISTS idx_assignment_instances_class_id ON assignment_instances(class_id);
CREATE INDEX IF NOT EXISTS idx_assignment_instances_tenant_id ON assignment_instances(tenant_id);
CREATE INDEX IF NOT EXISTS idx_assignment_instances_ends_at ON assignment_instances(ends_at);

-- Ajouter les contraintes de clés étrangères si elles n'existent pas
DO $$
BEGIN
    -- Contrainte pour assignment_id
    IF NOT EXISTS (SELECT 1 FROM information_schema.table_constraints 
                   WHERE constraint_name = 'fk_assignment_instances_assignment_id') THEN
        ALTER TABLE assignment_instances 
        ADD CONSTRAINT fk_assignment_instances_assignment_id 
        FOREIGN KEY (assignment_id) REFERENCES assignments(id) ON DELETE CASCADE;
    END IF;

    -- Contrainte pour class_id
    IF NOT EXISTS (SELECT 1 FROM information_schema.table_constraints 
                   WHERE constraint_name = 'fk_assignment_instances_class_id') THEN
        ALTER TABLE assignment_instances 
        ADD CONSTRAINT fk_assignment_instances_class_id 
        FOREIGN KEY (class_id) REFERENCES classes(id) ON DELETE CASCADE;
    END IF;

    RAISE NOTICE 'Contraintes ajoutées';
END $$;

-- Activer RLS sur assignment_instances si pas déjà fait
ALTER TABLE assignment_instances ENABLE ROW LEVEL SECURITY;

-- Créer les politiques RLS si elles n'existent pas
DO $$
BEGIN
    -- Politique pour les enseignants
    IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'assignment_instances' AND policyname = 'assignment_instances_tenant_isolation') THEN
        CREATE POLICY assignment_instances_tenant_isolation ON assignment_instances
        FOR ALL USING (tenant_id = current_setting('app.tenant_id')::uuid);
    END IF;

    RAISE NOTICE 'Politiques RLS créées';
END $$;

-- Ajouter assignment_instance_id à assignment_submissions si elle n'existe pas
DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns 
                   WHERE table_name = 'assignment_submissions' AND column_name = 'assignment_instance_id') THEN
        ALTER TABLE assignment_submissions ADD COLUMN assignment_instance_id UUID;
        
        -- Créer l'index
        CREATE INDEX IF NOT EXISTS idx_assignment_submissions_instance_id 
        ON assignment_submissions(assignment_instance_id);
        
        COMMENT ON COLUMN assignment_submissions.assignment_instance_id IS 'Référence vers l''instance d''assignation';
    END IF;
END $$;

-- Créer une vue simplifiée pour les étudiants (en s'adaptant aux tables existantes)
CREATE OR REPLACE VIEW student_assignments_view AS
SELECT 
    ai.id as instance_id,
    ai.assignment_id,
    ai.class_id,
    ai.starts_at,
    ai.ends_at,
    ai.duration_minutes,
    ai.max_attempts,
    ai.show_results_mode,
    ai.late_submission_allowed,
    ai.late_penalty_percent,
    a.title,
    a.description,
    a.type,
    a.course_id,
    c.name as course_name,
    c.code as course_code,
    cl.name as class_name,
    -- Vérifier si l'étudiant a déjà soumis
    CASE WHEN sub.id IS NOT NULL THEN sub.status ELSE 'not_started' END as submission_status,
    sub.id as submission_id,
    sub.submitted_at,
    sub.final_score,
    sub.is_late
FROM assignment_instances ai
JOIN assignments a ON a.id = ai.assignment_id
JOIN courses c ON c.id = a.course_id
JOIN classes cl ON cl.id = ai.class_id
LEFT JOIN assignment_submissions sub ON sub.assignment_id = a.id 
WHERE ai.tenant_id = current_setting('app.tenant_id')::uuid;

-- Créer une vue pour les enseignants
CREATE OR REPLACE VIEW teacher_assignments_view AS
SELECT 
    ai.id as instance_id,
    ai.assignment_id,
    ai.class_id,
    ai.teacher_id,
    ai.starts_at,
    ai.ends_at,
    ai.duration_minutes,
    ai.max_attempts,
    ai.created_at,
    a.title,
    a.description,
    a.type,
    a.course_id,
    c.name as course_name,
    c.code as course_code,
    cl.name as class_name,
    -- Compter les soumissions
    COUNT(sub.id) as submissions_count
FROM assignment_instances ai
JOIN assignments a ON a.id = ai.assignment_id
JOIN courses c ON c.id = a.course_id
JOIN classes cl ON cl.id = ai.class_id
LEFT JOIN assignment_submissions sub ON sub.assignment_id = a.id
WHERE ai.tenant_id = current_setting('app.tenant_id')::uuid
GROUP BY ai.id, ai.assignment_id, ai.class_id, ai.teacher_id, ai.starts_at, ai.ends_at, 
         ai.duration_minutes, ai.max_attempts, ai.created_at, a.title, a.description, 
         a.type, a.course_id, c.name, c.code, cl.name;

-- Commentaires sur les vues
COMMENT ON VIEW student_assignments_view IS 'Vue optimisée pour l''accès étudiant aux assignments';
COMMENT ON VIEW teacher_assignments_view IS 'Vue optimisée pour la gestion enseignant des assignments';

-- Fonction pour mettre à jour updated_at automatiquement
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ language 'plpgsql';

-- Trigger pour updated_at sur assignment_instances
DROP TRIGGER IF EXISTS update_assignment_instances_updated_at ON assignment_instances;
CREATE TRIGGER update_assignment_instances_updated_at
    BEFORE UPDATE ON assignment_instances
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at_column();

-- Messages de confirmation
RAISE NOTICE '=== MIGRATION CORRECTIVE TERMINÉE ===';
RAISE NOTICE 'Table assignment_instances mise à jour avec les colonnes manquantes';
RAISE NOTICE 'Index et contraintes ajoutés';
RAISE NOTICE 'Politiques RLS activées';
RAISE NOTICE 'Vues créées pour étudiants et enseignants';
RAISE NOTICE 'Le système d''assignation est maintenant prêt !';
