import { describe, it, expect, beforeAll, afterAll, beforeEach } from '@jest/globals';
import { FastifyInstance } from 'fastify';
import { Pool } from 'pg';
import { buildApp } from '../app';

describe('Payment Flow Integration Tests', () => {
  let app: FastifyInstance;
  let pool: Pool;
  let testTenantId: string;
  let testStudentId: string;
  let testEnrollmentId: string;
  let testScheduleId: string;

  beforeAll(async () => {
    app = await buildApp({
      logger: false,
      disableRequestLogging: true,
    });

    pool = app.pg as Pool;
    await setupTestData();
  });

  afterAll(async () => {
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
        VALUES ('Integration Test School', '456 Integration St', '+225 01 23 45 67', 'integration@school.com')
        RETURNING id
      `);
      testTenantId = tenantResult.rows[0].id;

      await client.query("SET app.tenant_id = $1", [testTenantId]);

      // Create test user and student
      const userResult = await client.query(`
        INSERT INTO users (email, first_name, last_name, role)
        VALUES ('integration@test.com', 'Integration', 'Student', 'student')
        RETURNING id
      `);
      const testUserId = userResult.rows[0].id;

      const studentResult = await client.query(`
        INSERT INTO student_profiles (tenant_id, user_id, student_number, phone)
        VALUES ($1, $2, 'INT001', '+225 07 12 34 56')
        RETURNING id
      `, [testTenantId, testUserId]);
      testStudentId = studentResult.rows[0].id;

      // Create academic year and enrollment
      const academicYearResult = await client.query(`
        INSERT INTO academic_years (tenant_id, name, start_date, end_date)
        VALUES ($1, '2024-2025', '2024-09-01', '2025-06-30')
        RETURNING id
      `, [testTenantId]);
      const testAcademicYearId = academicYearResult.rows[0].id;

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

      // Create tuition payment schedule
      const scheduleResult = await client.query(`
        INSERT INTO tuition_payment_schedules (
          tenant_id, academic_year_id, schedule_name, installments, created_by
        ) VALUES ($1, $2, 'Test Schedule', $3, $4)
        RETURNING id
      `, [
        testTenantId,
        testAcademicYearId,
        JSON.stringify([
          { percentage: 40, dueDate: '2024-10-15', label: '1st Installment' },
          { percentage: 30, dueDate: '2024-12-15', label: '2nd Installment' },
          { percentage: 30, dueDate: '2025-03-15', label: '3rd Installment' },
        ]),
        testUserId
      ]);
      testScheduleId = scheduleResult.rows[0].id;

      // Generate tuition installments
      const installments = [
        { percentage: 40, amount: 80000, dueDate: '2024-10-15', label: '1st Installment' },
        { percentage: 30, amount: 60000, dueDate: '2024-12-15', label: '2nd Installment' },
        { percentage: 30, amount: 60000, dueDate: '2025-03-15', label: '3rd Installment' },
      ];

      for (let i = 0; i < installments.length; i++) {
        const installment = installments[i];
        await client.query(`
          INSERT INTO student_tuition_installments (
            tenant_id, student_id, enrollment_id, schedule_id,
            installment_number, installment_label, amount, due_date
          ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
        `, [
          testTenantId,
          testStudentId,
          testEnrollmentId,
          testScheduleId,
          i + 1,
          installment.label,
          installment.amount,
          installment.dueDate
        ]);
      }

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

  describe('Complete Payment Flow', () => {
    it('should handle complete immediate fee payment flow', async () => {
      // Step 1: Get student payment summary
      const summaryResponse = await app.inject({
        method: 'GET',
        url: `/api/v1/student-payments/${testStudentId}`,
        headers: { 'x-tenant-id': testTenantId },
      });

      expect(summaryResponse.statusCode).toBe(200);
      const summaryData = JSON.parse(summaryResponse.payload);
      
      // Verify initial state
      expect(summaryData.data.immediateFeesStatus.inscription.paid).toBe(false);
      expect(summaryData.data.immediateFeesStatus.inscription.amount).toBe(50000);

      // Step 2: Initiate payment for inscription fee
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

      expect(initiateResponse.statusCode).toBe(200);
      const initiateData = JSON.parse(initiateResponse.payload);
      const transactionId = initiateData.data.transactionId;

      // Step 3: Simulate webhook notification (payment completed)
      const webhookPayload = {
        transaction_id: `ext_${transactionId}`,
        status: 'completed',
        amount: 50000,
        currency: 'XOF',
      };

      // First, update the transaction with external ID (normally done during initiation)
      const client = await pool.connect();
      try {
        await client.query("SET app.tenant_id = $1", [testTenantId]);
        await client.query(
          "UPDATE payment_transactions SET external_transaction_id = $1 WHERE id = $2",
          [`ext_${transactionId}`, transactionId]
        );
      } finally {
        client.release();
      }

      const webhookResponse = await app.inject({
        method: 'POST',
        url: '/api/v1/student-payments/webhook',
        headers: {
          'content-type': 'application/json',
          'x-signature': 'mock_signature',
        },
        payload: webhookPayload,
      });

      expect(webhookResponse.statusCode).toBe(200);

      // Step 4: Verify payment was processed
      const verifyResponse = await app.inject({
        method: 'POST',
        url: `/api/v1/student-payments/verify/${transactionId}`,
        headers: { 'x-tenant-id': testTenantId },
      });

      expect(verifyResponse.statusCode).toBe(200);
      const verifyData = JSON.parse(verifyResponse.payload);
      expect(verifyData.data.status).toBe('completed');

      // Step 5: Check updated payment summary
      const updatedSummaryResponse = await app.inject({
        method: 'GET',
        url: `/api/v1/student-payments/${testStudentId}`,
        headers: { 'x-tenant-id': testTenantId },
      });

      expect(updatedSummaryResponse.statusCode).toBe(200);
      const updatedSummaryData = JSON.parse(updatedSummaryResponse.payload);
      
      // Verify payment was recorded
      expect(updatedSummaryData.data.totalPaid).toBe(50000);
      expect(updatedSummaryData.data.totalOutstanding).toBe(235000);

      // Step 6: Generate receipt
      const receiptResponse = await app.inject({
        method: 'POST',
        url: `/api/v1/receipts/generate/${transactionId}`,
        headers: { 'x-tenant-id': testTenantId },
      });

      expect(receiptResponse.statusCode).toBe(200);
      const receiptData = JSON.parse(receiptResponse.payload);
      expect(receiptData.data).toHaveProperty('receiptNumber');
      expect(receiptData.data).toHaveProperty('receiptUrl');
    });

    it('should handle tuition installment payment flow', async () => {
      // Step 1: Get student payment summary with installments
      const summaryResponse = await app.inject({
        method: 'GET',
        url: `/api/v1/student-payments/${testStudentId}`,
        headers: { 'x-tenant-id': testTenantId },
      });

      expect(summaryResponse.statusCode).toBe(200);
      const summaryData = JSON.parse(summaryResponse.payload);
      
      // Find first installment
      const firstInstallment = summaryData.data.tuitionInstallments.find(
        (inst: any) => inst.installmentNumber === 1
      );
      expect(firstInstallment).toBeDefined();
      expect(firstInstallment.status).toBe('pending');

      // Step 2: Initiate partial payment for first installment
      const partialAmount = 40000; // Partial payment
      const paymentRequest = {
        studentId: testStudentId,
        enrollmentId: testEnrollmentId,
        feeType: 'scolarite',
        amount: partialAmount,
        currency: 'XOF',
        paymentMethod: 'mtn_money',
        tuitionInstallmentId: firstInstallment.id,
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

      expect(initiateResponse.statusCode).toBe(200);
      const initiateData = JSON.parse(initiateResponse.payload);
      const transactionId = initiateData.data.transactionId;

      // Step 3: Complete payment via webhook
      const client = await pool.connect();
      try {
        await client.query("SET app.tenant_id = $1", [testTenantId]);
        await client.query(
          "UPDATE payment_transactions SET external_transaction_id = $1, status = 'completed', processed_at = NOW() WHERE id = $2",
          [`ext_${transactionId}`, transactionId]
        );
      } finally {
        client.release();
      }

      // Step 4: Check installment status update
      const updatedSummaryResponse = await app.inject({
        method: 'GET',
        url: `/api/v1/student-payments/${testStudentId}`,
        headers: { 'x-tenant-id': testTenantId },
      });

      expect(updatedSummaryResponse.statusCode).toBe(200);
      const updatedSummaryData = JSON.parse(updatedSummaryResponse.payload);
      
      const updatedInstallment = updatedSummaryData.data.tuitionInstallments.find(
        (inst: any) => inst.installmentNumber === 1
      );
      
      expect(updatedInstallment.status).toBe('partial');
      expect(updatedInstallment.amountPaid).toBe(partialAmount);

      // Step 5: Complete the remaining amount
      const remainingAmount = firstInstallment.amount - partialAmount;
      const completePaymentRequest = {
        studentId: testStudentId,
        enrollmentId: testEnrollmentId,
        feeType: 'scolarite',
        amount: remainingAmount,
        currency: 'XOF',
        paymentMethod: 'mtn_money',
        tuitionInstallmentId: firstInstallment.id,
      };

      const completeInitiateResponse = await app.inject({
        method: 'POST',
        url: '/api/v1/student-payments/initiate',
        headers: {
          'x-tenant-id': testTenantId,
          'content-type': 'application/json',
        },
        payload: completePaymentRequest,
      });

      expect(completeInitiateResponse.statusCode).toBe(200);
      const completeInitiateData = JSON.parse(completeInitiateResponse.payload);
      const completeTransactionId = completeInitiateData.data.transactionId;

      // Complete the second payment
      const client2 = await pool.connect();
      try {
        await client2.query("SET app.tenant_id = $1", [testTenantId]);
        await client2.query(
          "UPDATE payment_transactions SET external_transaction_id = $1, status = 'completed', processed_at = NOW() WHERE id = $2",
          [`ext_${completeTransactionId}`, completeTransactionId]
        );
      } finally {
        client2.release();
      }

      // Step 6: Verify installment is now completed
      const finalSummaryResponse = await app.inject({
        method: 'GET',
        url: `/api/v1/student-payments/${testStudentId}`,
        headers: { 'x-tenant-id': testTenantId },
      });

      expect(finalSummaryResponse.statusCode).toBe(200);
      const finalSummaryData = JSON.parse(finalSummaryResponse.payload);
      
      const finalInstallment = finalSummaryData.data.tuitionInstallments.find(
        (inst: any) => inst.installmentNumber === 1
      );
      
      expect(finalInstallment.status).toBe('completed');
      expect(finalInstallment.amountPaid).toBe(firstInstallment.amount);
    });

    it('should handle payment failure and retry flow', async () => {
      // Step 1: Initiate payment
      const paymentRequest = {
        studentId: testStudentId,
        enrollmentId: testEnrollmentId,
        feeType: 'annexes',
        amount: 25000,
        currency: 'XOF',
        paymentMethod: 'card',
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

      expect(initiateResponse.statusCode).toBe(200);
      const initiateData = JSON.parse(initiateResponse.payload);
      const transactionId = initiateData.data.transactionId;

      // Step 2: Simulate payment failure via webhook
      const client = await pool.connect();
      try {
        await client.query("SET app.tenant_id = $1", [testTenantId]);
        await client.query(
          "UPDATE payment_transactions SET external_transaction_id = $1 WHERE id = $2",
          [`ext_${transactionId}`, transactionId]
        );
      } finally {
        client.release();
      }

      const failureWebhookPayload = {
        transaction_id: `ext_${transactionId}`,
        status: 'failed',
        amount: 25000,
        currency: 'XOF',
      };

      const failureWebhookResponse = await app.inject({
        method: 'POST',
        url: '/api/v1/student-payments/webhook',
        headers: {
          'content-type': 'application/json',
          'x-signature': 'mock_signature',
        },
        payload: failureWebhookPayload,
      });

      expect(failureWebhookResponse.statusCode).toBe(200);

      // Step 3: Verify transaction is marked as failed
      const verifyResponse = await app.inject({
        method: 'POST',
        url: `/api/v1/student-payments/verify/${transactionId}`,
        headers: { 'x-tenant-id': testTenantId },
      });

      expect(verifyResponse.statusCode).toBe(200);
      const verifyData = JSON.parse(verifyResponse.payload);
      expect(verifyData.data.status).toBe('failed');

      // Step 4: Retry payment with different method
      const retryPaymentRequest = {
        studentId: testStudentId,
        enrollmentId: testEnrollmentId,
        feeType: 'annexes',
        amount: 25000,
        currency: 'XOF',
        paymentMethod: 'orange_money',
      };

      const retryInitiateResponse = await app.inject({
        method: 'POST',
        url: '/api/v1/student-payments/initiate',
        headers: {
          'x-tenant-id': testTenantId,
          'content-type': 'application/json',
        },
        payload: retryPaymentRequest,
      });

      expect(retryInitiateResponse.statusCode).toBe(200);
      const retryInitiateData = JSON.parse(retryInitiateResponse.payload);
      const retryTransactionId = retryInitiateData.data.transactionId;

      // Step 5: Complete retry payment
      const client2 = await pool.connect();
      try {
        await client2.query("SET app.tenant_id = $1", [testTenantId]);
        await client2.query(
          "UPDATE payment_transactions SET external_transaction_id = $1, status = 'completed', processed_at = NOW() WHERE id = $2",
          [`ext_${retryTransactionId}`, retryTransactionId]
        );
      } finally {
        client2.release();
      }

      // Step 6: Verify retry payment succeeded
      const retryVerifyResponse = await app.inject({
        method: 'POST',
        url: `/api/v1/student-payments/verify/${retryTransactionId}`,
        headers: { 'x-tenant-id': testTenantId },
      });

      expect(retryVerifyResponse.statusCode).toBe(200);
      const retryVerifyData = JSON.parse(retryVerifyResponse.payload);
      expect(retryVerifyData.data.status).toBe('completed');

      // Step 7: Check transaction history shows both attempts
      const historyResponse = await app.inject({
        method: 'GET',
        url: `/api/v1/student-payments/${testStudentId}/transactions?feeType=annexes`,
        headers: { 'x-tenant-id': testTenantId },
      });

      expect(historyResponse.statusCode).toBe(200);
      const historyData = JSON.parse(historyResponse.payload);
      
      expect(historyData.data.length).toBe(2);
      const transactions = historyData.data;
      expect(transactions.some((tx: any) => tx.status === 'failed')).toBe(true);
      expect(transactions.some((tx: any) => tx.status === 'completed')).toBe(true);
    });
  });
});
