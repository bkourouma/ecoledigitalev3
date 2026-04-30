-- Migration: Create time_slots table for schedule generation
-- Date: 2024-08-29
-- Description: Create time slots table for managing available time periods for classes

-- Create enum for day of week
DO $$ BEGIN
    CREATE TYPE day_of_week AS ENUM ('monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday');
EXCEPTION
    WHEN duplicate_object THEN null;
END $$;

-- Create time_slots table
CREATE TABLE IF NOT EXISTS time_slots (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    name VARCHAR(255) NOT NULL,                     -- Nom du créneau (ex: "Lundi Matin 1")
    day_of_week day_of_week NOT NULL,               -- Jour de la semaine
    start_time TIME NOT NULL,                       -- Heure de début (ex: 08:00:00)
    end_time TIME NOT NULL,                         -- Heure de fin (ex: 10:00:00)
    priority INTEGER NOT NULL DEFAULT 1,            -- Priorité (1=faible, 3=élevée)
    max_concurrent_sessions INTEGER DEFAULT 1,      -- Nombre max de sessions simultanées
    is_active BOOLEAN DEFAULT true,                 -- Créneau actif ou non
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    
    -- Contraintes
    CONSTRAINT time_slots_time_order CHECK (start_time < end_time),
    CONSTRAINT time_slots_priority_range CHECK (priority >= 1 AND priority <= 3),
    CONSTRAINT time_slots_max_sessions_positive CHECK (max_concurrent_sessions > 0),
    
    -- Unicité par tenant, jour et heures
    UNIQUE(tenant_id, day_of_week, start_time, end_time)
);

-- Create indexes
CREATE INDEX IF NOT EXISTS idx_time_slots_tenant_id ON time_slots(tenant_id);
CREATE INDEX IF NOT EXISTS idx_time_slots_day_of_week ON time_slots(tenant_id, day_of_week);
CREATE INDEX IF NOT EXISTS idx_time_slots_active ON time_slots(tenant_id, is_active);
CREATE INDEX IF NOT EXISTS idx_time_slots_priority ON time_slots(tenant_id, priority);

-- Add RLS policy
ALTER TABLE time_slots ENABLE ROW LEVEL SECURITY;

-- Policy for tenant isolation
CREATE POLICY time_slots_tenant_isolation ON time_slots
    USING (tenant_id = current_setting('app.tenant_id')::uuid);

-- Insert default time slots for the main tenant
DO $$
DECLARE
    main_tenant_id UUID;
BEGIN
    -- Get the main tenant ID
    SELECT id INTO main_tenant_id FROM tenants WHERE name = 'Imhotep Academy' LIMIT 1;
    
    IF main_tenant_id IS NOT NULL THEN
        -- Insert standard time slots
        INSERT INTO time_slots (tenant_id, name, day_of_week, start_time, end_time, priority, max_concurrent_sessions, is_active)
        VALUES 
            -- Lundi
            (main_tenant_id, 'Lundi Matin 1', 'monday', '08:00:00', '10:00:00', 3, 1, true),
            (main_tenant_id, 'Lundi Matin 2', 'monday', '10:15:00', '12:15:00', 3, 1, true),
            (main_tenant_id, 'Lundi Après-midi 1', 'monday', '13:30:00', '15:30:00', 2, 1, true),
            (main_tenant_id, 'Lundi Après-midi 2', 'monday', '15:45:00', '17:45:00', 2, 1, true),
            
            -- Mardi
            (main_tenant_id, 'Mardi Matin 1', 'tuesday', '08:00:00', '10:00:00', 3, 1, true),
            (main_tenant_id, 'Mardi Matin 2', 'tuesday', '10:15:00', '12:15:00', 3, 1, true),
            (main_tenant_id, 'Mardi Après-midi 1', 'tuesday', '13:30:00', '15:30:00', 2, 1, true),
            (main_tenant_id, 'Mardi Après-midi 2', 'tuesday', '15:45:00', '17:45:00', 2, 1, true),
            
            -- Mercredi
            (main_tenant_id, 'Mercredi Matin 1', 'wednesday', '08:00:00', '10:00:00', 3, 1, true),
            (main_tenant_id, 'Mercredi Matin 2', 'wednesday', '10:15:00', '12:15:00', 3, 1, true),
            (main_tenant_id, 'Mercredi Après-midi 1', 'wednesday', '13:30:00', '15:30:00', 1, 1, true),
            
            -- Jeudi
            (main_tenant_id, 'Jeudi Matin 1', 'thursday', '08:00:00', '10:00:00', 3, 1, true),
            (main_tenant_id, 'Jeudi Matin 2', 'thursday', '10:15:00', '12:15:00', 3, 1, true),
            (main_tenant_id, 'Jeudi Après-midi 1', 'thursday', '13:30:00', '15:30:00', 2, 1, true),
            (main_tenant_id, 'Jeudi Après-midi 2', 'thursday', '15:45:00', '17:45:00', 2, 1, true),
            
            -- Vendredi
            (main_tenant_id, 'Vendredi Matin 1', 'friday', '08:00:00', '10:00:00', 3, 1, true),
            (main_tenant_id, 'Vendredi Matin 2', 'friday', '10:15:00', '12:15:00', 3, 1, true),
            (main_tenant_id, 'Vendredi Après-midi 1', 'friday', '13:30:00', '15:30:00', 2, 1, true),
            
            -- Samedi (optionnel)
            (main_tenant_id, 'Samedi Matin 1', 'saturday', '08:00:00', '10:00:00', 1, 1, true),
            (main_tenant_id, 'Samedi Matin 2', 'saturday', '10:15:00', '12:15:00', 1, 1, true)
        ON CONFLICT (tenant_id, day_of_week, start_time, end_time) DO NOTHING;
        
        RAISE NOTICE 'Time slots created for tenant: %', main_tenant_id;
    ELSE
        RAISE NOTICE 'Main tenant not found, skipping time slots creation';
    END IF;
END $$;
