import { FastifyInstance } from "fastify";
import { z } from "zod";
import bcrypt from "bcryptjs";

interface AuthenticatedRequest {
  tenantId?: string;
  user?: {
    id: string;
    email: string;
    roles?: string[];
  };
  headers?: any;
  query?: any;
  params?: any;
  body?: any;
}

// Verify parent user access utility
// Checks that authenticated user ID matches parent ID and user has parent role
// Returns userId and tenantId if authorized, otherwise sends error response and returns null
async function verifyParentUserAccess(
  request: AuthenticatedRequest,
  reply: any
): Promise<{ userId: string; tenantId: string } | null> {
  const tenantId = request.tenantId;
  const userId = (request.user?.id || (request.headers as any)?.['x-user-id']) as string;

  if (!tenantId) {
    reply.status(400).send({
      success: false,
      error: 'Tenant Required',
      message: 'This endpoint requires tenant context',
    });
    return null;
  }

  if (!userId) {
    reply.status(401).send({
      success: false,
      error: 'Authentication Required',
      message: 'User ID is required',
    });
    return null;
  }

  // Check if user has parent role
  const userRoles = request.user?.roles || [];
  if (!userRoles.includes('parent')) {
    reply.status(403).send({
      success: false,
      error: 'Forbidden',
      message: 'This endpoint requires parent role',
    });
    return null;
  }

  // For parent-settings, the authenticated user IS the parent
  // So userId === parentId is always true
  // We just need to verify the user exists in the tenant
  return {
    userId,
    tenantId,
  };
}

