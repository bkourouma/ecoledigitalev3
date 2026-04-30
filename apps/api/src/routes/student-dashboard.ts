import { FastifyInstance } from "fastify";
import { z } from "zod";
import {
  DashboardQuerySchema,
  CreateStudentDashboardConfigSchema,
  UpdateStudentDashboardConfigSchema,
  WidgetDataQuerySchema,
  DashboardListResponseSchema,
  WidgetDataResponseSchema,
  AvailableWidgetsResponseSchema,
  StudentDashboardConfigSchema
} from "@ecoledigitale/contracts";

export async function studentDashboardRoutes(fastify: FastifyInstance) {
  // GET /api/v1/students/dashboards - Liste des tableaux de bord
  fastify.get("/", {
    schema: {
      querystring: DashboardQuerySchema,
      response: {
        200: DashboardListResponseSchema
      }
    },
    handler: async (request, reply) => {
      if (!request.tenantId || !request.userId) {
        return reply.status(401).send({
          error: "Unauthorized",
          message: "Authentication required"
        });
      }

      const query = DashboardQuerySchema.parse(request.query);
      const offset = (query.page - 1) * query.limit;

      const client = await fastify.pg.connect();
      try {
        let whereClause = "WHERE sdc.tenant_id = $1 AND sdc.student_id = $2";
        const params = [request.tenantId, request.userId];
        let paramIndex = 3;

        if (query.layoutName) {
          whereClause += ` AND sdc.layout_name = $${paramIndex}`;
          params.push(query.layoutName);
          paramIndex++;
        }

        if (query.isActive !== undefined) {
          whereClause += ` AND sdc.is_active = $${paramIndex}`;
          params.push(query.isActive);
          paramIndex++;
        }

        // Compter le total
        const countResult = await client.query(
          `SELECT COUNT(*) FROM student_dashboard_configs sdc ${whereClause}`,
          params
        );
        const total = parseInt(countResult.rows[0].count);

        // Récupérer les tableaux de bord
        const result = await client.query(
          `SELECT 
            sdc.id,
            sdc.tenant_id,
            sdc.student_id,
            sdc.layout_name,
            sdc.is_active,
            sdc.config_data,
            sdc.created_at,
            sdc.updated_at
          FROM student_dashboard_configs sdc 
          ${whereClause}
          ORDER BY sdc.updated_at DESC
          LIMIT $${paramIndex} OFFSET $${paramIndex + 1}`,
          [...params, query.limit, offset]
        );

        const totalPages = Math.ceil(total / query.limit);

        return {
          dashboards: result.rows.map(row => ({
            id: row.id,
            tenantId: row.tenant_id,
            studentId: row.student_id,
            layoutName: row.layout_name,
            isActive: row.is_active,
            configData: row.config_data,
            createdAt: new Date(row.created_at),
            updatedAt: new Date(row.updated_at)
          })),
          total,
          page: query.page,
          limit: query.limit,
          totalPages
        };
      } finally {
        client.release();
      }
    }
  });

  // GET /api/v1/students/dashboards/:id - Récupérer un tableau de bord spécifique
  fastify.get("/:id", {
    schema: {
      params: z.object({
        id: z.string().uuid()
      }),
      response: {
        200: z.object({
          dashboard: StudentDashboardConfigSchema
        })
      }
    },
    handler: async (request, reply) => {
      if (!request.tenantId || !request.userId) {
        return reply.status(401).send({
          error: "Unauthorized",
          message: "Authentication required"
        });
      }

      const { id } = request.params as { id: string };

      const client = await fastify.pg.connect();
      try {
        const result = await client.query(
          `SELECT * FROM student_dashboard_configs 
           WHERE id = $1 AND tenant_id = $2 AND student_id = $3`,
          [id, request.tenantId, request.userId]
        );

        if (result.rows.length === 0) {
          return reply.status(404).send({
            error: "Not Found",
            message: "Dashboard not found"
          });
        }

        const dashboard = result.rows[0];
        return {
          dashboard: {
            id: dashboard.id,
            tenantId: dashboard.tenant_id,
            studentId: dashboard.student_id,
            layoutName: dashboard.layout_name,
            isActive: dashboard.is_active,
            configData: dashboard.config_data,
            createdAt: new Date(dashboard.created_at),
            updatedAt: new Date(dashboard.updated_at)
          }
        };
      } finally {
        client.release();
      }
    }
  });

  // POST /api/v1/students/dashboards - Créer un nouveau tableau de bord
  fastify.post("/", {
    schema: {
      body: CreateStudentDashboardConfigSchema,
      response: {
        201: z.object({
          dashboard: StudentDashboardConfigSchema
        })
      }
    },
    handler: async (request, reply) => {
      if (!request.tenantId || !request.userId) {
        return reply.status(401).send({
          error: "Unauthorized",
          message: "Authentication required"
        });
      }

      const dashboardData = CreateStudentDashboardConfigSchema.parse(request.body);

      const client = await fastify.pg.connect();
      try {
        const result = await client.query(
          `INSERT INTO student_dashboard_configs 
           (tenant_id, student_id, layout_name, is_active, config_data)
           VALUES ($1, $2, $3, $4, $5)
           RETURNING *`,
          [
            request.tenantId,
            request.userId,
            dashboardData.layoutName,
            dashboardData.isActive,
            JSON.stringify(dashboardData.configData)
          ]
        );

        const dashboard = result.rows[0];
        return reply.status(201).send({
          dashboard: {
            id: dashboard.id,
            tenantId: dashboard.tenant_id,
            studentId: dashboard.student_id,
            layoutName: dashboard.layout_name,
            isActive: dashboard.is_active,
            configData: dashboard.config_data,
            createdAt: new Date(dashboard.created_at),
            updatedAt: new Date(dashboard.updated_at)
          }
        });
      } finally {
        client.release();
      }
    }
  });

  // PUT /api/v1/students/dashboards/:id - Mettre à jour un tableau de bord
  fastify.put("/:id", {
    schema: {
      params: z.object({
        id: z.string().uuid()
      }),
      body: UpdateStudentDashboardConfigSchema,
      response: {
        200: z.object({
          dashboard: StudentDashboardConfigSchema
        })
      }
    },
    handler: async (request, reply) => {
      if (!request.tenantId || !request.userId) {
        return reply.status(401).send({
          error: "Unauthorized",
          message: "Authentication required"
        });
      }

      const { id } = request.params as { id: string };
      const updateData = UpdateStudentDashboardConfigSchema.parse(request.body);

      const client = await fastify.pg.connect();
      try {
        // Vérifier que le tableau de bord existe
        const existingResult = await client.query(
          `SELECT * FROM student_dashboard_configs 
           WHERE id = $1 AND tenant_id = $2 AND student_id = $3`,
          [id, request.tenantId, request.userId]
        );

        if (existingResult.rows.length === 0) {
          return reply.status(404).send({
            error: "Not Found",
            message: "Dashboard not found"
          });
        }

        // Construire la requête de mise à jour
        const updateFields = [];
        const updateValues = [];
        let paramIndex = 1;

        if (updateData.layoutName !== undefined) {
          updateFields.push(`layout_name = $${paramIndex}`);
          updateValues.push(updateData.layoutName);
          paramIndex++;
        }

        if (updateData.isActive !== undefined) {
          updateFields.push(`is_active = $${paramIndex}`);
          updateValues.push(updateData.isActive);
          paramIndex++;
        }

        if (updateData.configData !== undefined) {
          updateFields.push(`config_data = $${paramIndex}`);
          updateValues.push(JSON.stringify(updateData.configData));
          paramIndex++;
        }

        if (updateFields.length === 0) {
          return reply.status(400).send({
            error: "Bad Request",
            message: "No fields to update"
          });
        }

        updateFields.push(`updated_at = NOW()`);

        const result = await client.query(
          `UPDATE student_dashboard_configs 
           SET ${updateFields.join(', ')}
           WHERE id = $${paramIndex} AND tenant_id = $${paramIndex + 1} AND student_id = $${paramIndex + 2}
           RETURNING *`,
          [...updateValues, id, request.tenantId, request.userId]
        );

        const dashboard = result.rows[0];
        return {
          dashboard: {
            id: dashboard.id,
            tenantId: dashboard.tenant_id,
            studentId: dashboard.student_id,
            layoutName: dashboard.layout_name,
            isActive: dashboard.is_active,
            configData: dashboard.config_data,
            createdAt: new Date(dashboard.created_at),
            updatedAt: new Date(dashboard.updated_at)
          }
        };
      } finally {
        client.release();
      }
    }
  });

  // DELETE /api/v1/students/dashboards/:id - Supprimer un tableau de bord
  fastify.delete("/:id", {
    schema: {
      params: z.object({
        id: z.string().uuid()
      }),
      response: {
        200: z.object({
          message: z.string()
        })
      }
    },
    handler: async (request, reply) => {
      if (!request.tenantId || !request.userId) {
        return reply.status(401).send({
          error: "Unauthorized",
          message: "Authentication required"
        });
      }

      const { id } = request.params as { id: string };

      const client = await fastify.pg.connect();
      try {
        const result = await client.query(
          `DELETE FROM student_dashboard_configs 
           WHERE id = $1 AND tenant_id = $2 AND student_id = $3
           RETURNING id`,
          [id, request.tenantId, request.userId]
        );

        if (result.rows.length === 0) {
          return reply.status(404).send({
            error: "Not Found",
            message: "Dashboard not found"
          });
        }

        return {
          message: "Dashboard deleted successfully"
        };
      } finally {
        client.release();
      }
    }
  });

  // GET /api/v1/students/dashboards/widgets/available - Récupérer les widgets disponibles
  fastify.get("/widgets/available", {
    schema: {
      response: {
        200: AvailableWidgetsResponseSchema
      }
    },
    handler: async (request, reply) => {
      if (!request.tenantId) {
        return reply.status(401).send({
          error: "Unauthorized",
          message: "Authentication required"
        });
      }

      const client = await fastify.pg.connect();
      try {
        const result = await client.query(
          `SELECT 
            dw.id,
            dw.tenant_id,
            dw.widget_type,
            dw.widget_name,
            dw.description,
            dw.default_config,
            dw.is_enabled,
            dw.created_at
          FROM dashboard_widgets dw
          WHERE dw.tenant_id = $1 AND dw.is_enabled = true
          ORDER BY dw.widget_name`,
          [request.tenantId]
        );

        return {
          widgets: result.rows.map(row => ({
            id: row.id,
            tenantId: row.tenant_id,
            widgetType: row.widget_type,
            widgetName: row.widget_name,
            description: row.description,
            defaultConfig: row.default_config,
            isEnabled: row.is_enabled,
            createdAt: new Date(row.created_at)
          })),
          total: result.rows.length
        };
      } finally {
        client.release();
      }
    }
  });

  // GET /api/v1/students/dashboards/widgets/:type/data - Récupérer les données d'un widget
  fastify.get("/widgets/:type/data", {
    schema: {
      params: z.object({
        type: z.string()
      }),
      querystring: WidgetDataQuerySchema,
      response: {
        200: WidgetDataResponseSchema
      }
    },
    handler: async (request, reply) => {
      if (!request.tenantId || !request.userId) {
        return reply.status(401).send({
          error: "Unauthorized",
          message: "Authentication required"
        });
      }

      const { type } = request.params as { type: string };
      const query = WidgetDataQuerySchema.parse(request.query);

      // Simuler des données pour les différents types de widgets
      let widgetData;
      const now = new Date().toISOString();

      switch (type) {
        case 'academic_progress':
          widgetData = {
            type: 'academic_progress',
            data: {
              totalCredits: 120,
              acquiredCredits: 85,
              currentGPA: 3.2,
              semesterProgress: 65
            }
          };
          break;

        case 'schedule':
          widgetData = {
            type: 'schedule',
            data: [
              {
                id: '1',
                courseName: 'Mathématiques',
                startTime: '09:00',
                endTime: '10:30',
                location: 'Salle A101',
                teacher: 'Dr. Martin'
              },
              {
                id: '2',
                courseName: 'Physique',
                startTime: '11:00',
                endTime: '12:30',
                location: 'Salle B203',
                teacher: 'Prof. Dubois'
              }
            ]
          };
          break;

        case 'assignments':
          widgetData = {
            type: 'assignments',
            data: [
              {
                id: '1',
                title: 'Devoir de Mathématiques',
                course: 'Algèbre Linéaire',
                dueDate: '2024-02-15',
                status: 'pending',
                grade: undefined
              },
              {
                id: '2',
                title: 'Projet de Physique',
                course: 'Mécanique Quantique',
                dueDate: '2024-02-20',
                status: 'submitted',
                grade: undefined
              }
            ]
          };
          break;

        case 'recent_grades':
          widgetData = {
            type: 'recent_grades',
            data: [
              {
                id: '1',
                assignmentTitle: 'Examen de Mathématiques',
                course: 'Calcul Différentiel',
                grade: 85,
                date: '2024-01-30',
                feedback: 'Bon travail, quelques erreurs de calcul'
              },
              {
                id: '2',
                assignmentTitle: 'Devoir de Physique',
                course: 'Thermodynamique',
                grade: 92,
                date: '2024-01-25',
                feedback: 'Excellent!'
              }
            ]
          };
          break;

        case 'financial_status':
          widgetData = {
            type: 'financial_status',
            data: {
              balance: 2500,
              nextPayment: 800,
              nextPaymentDate: '2024-03-01',
              paymentHistory: [
                {
                  amount: 800,
                  date: '2024-01-01',
                  status: 'paid'
                },
                {
                  amount: 800,
                  date: '2024-02-01',
                  status: 'paid'
                }
              ]
            }
          };
          break;

        case 'messages':
          widgetData = {
            type: 'messages',
            data: [
              {
                id: '1',
                from: 'Prof. Martin',
                subject: 'Rappel: Devoir à rendre',
                content: 'N\'oubliez pas de rendre votre devoir avant vendredi.',
                date: '2024-02-10',
                isRead: false
              },
              {
                id: '2',
                from: 'Administration',
                subject: 'Confirmation de paiement',
                content: 'Votre paiement de 800€ a été reçu avec succès.',
                date: '2024-02-08',
                isRead: true
              }
            ]
          };
          break;

        case 'announcements':
          widgetData = {
            type: 'announcements',
            data: [
              {
                id: '1',
                title: 'Journée Portes Ouvertes',
                content: 'La journée portes ouvertes aura lieu le 15 mars 2024.',
                date: '2024-02-10',
                priority: 'medium',
                category: 'events'
              },
              {
                id: '2',
                title: 'Maintenance du système',
                content: 'Le système sera en maintenance le 20 février de 22h à 2h.',
                date: '2024-02-09',
                priority: 'high',
                category: 'urgent'
              }
            ]
          };
          break;

        case 'recent_content':
          widgetData = {
            type: 'recent_content',
            data: [
              {
                id: '1',
                title: 'Vidéo: Introduction aux dérivées',
                type: 'video',
                course: 'Calcul Différentiel',
                date: '2024-02-08',
                progress: 75
              },
              {
                id: '2',
                title: 'Document: Exercices de TD',
                type: 'document',
                course: 'Algèbre Linéaire',
                date: '2024-02-07',
                progress: 100
              }
            ]
          };
          break;

        case 'course_progress':
          widgetData = {
            type: 'course_progress',
            data: [
              {
                courseId: '1',
                courseName: 'Calcul Différentiel',
                progress: 75,
                completedModules: 6,
                totalModules: 8
              },
              {
                courseId: '2',
                courseName: 'Algèbre Linéaire',
                progress: 60,
                completedModules: 3,
                totalModules: 5
              }
            ]
          };
          break;

        case 'personal_stats':
          widgetData = {
            type: 'personal_stats',
            data: {
              attendanceRate: 85,
              averageGrade: 78,
              completedAssignments: 12,
              totalAssignments: 15
            }
          };
          break;

        case 'quick_actions':
          widgetData = {
            type: 'quick_actions',
            data: {}
          };
          break;

        case 'ai_tutor':
          widgetData = {
            type: 'ai_tutor',
            data: {
              recommendations: [
                {
                  id: '1',
                  type: 'study_tip',
                  title: 'Réviser les dérivées',
                  description: 'Concentrez-vous sur les règles de dérivation pour le prochain examen.',
                  actionable: true,
                  actionLabel: 'Voir les exercices'
                }
              ],
              recentInteractions: [
                {
                  id: '1',
                  question: 'Comment calculer la dérivée de x²?',
                  answer: 'La dérivée de x² est 2x. Utilisez la règle de puissance.',
                  date: '2024-02-10',
                  helpful: true
                }
              ]
            }
          };
          break;

        default:
          return reply.status(400).send({
            error: "Bad Request",
            message: "Invalid widget type"
          });
      }

      return {
        widgetType: type as any,
        data: widgetData,
        lastUpdated: now,
        nextUpdate: new Date(Date.now() + 5 * 60 * 1000).toISOString() // 5 minutes
      };
    }
  });

  // GET /api/v1/students/dashboards/templates - Récupérer les templates disponibles
  fastify.get("/templates", {
    schema: {
      response: {
        200: z.object({
          templates: z.array(z.object({
            id: z.string().uuid(),
            name: z.string(),
            description: z.string().optional(),
            isDefault: z.boolean()
          }))
        })
      }
    },
    handler: async (request, reply) => {
      if (!request.tenantId) {
        return reply.status(401).send({
          error: "Unauthorized",
          message: "Authentication required"
        });
      }

      const client = await fastify.pg.connect();
      try {
        const result = await client.query(
          `SELECT 
            dt.id,
            dt.name,
            dt.description,
            dt.is_default
          FROM dashboard_templates dt
          WHERE dt.tenant_id = $1
          ORDER BY dt.is_default DESC, dt.name`,
          [request.tenantId]
        );

        return {
          templates: result.rows.map(row => ({
            id: row.id,
            name: row.name,
            description: row.description,
            isDefault: row.is_default
          }))
        };
      } finally {
        client.release();
      }
    }
  });

  // POST /api/v1/students/dashboards/reset - Réinitialiser le tableau de bord
  fastify.post("/reset", {
    schema: {
      response: {
        200: z.object({
          message: z.string(),
          dashboard: StudentDashboardConfigSchema
        })
      }
    },
    handler: async (request, reply) => {
      if (!request.tenantId || !request.userId) {
        return reply.status(401).send({
          error: "Unauthorized",
          message: "Authentication required"
        });
      }

      const client = await fastify.pg.connect();
      try {
        // Récupérer le template par défaut
        const templateResult = await client.query(
          `SELECT layout FROM dashboard_templates 
           WHERE tenant_id = $1 AND is_default = true
           LIMIT 1`,
          [request.tenantId]
        );

        if (templateResult.rows.length === 0) {
          return reply.status(404).send({
            error: "Not Found",
            message: "No default template found"
          });
        }

        const defaultLayout = templateResult.rows[0].layout;

        // Mettre à jour ou créer la configuration
        const upsertResult = await client.query(
          `INSERT INTO student_dashboard_configs 
           (tenant_id, student_id, layout_name, is_active, config_data)
           VALUES ($1, $2, 'default', true, $3)
           ON CONFLICT (tenant_id, student_id)
           DO UPDATE SET 
             layout_name = 'default',
             is_active = true,
             config_data = $3,
             updated_at = NOW()
           RETURNING *`,
          [request.tenantId, request.userId, JSON.stringify(defaultLayout)]
        );

        const dashboard = upsertResult.rows[0];
        return {
          message: "Dashboard reset to default layout",
          dashboard: {
            id: dashboard.id,
            tenantId: dashboard.tenant_id,
            studentId: dashboard.student_id,
            layoutName: dashboard.layout_name,
            isActive: dashboard.is_active,
            configData: dashboard.config_data,
            createdAt: new Date(dashboard.created_at),
            updatedAt: new Date(dashboard.updated_at)
          }
        };
      } finally {
        client.release();
      }
    }
  });
}