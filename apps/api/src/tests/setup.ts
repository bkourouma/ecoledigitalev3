import { jest } from '@jest/globals';

// Mock environment variables for testing
process.env.NODE_ENV = 'test';
process.env.DATABASE_URL = process.env.TEST_DATABASE_URL || 'postgresql://localhost:5432/dbecoledigitale_test';
process.env.JWT_SECRET = 'test-jwt-secret';
process.env.TRESORPAY_API_KEY = 'test-tresorpay-api-key';
process.env.TRESORPAY_SECRET_KEY = 'test-tresorpay-secret-key';
process.env.TRESORPAY_MERCHANT_ID = 'test-merchant-id';
process.env.TRESORPAY_BASE_URL = 'https://api.test.tresorpay.com/v1';
process.env.TRESORPAY_WEBHOOK_SECRET = 'test-webhook-secret';
process.env.EMAIL_API_KEY = 'test-email-api-key';
process.env.EMAIL_FROM_ADDRESS = 'test@ecoledigitale.com';
process.env.EMAIL_FROM_NAME = 'École Digitale Test';
process.env.SMS_API_KEY = 'test-sms-api-key';
process.env.SMS_SENDER_ID = 'EcoleTest';
process.env.APP_BASE_URL = 'http://localhost:3000';
process.env.API_BASE_URL = 'http://localhost:4000';

// Mock console methods to reduce noise in tests
const originalConsoleError = console.error;
const originalConsoleWarn = console.warn;
const originalConsoleLog = console.log;

beforeAll(() => {
  // Suppress console output during tests unless explicitly needed
  console.error = jest.fn();
  console.warn = jest.fn();
  console.log = jest.fn();
});

afterAll(() => {
  // Restore original console methods
  console.error = originalConsoleError;
  console.warn = originalConsoleWarn;
  console.log = originalConsoleLog;
});

// Global test utilities
global.testUtils = {
  // Helper to generate test UUIDs
  generateTestUUID: () => {
    return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function(c) {
      const r = Math.random() * 16 | 0;
      const v = c === 'x' ? r : (r & 0x3 | 0x8);
      return v.toString(16);
    });
  },

  // Helper to create test dates
  createTestDate: (daysFromNow: number = 0) => {
    const date = new Date();
    date.setDate(date.getDate() + daysFromNow);
    return date;
  },

  // Helper to format currency for tests
  formatCurrency: (amount: number) => {
    return new Intl.NumberFormat("fr-FR", {
      style: "currency",
      currency: "XOF",
      minimumFractionDigits: 0,
    }).format(amount);
  },

  // Helper to wait for async operations
  wait: (ms: number) => new Promise(resolve => setTimeout(resolve, ms)),

  // Helper to create test payment data
  createTestPaymentData: () => ({
    studentId: global.testUtils.generateTestUUID(),
    enrollmentId: global.testUtils.generateTestUUID(),
    feeType: 'inscription' as const,
    amount: 50000,
    currency: 'XOF',
    paymentMethod: 'orange_money' as const,
  }),

  // Helper to create test student data
  createTestStudentData: () => ({
    firstName: 'Test',
    lastName: 'Student',
    email: `test.student.${Date.now()}@example.com`,
    phone: '+225 07 12 34 56',
    studentNumber: `TS${Date.now().toString().slice(-6)}`,
  }),

  // Helper to create test enrollment data
  createTestEnrollmentData: () => ({
    fees: {
      inscription: 50000,
      scolarite: 200000,
      annexes: 25000,
      autres: 10000,
      total: 285000,
    },
    status: 'active' as const,
  }),

  // Helper to create test tuition schedule data
  createTestTuitionScheduleData: () => ({
    scheduleName: `Test Schedule ${Date.now()}`,
    installments: [
      { percentage: 40, dueDate: '2024-10-15', label: '1st Installment' },
      { percentage: 30, dueDate: '2024-12-15', label: '2nd Installment' },
      { percentage: 30, dueDate: '2025-03-15', label: '3rd Installment' },
    ],
  }),
};

