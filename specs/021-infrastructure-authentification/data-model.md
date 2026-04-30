# Data Model: Phase 1 - Infrastructure et Authentification RSO-PFSO

**Feature**: Phase 1 - Infrastructure et Authentification RSO-PFSO  
**Date**: 2024-12-19  
**Status**: Complete

## Overview

The RSO-PFSO module uses a separate database schema (`rso_*` tables) within the existing PostgreSQL database, maintaining tenant isolation through foreign key relationships to the `tenants` table. All tables support Row Level Security (RLS) for multi-tenant data isolation.

## Database Schema

### Table: `rso_users`

**Purpose**: Stores user accounts for the RSO-PFSO module with authentication credentials, personal information, role assignment, and status.

**Schema**:
```sql
CREATE TABLE rso_users (
    id INT PRIMARY KEY GENERATED ALWAYS AS IDENTITY,
    tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    username VARCHAR(100) UNIQUE NOT NULL,
    nom VARCHAR(100) NOT NULL,
    prenoms VARCHAR(100) NOT NULL,
    email VARCHAR(150) UNIQUE NOT NULL,
    telephone VARCHAR(20),
    password VARCHAR(255) NOT NULL,  -- bcrypt hashed (cost factor 12)
    role VARCHAR(50) NOT NULL CHECK (role IN ('administrateur', 'rso_formateur', 'agent_pfso', 'agent_surete')),
    statut VARCHAR(20) NOT NULL DEFAULT 'actif' CHECK (statut IN ('actif', 'inactif', 'suspendu')),
    installation_id INT NULL,  -- Foreign key to rso_installations (Phase 2), nullable for non-PFSO roles
    created_by INT NULL REFERENCES rso_users(id) ON DELETE SET NULL,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP NOT NULL,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP NOT NULL,
    last_login TIMESTAMP WITH TIME ZONE NULL,
    password_reset_token VARCHAR(255) NULL,
    password_reset_expires TIMESTAMP WITH TIME ZONE NULL,
    
    CONSTRAINT rso_users_tenant_username_unique UNIQUE (tenant_id, username),
    CONSTRAINT rso_users_tenant_email_unique UNIQUE (tenant_id, email),
    CONSTRAINT rso_users_pfso_installation_required CHECK (
        (role = 'agent_pfso' AND installation_id IS NOT NULL) OR
        (role != 'agent_pfso')
    )
);

-- Indexes
CREATE INDEX idx_rso_users_tenant_id ON rso_users(tenant_id);
CREATE INDEX idx_rso_users_email ON rso_users(email);
CREATE INDEX idx_rso_users_username ON rso_users(username);
CREATE INDEX idx_rso_users_role ON rso_users(role);
CREATE INDEX idx_rso_users_statut ON rso_users(statut);
CREATE INDEX idx_rso_users_installation_id ON rso_users(installation_id);
CREATE INDEX idx_rso_users_password_reset_token ON rso_users(password_reset_token) WHERE password_reset_token IS NOT NULL;
```

**Field Descriptions**:
- `id`: Primary key, auto-incrementing integer
- `tenant_id`: Foreign key to `tenants` table (ASPCI tenant only for RSO module)
- `username`: Unique username for login (5-20 characters, alphanumeric + underscore)
- `nom`: Last name (max 100 characters)
- `prenoms`: First names (max 100 characters)
- `email`: Unique email address (validated format, max 150 characters)
- `telephone`: Phone number (optional, international format: +225...)
- `password`: bcrypt hashed password (cost factor 12, never stored in plain text)
- `role`: User role enum ('administrateur', 'rso_formateur', 'agent_pfso', 'agent_surete')
- `statut`: Account status ('actif', 'inactif', 'suspendu')
- `installation_id`: Foreign key to port facility installation (required for agent_pfso, NULL for others)
- `created_by`: Foreign key to `rso_users.id` (tracks who created this account)
- `created_at`: Account creation timestamp
- `updated_at`: Last update timestamp (auto-updated)
- `last_login`: Last successful login timestamp (NULL if never logged in)
- `password_reset_token`: Token for password reset (NULL when not resetting, hashed)
- `password_reset_expires`: Expiration timestamp for password reset token (1 hour validity)

