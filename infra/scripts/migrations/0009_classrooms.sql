-- EcoleDigitale Database Schema Migration 0009
-- Creates classroom management tables

-- Enable UUID extension (if not already enabled)
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- Create classroom types enum
DO $$ BEGIN
    CREATE TYPE classroom_type AS ENUM (
        'amphitheatre',
        'salle_cours',
        'laboratoire',
        'salle_informatique',
        'atelier',
        'bibliotheque',
        'salle_reunion',
        'autre'
    );
EXCEPTION
    WHEN duplicate_object THEN null;
END $$;

-- Create classroom status enum
DO $$ BEGIN
    CREATE TYPE classroom_status AS ENUM (
        'disponible',
        'occupe',
        'maintenance',
        'hors_service'
    );
EXCEPTION
    WHEN duplicate_object THEN null;
END $$;

-- Create classrooms table
CREATE TABLE IF NOT EXISTS classrooms (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    name VARCHAR(255) NOT NULL,                     -- Nom de la salle (ex: "Salle A101")
    code VARCHAR(50) NOT NULL,                      -- Code unique (ex: "A101")
    type classroom_type NOT NULL DEFAULT 'salle_cours',
    capacity INTEGER NOT NULL DEFAULT 30,          -- Capacité d'accueil
    floor INTEGER,                                  -- Étage
    building VARCHAR(100),                          -- Bâtiment
    description TEXT,                               -- Description de la salle
    equipment TEXT[],                               -- Équipements disponibles (tableau, projecteur, etc.)
    status classroom_status NOT NULL DEFAULT 'disponible',
    is_active BOOLEAN DEFAULT true,                 -- Salle active ou non
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    UNIQUE(tenant_id, code),
    CONSTRAINT capacity_positive CHECK (capacity > 0)
);

-- Create classroom reservations table for scheduling
CREATE TABLE IF NOT EXISTS classroom_reservations (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    classroom_id UUID NOT NULL REFERENCES classrooms(id) ON DELETE CASCADE,
    title VARCHAR(255) NOT NULL,                    -- Titre de la réservation
    description TEXT,                               -- Description
    start_datetime TIMESTAMP WITH TIME ZONE NOT NULL,
    end_datetime TIMESTAMP WITH TIME ZONE NOT NULL,
    reserved_by UUID NOT NULL REFERENCES users(id), -- Utilisateur qui a fait la réservation
    course_id UUID REFERENCES courses(id),          -- Cours associé (optionnel)
    class_id UUID REFERENCES classes(id),           -- Classe associée (optionnel)
    status VARCHAR(20) DEFAULT 'confirmed',         -- confirmed, cancelled, pending
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    CONSTRAINT valid_datetime_range CHECK (end_datetime > start_datetime)
);

-- Create indexes for performance
CREATE INDEX IF NOT EXISTS idx_classrooms_tenant_id ON classrooms(tenant_id);
CREATE INDEX IF NOT EXISTS idx_classrooms_code ON classrooms(tenant_id, code);
CREATE INDEX IF NOT EXISTS idx_classrooms_type ON classrooms(tenant_id, type);
CREATE INDEX IF NOT EXISTS idx_classrooms_status ON classrooms(tenant_id, status);
CREATE INDEX IF NOT EXISTS idx_classrooms_active ON classrooms(tenant_id, is_active) WHERE is_active = true;

CREATE INDEX IF NOT EXISTS idx_classroom_reservations_tenant_id ON classroom_reservations(tenant_id);
CREATE INDEX IF NOT EXISTS idx_classroom_reservations_classroom_id ON classroom_reservations(classroom_id);
CREATE INDEX IF NOT EXISTS idx_classroom_reservations_datetime ON classroom_reservations(tenant_id, start_datetime, end_datetime);
CREATE INDEX IF NOT EXISTS idx_classroom_reservations_course ON classroom_reservations(course_id) WHERE course_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_classroom_reservations_class ON classroom_reservations(class_id) WHERE class_id IS NOT NULL;

-- Enable Row Level Security
ALTER TABLE classrooms ENABLE ROW LEVEL SECURITY;
ALTER TABLE classroom_reservations ENABLE ROW LEVEL SECURITY;

-- Create RLS policies for classrooms
CREATE POLICY classrooms_tenant_policy ON classrooms
    FOR ALL
    USING (tenant_id = current_setting('app.tenant_id', true)::UUID)
    WITH CHECK (tenant_id = current_setting('app.tenant_id', true)::UUID);

-- Create RLS policies for classroom_reservations
CREATE POLICY classroom_reservations_tenant_policy ON classroom_reservations
    FOR ALL
    USING (tenant_id = current_setting('app.tenant_id', true)::UUID)
    WITH CHECK (tenant_id = current_setting('app.tenant_id', true)::UUID);

-- Add constraint to prevent overlapping reservations for the same classroom
ALTER TABLE classroom_reservations
    ADD CONSTRAINT classroom_reservations_no_overlap
    EXCLUDE USING gist (
        tenant_id WITH =,
        classroom_id WITH =,
        tstzrange(start_datetime, end_datetime, '[)') WITH &&
    ) WHERE (status != 'cancelled');

-- Comments for documentation
COMMENT ON TABLE classrooms IS 'Salles de classe et espaces d''enseignement';
COMMENT ON TABLE classroom_reservations IS 'Réservations et planning des salles de classe';

COMMENT ON COLUMN classrooms.type IS 'Type de salle: amphitheatre, salle_cours, laboratoire, salle_informatique, atelier, bibliotheque, salle_reunion, autre';
COMMENT ON COLUMN classrooms.capacity IS 'Capacité maximale d''accueil de la salle';
COMMENT ON COLUMN classrooms.equipment IS 'Liste des équipements disponibles dans la salle';
COMMENT ON COLUMN classrooms.status IS 'Statut actuel: disponible, occupe, maintenance, hors_service';

COMMENT ON COLUMN classroom_reservations.start_datetime IS 'Date et heure de début de la réservation';
COMMENT ON COLUMN classroom_reservations.end_datetime IS 'Date et heure de fin de la réservation';
COMMENT ON COLUMN classroom_reservations.status IS 'Statut de la réservation: confirmed, cancelled, pending';
