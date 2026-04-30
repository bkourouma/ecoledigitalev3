import { describe, it, expect, beforeAll, afterAll, beforeEach } from '@jest/globals';
import { FastifyInstance } from 'fastify';
import { Pool } from 'pg';
import { buildApp } from '../app';

describe('Student Payments API', () => {
  let app: FastifyInstance;
  let pool: Pool;
  let testTenantId: string;
  let testStudentId: string;
  let testEnrollmentId: string;
  let testTransactionId: string;

  beforeAll(async () => {
    // Initialize test app
    app = await buildApp({
      logger: false,
      disableRequestLogging: true,
    });

    pool = app.pg as Pool;

    // Setup test data
    await setupTestData();
  });

  afterAll(async () => {
    // Cleanup test data
    await cleanupTestData();
    await app.close();
  });

  beforeEach(async () => {
    // Reset any test-specific state
  });

  async function setupTestData() {
    const client = await pool.connect();
    try {
      // Create test tenant
      const tenantResult = await client.query(`
        INSERT INTO tenants (name, address, phone, email)
        VALUES ('Test School', '123 Test St', '+225 01 23 45 67', 'test@school.com')
        RETURNING id
      `);
      testTenantId = tenantResult.rows[0].id;

      await client.query("SET app.tenant_id = $1", [testTenantId]);

      // Create test user
      const userResult = await client.query(`
        INSERT INTO users (email, first_name, last_name, role)
        VALUES ('student@test.com', 'Test', 'Student', 'student')
        RETURNING id
      `);
      const testUserId = userResult.rows[0].id;

      // Create test student profile
      const studentResult = await client.query(`
        INSERT INTO student_profiles (tenant_id, user_id, student_number, phone)
        VALUES ($1, $2, 'TS001', '+225 07 12 34 56')
        RETURNING id
      `, [testTenantId, testUserId]);
      testStudentId = studentResult.rows[0].id;

      // Create test academic year
      const academicYearResult = await client.query(`
        INSERT INTO academic_years (tenant_id, name, start_date, end_date)
        VALUES ($1, '2024-2025', '2024-09-01', '2025-06-30')
        RETURNING id
      `, [testTenantId]);
      const testAcademicYearId = academicYearResult.rows[0].id;

      // Create test enrollment
      const enrollmentResult = await client.query(`
        INSERT INTO student_enrollments (
          tenant_id, student_id, academic_year_id, status, fees
        ) VALUES ($1, $2, $3, 'active', $4)
        RETURNING id
      `, [
        testTenantId,
        testStudentId,
        testAcademicYearId,
        JSON.stringify({
          inscription: 50000,
          scolarite: 200000,
          annexes: 25000,
          autres: 10000,
          total: 285000
        })
      ]);
      testEnrollmentId = enrollmentResult.rows[0].id;

    } finally {
      client.release();
    }
  }

  async function cleanupTestData() {
    const client = await pool.connect();
    try {
      await client.query("DELETE FROM tenants WHERE id = $1", [testTenantId]);
    } finally {
      client.release();
    }
  }

  describe('GET /api/v1/student-payments/:studentId', () => {
    it('should return student payment summary', async () => {
      const response = await app.inject({
        method: 'GET',
        url: `/api/v1/student-payments/${testStudentId}`,
        headers: {
          'x-tenant-id': testTenantId,
        },
      });

      expect(response.statusCode).toBe(200);
      const data = JSON.parse(response.payload);
      
      expect(data.data).toHaveProperty('studentId', testStudentId);
      expect(data.data).toHaveProperty('studentName');
      expect(data.data).toHaveProperty('enrollmentId', testEnrollmentId);
      expect(data.data).toHaveProperty('totalFees', 285000);
      expect(data.data).toHaveProperty('totalPaid', 0);
      expect(data.data).toHaveProperty('totalOutstanding', 285000);
      expect(data.data).toHaveProperty('immediateFeesStatus');
      expect(data.data).toHaveProperty('tuitionInstallments');
      expect(data.data).toHaveProperty('recentTransactions');
    });

    it('should return 404 for non-existent student', async () => {
      const response = await app.inject({
        method: 'GET',
        url: '/api/v1/student-payments/00000000-0000-0000-0000-000000000000',
        headers: {
          'x-tenant-id': testTenantId,
        },
      });

      expect(response.statusCode).toBe(404);
    });

    it('should return 400 without tenant context', async () => {
      const response = await app.inject({
        method: 'GET',
        url: `/api/v1/student-payments/${testStudentId}`,
      });

      expect(response.statusCode).toBe(400);
    });
  });

  describe('POST /api/v1/student-payments/initiate', () => {
    it('should initiate payment successfully', async () => {
      const paymentRequest = {
        studentId: testStudentId,
        enrollmentId: testEnrollmentId,
        feeType: 'inscription',
        amount: 50000,
        currency: 'XOF',
        paymentMethod: 'orange_money',
      };

      const response = await app.inject({
        method: 'POST',
        url: '/api/v1/student-payments/initiate',
        headers: {
          'x-tenant-id': testTenantId,
          'content-type': 'application/json',
        },
        payload: paymentRequest,
      });

      expect(response.statusCode).toBe(200);
      const data = JSON.parse(response.payload);
      
      expect(data.data).toHaveProperty('transactionId');
      expect(data.data).toHaveProperty('status', 'pending');
      expect(data.data).toHaveProperty('message');
      
      testTransactionId = data.data.transactionId;
    });

    it('should validate payment amount', async () => {
      const paymentRequest = {
        studentId: testStudentId,
        enrollmentId: testEnrollmentId,
        feeType: 'inscription',
        amount: 100000, // Invalid amount (too high)
        currency: 'XOF',
        paymentMethod: 'orange_money',
      };

      const response = await app.inject({
        method: 'POST',
        url: '/api/v1/student-payments/initiate',
        headers: {
          'x-tenant-id': testTenantId,
          'content-type': 'application/json',
        },
        payload: paymentRequest,
      });

      expect(response.statusCode).toBe(400);
    });

    it('should require valid student and enrollment', async () => {
      const paymentRequest = {
        studentId: '00000000-0000-0000-0000-000000000000',
        enrollmentId: '00000000-0000-0000-0000-000000000000',
        feeType: 'inscription',
        amount: 50000,
        currency: 'XOF',
        paymentMethod: 'orange_money',
      };

      const response = await app.inject({
        method: 'POST',
        url: '/api/v1/student-payments/initiate',
        headers: {
          'x-tenant-id': testTenantId,
          'content-type': 'application/json',
        },
        payload: paymentRequest,
      });

      expect(response.statusCode).toBe(404);
    });
  });

  describe('POST /api/v1/student-payments/verify/:transactionId', () => {
    it('should verify payment transaction', async () => {
      // First create a transaction to verify
      if (!testTransactionId) {
        const paymentRequest = {
          studentId: testStudentId,
          enrollmentId: testEnrollmentId,
          feeType: 'inscription',
          amount: 50000,
          currency: 'XOF',
          paymentMethod: 'orange_money',
        };

        const initiateResponse = await app.inject({
          method: 'POST',
          url: '/api/v1/student-payments/initiate',
          headers: {
            'x-tenant-id': testTenantId,
            'content-type': 'application/json',
          },
          payload: paymentRequest,
        });

        const initiateData = JSON.parse(initiateResponse.payload);
        testTransactionId = initiateData.data.transactionId;
      }

      const response = await app.inject({
        method: 'POST',
        url: `/api/v1/student-payments/verify/${testTransactionId}`,
        headers: {
          'x-tenant-id': testTenantId,
        },
      });

      expect(response.statusCode).toBe(200);
      const data = JSON.parse(response.payload);
      
      expect(data.data).toHaveProperty('transactionId', testTransactionId);
      expect(data.data).toHaveProperty('status');
    });

    it('should return 404 for non-existent transaction', async () => {
      const response = await app.inject({
        method: 'POST',
        url: '/api/v1/student-payments/verify/00000000-0000-0000-0000-000000000000',
        headers: {
          'x-tenant-id': testTenantId,
        },
      });

      expect(response.statusCode).toBe(404);
    });
  });

  describe('POST /api/v1/student-payments/webhook', () => {
    it('should process valid webhook', async () => {
      const webhookPayload = {
        transaction_id: 'ext_tx_123',
        status: 'completed',
        amount: 50000,
        currency: 'XOF',
      };

      const response = await app.inject({
        method: 'POST',
        url: '/api/v1/student-payments/webhook',
        headers: {
          'content-type': 'application/json',
          'x-signature': 'mock_signature', // In real tests, generate valid signature
        },
        payload: webhookPayload,
      });

      expect(response.statusCode).toBe(200);
    });

    it('should reject webhook without signature', async () => {
      const webhookPayload = {
        transaction_id: 'ext_tx_123',
        status: 'completed',
        amount: 50000,
        currency: 'XOF',
      };

      const response = await app.inject({
        method: 'POST',
        url: '/api/v1/student-payments/webhook',
        headers: {
          'content-type': 'application/json',
        },
        payload: webhookPayload,
      });

      expect(response.statusCode).toBe(400);
    });
  });

  describe('GET /api/v1/student-payments/:studentId/transactions', () => {
    it('should return student transaction history', async () => {
      const response = await app.inject({
        method: 'GET',
        url: `/api/v1/student-payments/${testStudentId}/transactions`,
        headers: {
          'x-tenant-id': testTenantId,
        },
      });

      expect(response.statusCode).toBe(200);
      const data = JSON.parse(response.payload);
      
      expect(data).toHaveProperty('data');
      expect(Array.isArray(data.data)).toBe(true);
      expect(data).toHaveProperty('pagination');
      expect(data.pagination).toHaveProperty('total');
      expect(data.pagination).toHaveProperty('limit');
      expect(data.pagination).toHaveProperty('offset');
      expect(data.pagination).toHaveProperty('hasMore');
    });

    it('should filter transactions by fee type', async () => {
      const response = await app.inject({
        method: 'GET',
        url: `/api/v1/student-payments/${testStudentId}/transactions?feeType=inscription`,
        headers: {
          'x-tenant-id': testTenantId,
        },
      });

      expect(response.statusCode).toBe(200);
      const data = JSON.parse(response.payload);
      
      // All returned transactions should be for inscription fees
      data.data.forEach((transaction: any) => {
        expect(transaction.feeType).toBe('inscription');
      });
    });

    it('should filter transactions by status', async () => {
      const response = await app.inject({
        method: 'GET',
        url: `/api/v1/student-payments/${testStudentId}/transactions?status=pending`,
        headers: {
          'x-tenant-id': testTenantId,
        },
      });

      expect(response.statusCode).toBe(200);
      const data = JSON.parse(response.payload);
      
      // All returned transactions should have pending status
      data.data.forEach((transaction: any) => {
        expect(transaction.status).toBe('pending');
      });
    });

    it('should respect pagination limits', async () => {
      const response = await app.inject({
        method: 'GET',
        url: `/api/v1/student-payments/${testStudentId}/transactions?limit=5&offset=0`,
        headers: {
          'x-tenant-id': testTenantId,
        },
      });

      expect(response.statusCode).toBe(200);
      const data = JSON.parse(response.payload);
      
      expect(data.data.length).toBeLessThanOrEqual(5);
      expect(data.pagination.limit).toBe(5);
      expect(data.pagination.offset).toBe(0);
    });
  });
});