**Validation Rules**:
- Username: 5-20 characters, alphanumeric + underscore, unique per tenant
- Email: Valid email format, unique per tenant
- Password: Minimum 8 characters, 1 uppercase, 1 lowercase, 1 digit, 1 special character (validated before hashing)
- Role: Must be one of the 4 allowed roles
- Installation: Required for `agent_pfso` role, NULL for others

**State Transitions**:
- `statut`: 'actif' ↔ 'inactif' ↔ 'suspendu' (admin can change status)
- `password_reset_token`: NULL → (token set) → NULL (after reset or expiration)

---

### Table: `rso_user_sessions`

**Purpose**: Tracks active user sessions for authentication and security monitoring.

**Schema**:
```sql
CREATE TABLE rso_user_sessions (
    id INT PRIMARY KEY GENERATED ALWAYS AS IDENTITY,
    user_id INT NOT NULL REFERENCES rso_users(id) ON DELETE CASCADE,
    token VARCHAR(500) UNIQUE NOT NULL,  -- JWT token (stored for blacklist/revocation)
    ip_address VARCHAR(45) NOT NULL,  -- Supports IPv4 and IPv6
    user_agent TEXT,
    login_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP NOT NULL,
    logout_at TIMESTAMP WITH TIME ZONE NULL,
    expires_at TIMESTAMP WITH TIME ZONE NOT NULL,
    statut VARCHAR(20) NOT NULL DEFAULT 'active' CHECK (statut IN ('active', 'expired', 'logout')),
    
    CONSTRAINT rso_sessions_token_unique UNIQUE (token)
);

-- Indexes
CREATE INDEX idx_rso_sessions_user_id ON rso_user_sessions(user_id);
CREATE INDEX idx_rso_sessions_token ON rso_user_sessions(token);
CREATE INDEX idx_rso_sessions_statut ON rso_user_sessions(statut);
CREATE INDEX idx_rso_sessions_expires_at ON rso_user_sessions(expires_at);
CREATE INDEX idx_rso_sessions_active ON rso_user_sessions(user_id, statut) WHERE statut = 'active';
```

**Field Descriptions**:
- `id`: Primary key, auto-incrementing integer
- `user_id`: Foreign key to `rso_users` (who owns this session)
- `token`: JWT token string (stored for blacklist/revocation checks)
- `ip_address`: Client IP address (IPv4 or IPv6 format)
- `user_agent`: Browser/client user agent string
- `login_at`: Session creation timestamp
- `logout_at`: Session end timestamp (NULL if still active or expired)
- `expires_at`: Token expiration timestamp (8 hours default, 30 days with "remember me")
- `statut`: Session status ('active', 'expired', 'logout')

**State Transitions**:
- `statut`: 'active' → 'expired' (automatic on expiration) or 'logout' (explicit logout)
- `logout_at`: NULL → (timestamp) (set on logout or expiration)

---

### Table: `rso_activity_logs`

**Purpose**: Comprehensive audit trail for all security-related actions, required for ISPS code compliance.

**Schema**:
```sql
CREATE TABLE rso_activity_logs (
    id INT PRIMARY KEY GENERATED ALWAYS AS IDENTITY,
    user_id INT NULL REFERENCES rso_users(id) ON DELETE SET NULL,  -- NULL for system actions
    action VARCHAR(100) NOT NULL,  -- e.g., 'login', 'logout', 'create_user', 'update_user', 'delete_user', 'change_password', 'unauthorized_access'
    entity_type VARCHAR(50) NULL,  -- e.g., 'activite', 'installation', 'incident', 'user'
    entity_id INT NULL,  -- ID of affected entity (if applicable)
    description TEXT,  -- Human-readable description of action
    ip_address VARCHAR(45) NOT NULL,
    user_agent TEXT,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP NOT NULL,
    
    CONSTRAINT rso_logs_action_not_empty CHECK (LENGTH(TRIM(action)) > 0)
);

-- Indexes
CREATE INDEX idx_rso_logs_user_id ON rso_activity_logs(user_id);
CREATE INDEX idx_rso_logs_action ON rso_activity_logs(action);
CREATE INDEX idx_rso_logs_entity ON rso_activity_logs(entity_type, entity_id) WHERE entity_type IS NOT NULL;
CREATE INDEX idx_rso_logs_created_at ON rso_activity_logs(created_at DESC);
CREATE INDEX idx_rso_logs_user_action ON rso_activity_logs(user_id, action, created_at DESC);
```

