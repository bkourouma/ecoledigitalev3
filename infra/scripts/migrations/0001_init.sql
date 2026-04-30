-- EcoleDigitale Database Schema Migration 0001
-- Creates multi-tenant tables with RLS policies

-- Enable UUID extension
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- Create tenants table
CREATE TABLE IF NOT EXISTS tenants (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    slug VARCHAR(50) UNIQUE NOT NULL,
    name VARCHAR(255) NOT NULL,
    settings_json JSONB DEFAULT '{}',
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Create roles table (tenant-scoped)
CREATE TABLE IF NOT EXISTS roles (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    key VARCHAR(50) NOT NULL,
    name VARCHAR(255) NOT NULL,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    UNIQUE(tenant_id, key)
);

-- Create users table (tenant-scoped)
CREATE TABLE IF NOT EXISTS users (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    email VARCHAR(255) NOT NULL,
    name VARCHAR(255) NOT NULL,
    password_hash VARCHAR(255) NOT NULL,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    UNIQUE(tenant_id, email)
);

-- Create user_roles junction table
CREATE TABLE IF NOT EXISTS user_roles (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    role_id UUID NOT NULL REFERENCES roles(id) ON DELETE CASCADE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    UNIQUE(user_id, role_id)
);

-- Enable Row Level Security
ALTER TABLE tenants ENABLE ROW LEVEL SECURITY;
ALTER TABLE roles ENABLE ROW LEVEL SECURITY;
ALTER TABLE users ENABLE ROW LEVEL SECURITY;
ALTER TABLE user_roles ENABLE ROW LEVEL SECURITY;

-- Create RLS policies for tenants table
-- Note: Tenants table is accessible based on app.tenant_id setting
CREATE POLICY tenant_policy ON tenants
    FOR ALL
    USING (id = current_setting('app.tenant_id', true)::UUID);

-- Create RLS policies for roles table
CREATE POLICY roles_tenant_policy ON roles
    FOR ALL
    USING (tenant_id = current_setting('app.tenant_id', true)::UUID);

-- Create RLS policies for users table
CREATE POLICY users_tenant_policy ON users
    FOR ALL
    USING (tenant_id = current_setting('app.tenant_id', true)::UUID);

-- Create RLS policies for user_roles table
-- Users can only see role assignments within their tenant
CREATE POLICY user_roles_tenant_policy ON user_roles
    FOR ALL
    USING (
        EXISTS (
            SELECT 1 FROM users u 
            WHERE u.id = user_roles.user_id 
            AND u.tenant_id = current_setting('app.tenant_id', true)::UUID
        )
    );

-- Create indexes for performance
CREATE INDEX IF NOT EXISTS idx_tenants_slug ON tenants(slug);
CREATE INDEX IF NOT EXISTS idx_roles_tenant_id ON roles(tenant_id);
CREATE INDEX IF NOT EXISTS idx_roles_key ON roles(tenant_id, key);
CREATE INDEX IF NOT EXISTS idx_users_tenant_id ON users(tenant_id);
CREATE INDEX IF NOT EXISTS idx_users_email ON users(tenant_id, email);
CREATE INDEX IF NOT EXISTS idx_user_roles_user_id ON user_roles(user_id);
CREATE INDEX IF NOT EXISTS idx_user_roles_role_id ON user_roles(role_id);

-- Create updated_at trigger function
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ language 'plpgsql';

-- Create triggers for updated_at
CREATE TRIGGER update_tenants_updated_at 
    BEFORE UPDATE ON tenants 
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_roles_updated_at 
    BEFORE UPDATE ON roles 
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_users_updated_at 
    BEFORE UPDATE ON users 
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- Grant permissions (adjust based on your database user setup)
-- GRANT ALL PRIVILEGES ON ALL TABLES IN SCHEMA public TO your_api_user;
-- GRANT ALL PRIVILEGES ON ALL SEQUENCES IN SCHEMA public TO your_api_user;

-- Comments for documentation
COMMENT ON TABLE tenants IS 'Multi-tenant organizations/institutions';
COMMENT ON TABLE roles IS 'Tenant-scoped user roles (admin, student, parent, etc.)';
COMMENT ON TABLE users IS 'Tenant-scoped user accounts';
COMMENT ON TABLE user_roles IS 'Many-to-many relationship between users and roles';

COMMENT ON COLUMN tenants.slug IS 'URL-safe identifier for tenant (used in subdomains)';
COMMENT ON COLUMN tenants.settings_json IS 'Tenant-specific configuration settings';
COMMENT ON COLUMN roles.key IS 'Machine-readable role identifier (admin, student, parent)';
COMMENT ON COLUMN users.password_hash IS 'bcrypt hashed password';

-- Migration complete
SELECT 'Migration 0001_init.sql completed successfully' as result;











