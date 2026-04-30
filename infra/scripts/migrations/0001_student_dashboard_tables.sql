-- Migration: Create student dashboard tables
-- Date: 2024-01-XX
-- Description: Creates tables for storing student dashboard configurations and widget data

-- Enable Row Level Security
ALTER TABLE IF EXISTS users ENABLE ROW LEVEL SECURITY;

-- Create student dashboard configurations table
CREATE TABLE IF NOT EXISTS student_dashboard_configs (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    tenant_id UUID NOT NULL,
    layout JSONB NOT NULL DEFAULT '[]'::jsonb,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    UNIQUE(user_id, tenant_id)
);

-- Create dashboard widgets table
CREATE TABLE IF NOT EXISTS dashboard_widgets (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL,
    widget_type VARCHAR(50) NOT NULL,
    title VARCHAR(255) NOT NULL,
    description TEXT,
    default_config JSONB DEFAULT '{}'::jsonb,
    is_active BOOLEAN DEFAULT true,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Create dashboard templates table
CREATE TABLE IF NOT EXISTS dashboard_templates (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL,
    name VARCHAR(255) NOT NULL,
    description TEXT,
    layout JSONB NOT NULL,
    is_default BOOLEAN DEFAULT false,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Create indexes for better performance
CREATE INDEX IF NOT EXISTS idx_student_dashboard_configs_user_tenant ON student_dashboard_configs(user_id, tenant_id);
CREATE INDEX IF NOT EXISTS idx_dashboard_widgets_tenant ON dashboard_widgets(tenant_id);
CREATE INDEX IF NOT EXISTS idx_dashboard_templates_tenant ON dashboard_templates(tenant_id);

-- Create updated_at trigger function if it doesn't exist
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ language 'plpgsql';

-- Create triggers for updated_at
CREATE TRIGGER update_student_dashboard_configs_updated_at 
    BEFORE UPDATE ON student_dashboard_configs 
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_dashboard_widgets_updated_at 
    BEFORE UPDATE ON dashboard_widgets 
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_dashboard_templates_updated_at 
    BEFORE UPDATE ON dashboard_templates 
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- Row Level Security Policies

-- Policy for student_dashboard_configs
CREATE POLICY "Users can view their own dashboard configs" ON student_dashboard_configs
    FOR SELECT USING (
        auth.uid() = user_id AND 
        tenant_id = current_setting('app.tenant_id')::UUID
    );

CREATE POLICY "Users can insert their own dashboard configs" ON student_dashboard_configs
    FOR INSERT WITH CHECK (
        auth.uid() = user_id AND 
        tenant_id = current_setting('app.tenant_id')::UUID
    );

CREATE POLICY "Users can update their own dashboard configs" ON student_dashboard_configs
    FOR UPDATE USING (
        auth.uid() = user_id AND 
        tenant_id = current_setting('app.tenant_id')::UUID
    );

CREATE POLICY "Users can delete their own dashboard configs" ON student_dashboard_configs
    FOR DELETE USING (
        auth.uid() = user_id AND 
        tenant_id = current_setting('app.tenant_id')::UUID
    );

-- Policy for dashboard_widgets (read-only for students)
CREATE POLICY "Users can view available widgets" ON dashboard_widgets
    FOR SELECT USING (
        tenant_id = current_setting('app.tenant_id')::UUID AND
        is_active = true
    );

-- Policy for dashboard_templates (read-only for students)
CREATE POLICY "Users can view available templates" ON dashboard_templates
    FOR SELECT USING (
        tenant_id = current_setting('app.tenant_id')::UUID
    );

-- Insert default widgets for the tenant
INSERT INTO dashboard_widgets (tenant_id, widget_type, title, description, default_config) VALUES
    ('6eb9c106-b650-4398-b6fa-091b6828c4ba', 'academic-progress', 'Progression Académique', 'Affiche la progression dans les cours et programmes', '{"showPercentage": true, "showGraph": true}'),
    ('6eb9c106-b650-4398-b6fa-091b6828c4ba', 'schedule', 'Emploi du Temps', 'Affiche l\'emploi du temps de la semaine', '{"showToday": true, "showWeek": true}'),
    ('6eb9c106-b650-4398-b6fa-091b6828c4ba', 'assignments', 'Devoirs', 'Liste des devoirs à rendre et déjà rendus', '{"showPending": true, "showCompleted": true}'),
    ('6eb9c106-b650-4398-b6fa-091b6828c4ba', 'recent-grades', 'Notes Récentes', 'Affiche les notes des derniers devoirs', '{"showLast": 5, "showAverage": true}'),
    ('6eb9c106-b650-4398-b6fa-091b6828c4ba', 'financial', 'Situation Financière', 'Affiche les frais de scolarité et paiements', '{"showBalance": true, "showHistory": true}'),
    ('6eb9c106-b650-4398-b6fa-091b6828c4ba', 'messages', 'Messages', 'Boîte de réception des messages', '{"showUnread": true, "maxMessages": 10}'),
    ('6eb9c106-b650-4398-b6fa-091b6828c4ba', 'announcements', 'Annonces', 'Annonces importantes de l\'établissement', '{"showPriority": true, "maxAnnouncements": 5}'),
    ('6eb9c106-b650-4398-b6fa-091b6828c4ba', 'recent-content', 'Contenu Récent', 'Derniers documents et ressources ajoutés', '{"showLast": 8, "showType": true}'),
    ('6eb9c106-b650-4398-b6fa-091b6828c4ba', 'course-progress', 'Progression par Cours', 'Détail de la progression dans chaque cours', '{"showAllCourses": true, "showDetails": true}'),
    ('6eb9c106-b650-4398-b6fa-091b6828c4ba', 'personal-stats', 'Statistiques Personnelles', 'Statistiques d\'assiduité et de performance', '{"showAttendance": true, "showPerformance": true}'),
    ('6eb9c106-b650-4398-b6fa-091b6828c4ba', 'quick-actions', 'Actions Rapides', 'Accès rapide aux fonctionnalités principales', '{"showFavorites": true, "showRecent": true}'),
    ('6eb9c106-b650-4398-b6fa-091b6828c4ba', 'ai-tutor', 'Assistant IA', 'Assistant intelligent pour les questions', '{"showSuggestions": true, "showHistory": true}')
ON CONFLICT (tenant_id, widget_type) DO NOTHING;

-- Insert default template
INSERT INTO dashboard_templates (tenant_id, name, description, layout, is_default) VALUES
    ('6eb9c106-b650-4398-b6fa-091b6828c4ba', 'Template Standard', 'Configuration standard recommandée pour les étudiants', 
    '[
        {"id": "academic-progress", "type": "academic-progress", "title": "Progression Académique", "config": {}, "position": {"x": 0, "y": 0, "w": 6, "h": 4}},
        {"id": "schedule", "type": "schedule", "title": "Emploi du Temps", "config": {}, "position": {"x": 6, "y": 0, "w": 6, "h": 4}},
        {"id": "assignments", "type": "assignments", "title": "Devoirs", "config": {}, "position": {"x": 0, "y": 4, "w": 6, "h": 3}},
        {"id": "recent-grades", "type": "recent-grades", "title": "Notes Récentes", "config": {}, "position": {"x": 6, "y": 4, "w": 6, "h": 3}}
    ]', true)
ON CONFLICT (tenant_id, name) DO NOTHING;

-- Grant necessary permissions
GRANT SELECT, INSERT, UPDATE, DELETE ON student_dashboard_configs TO authenticated;
GRANT SELECT ON dashboard_widgets TO authenticated;
GRANT SELECT ON dashboard_templates TO authenticated;

-- Create a function to get user dashboard config
CREATE OR REPLACE FUNCTION get_user_dashboard_config(user_uuid UUID)
RETURNS JSONB AS $$
DECLARE
    user_config JSONB;
    default_template JSONB;
BEGIN
    -- Try to get user's custom config
    SELECT layout INTO user_config
    FROM student_dashboard_configs
    WHERE user_id = user_uuid AND tenant_id = current_setting('app.tenant_id')::UUID;
    
    -- If no custom config, get default template
    IF user_config IS NULL THEN
        SELECT layout INTO default_template
        FROM dashboard_templates
        WHERE tenant_id = current_setting('app.tenant_id')::UUID AND is_default = true
        LIMIT 1;
        
        user_config := default_template;
    END IF;
    
    RETURN COALESCE(user_config, '[]'::jsonb);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Grant execute permission on the function
GRANT EXECUTE ON FUNCTION get_user_dashboard_config(UUID) TO authenticated;