**Field Descriptions**:
- `id`: Primary key, auto-incrementing integer
- `user_id`: Foreign key to `rso_users` (who performed action, NULL for system actions)
- `action`: Action type (e.g., 'login', 'create_user', 'unauthorized_access')
- `entity_type`: Type of entity affected (e.g., 'user', 'activite', 'installation')
- `entity_id`: ID of affected entity (if applicable)
- `description`: Human-readable description (e.g., "Created user: John Doe (agent_pfso)")
- `ip_address`: Client IP address
- `user_agent`: Browser/client user agent string
- `created_at`: Action timestamp

**Common Actions**:
- Authentication: 'login', 'logout', 'login_failed', 'password_reset_requested', 'password_reset_completed', 'password_changed'
- User Management: 'create_user', 'update_user', 'delete_user', 'activate_user', 'deactivate_user', 'suspend_user'
- Security: 'unauthorized_access', 'permission_denied', 'session_expired', 'token_refreshed'

---

### Table: `rso_permissions`

**Purpose**: Defines role-based permissions for different modules and actions.

**Schema**:
```sql
CREATE TABLE rso_permissions (
    id INT PRIMARY KEY GENERATED ALWAYS AS IDENTITY,
    role VARCHAR(50) NOT NULL CHECK (role IN ('administrateur', 'rso_formateur', 'agent_pfso', 'agent_surete')),
    module VARCHAR(50) NOT NULL,  -- e.g., 'gestion_activites', 'gestion_incidents', 'gestion_utilisateurs', 'gestion_installations'
    can_create BOOLEAN NOT NULL DEFAULT FALSE,
    can_read BOOLEAN NOT NULL DEFAULT FALSE,
    can_update BOOLEAN NOT NULL DEFAULT FALSE,
    can_delete BOOLEAN NOT NULL DEFAULT FALSE,
    
    CONSTRAINT rso_permissions_role_module_unique UNIQUE (role, module),
    CONSTRAINT rso_permissions_at_least_one_action CHECK (
        can_create = TRUE OR can_read = TRUE OR can_update = TRUE OR can_delete = TRUE
    )
);

-- Indexes
CREATE INDEX idx_rso_permissions_role ON rso_permissions(role);
CREATE INDEX idx_rso_permissions_module ON rso_permissions(module);
```

**Field Descriptions**:
- `id`: Primary key, auto-incrementing integer
- `role`: User role (one of the 4 RSO roles)
- `module`: Module name (e.g., 'gestion_activites', 'gestion_incidents')
- `can_create`: Permission to create resources in this module
- `can_read`: Permission to read resources in this module
- `can_update`: Permission to update resources in this module
- `can_delete`: Permission to delete resources in this module

**Default Permissions** (to be seeded):

| Role | Module | Create | Read | Update | Delete |
|------|--------|--------|------|--------|--------|
| administrateur | gestion_utilisateurs | ✅ | ✅ | ✅ | ✅ |
| administrateur | gestion_activites | ✅ | ✅ | ✅ | ✅ |
| administrateur | gestion_installations | ✅ | ✅ | ✅ | ✅ |
| administrateur | gestion_incidents | ✅ | ✅ | ✅ | ✅ |
| rso_formateur | gestion_utilisateurs | ✅ (PFSO only) | ✅ | ✅ (PFSO only) | ❌ |
| rso_formateur | gestion_activites | ✅ | ✅ | ✅ | ✅ |
| rso_formateur | gestion_installations | ✅ | ✅ | ✅ | ✅ |
| agent_pfso | gestion_activites | ❌ | ✅ (own installation) | ❌ | ❌ |
| agent_surete | gestion_incidents | ✅ | ✅ (own incidents) | ✅ (own incidents) | ❌ |

---

### Table: `rso_installations` (Phase 2 Preview)

**Purpose**: Port facility installations (Abidjan, San-Pedro). Referenced in Phase 1 for PFSO agent assignment.

