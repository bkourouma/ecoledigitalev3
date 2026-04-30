import { FastifyInstance } from "fastify";

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

// Verify parent user access control utility
// Checks that authenticated user ID matches parent ID
// Returns userId and tenantId if authorized, otherwise sends error response and returns null
async function verifyParentUserAccess(
  pool: any,
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

  return {
    userId,
    tenantId,
  };
}

// Helper function to validate phone format
function isValidPhone(phone: string): boolean {
  const phoneRegex = /^[\d\s\-\+\(\)]+$/;
  return phoneRegex.test(phone);
}

// Helper function to validate email format
function isValidEmail(email: string): boolean {
  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  return emailRegex.test(email);
}

export async function parentEmergencyRoutes(fastify: FastifyInstance) {
  const pool = fastify.pg as any;

  // GET /api/v1/parent/emergency/contacts - Get emergency contacts for the authenticated parent
  fastify.get('/contacts', {
    schema: {
      tags: ['Parent Emergency'],
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
      const auth = await verifyParentUserAccess(pool, request, reply);
      if (!auth) return;

      const { userId: parentId, tenantId } = auth;

      try {
        // Set tenant context for RLS
        await pool.query('SELECT set_config($1, $2, true)', ['app.tenant_id', tenantId]);

        // Query emergency contacts for the authenticated parent
        const result = await pool.query(
          `SELECT 
            id,
            contact_name,
            relationship,
            phone,
            email,
            created_at,
            updated_at
          FROM emergency_contacts
          WHERE parent_id = $1 AND tenant_id = $2
          ORDER BY created_at ASC`,
          [parentId, tenantId]
        );

        const contacts = result.rows.map((row: any) => ({
          id: row.id,
          contactName: row.contact_name,
          relationship: row.relationship,
          phone: row.phone,
          email: row.email,
          createdAt: row.created_at.toISOString(),
          updatedAt: row.updated_at.toISOString(),
        }));

        return reply.send({
          success: true,
          data: {
            contacts,
          },
        });
      } catch (error: any) {
        fastify.log.error(error);
        return reply.status(500).send({
          success: false,
          error: 'Internal Server Error',
          message: 'Failed to fetch emergency contacts',
        });
      }
    },
  });

  // POST /api/v1/parent/emergency/contacts - Add a new emergency contact
  fastify.post('/contacts', {
    schema: {
      tags: ['Parent Emergency'],
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
      const auth = await verifyParentUserAccess(pool, request, reply);
      if (!auth) return;

      const { userId: parentId, tenantId } = auth;
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
      if (!isValidPhone(body.phone)) {
        return reply.status(400).send({
          success: false,
          error: 'Validation Error',
          message: 'Invalid phone number format',
        });
      }

      // Validate email format if provided
      if (body.email && body.email.trim() !== '') {
        if (!isValidEmail(body.email)) {
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
        const result = await pool.query(
          `INSERT INTO emergency_contacts (tenant_id, parent_id, contact_name, relationship, phone, email)
          VALUES ($1, $2, $3, $4, $5, $6)
          RETURNING id, contact_name, relationship, phone, email, created_at, updated_at`,
          [
            tenantId,
            parentId,
            body.contactName.trim(),
            body.relationship.trim(),
            body.phone.trim(),
            body.email?.trim() || null,
          ]
        );

        const contact = result.rows[0];

        return reply.send({
          success: true,
          data: {
            contact: {
              id: contact.id,
              contactName: contact.contact_name,
              relationship: contact.relationship,
              phone: contact.phone,
              email: contact.email,
              createdAt: contact.created_at.toISOString(),
              updatedAt: contact.updated_at.toISOString(),
            },
          },
        });
      } catch (error: any) {
        fastify.log.error(error);
        return reply.status(500).send({
          success: false,
          error: 'Internal Server Error',
          message: 'Failed to create emergency contact',
        });
      }
    },
  });

  // PUT /api/v1/parent/emergency/contacts/:contactId - Update an existing emergency contact
  fastify.put('/contacts/:contactId', {
    schema: {
      tags: ['Parent Emergency'],
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
      const auth = await verifyParentUserAccess(pool, request, reply);
      if (!auth) return;

      const { userId: parentId, tenantId } = auth;
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
        if (!isValidPhone(body.phone)) {
          return reply.status(400).send({
            success: false,
            error: 'Validation Error',
            message: 'Invalid phone number format',
          });
        }
      }

      // Validate email format if provided
      if (body.email !== undefined && body.email !== null && body.email.trim() !== '') {
        if (!isValidEmail(body.email)) {
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

        // Verify that the contact belongs to the parent
        const checkResult = await pool.query(
          `SELECT id FROM emergency_contacts
          WHERE id = $1 AND parent_id = $2 AND tenant_id = $3`,
          [contactId, parentId, tenantId]
        );

        if (checkResult.rows.length === 0) {
          return reply.status(404).send({
            success: false,
            error: 'Not Found',
            message: 'Emergency contact not found or not accessible',
          });
        }

        // Build update query dynamically
        const updateFields: string[] = [];
        const updateValues: any[] = [];
        let paramIndex = 1;

        if (body.contactName !== undefined) {
          if (body.contactName.trim() === '') {
            return reply.status(400).send({
              success: false,
              error: 'Validation Error',
              message: 'Contact name cannot be empty',
            });
          }
          updateFields.push(`contact_name = $${paramIndex++}`);
          updateValues.push(body.contactName.trim());
        }

        if (body.relationship !== undefined) {
          if (body.relationship.trim() === '') {
            return reply.status(400).send({
              success: false,
              error: 'Validation Error',
              message: 'Relationship cannot be empty',
            });
          }
          updateFields.push(`relationship = $${paramIndex++}`);
          updateValues.push(body.relationship.trim());
        }

        if (body.phone !== undefined) {
          if (body.phone.trim() === '') {
            return reply.status(400).send({
              success: false,
              error: 'Validation Error',
              message: 'Phone number cannot be empty',
            });
          }
          updateFields.push(`phone = $${paramIndex++}`);
          updateValues.push(body.phone.trim());
        }

        if (body.email !== undefined) {
          updateFields.push(`email = $${paramIndex++}`);
          updateValues.push(body.email === null || body.email.trim() === '' ? null : body.email.trim());
        }

        // Add updated_at
        updateFields.push(`updated_at = NOW()`);

        // Add WHERE clause parameters
        updateValues.push(contactId, parentId, tenantId);

        // Update emergency contact
        const result = await pool.query(
          `UPDATE emergency_contacts
          SET ${updateFields.join(', ')}
          WHERE id = $${paramIndex++} AND parent_id = $${paramIndex++} AND tenant_id = $${paramIndex++}
          RETURNING id, contact_name, relationship, phone, email, updated_at`,
          updateValues
        );

        if (result.rows.length === 0) {
          return reply.status(404).send({
            success: false,
            error: 'Not Found',
            message: 'Emergency contact not found or not accessible',
          });
        }

        const contact = result.rows[0];

        return reply.send({
          success: true,
          data: {
            contact: {
              id: contact.id,
              contactName: contact.contact_name,
              relationship: contact.relationship,
              phone: contact.phone,
              email: contact.email,
              updatedAt: contact.updated_at.toISOString(),
            },
          },
        });
      } catch (error: any) {
        fastify.log.error(error);
        return reply.status(500).send({
          success: false,
          error: 'Internal Server Error',
          message: 'Failed to update emergency contact',
        });
      }
    },
  });

  // DELETE /api/v1/parent/emergency/contacts/:contactId - Remove an emergency contact
  fastify.delete('/contacts/:contactId', {
    schema: {
      tags: ['Parent Emergency'],
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
      const auth = await verifyParentUserAccess(pool, request, reply);
      if (!auth) return;

      const { userId: parentId, tenantId } = auth;
      const { contactId } = request.params as { contactId: string };

      try {
        // Set tenant context for RLS
        await pool.query('SELECT set_config($1, $2, true)', ['app.tenant_id', tenantId]);

        // Verify that the contact belongs to the parent and delete
        const result = await pool.query(
          `DELETE FROM emergency_contacts
          WHERE id = $1 AND parent_id = $2 AND tenant_id = $3
          RETURNING id`,
          [contactId, parentId, tenantId]
        );

        if (result.rows.length === 0) {
          return reply.status(404).send({
            success: false,
            error: 'Not Found',
            message: 'Emergency contact not found or not accessible',
          });
        }

        return reply.send({
          success: true,
          data: {
            message: 'Emergency contact removed successfully',
          },
        });
      } catch (error: any) {
        fastify.log.error(error);
        return reply.status(500).send({
          success: false,
          error: 'Internal Server Error',
          message: 'Failed to delete emergency contact',
        });
      }
    },
  });

  // GET /api/v1/parent/emergency/pickup-authorization - Get pickup authorization for the authenticated parent's children
  fastify.get('/pickup-authorization', {
    schema: {
      tags: ['Parent Emergency'],
      summary: 'Get pickup authorization for the authenticated parent\'s children',
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
                      canPickup: { type: 'boolean' },
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
      const auth = await verifyParentUserAccess(pool, request, reply);
      if (!auth) return;

      const { userId: parentId, tenantId } = auth;

      try {
        // Set tenant context for RLS
        await pool.query('SELECT set_config($1, $2, true)', ['app.tenant_id', tenantId]);

        // Query pickup authorization for the authenticated parent's children
        const result = await pool.query(
          `SELECT 
            sp_rel.id as relationship_id,
            sp.id as child_id,
            COALESCE(u.first_name || ' ' || u.last_name, u.name) as child_name,
            sp_rel.relationship_type,
            sp_rel.can_pickup,
            sp_rel.created_at
          FROM student_parents sp_rel
          JOIN student_profiles sp ON sp_rel.student_id = sp.id
          JOIN users u ON sp.user_id = u.id
          WHERE sp_rel.parent_id = $1 AND sp_rel.tenant_id = $2
          ORDER BY sp_rel.created_at ASC`,
          [parentId, tenantId]
        );

        const relationships = result.rows.map((row: any) => ({
          id: row.relationship_id,
          childId: row.child_id,
          childName: row.child_name,
          relationshipType: row.relationship_type,
          canPickup: row.can_pickup,
          createdAt: row.created_at.toISOString(),
        }));

        return reply.send({
          success: true,
          data: {
            relationships,
          },
        });
      } catch (error: any) {
        fastify.log.error(error);
        return reply.status(500).send({
          success: false,
          error: 'Internal Server Error',
          message: 'Failed to fetch pickup authorization',
        });
      }
    },
  });

  // PUT /api/v1/parent/emergency/pickup-authorization/:relationshipId - Update pickup authorization for a specific parent-child relationship
  fastify.put('/pickup-authorization/:relationshipId', {
    schema: {
      tags: ['Parent Emergency'],
      summary: 'Update pickup authorization for a specific parent-child relationship',
      params: {
        type: 'object',
        required: ['relationshipId'],
        properties: {
          relationshipId: { type: 'string', format: 'uuid' },
        },
      },
      body: {
        type: 'object',
        required: ['canPickup'],
        properties: {
          canPickup: { type: 'boolean' },
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
                relationship: {
                  type: 'object',
                  properties: {
                    id: { type: 'string', format: 'uuid' },
                    childId: { type: 'string', format: 'uuid' },
                    childName: { type: 'string' },
                    relationshipType: { type: 'string', enum: ['parent', 'guardian', 'emergency_contact'] },
                    canPickup: { type: 'boolean' },
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
      const auth = await verifyParentUserAccess(pool, request, reply);
      if (!auth) return;

      const { userId: parentId, tenantId } = auth;
      const { relationshipId } = request.params as { relationshipId: string };
      const body = request.body as {
        canPickup: boolean;
      };

      // Validate input
      if (typeof body.canPickup !== 'boolean') {
        return reply.status(400).send({
          success: false,
          error: 'Validation Error',
          message: 'canPickup must be a boolean value',
        });
      }

      try {
        // Set tenant context for RLS
        await pool.query('SELECT set_config($1, $2, true)', ['app.tenant_id', tenantId]);

        // Verify that the relationship belongs to the parent
        const checkResult = await pool.query(
          `SELECT sp_rel.id, sp.id as child_id, COALESCE(u.first_name || ' ' || u.last_name, u.name) as child_name, sp_rel.relationship_type
          FROM student_parents sp_rel
          JOIN student_profiles sp ON sp_rel.student_id = sp.id
          JOIN users u ON sp.user_id = u.id
          WHERE sp_rel.id = $1 AND sp_rel.parent_id = $2 AND sp_rel.tenant_id = $3`,
          [relationshipId, parentId, tenantId]
        );

        if (checkResult.rows.length === 0) {
          return reply.status(404).send({
            success: false,
            error: 'Not Found',
            message: 'Relationship not found or not accessible',
          });
        }

        const relationship = checkResult.rows[0];

        // Update pickup authorization
        const updateResult = await pool.query(
          `UPDATE student_parents
          SET can_pickup = $1, updated_at = NOW()
          WHERE id = $2 AND parent_id = $3 AND tenant_id = $4
          RETURNING id, can_pickup, updated_at`,
          [body.canPickup, relationshipId, parentId, tenantId]
        );

        if (updateResult.rows.length === 0) {
          return reply.status(404).send({
            success: false,
            error: 'Not Found',
            message: 'Relationship not found or not accessible',
          });
        }

        const updated = updateResult.rows[0];

        return reply.send({
          success: true,
          data: {
            relationship: {
              id: updated.id,
              childId: relationship.child_id,
              childName: relationship.child_name,
              relationshipType: relationship.relationship_type,
              canPickup: updated.can_pickup,
              updatedAt: updated.updated_at.toISOString(),
            },
          },
        });
      } catch (error: any) {
        fastify.log.error(error);
        return reply.status(500).send({
          success: false,
          error: 'Internal Server Error',
          message: 'Failed to update pickup authorization',
        });
      }
    },
  });

  // GET /api/v1/parent/emergency/relationship-types - Get relationship types for the authenticated parent's children
  fastify.get('/relationship-types', {
    schema: {
      tags: ['Parent Emergency'],
      summary: 'Get relationship types for the authenticated parent\'s children',
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
      const auth = await verifyParentUserAccess(pool, request, reply);
      if (!auth) return;

      const { userId: parentId, tenantId } = auth;

      try {
        // Set tenant context for RLS
        await pool.query('SELECT set_config($1, $2, true)', ['app.tenant_id', tenantId]);

        // Query relationship types for the authenticated parent's children
        const result = await pool.query(
          `SELECT 
            sp_rel.id as relationship_id,
            sp.id as child_id,
            COALESCE(u.first_name || ' ' || u.last_name, u.name) as child_name,
            sp_rel.relationship_type,
            sp_rel.is_primary_contact,
            sp_rel.emergency_contact,
            sp_rel.can_pickup,
            sp_rel.notes,
            sp_rel.created_at
          FROM student_parents sp_rel
          JOIN student_profiles sp ON sp_rel.student_id = sp.id
          JOIN users u ON sp.user_id = u.id
          WHERE sp_rel.parent_id = $1 AND sp_rel.tenant_id = $2
          ORDER BY sp_rel.created_at ASC`,
          [parentId, tenantId]
        );

        const relationships = result.rows.map((row: any) => ({
          id: row.relationship_id,
          childId: row.child_id,
          childName: row.child_name,
          relationshipType: row.relationship_type,
          isPrimaryContact: row.is_primary_contact,
          emergencyContact: row.emergency_contact,
          canPickup: row.can_pickup,
          notes: row.notes,
          createdAt: row.created_at.toISOString(),
        }));

        return reply.send({
          success: true,
          data: {
            relationships,
          },
        });
      } catch (error: any) {
        fastify.log.error(error);
        return reply.status(500).send({
          success: false,
          error: 'Internal Server Error',
          message: 'Failed to fetch relationship types',
        });
      }
    },
  });

  // PUT /api/v1/parent/emergency/relationship-types/:relationshipId - Update relationship type for a specific parent-child relationship
  fastify.put('/relationship-types/:relationshipId', {
    schema: {
      tags: ['Parent Emergency'],
      summary: 'Update relationship type for a specific parent-child relationship',
      params: {
        type: 'object',
        required: ['relationshipId'],
        properties: {
          relationshipId: { type: 'string', format: 'uuid' },
        },
      },
      body: {
        type: 'object',
        required: ['relationshipType'],
        properties: {
          relationshipType: { type: 'string', enum: ['parent', 'guardian', 'emergency_contact'] },
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
                relationship: {
                  type: 'object',
                  properties: {
                    id: { type: 'string', format: 'uuid' },
                    childId: { type: 'string', format: 'uuid' },
                    childName: { type: 'string' },
                    relationshipType: { type: 'string', enum: ['parent', 'guardian', 'emergency_contact'] },
                    requiresApproval: { type: 'boolean' },
                    updatedAt: { type: 'string' },
                  },
                },
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
      const auth = await verifyParentUserAccess(pool, request, reply);
      if (!auth) return;

      const { userId: parentId, tenantId } = auth;
      const { relationshipId } = request.params as { relationshipId: string };
      const body = request.body as {
        relationshipType: 'parent' | 'guardian' | 'emergency_contact';
      };

      // Validate input
      const validTypes = ['parent', 'guardian', 'emergency_contact'];
      if (!body.relationshipType || !validTypes.includes(body.relationshipType)) {
        return reply.status(400).send({
          success: false,
          error: 'Validation Error',
          message: 'relationshipType must be one of: parent, guardian, emergency_contact',
        });
      }

      try {
        // Set tenant context for RLS
        await pool.query('SELECT set_config($1, $2, true)', ['app.tenant_id', tenantId]);

        // Verify that the relationship belongs to the parent
        const checkResult = await pool.query(
          `SELECT sp_rel.id, sp.id as child_id, COALESCE(u.first_name || ' ' || u.last_name, u.name) as child_name, sp_rel.relationship_type
          FROM student_parents sp_rel
          JOIN student_profiles sp ON sp_rel.student_id = sp.id
          JOIN users u ON sp.user_id = u.id
          WHERE sp_rel.id = $1 AND sp_rel.parent_id = $2 AND sp_rel.tenant_id = $3`,
          [relationshipId, parentId, tenantId]
        );

        if (checkResult.rows.length === 0) {
          return reply.status(404).send({
            success: false,
            error: 'Not Found',
            message: 'Relationship not found or not accessible',
          });
        }

        const relationship = checkResult.rows[0];

        // Update relationship type
        const updateResult = await pool.query(
          `UPDATE student_parents
          SET relationship_type = $1, updated_at = NOW()
          WHERE id = $2 AND parent_id = $3 AND tenant_id = $4
          RETURNING id, relationship_type, updated_at`,
          [body.relationshipType, relationshipId, parentId, tenantId]
        );

        if (updateResult.rows.length === 0) {
          return reply.status(404).send({
            success: false,
            error: 'Not Found',
            message: 'Relationship not found or not accessible',
          });
        }

        const updated = updateResult.rows[0];

        // Determine if approval is required (approval may be required when changing from/to certain types)
        const requiresApproval = relationship.relationship_type !== body.relationshipType;

        return reply.send({
          success: true,
          data: {
            relationship: {
              id: updated.id,
              childId: relationship.child_id,
              childName: relationship.child_name,
              relationshipType: updated.relationship_type,
              requiresApproval,
              updatedAt: updated.updated_at.toISOString(),
            },
            message: 'Relationship type updated. This change may require administrative approval.',
          },
        });
      } catch (error: any) {
        fastify.log.error(error);
        return reply.status(500).send({
          success: false,
          error: 'Internal Server Error',
          message: 'Failed to update relationship type',
        });
      }
    },
  });

  // GET /api/v1/parent/emergency/data-access - Get data access information for the authenticated parent's children
  fastify.get('/data-access', {
    schema: {
      tags: ['Parent Emergency'],
      summary: 'Get data access information for the authenticated parent\'s children',
      response: {
        200: {
          type: 'object',
          properties: {
            success: { type: 'boolean' },
            data: {
              type: 'object',
              properties: {
                dataAccess: {
                  type: 'array',
                  items: {
                    type: 'object',
                    properties: {
                      relationshipId: { type: 'string', format: 'uuid' },
                      childId: { type: 'string', format: 'uuid' },
                      childName: { type: 'string' },
                      relationshipType: { type: 'string', enum: ['parent', 'guardian', 'emergency_contact'] },
                      canPickup: { type: 'boolean' },
                      accessLevel: { type: 'string', enum: ['full', 'limited', 'view-only'] },
                      accessibleDataTypes: {
                        type: 'array',
                        items: { type: 'string' },
                      },
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
      const auth = await verifyParentUserAccess(pool, request, reply);
      if (!auth) return;

      const { userId: parentId, tenantId } = auth;

      try {
        // Set tenant context for RLS
        await pool.query('SELECT set_config($1, $2, true)', ['app.tenant_id', tenantId]);

        // Query data access information for the authenticated parent's children
        // Derive access level and accessible data types from relationship type
        const result = await pool.query(
          `SELECT 
            sp_rel.id as relationship_id,
            sp.id as child_id,
            COALESCE(u.first_name || ' ' || u.last_name, u.name) as child_name,
            sp_rel.relationship_type,
            sp_rel.can_pickup,
            CASE 
              WHEN sp_rel.relationship_type = 'parent' THEN 'full'
              WHEN sp_rel.relationship_type = 'guardian' THEN 'limited'
              WHEN sp_rel.relationship_type = 'emergency_contact' THEN 'view-only'
            END as access_level,
            CASE 
              WHEN sp_rel.relationship_type = 'parent' THEN '["grades", "attendance", "payments", "homework", "messages", "academic", "documents"]'::jsonb
              WHEN sp_rel.relationship_type = 'guardian' THEN '["grades", "attendance", "homework", "messages"]'::jsonb
              WHEN sp_rel.relationship_type = 'emergency_contact' THEN '["messages"]'::jsonb
            END as accessible_data_types
          FROM student_parents sp_rel
          JOIN student_profiles sp ON sp_rel.student_id = sp.id
          JOIN users u ON sp.user_id = u.id
          WHERE sp_rel.parent_id = $1 AND sp_rel.tenant_id = $2
          ORDER BY sp_rel.created_at ASC`,
          [parentId, tenantId]
        );

        const dataAccess = result.rows.map((row: any) => ({
          relationshipId: row.relationship_id,
          childId: row.child_id,
          childName: row.child_name,
          relationshipType: row.relationship_type,
          canPickup: row.can_pickup,
          accessLevel: row.access_level,
          accessibleDataTypes: row.accessible_data_types || [],
        }));

        return reply.send({
          success: true,
          data: {
            dataAccess,
          },
        });
      } catch (error: any) {
        fastify.log.error(error);
        return reply.status(500).send({
          success: false,
          error: 'Internal Server Error',
          message: 'Failed to fetch data access information',
        });
      }
    },
  });
}