// Extend global types for TypeScript
declare global {
  var testUtils: {
    generateTestUUID: () => string;
    createTestDate: (daysFromNow?: number) => Date;
    formatCurrency: (amount: number) => string;
    wait: (ms: number) => Promise<void>;
    createTestPaymentData: () => any;
    createTestStudentData: () => any;
    createTestEnrollmentData: () => any;
    createTestTuitionScheduleData: () => any;
  };
}

// Mock fetch for gateway tests
if (!global.fetch) {
  global.fetch = jest.fn() as jest.MockedFunction<typeof fetch>;
}

// Setup test database connection pool
let testPool: any;

export const getTestPool = () => {
  if (!testPool) {
    const { Pool } = require('pg');
    testPool = new Pool({
      connectionString: process.env.DATABASE_URL,
      max: 5, // Limit connections for tests
    });
  }
  return testPool;
};

export const closeTestPool = async () => {
  if (testPool) {
    await testPool.end();
    testPool = null;
  }
};

// Test database helpers
export const testDb = {
  async query(text: string, params?: any[]) {
    const pool = getTestPool();
    return pool.query(text, params);
  },

  async getClient() {
    const pool = getTestPool();
    return pool.connect();
  },

  async createTestTenant() {
    const client = await this.getClient();
    try {
      const result = await client.query(`
        INSERT INTO tenants (name, address, phone, email)
        VALUES ('Test Tenant', '123 Test St', '+225 01 23 45 67', 'test@tenant.com')
        RETURNING id
      `);
      return result.rows[0].id;
    } finally {
      client.release();
    }
  },

  async cleanupTestTenant(tenantId: string) {
    const client = await this.getClient();
    try {
      await client.query('DELETE FROM tenants WHERE id = $1', [tenantId]);
    } finally {
      client.release();
    }
  },

  async setTenantContext(tenantId: string) {
    const client = await this.getClient();
    try {
      await client.query('SET app.tenant_id = $1', [tenantId]);
      return client;
    } catch (error) {
      client.release();
      throw error;
    }
  },
};

// Mock payment gateway responses
export const mockGatewayResponses = {
  successfulPaymentInitiation: {
    status: 'success',
    message: 'Payment initiated successfully',
    data: {
      transaction_id: 'ext_tx_123456',
      payment_url: 'https://pay.tresorpay.com/pay/ext_tx_123456',
      payment_token: 'token_123456',
    },
  },

  failedPaymentInitiation: {
    status: 'error',
    message: 'Payment initiation failed',
    error: 'INVALID_PAYMENT_METHOD',
  },

  successfulPaymentVerification: {
    status: 'success',
    data: {
      transaction_id: 'ext_tx_123456',
      status: 'completed',
      amount: 50000,
      currency: 'XOF',
      payment_method: 'ORANGE_MONEY',
      processed_at: '2024-08-24T10:30:00Z',
    },
  },

  failedPaymentVerification: {
    status: 'error',
    error: 'Transaction not found',
  },

  successfulRefund: {
    status: 'success',
    message: 'Refund processed successfully',
    data: {
      refund_id: 'refund_123456',
      transaction_id: 'ext_tx_123456',
      amount: 25000,
      status: 'pending',
    },
  },

  completedWebhook: {
    transaction_id: 'ext_tx_123456',
    status: 'completed',
    amount: 50000,
    currency: 'XOF',
    payment_method: 'ORANGE_MONEY',
    processed_at: '2024-08-24T10:30:00Z',
  },

  failedWebhook: {
    transaction_id: 'ext_tx_123456',
    status: 'failed',
    amount: 50000,
    currency: 'XOF',
    payment_method: 'ORANGE_MONEY',
    error_code: 'INSUFFICIENT_FUNDS',
    error_message: 'Insufficient funds in account',
  },
};

// Export test utilities for use in test files
export const testUtils = global.testUtils;