export async function parentSettingsRoutes(fastify: FastifyInstance) {
  const pool = fastify.pg as any;

  // GET /api/v1/parent/settings/profile - Get parent profile information
  fastify.get('/profile', {
    schema: {
      tags: ['Parent Settings'],
      summary: 'Get parent profile information',
      response: {
        200: {
          type: 'object',
          properties: {
            success: { type: 'boolean' },
            data: {
              type: 'object',
              properties: {
                profile: {
                  type: 'object',
                  properties: {
                    id: { type: 'string', format: 'uuid' },
                    email: { type: 'string' },
                    firstName: { type: 'string' },
                    lastName: { type: 'string' },
                    name: { type: 'string', nullable: true },
                    phone: { type: 'string', nullable: true },
                    address: { type: 'string', nullable: true },
                    dateOfBirth: { type: 'string', nullable: true },
                    profilePictureUrl: { type: 'string', nullable: true },
                    createdAt: { type: 'string' },
                    updatedAt: { type: 'string' },
                  },
                },
              },
            },
          },
        },
        401: {
          type: 'object',
          properties: {
            success: { type: 'boolean' },
            error: { type: 'string' },
            message: { type: 'string' },
          },
        },
        403: {
          type: 'object',
          properties: {
            success: { type: 'boolean' },
            error: { type: 'string' },
            message: { type: 'string' },
          },
        },
      },
    },
    handler: async (request: AuthenticatedRequest, reply) => {
      const auth = await verifyParentUserAccess(request, reply);
      if (!auth) return;

      const { userId, tenantId } = auth;

      try {
        // Set tenant context for RLS
        await pool.query('SELECT set_config($1, $2, true)', ['app.tenant_id', tenantId]);

        // Query parent profile from users table
        // Note: phone, address, date_of_birth, profile_picture_url columns don't exist in users table yet
        // Only selecting columns that exist: id, email, first_name, last_name, name, created_at, updated_at
        const profileQuery = `
          SELECT 
            u.id,
            u.email,
            u.first_name,
            u.last_name,
            u.name,
            u.created_at,
            u.updated_at
          FROM users u
          WHERE u.id = $1 AND u.tenant_id = $2
        `;

        const profileResult = await pool.query(profileQuery, [userId, tenantId]);

        if (profileResult.rows.length === 0) {
          return reply.status(404).send({
            success: false,
            error: 'Not Found',
            message: 'Parent profile not found',
          });
        }

        const row = profileResult.rows[0];

        const profile = {
          id: row.id,
          email: row.email,
          firstName: row.first_name || '',
          lastName: row.last_name || '',
          name: row.name || `${row.first_name || ''} ${row.last_name || ''}`.trim(),
          phone: null, // Column doesn't exist in users table yet
          address: null, // Column doesn't exist in users table yet
          dateOfBirth: null, // Column doesn't exist in users table yet
          profilePictureUrl: null, // Column doesn't exist in users table yet
          createdAt: new Date(row.created_at).toISOString(),
          updatedAt: new Date(row.updated_at).toISOString(),
        };

        return reply.send({
          success: true,
          data: {
            profile,
          },
        });
      } catch (error: any) {
        fastify.log.error({
          msg: 'Error fetching parent profile',
          error: error.message,
          stack: error.stack,
          userId,
          tenantId,
        });
        return reply.status(500).send({
          success: false,
          error: 'Internal Server Error',
          message: 'An error occurred while fetching parent profile',
        });
      }
    },
  });

  // PUT /api/v1/parent/settings/profile - Update parent profile information
  fastify.put('/profile', {
    schema: {
      tags: ['Parent Settings'],
      summary: 'Update parent profile information',
      body: {
        type: 'object',
        required: ['firstName', 'lastName'],
        properties: {
          firstName: { type: 'string', minLength: 1 },
          lastName: { type: 'string', minLength: 1 },
          phone: { type: 'string', nullable: true },
          address: { type: 'string', nullable: true },
          dateOfBirth: { type: 'string', nullable: true },
        },
      },
      response: {
        200: {
          type: 'object',
          properties: {
            success: { type: 'boolean' },
            data: {
              type: 'object',
              properties: {
                profile: {
                  type: 'object',
                  properties: {
                    id: { type: 'string', format: 'uuid' },
                    email: { type: 'string' },
                    firstName: { type: 'string' },
                    lastName: { type: 'string' },
                    name: { type: 'string', nullable: true },
                    phone: { type: 'string', nullable: true },
                    address: { type: 'string', nullable: true },
                    dateOfBirth: { type: 'string', nullable: true },
                    profilePictureUrl: { type: 'string', nullable: true },
                    updatedAt: { type: 'string' },
                  },
                },
              },
            },
          },
        },
        400: {
          type: 'object',
          properties: {
            success: { type: 'boolean' },
            error: { type: 'string' },
            message: { type: 'string' },
          },
        },
        401: {
          type: 'object',
          properties: {
            success: { type: 'boolean' },
            error: { type: 'string' },
            message: { type: 'string' },
          },
        },
        403: {
          type: 'object',
          properties: {
            success: { type: 'boolean' },
            error: { type: 'string' },
            message: { type: 'string' },
          },
        },
      },
    },
    handler: async (request: AuthenticatedRequest, reply) => {
      const auth = await verifyParentUserAccess(request, reply);
      if (!auth) return;

      const { userId, tenantId } = auth;
      const body = request.body as {
        firstName: string;
        lastName: string;
        phone?: string | null;
        address?: string | null;
        dateOfBirth?: string | null;
      };

      // Validate input
      if (!body.firstName || !body.lastName) {
        return reply.status(400).send({
          success: false,
          error: 'Validation Error',
          message: 'First name and last name are required',
        });
      }

      // Validate phone format if provided
      if (body.phone && body.phone.trim() !== '') {
        const phoneRegex = /^[\d\s\-\+\(\)]+$/;
        if (!phoneRegex.test(body.phone)) {
          return reply.status(400).send({
            success: false,
            error: 'Validation Error',
            message: 'Invalid phone number format',
          });
        }
      }

      // Validate date of birth format if provided
      if (body.dateOfBirth && body.dateOfBirth.trim() !== '') {
        const dateRegex = /^\d{4}-\d{2}-\d{2}/;
        if (!dateRegex.test(body.dateOfBirth)) {
          return reply.status(400).send({
            success: false,
            error: 'Validation Error',
            message: 'Invalid date of birth format. Use ISO date format (YYYY-MM-DD)',
          });
        }
      }

      try {
        // Set tenant context for RLS
        await pool.query('SELECT set_config($1, $2, true)', ['app.tenant_id', tenantId]);

        // Update parent profile
        // Note: phone, address, date_of_birth columns don't exist in users table yet
        // Only updating columns that exist: first_name, last_name, updated_at
        const updateQuery = `
          UPDATE users
          SET 
            first_name = $1,
            last_name = $2,
            updated_at = NOW()
          WHERE id = $3 AND tenant_id = $4
          RETURNING 
            id,
            email,
            first_name,
            last_name,
            name,
            created_at,
            updated_at
        `;

        const updateResult = await pool.query(updateQuery, [
          body.firstName,
          body.lastName,
          userId,
          tenantId,
        ]);

        if (updateResult.rows.length === 0) {
          return reply.status(404).send({
            success: false,
            error: 'Not Found',
            message: 'Parent profile not found',
          });
        }

        const row = updateResult.rows[0];

        const profile = {
          id: row.id,
          email: row.email,
          firstName: row.first_name || '',
          lastName: row.last_name || '',
          name: row.name || `${row.first_name || ''} ${row.last_name || ''}`.trim(),
          phone: null, // Column doesn't exist in users table yet
          address: null, // Column doesn't exist in users table yet
          dateOfBirth: null, // Column doesn't exist in users table yet
          profilePictureUrl: null, // Column doesn't exist in users table yet
          updatedAt: new Date(row.updated_at).toISOString(),
        };

        return reply.send({
          success: true,
          data: {
            profile,
          },
        });
      } catch (error: any) {
        fastify.log.error({
          msg: 'Error updating parent profile',
          error: error.message,
          stack: error.stack,
          userId,
          tenantId,
        });
        return reply.status(500).send({
          success: false,
          error: 'Internal Server Error',
          message: 'An error occurred while updating parent profile',
        });
      }
    },
  });

  // GET /api/v1/parent/settings/contact - Get contact information
  fastify.get('/contact', {
    schema: {
      tags: ['Parent Settings'],
      summary: 'Get contact information',
      response: {
        200: {
          type: 'object',
          properties: {
            success: { type: 'boolean' },
            data: {
              type: 'object',
              properties: {
                contact: {
                  type: 'object',
                  properties: {
                    phone: { type: 'string', nullable: true },
                    email: { type: 'string' },
                    address: { type: 'string', nullable: true },
                  },
                },
              },
            },
          },
        },
        401: {
          type: 'object',
          properties: {
            success: { type: 'boolean' },
            error: { type: 'string' },
            message: { type: 'string' },
          },
        },
        403: {
          type: 'object',
          properties: {
            success: { type: 'boolean' },
            error: { type: 'string' },
            message: { type: 'string' },
          },
        },
      },
    },
    handler: async (request: AuthenticatedRequest, reply) => {
      const auth = await verifyParentUserAccess(request, reply);
      if (!auth) return;

      const { userId, tenantId } = auth;

      try {
        // Set tenant context for RLS
        await pool.query('SELECT set_config($1, $2, true)', ['app.tenant_id', tenantId]);

        // Query contact information from users table
        // Note: phone, address columns don't exist in users table yet
        // Only selecting columns that exist: email
        const contactQuery = `
          SELECT 
            u.email
          FROM users u
          WHERE u.id = $1 AND u.tenant_id = $2
        `;

        const contactResult = await pool.query(contactQuery, [userId, tenantId]);

        if (contactResult.rows.length === 0) {
          return reply.status(404).send({
            success: false,
            error: 'Not Found',
            message: 'Parent contact information not found',
          });
        }

        const row = contactResult.rows[0];

        const contact = {
          phone: null, // Column doesn't exist in users table yet
          email: row.email,
          address: null, // Column doesn't exist in users table yet
        };

        return reply.send({
          success: true,
          data: {
            contact,
          },
        });
      } catch (error: any) {
        fastify.log.error({
          msg: 'Error fetching contact information',
          error: error.message,
          stack: error.stack,
          userId,
          tenantId,
        });
        return reply.status(500).send({
          success: false,
          error: 'Internal Server Error',
          message: 'An error occurred while fetching contact information',
        });
      }
    },
  });

  // PUT /api/v1/parent/settings/contact - Update contact information
  fastify.put('/contact', {
    schema: {
      tags: ['Parent Settings'],
      summary: 'Update contact information',
      body: {
        type: 'object',
        required: ['email'],
        properties: {
          phone: { type: 'string', nullable: true },
          email: { type: 'string', format: 'email' },
          address: { type: 'string', nullable: true },
        },
      },
      response: {
        200: {
          type: 'object',
          properties: {
            success: { type: 'boolean' },
            data: {
              type: 'object',
              properties: {
                contact: {
                  type: 'object',
                  properties: {
                    phone: { type: 'string', nullable: true },
                    email: { type: 'string' },
                    address: { type: 'string', nullable: true },
                  },
                },
              },
            },
          },
        },
        400: {
          type: 'object',
          properties: {
            success: { type: 'boolean' },
            error: { type: 'string' },
            message: { type: 'string' },
          },
        },
        401: {
          type: 'object',
          properties: {
            success: { type: 'boolean' },
            error: { type: 'string' },
            message: { type: 'string' },
          },
        },
        403: {
          type: 'object',
          properties: {
            success: { type: 'boolean' },
            error: { type: 'string' },
            message: { type: 'string' },
          },
        },
      },
    },
    handler: async (request: AuthenticatedRequest, reply) => {
      const auth = await verifyParentUserAccess(request, reply);
      if (!auth) return;

      const { userId, tenantId } = auth;
      const body = request.body as {
        phone?: string | null;
        email: string;
        address?: string | null;
      };

      // Validate input
      if (!body.email) {
        return reply.status(400).send({
          success: false,
          error: 'Validation Error',
          message: 'Email is required',
        });
      }

      // Validate email format
      const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
      if (!emailRegex.test(body.email)) {
        return reply.status(400).send({
          success: false,
          error: 'Validation Error',
          message: 'Invalid email format',
        });
      }

      // Validate phone format if provided
      if (body.phone && body.phone.trim() !== '') {
        const phoneRegex = /^[\d\s\-\+\(\)]+$/;
        if (!phoneRegex.test(body.phone)) {
          return reply.status(400).send({
            success: false,
            error: 'Validation Error',
            message: 'Invalid phone number format',
          });
        }
      }

      try {
        // Set tenant context for RLS
        await pool.query('SELECT set_config($1, $2, true)', ['app.tenant_id', tenantId]);

        // Update contact information
        // Note: phone, address columns don't exist in users table yet
        // Only updating email for now
        const updateQuery = `
          UPDATE users
          SET 
            email = $1,
            updated_at = NOW()
          WHERE id = $2 AND tenant_id = $3
          RETURNING 
            email
        `;

        const updateResult = await pool.query(updateQuery, [
          body.email,
          userId,
          tenantId,
        ]);

        if (updateResult.rows.length === 0) {
          return reply.status(404).send({
            success: false,
            error: 'Not Found',
            message: 'Parent contact information not found',
          });
        }

        const row = updateResult.rows[0];

        const contact = {
          phone: null, // Column doesn't exist in users table yet
          email: row.email,
          address: null, // Column doesn't exist in users table yet
        };

        return reply.send({
          success: true,
          data: {
            contact,
          },
        });
      } catch (error: any) {
        fastify.log.error({
          msg: 'Error updating contact information',
          error: error.message,
          stack: error.stack,
          userId,
          tenantId,
        });
        return reply.status(500).send({
          success: false,
          error: 'Internal Server Error',
          message: 'An error occurred while updating contact information',
        });
      }
    },
  });

  // GET /api/v1/parent/settings/emergency-contacts - Get emergency contacts
  fastify.get('/emergency-contacts', {
    schema: {
      tags: ['Parent Settings'],
      summary: 'Get emergency contacts for the authenticated parent',
      response: {
        200: {
          type: 'object',
          properties: {
            success: { type: 'boolean' },
            data: {
              type: 'object',
              properties: {
                contacts: {
                  type: 'array',
                  items: {
                    type: 'object',
                    properties: {
                      id: { type: 'string', format: 'uuid' },
                      contactName: { type: 'string' },
                      relationship: { type: 'string' },
                      phone: { type: 'string' },
                      email: { type: 'string', nullable: true },
                      createdAt: { type: 'string' },
                      updatedAt: { type: 'string' },
                    },
                  },
                },
              },
            },
          },
        },
        401: {
          type: 'object',
          properties: {
            success: { type: 'boolean' },
            error: { type: 'string' },
            message: { type: 'string' },
          },
        },
        403: {
          type: 'object',
          properties: {
            success: { type: 'boolean' },
            error: { type: 'string' },
            message: { type: 'string' },
          },
        },
      },
    },
    handler: async (request: AuthenticatedRequest, reply) => {
      const auth = await verifyParentUserAccess(request, reply);
      if (!auth) return;

      const { userId, tenantId } = auth;

      try {
        // Set tenant context for RLS
        await pool.query('SELECT set_config($1, $2, true)', ['app.tenant_id', tenantId]);

        // Query emergency contacts from emergency_contacts table
        // Note: Table may not exist yet - will return empty array if table doesn't exist
        const contactsQuery = `
          SELECT 
            ec.id,
            ec.contact_name,
            ec.relationship,
            ec.phone,
            ec.email,
            ec.created_at,
            ec.updated_at
          FROM emergency_contacts ec
          WHERE ec.parent_id = $1 AND ec.tenant_id = $2
          ORDER BY ec.created_at ASC
        `;

        const contactsResult = await pool.query(contactsQuery, [userId, tenantId]);

        const contacts = contactsResult.rows.map((row: any) => ({
          id: row.id,
          contactName: row.contact_name,
          relationship: row.relationship,
          phone: row.phone,
          email: row.email || null,
          createdAt: new Date(row.created_at).toISOString(),
          updatedAt: new Date(row.updated_at).toISOString(),
        }));

        return reply.send({
          success: true,
          data: {
            contacts,
          },
        });
      } catch (error: any) {
        // If table doesn't exist, return empty array
        if (error.message && error.message.includes('does not exist')) {
          return reply.send({
            success: true,
            data: {
              contacts: [],
            },
          });
        }
        
        fastify.log.error({
          msg: 'Error fetching emergency contacts',
          error: error.message,
          stack: error.stack,
          userId,
          tenantId,
        });
        return reply.status(500).send({
          success: false,
          error: 'Internal Server Error',
          message: 'An error occurred while fetching emergency contacts',
        });
      }
    },
  });

  // POST /api/v1/parent/settings/emergency-contacts - Add emergency contact
  fastify.post('/emergency-contacts', {
    schema: {
      tags: ['Parent Settings'],
      summary: 'Add a new emergency contact',
      body: {
        type: 'object',
        required: ['contactName', 'relationship', 'phone'],
        properties: {
          contactName: { type: 'string', minLength: 1 },
          relationship: { type: 'string', minLength: 1 },
          phone: { type: 'string', minLength: 1 },
          email: { type: 'string', nullable: true },
        },
      },
      response: {
        200: {
          type: 'object',
          properties: {
            success: { type: 'boolean' },
            data: {
              type: 'object',
              properties: {
                contact: {
                  type: 'object',
                  properties: {
                    id: { type: 'string', format: 'uuid' },
                    contactName: { type: 'string' },
                    relationship: { type: 'string' },
                    phone: { type: 'string' },
                    email: { type: 'string', nullable: true },
                    createdAt: { type: 'string' },
                    updatedAt: { type: 'string' },
                  },
                },
              },
            },
          },
        },
        400: {
          type: 'object',
          properties: {
            success: { type: 'boolean' },
            error: { type: 'string' },
            message: { type: 'string' },
          },
        },
        401: {
          type: 'object',
          properties: {
            success: { type: 'boolean' },
            error: { type: 'string' },
            message: { type: 'string' },
          },
        },
        403: {
          type: 'object',
          properties: {
            success: { type: 'boolean' },
            error: { type: 'string' },
            message: { type: 'string' },
          },
        },
      },
    },
    handler: async (request: AuthenticatedRequest, reply) => {
      const auth = await verifyParentUserAccess(request, reply);
      if (!auth) return;

      const { userId, tenantId } = auth;
      const body = request.body as {
        contactName: string;
        relationship: string;
        phone: string;
        email?: string | null;
      };

      // Validate input
      if (!body.contactName || body.contactName.trim() === '') {
        return reply.status(400).send({
          success: false,
          error: 'Validation Error',
          message: 'Contact name is required',
        });
      }

      if (!body.relationship || body.relationship.trim() === '') {
        return reply.status(400).send({
          success: false,
          error: 'Validation Error',
          message: 'Relationship is required',
        });
      }

      if (!body.phone || body.phone.trim() === '') {
        return reply.status(400).send({
          success: false,
          error: 'Validation Error',
          message: 'Phone number is required',
        });
      }

      // Validate phone format
      const phoneRegex = /^[\d\s\-\+\(\)]+$/;
      if (!phoneRegex.test(body.phone)) {
        return reply.status(400).send({
          success: false,
          error: 'Validation Error',
          message: 'Invalid phone number format',
        });
      }

      // Validate email format if provided
      if (body.email && body.email.trim() !== '') {
        const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
        if (!emailRegex.test(body.email)) {
          return reply.status(400).send({
            success: false,
            error: 'Validation Error',
            message: 'Invalid email format',
          });
        }
      }

      try {
        // Set tenant context for RLS
        await pool.query('SELECT set_config($1, $2, true)', ['app.tenant_id', tenantId]);

        // Insert new emergency contact
        // Note: Table may not exist yet - will return error if table doesn't exist
        const insertQuery = `
          INSERT INTO emergency_contacts (
            tenant_id,
            parent_id,
            contact_name,
            relationship,
            phone,
            email,
            created_at,
            updated_at
          )
          VALUES ($1, $2, $3, $4, $5, $6, NOW(), NOW())
          RETURNING 
            id,
            contact_name,
            relationship,
            phone,
            email,
            created_at,
            updated_at
        `;

        const insertResult = await pool.query(insertQuery, [
          tenantId,
          userId,
          body.contactName.trim(),
          body.relationship.trim(),
          body.phone.trim(),
          body.email && body.email.trim() !== '' ? body.email.trim() : null,
        ]);

        const row = insertResult.rows[0];

        const contact = {
          id: row.id,
          contactName: row.contact_name,
          relationship: row.relationship,
          phone: row.phone,
          email: row.email || null,
          createdAt: new Date(row.created_at).toISOString(),
          updatedAt: new Date(row.updated_at).toISOString(),
        };

        return reply.send({
          success: true,
          data: {
            contact,
          },
        });
      } catch (error: any) {
        // If table doesn't exist, return error
        if (error.message && error.message.includes('does not exist')) {
          return reply.status(500).send({
            success: false,
            error: 'Table Not Found',
            message: 'Emergency contacts table does not exist. Please create the table first.',
          });
        }
        
        fastify.log.error({
          msg: 'Error creating emergency contact',
          error: error.message,
          stack: error.stack,
          userId,
          tenantId,
        });
        return reply.status(500).send({
          success: false,
          error: 'Internal Server Error',
          message: 'An error occurred while creating emergency contact',
        });
      }
    },
  });

  // PUT /api/v1/parent/settings/emergency-contacts/:contactId - Update emergency contact
  fastify.put('/emergency-contacts/:contactId', {
    schema: {
      tags: ['Parent Settings'],
      summary: 'Update an existing emergency contact',
      params: {
        type: 'object',
        required: ['contactId'],
        properties: {
          contactId: { type: 'string', format: 'uuid' },
        },
      },
      body: {
        type: 'object',
        properties: {
          contactName: { type: 'string', minLength: 1 },
          relationship: { type: 'string', minLength: 1 },
          phone: { type: 'string', minLength: 1 },
          email: { type: 'string', nullable: true },
        },
      },
      response: {
        200: {
          type: 'object',
          properties: {
            success: { type: 'boolean' },
            data: {
              type: 'object',
              properties: {
                contact: {
                  type: 'object',
                  properties: {
                    id: { type: 'string', format: 'uuid' },
                    contactName: { type: 'string' },
                    relationship: { type: 'string' },
                    phone: { type: 'string' },
                    email: { type: 'string', nullable: true },
                    updatedAt: { type: 'string' },
                  },
                },
              },
            },
          },
        },
        400: {
          type: 'object',
          properties: {
            success: { type: 'boolean' },
            error: { type: 'string' },
            message: { type: 'string' },
          },
        },
        401: {
          type: 'object',
          properties: {
            success: { type: 'boolean' },
            error: { type: 'string' },
            message: { type: 'string' },
          },
        },
        403: {
          type: 'object',
          properties: {
            success: { type: 'boolean' },
            error: { type: 'string' },
            message: { type: 'string' },
          },
        },
        404: {
          type: 'object',
          properties: {
            success: { type: 'boolean' },
            error: { type: 'string' },
            message: { type: 'string' },
          },
        },
      },
    },
    handler: async (request: AuthenticatedRequest, reply) => {
      const auth = await verifyParentUserAccess(request, reply);
      if (!auth) return;

      const { userId, tenantId } = auth;
      const { contactId } = request.params as { contactId: string };
      const body = request.body as {
        contactName?: string;
        relationship?: string;
        phone?: string;
        email?: string | null;
      };

      // Validate that at least one field is provided
      if (!body.contactName && !body.relationship && !body.phone && body.email === undefined) {
        return reply.status(400).send({
          success: false,
          error: 'Validation Error',
          message: 'At least one field must be provided for update',
        });
      }

      // Validate phone format if provided
      if (body.phone && body.phone.trim() !== '') {
        const phoneRegex = /^[\d\s\-\+\(\)]+$/;
        if (!phoneRegex.test(body.phone)) {
          return reply.status(400).send({
            success: false,
            error: 'Validation Error',
            message: 'Invalid phone number format',
          });
        }
      }

      // Validate email format if provided
      if (body.email !== undefined && body.email !== null && body.email.trim() !== '') {
        const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
        if (!emailRegex.test(body.email)) {
          return reply.status(400).send({
            success: false,
            error: 'Validation Error',
            message: 'Invalid email format',
          });
        }
      }

      try {
        // Set tenant context for RLS
        await pool.query('SELECT set_config($1, $2, true)', ['app.tenant_id', tenantId]);

        // First verify that the contact belongs to the parent
        const verifyQuery = `
          SELECT id FROM emergency_contacts
          WHERE id = $1 AND parent_id = $2 AND tenant_id = $3
        `;
        const verifyResult = await pool.query(verifyQuery, [contactId, userId, tenantId]);

        if (verifyResult.rows.length === 0) {
          return reply.status(404).send({
            success: false,
            error: 'Not Found',
            message: 'Emergency contact not found or not accessible',
          });
        }

        // Build update query dynamically based on provided fields
        const updateFields: string[] = [];
        const updateValues: any[] = [];
        let paramIndex = 1;

        if (body.contactName !== undefined) {
          updateFields.push(`contact_name = $${paramIndex}`);
          updateValues.push(body.contactName.trim());
          paramIndex++;
        }

        if (body.relationship !== undefined) {
          updateFields.push(`relationship = $${paramIndex}`);
          updateValues.push(body.relationship.trim());
          paramIndex++;
        }

        if (body.phone !== undefined) {
          updateFields.push(`phone = $${paramIndex}`);
          updateValues.push(body.phone.trim());
          paramIndex++;
        }

        if (body.email !== undefined) {
          updateFields.push(`email = $${paramIndex}`);
          updateValues.push(body.email && body.email.trim() !== '' ? body.email.trim() : null);
          paramIndex++;
        }

        updateFields.push(`updated_at = NOW()`);

        // Add WHERE clause parameters
        updateValues.push(contactId);
        updateValues.push(userId);
        updateValues.push(tenantId);

        const updateQuery = `
          UPDATE emergency_contacts
          SET ${updateFields.join(', ')}
          WHERE id = $${paramIndex} AND parent_id = $${paramIndex + 1} AND tenant_id = $${paramIndex + 2}
          RETURNING 
            id,
            contact_name,
            relationship,
            phone,
            email,
            updated_at
        `;

        const updateResult = await pool.query(updateQuery, updateValues);

        if (updateResult.rows.length === 0) {
          return reply.status(404).send({
            success: false,
            error: 'Not Found',
            message: 'Emergency contact not found',
          });
        }

        const row = updateResult.rows[0];

        const contact = {
          id: row.id,
          contactName: row.contact_name,
          relationship: row.relationship,
          phone: row.phone,
          email: row.email || null,
          updatedAt: new Date(row.updated_at).toISOString(),
        };

        return reply.send({
          success: true,
          data: {
            contact,
          },
        });
      } catch (error: any) {
        // If table doesn't exist, return error
        if (error.message && error.message.includes('does not exist')) {
          return reply.status(500).send({
            success: false,
            error: 'Table Not Found',
            message: 'Emergency contacts table does not exist. Please create the table first.',
          });
        }
        
        fastify.log.error({
          msg: 'Error updating emergency contact',
          error: error.message,
          stack: error.stack,
          userId,
          tenantId,
        });
        return reply.status(500).send({
          success: false,
          error: 'Internal Server Error',
          message: 'An error occurred while updating emergency contact',
        });
      }
    },
  });

  // DELETE /api/v1/parent/settings/emergency-contacts/:contactId - Delete emergency contact
  fastify.delete('/emergency-contacts/:contactId', {
    schema: {
      tags: ['Parent Settings'],
      summary: 'Remove an emergency contact',
      params: {
        type: 'object',
        required: ['contactId'],
        properties: {
          contactId: { type: 'string', format: 'uuid' },
        },
      },
      response: {
        200: {
          type: 'object',
          properties: {
            success: { type: 'boolean' },
            data: {
              type: 'object',
              properties: {
                message: { type: 'string' },
              },
            },
          },
        },
        401: {
          type: 'object',
          properties: {
            success: { type: 'boolean' },
            error: { type: 'string' },
            message: { type: 'string' },
          },
        },
        403: {
          type: 'object',
          properties: {
            success: { type: 'boolean' },
            error: { type: 'string' },
            message: { type: 'string' },
          },
        },
        404: {
          type: 'object',
          properties: {
            success: { type: 'boolean' },
            error: { type: 'string' },
            message: { type: 'string' },
          },
        },
      },
    },
    handler: async (request: AuthenticatedRequest, reply) => {
      const auth = await verifyParentUserAccess(request, reply);
      if (!auth) return;

      const { userId, tenantId } = auth;
      const { contactId } = request.params as { contactId: string };

      try {
        // Set tenant context for RLS
        await pool.query('SELECT set_config($1, $2, true)', ['app.tenant_id', tenantId]);

        // Verify that the contact belongs to the parent before deleting
        const verifyQuery = `
          SELECT id FROM emergency_contacts
          WHERE id = $1 AND parent_id = $2 AND tenant_id = $3
        `;
        const verifyResult = await pool.query(verifyQuery, [contactId, userId, tenantId]);

        if (verifyResult.rows.length === 0) {
          return reply.status(404).send({
            success: false,
            error: 'Not Found',
            message: 'Emergency contact not found or not accessible',
          });
        }

        // Delete emergency contact
        const deleteQuery = `
          DELETE FROM emergency_contacts
          WHERE id = $1 AND parent_id = $2 AND tenant_id = $3
        `;

        await pool.query(deleteQuery, [contactId, userId, tenantId]);

        return reply.send({
          success: true,
          data: {
            message: 'Emergency contact removed successfully',
          },
        });
      } catch (error: any) {
        // If table doesn't exist, return error
        if (error.message && error.message.includes('does not exist')) {
          return reply.status(500).send({
            success: false,
            error: 'Table Not Found',
            message: 'Emergency contacts table does not exist. Please create the table first.',
          });
        }
        
        fastify.log.error({
          msg: 'Error deleting emergency contact',
          error: error.message,
          stack: error.stack,
          userId,
          tenantId,
        });
        return reply.status(500).send({
          success: false,
          error: 'Internal Server Error',
          message: 'An error occurred while deleting emergency contact',
        });
      }
    },
  });

  // GET /api/v1/parent/settings/notification-preferences - Get notification preferences
  fastify.get('/notification-preferences', {
    schema: {
      tags: ['Parent Settings'],
      summary: 'Get notification preferences for the authenticated parent',
      response: {
        200: {
          type: 'object',
          properties: {
            success: { type: 'boolean' },
            data: {
              type: 'object',
              properties: {
                preferences: {
                  type: 'array',
                  items: {
                    type: 'object',
                    properties: {
                      id: { type: 'string', format: 'uuid' },
                      notificationType: { type: 'string', enum: ['message', 'announcement', 'event', 'grade', 'payment', 'other'] },
                      enabled: { type: 'boolean' },
                      deliveryMethods: {
                        type: 'array',
                        items: { type: 'string', enum: ['email', 'in-app', 'sms'] },
                      },
                      createdAt: { type: 'string' },
                      updatedAt: { type: 'string' },
                    },
                  },
                },
              },
            },
          },
        },
        401: {
          type: 'object',
          properties: {
            success: { type: 'boolean' },
            error: { type: 'string' },
            message: { type: 'string' },
          },
        },
        403: {
          type: 'object',
          properties: {
            success: { type: 'boolean' },
            error: { type: 'string' },
            message: { type: 'string' },
          },
        },
      },
    },
    handler: async (request: AuthenticatedRequest, reply) => {
      const auth = await verifyParentUserAccess(request, reply);
      if (!auth) return;

      const { userId, tenantId } = auth;

      try {
        // Set tenant context for RLS
        await pool.query('SELECT set_config($1, $2, true)', ['app.tenant_id', tenantId]);

        // Query notification preferences from notification_preferences table
        // Note: Table may not exist yet - will return default preferences if table doesn't exist
        const preferencesQuery = `
          SELECT 
            np.id,
            np.notification_type,
            np.enabled,
            np.delivery_methods,
            np.created_at,
            np.updated_at
          FROM notification_preferences np
          WHERE np.parent_id = $1 AND np.tenant_id = $2
          ORDER BY np.notification_type ASC
        `;

        const preferencesResult = await pool.query(preferencesQuery, [userId, tenantId]);

        // If no preferences exist, return default preferences
        if (preferencesResult.rows.length === 0) {
          const defaultNotificationTypes = ['message', 'announcement', 'event', 'grade', 'payment', 'other'];
          const defaultPreferences = defaultNotificationTypes.map((type) => ({
            id: null,
            notificationType: type,
            enabled: true,
            deliveryMethods: ['email', 'in-app'],
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString(),
          }));

          return reply.send({
            success: true,
            data: {
              preferences: defaultPreferences,
            },
          });
        }

        const preferences = preferencesResult.rows.map((row: any) => ({
          id: row.id,
          notificationType: row.notification_type,
          enabled: row.enabled,
          deliveryMethods: Array.isArray(row.delivery_methods) ? row.delivery_methods : [],
          createdAt: new Date(row.created_at).toISOString(),
          updatedAt: new Date(row.updated_at).toISOString(),
        }));

        return reply.send({
          success: true,
          data: {
            preferences,
          },
        });
      } catch (error: any) {
        // If table doesn't exist, return default preferences
        if (error.message && error.message.includes('does not exist')) {
          const defaultNotificationTypes = ['message', 'announcement', 'event', 'grade', 'payment', 'other'];
          const defaultPreferences = defaultNotificationTypes.map((type) => ({
            id: null,
            notificationType: type,
            enabled: true,
            deliveryMethods: ['email', 'in-app'],
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString(),
          }));

          return reply.send({
            success: true,
            data: {
              preferences: defaultPreferences,
            },
          });
        }
        
        fastify.log.error({
          msg: 'Error fetching notification preferences',
          error: error.message,
          stack: error.stack,
          userId,
          tenantId,
        });
        return reply.status(500).send({
          success: false,
          error: 'Internal Server Error',
          message: 'An error occurred while fetching notification preferences',
        });
      }
    },
  });

  // PUT /api/v1/parent/settings/notification-preferences - Update notification preferences
  fastify.put('/notification-preferences', {
    schema: {
      tags: ['Parent Settings'],
      summary: 'Update notification preferences for the authenticated parent',
      body: {
        type: 'object',
        required: ['preferences'],
        properties: {
          preferences: {
            type: 'array',
            items: {
              type: 'object',
              required: ['notificationType', 'enabled', 'deliveryMethods'],
              properties: {
                notificationType: { type: 'string', enum: ['message', 'announcement', 'event', 'grade', 'payment', 'other'] },
                enabled: { type: 'boolean' },
                deliveryMethods: {
                  type: 'array',
                  items: { type: 'string', enum: ['email', 'in-app', 'sms'] },
                },
              },
            },
          },
        },
      },
      response: {
        200: {
          type: 'object',
          properties: {
            success: { type: 'boolean' },
            data: {
              type: 'object',
              properties: {
                preferences: {
                  type: 'array',
                  items: {
                    type: 'object',
                    properties: {
                      id: { type: 'string', format: 'uuid' },
                      notificationType: { type: 'string', enum: ['message', 'announcement', 'event', 'grade', 'payment', 'other'] },
                      enabled: { type: 'boolean' },
                      deliveryMethods: {
                        type: 'array',
                        items: { type: 'string', enum: ['email', 'in-app', 'sms'] },
                      },
                      updatedAt: { type: 'string' },
                    },
                  },
                },
              },
            },
          },
        },
        400: {
          type: 'object',
          properties: {
            success: { type: 'boolean' },
            error: { type: 'string' },
            message: { type: 'string' },
          },
        },
        401: {
          type: 'object',
          properties: {
            success: { type: 'boolean' },
            error: { type: 'string' },
            message: { type: 'string' },
          },
        },
        403: {
          type: 'object',
          properties: {
            success: { type: 'boolean' },
            error: { type: 'string' },
            message: { type: 'string' },
          },
        },
      },
    },
    handler: async (request: AuthenticatedRequest, reply) => {
      const auth = await verifyParentUserAccess(request, reply);
      if (!auth) return;

      const { userId, tenantId } = auth;
      const body = request.body as {
        preferences: Array<{
          notificationType: string;
          enabled: boolean;
          deliveryMethods: string[];
        }>;
      };

      // Validate input
      if (!body.preferences || !Array.isArray(body.preferences) || body.preferences.length === 0) {
        return reply.status(400).send({
          success: false,
          error: 'Validation Error',
          message: 'Preferences array is required and must not be empty',
        });
      }

      // Validate each preference
      const validNotificationTypes = ['message', 'announcement', 'event', 'grade', 'payment', 'other'];
      const validDeliveryMethods = ['email', 'in-app', 'sms'];

      for (const pref of body.preferences) {
        if (!pref.notificationType || !validNotificationTypes.includes(pref.notificationType)) {
          return reply.status(400).send({
            success: false,
            error: 'Validation Error',
            message: `Invalid notification type: ${pref.notificationType}`,
          });
        }

        if (typeof pref.enabled !== 'boolean') {
          return reply.status(400).send({
            success: false,
            error: 'Validation Error',
            message: 'Enabled must be a boolean value',
          });
        }

        if (!Array.isArray(pref.deliveryMethods)) {
          return reply.status(400).send({
            success: false,
            error: 'Validation Error',
            message: 'Delivery methods must be an array',
          });
        }

        // Validate delivery methods
        for (const method of pref.deliveryMethods) {
          if (!validDeliveryMethods.includes(method)) {
            return reply.status(400).send({
              success: false,
              error: 'Validation Error',
              message: `Invalid delivery method: ${method}`,
            });
          }
        }
      }

      try {
        // Set tenant context for RLS
        await pool.query('SELECT set_config($1, $2, true)', ['app.tenant_id', tenantId]);

        // Use upsert (INSERT ... ON CONFLICT ... UPDATE) to update or create preferences
        // Note: Table may not exist yet - will return error if table doesn't exist
        const updatedPreferences = [];

        for (const pref of body.preferences) {
          const upsertQuery = `
            INSERT INTO notification_preferences (
              tenant_id,
              parent_id,
              notification_type,
              enabled,
              delivery_methods,
              created_at,
              updated_at
            )
            VALUES ($1, $2, $3, $4, $5::jsonb, NOW(), NOW())
            ON CONFLICT (tenant_id, parent_id, notification_type)
            DO UPDATE SET
              enabled = EXCLUDED.enabled,
              delivery_methods = EXCLUDED.delivery_methods,
              updated_at = NOW()
            RETURNING 
              id,
              notification_type,
              enabled,
              delivery_methods,
              updated_at
          `;

          const upsertResult = await pool.query(upsertQuery, [
            tenantId,
            userId,
            pref.notificationType,
            pref.enabled,
            JSON.stringify(pref.deliveryMethods),
          ]);

          const row = upsertResult.rows[0];
          updatedPreferences.push({
            id: row.id,
            notificationType: row.notification_type,
            enabled: row.enabled,
            deliveryMethods: Array.isArray(row.delivery_methods) ? row.delivery_methods : [],
            updatedAt: new Date(row.updated_at).toISOString(),
          });
        }

        return reply.send({
          success: true,
          data: {
            preferences: updatedPreferences,
          },
        });
      } catch (error: any) {
        // If table doesn't exist, return error
        if (error.message && error.message.includes('does not exist')) {
          return reply.status(500).send({
            success: false,
            error: 'Table Not Found',
            message: 'Notification preferences table does not exist. Please create the table first.',
          });
        }
        
        fastify.log.error({
          msg: 'Error updating notification preferences',
          error: error.message,
          stack: error.stack,
          userId,
          tenantId,
        });
        return reply.status(500).send({
          success: false,
          error: 'Internal Server Error',
          message: 'An error occurred while updating notification preferences',
        });
      }
    },
  });

  // GET /api/v1/parent/settings/relationships - Get relationship management information
  fastify.get('/relationships', {
    schema: {
      tags: ['Parent Settings'],
      summary: 'Get relationship management information for the authenticated parent',
      response: {
        200: {
          type: 'object',
          properties: {
            success: { type: 'boolean' },
            data: {
              type: 'object',
              properties: {
                relationships: {
                  type: 'array',
                  items: {
                    type: 'object',
                    properties: {
                      id: { type: 'string', format: 'uuid' },
                      childId: { type: 'string', format: 'uuid' },
                      childName: { type: 'string' },
                      relationshipType: { type: 'string', enum: ['parent', 'guardian', 'emergency_contact'] },
                      isPrimaryContact: { type: 'boolean' },
                      emergencyContact: { type: 'boolean' },
                      canPickup: { type: 'boolean' },
                      notes: { type: 'string', nullable: true },
                      createdAt: { type: 'string' },
                    },
                  },
                },
              },
            },
          },
        },
        401: {
          type: 'object',
          properties: {
            success: { type: 'boolean' },
            error: { type: 'string' },
            message: { type: 'string' },
          },
        },
        403: {
          type: 'object',
          properties: {
            success: { type: 'boolean' },
            error: { type: 'string' },
            message: { type: 'string' },
          },
        },
      },
    },
    handler: async (request: AuthenticatedRequest, reply) => {
      const auth = await verifyParentUserAccess(request, reply);
      if (!auth) return;

      const { userId, tenantId } = auth;

      try {
        // Set tenant context for RLS
        await pool.query('SELECT set_config($1, $2, true)', ['app.tenant_id', tenantId]);

        // Query relationships from student_parents table joined with student_profiles and users
        const relationshipsQuery = `
          SELECT 
            sp_rel.id as relationship_id,
            sp_rel.student_id,
            sp_rel.parent_id,
            sp_rel.relationship_type,
            sp_rel.is_primary_contact,
            sp_rel.emergency_contact,
            sp_rel.can_pickup,
            sp_rel.notes,
            sp_rel.created_at,
            sp.id as child_id,
            COALESCE(u.first_name || ' ' || u.last_name, u.name) as child_name
          FROM student_parents sp_rel
          JOIN student_profiles sp ON sp_rel.student_id = sp.id
          JOIN users u ON sp.user_id = u.id
          WHERE sp_rel.parent_id = $1
            AND sp_rel.tenant_id = $2
          ORDER BY sp_rel.created_at ASC
        `;

        const relationshipsResult = await pool.query(relationshipsQuery, [userId, tenantId]);

        const relationships = relationshipsResult.rows.map((row: any) => ({
          id: row.relationship_id,
          childId: row.child_id,
          childName: row.child_name || 'Nom non disponible',
          relationshipType: row.relationship_type,
          isPrimaryContact: row.is_primary_contact || false,
          emergencyContact: row.emergency_contact || false,
          canPickup: row.can_pickup !== false, // Default to true if null
          notes: row.notes || null,
          createdAt: new Date(row.created_at).toISOString(),
        }));

        return reply.send({
          success: true,
          data: {
            relationships,
          },
        });
      } catch (error: any) {
        fastify.log.error({
          msg: 'Error fetching relationships',
          error: error.message,
          stack: error.stack,
          userId,
          tenantId,
        });
        return reply.status(500).send({
          success: false,
          error: 'Internal Server Error',
          message: 'An error occurred while fetching relationships',
        });
      }
    },
  });

  // POST /api/v1/parent/settings/change-password - Change password
  fastify.post('/change-password', {
    schema: {
      tags: ['Parent Settings'],
      summary: 'Change password for the authenticated parent',
      body: {
        type: 'object',
        required: ['currentPassword', 'newPassword', 'confirmPassword'],
        properties: {
          currentPassword: { type: 'string', minLength: 1 },
          newPassword: { type: 'string', minLength: 1 },
          confirmPassword: { type: 'string', minLength: 1 },
        },
      },
      response: {
        200: {
          type: 'object',
          properties: {
            success: { type: 'boolean' },
            data: {
              type: 'object',
              properties: {
                message: { type: 'string' },
              },
            },
          },
        },
        400: {
          type: 'object',
          properties: {
            success: { type: 'boolean' },
            error: { type: 'string' },
            message: { type: 'string' },
          },
        },
        401: {
          type: 'object',
          properties: {
            success: { type: 'boolean' },
            error: { type: 'string' },
            message: { type: 'string' },
          },
        },
        403: {
          type: 'object',
          properties: {
            success: { type: 'boolean' },
            error: { type: 'string' },
            message: { type: 'string' },
          },
        },
      },
    },
    handler: async (request: AuthenticatedRequest, reply) => {
      const auth = await verifyParentUserAccess(request, reply);
      if (!auth) return;

      const { userId, tenantId } = auth;
      const body = request.body as {
        currentPassword: string;
        newPassword: string;
        confirmPassword: string;
      };

      // Validate input
      if (!body.currentPassword || body.currentPassword.trim() === '') {
        return reply.status(400).send({
          success: false,
          error: 'Validation Error',
          message: 'Current password is required',
        });
      }

      if (!body.newPassword || body.newPassword.trim() === '') {
        return reply.status(400).send({
          success: false,
          error: 'Validation Error',
          message: 'New password is required',
        });
      }

      if (!body.confirmPassword || body.confirmPassword.trim() === '') {
        return reply.status(400).send({
          success: false,
          error: 'Validation Error',
          message: 'Confirm password is required',
        });
      }

      // Validate that new password and confirm password match
      if (body.newPassword !== body.confirmPassword) {
        return reply.status(400).send({
          success: false,
          error: 'Validation Error',
          message: 'New password and confirm password do not match',
        });
      }

      // Validate password requirements (minimum length, complexity)
      if (body.newPassword.length < 8) {
        return reply.status(400).send({
          success: false,
          error: 'Validation Error',
          message: 'New password must be at least 8 characters long',
        });
      }

      // Check password complexity (at least one letter and one number)
      const hasLetter = /[a-zA-Z]/.test(body.newPassword);
      const hasNumber = /[0-9]/.test(body.newPassword);
      if (!hasLetter || !hasNumber) {
        return reply.status(400).send({
          success: false,
          error: 'Validation Error',
          message: 'New password must contain at least one letter and one number',
        });
      }

      // Validate that new password is different from current password
      if (body.currentPassword === body.newPassword) {
        return reply.status(400).send({
          success: false,
          error: 'Validation Error',
          message: 'New password must be different from current password',
        });
      }

      try {
        // Set tenant context for RLS
        await pool.query('SELECT set_config($1, $2, true)', ['app.tenant_id', tenantId]);

        // Get current user password hash
        const userQuery = `
          SELECT id, password_hash
          FROM users
          WHERE id = $1 AND tenant_id = $2
        `;
        const userResult = await pool.query(userQuery, [userId, tenantId]);

        if (userResult.rows.length === 0) {
          return reply.status(404).send({
            success: false,
            error: 'Not Found',
            message: 'User not found',
          });
        }

        const user = userResult.rows[0];

        // Verify current password
        const passwordValid = await bcrypt.compare(body.currentPassword, user.password_hash);
        if (!passwordValid) {
          return reply.status(400).send({
            success: false,
            error: 'Invalid Password',
            message: 'Current password is incorrect',
          });
        }

        // Hash new password
        const saltRounds = 12;
        const newPasswordHash = await bcrypt.hash(body.newPassword, saltRounds);

        // Update password in users table
        const updateQuery = `
          UPDATE users
          SET password_hash = $1, updated_at = NOW()
          WHERE id = $2 AND tenant_id = $3
        `;

        await pool.query(updateQuery, [newPasswordHash, userId, tenantId]);

        return reply.send({
          success: true,
          data: {
            message: 'Password changed successfully',
          },
        });
      } catch (error: any) {
        fastify.log.error({
          msg: 'Error changing password',
          error: error.message,
          stack: error.stack,
          userId,
          tenantId,
        });
        return reply.status(500).send({
          success: false,
          error: 'Internal Server Error',
          message: 'An error occurred while changing password',
        });
      }
    },
  });
}