**Schema** (for reference, to be created in Phase 2):
```sql
CREATE TABLE rso_installations (
    id INT PRIMARY KEY GENERATED ALWAYS AS IDENTITY,
    tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    nom VARCHAR(200) NOT NULL,  -- e.g., "Port de commerce d'Abidjan"
    code VARCHAR(50) UNIQUE NOT NULL,  -- e.g., "ABJ-PORT"
    ville VARCHAR(100) NOT NULL,  -- e.g., "Abidjan"
    pays VARCHAR(100) NOT NULL DEFAULT 'Côte d''Ivoire',
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP NOT NULL,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP NOT NULL,
    
    CONSTRAINT rso_installations_tenant_code_unique UNIQUE (tenant_id, code)
);
```

**Note**: This table will be created in Phase 2, but Phase 1 needs the foreign key reference in `rso_users.installation_id`.

---

## Entity Relationships

```
tenants (existing)
    ↓ (1:N)
rso_users
    ├── (1:N) → rso_user_sessions
    ├── (1:N) → rso_activity_logs
    └── (N:1) → rso_users (created_by, self-reference)
    └── (N:1) → rso_installations (installation_id, Phase 2)

rso_permissions (standalone, referenced by role)
```

## Row Level Security (RLS) Policies

All `rso_*` tables must have RLS enabled to enforce tenant isolation:

```sql
-- Enable RLS on all RSO tables
ALTER TABLE rso_users ENABLE ROW LEVEL SECURITY;
ALTER TABLE rso_user_sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE rso_activity_logs ENABLE ROW LEVEL SECURITY;
ALTER TABLE rso_permissions ENABLE ROW LEVEL SECURITY;

-- RLS Policy: Users can only access RSO data for their tenant
CREATE POLICY rso_users_tenant_isolation ON rso_users
    FOR ALL
    USING (tenant_id = current_setting('app.tenant_id')::UUID);

CREATE POLICY rso_sessions_tenant_isolation ON rso_user_sessions
    FOR ALL
    USING (
        EXISTS (
            SELECT 1 FROM rso_users
            WHERE rso_users.id = rso_user_sessions.user_id
            AND rso_users.tenant_id = current_setting('app.tenant_id')::UUID
        )
    );

CREATE POLICY rso_logs_tenant_isolation ON rso_activity_logs
    FOR ALL
    USING (
        user_id IS NULL OR
        EXISTS (
            SELECT 1 FROM rso_users
            WHERE rso_users.id = rso_activity_logs.user_id
            AND rso_users.tenant_id = current_setting('app.tenant_id')::UUID
        )
    );

-- Permissions table is shared across tenants (same permissions for all)
-- But can be filtered by role in application logic
```

## Data Validation Rules

### User Account Creation
1. **Username**: 5-20 characters, alphanumeric + underscore, unique per tenant
2. **Email**: Valid email format, unique per tenant
3. **Password**: Minimum 8 characters, 1 uppercase, 1 lowercase, 1 digit, 1 special character
4. **Role**: Must be one of: 'administrateur', 'rso_formateur', 'agent_pfso', 'agent_surete'
5. **Installation**: Required for `agent_pfso` role, must exist in `rso_installations` (Phase 2)

### Session Management
1. **Token**: JWT token, unique, stored for blacklist checks
2. **Expiration**: Default 8 hours, 30 days with "remember me"
3. **Status**: 'active' → 'expired' (automatic) or 'logout' (explicit)

### Activity Logging
1. **Action**: Required, non-empty string
2. **User ID**: NULL allowed for system actions
3. **Entity**: Optional, but if `entity_type` provided, `entity_id` should be provided

## Migration Strategy

1. **Create tables**: Run migration script to create all `rso_*` tables
2. **Enable RLS**: Apply RLS policies for tenant isolation
3. **Seed permissions**: Insert default permission matrix
4. **Seed test users**: Create test accounts (admin, formateur, agent_pfso, agent_surete)
5. **Verify**: Test tenant isolation and RLS policies

## Indexes Summary

**Performance-Critical Indexes**:
- `rso_users`: email, username, tenant_id, role, statut
- `rso_user_sessions`: user_id, token, statut, expires_at
- `rso_activity_logs`: user_id, action, created_at (DESC), entity (composite)
- `rso_permissions`: role, module (composite unique)

**Query Optimization**:
- User lookup by email/username: `idx_rso_users_email`, `idx_rso_users_username`
- Active sessions: `idx_rso_sessions_active` (partial index on active status)
- Activity log queries: `idx_rso_logs_user_action` (composite for filtering)
- Permission checks: `idx_rso_permissions_role` (fast role-based lookups)

