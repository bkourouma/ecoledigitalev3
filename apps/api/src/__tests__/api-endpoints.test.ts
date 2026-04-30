import Fastify, { FastifyInstance } from 'fastify';
import cors from '@fastify/cors';
import helmet from '@fastify/helmet';
import postgres from '@fastify/postgres';
import request from 'supertest';
import { tenantContextPlugin } from '../plugins/tenant-context';
import { healthRoutes } from '../routes/health';
import { authRoutes } from '../routes/auth';
import { cyclesRoutes } from '../routes/cycles';
import { programmesRoutes } from '../routes/programmes';
import { coursesRoutes } from '../routes/courses';
import { teachersRoutes } from '../routes/teachers';
import { studentsRoutes } from '../routes/students';
import { usersRoutes } from '../routes/users';
import { TestUtils, setupTestDatabase } from './utils/test-utils';

describe('API Endpoints', () => {
  let fastify: FastifyInstance;
  let testUtils: TestUtils;

  beforeAll(async () => {
    // Create Fastify instance for testing
    fastify = Fastify({
      logger: false, // Disable logging during tests
    });

    // Register plugins
    await fastify.register(helmet);
    await fastify.register(cors, {
      origin: true,
      credentials: true,
    });

    // Register PostgreSQL plugin
    await fastify.register(postgres, {
      connectionString: process.env.DATABASE_URL,
    });

    // Register custom plugins
    await fastify.register(tenantContextPlugin);

    // Register routes
    await fastify.register(healthRoutes, { prefix: '/api/v1' });
    await fastify.register(authRoutes, { prefix: '/api/v1/auth' });
    await fastify.register(cyclesRoutes, { prefix: '/api/v1/cycles' });
    await fastify.register(programmesRoutes, { prefix: '/api/v1/programmes' });
    await fastify.register(coursesRoutes, { prefix: '/api/v1/courses' });
    await fastify.register(teachersRoutes, { prefix: '/api/v1/teachers' });
    await fastify.register(studentsRoutes, { prefix: '/api/v1/students' });
    await fastify.register(usersRoutes, { prefix: '/api/v1/users' });

    // Initialize test utilities
    testUtils = new TestUtils(fastify);

    // Setup test database
    await setupTestDatabase(fastify);
  });

  afterAll(async () => {
    await fastify.close();
  });

  afterEach(async () => {
    await testUtils.cleanup();
  });

  describe('Health Endpoints', () => {
    test('GET /api/v1/health should return health status', async () => {
      const response = await request(fastify.server)
        .get('/api/v1/health');

      expect(response.status).toBe(200);
      expect(response.body).toHaveProperty('ok', true);
      expect(response.body).toHaveProperty('timestamp');
      expect(response.body).toHaveProperty('uptime');
      expect(response.body).toHaveProperty('environment');
      expect(response.body).toHaveProperty('version');
    });

    test('GET /api/v1/health/db should return database health status', async () => {
      const response = await request(fastify.server)
        .get('/api/v1/health/db');

      expect(response.status).toBe(200);
      expect(response.body).toHaveProperty('ok', true);
      expect(response.body).toHaveProperty('database', 'connected');
      expect(response.body).toHaveProperty('timestamp');
    });
  });

  describe('Authentication Endpoints', () => {
    test('POST /api/v1/auth/login should authenticate valid user', async () => {
      const user = await testUtils.createTestUser(['user']);

      const response = await request(fastify.server)
        .post('/api/v1/auth/login')
        .set('X-Tenant-ID', user.tenantId)
        .send({
          email: user.email,
          password: user.password,
        });

      expect(response.status).toBe(200);

      expect(response.body).toHaveProperty('id');
      expect(response.body).toHaveProperty('email', user.email);
      expect(response.body).toHaveProperty('firstName');
      expect(response.body).toHaveProperty('lastName');
      expect(response.body).toHaveProperty('tenantId', user.tenantId);
      expect(response.body).toHaveProperty('tenantSlug');
      expect(response.body).toHaveProperty('roles');
    });

    test('POST /api/v1/auth/login should reject invalid credentials', async () => {
      const user = await testUtils.createTestUser(['user']);

      const response = await request(fastify.server)
        .post('/api/v1/auth/login')
        .set('X-Tenant-ID', user.tenantId)
        .send({
          email: user.email,
          password: 'wrongpassword',
        });

      expect(response.status).toBe(401);

      expect(response.body).toHaveProperty('error', 'Invalid Credentials');
    });

    test('POST /api/v1/auth/login should require tenant context', async () => {
      const user = await testUtils.createTestUser(['user']);

      const response = await request(fastify.server)
        .post('/api/v1/auth/login')
        .send({
          email: user.email,
          password: user.password,
        });

      expect(response.status).toBe(400);

      expect(response.body).toHaveProperty('error', 'Tenant Required');
    });
  });

  describe('Users Endpoints', () => {
    test('GET /api/v1/users should return users list', async () => {
      const user = await testUtils.createTestUser(['admin']);

      const response = await testUtils.makeAuthenticatedRequest('get', '/api/v1/users', user);

      expect(response.status).toBe(200);

      expect(Array.isArray(response.body)).toBe(true);
      expect(response.body.length).toBeGreaterThan(0);
    });

    test('GET /api/v1/users/:id should return specific user', async () => {
      const user = await testUtils.createTestUser(['admin']);

      const response = await testUtils.makeAuthenticatedRequest('get', `/api/v1/users/${user.id}`, user);

      expect(response.status).toBe(200);
      expect(response.body).toHaveProperty('id', user.id);
      expect(response.body).toHaveProperty('email', user.email);
    });
  });

  describe('Cycles Endpoints', () => {
    test('GET /api/v1/cycles should return cycles list', async () => {
      const user = await testUtils.createTestUser(['admin']);

      const response = await testUtils.makeAuthenticatedRequest('get', '/api/v1/cycles', user);

      expect(response.status).toBe(200);
      expect(Array.isArray(response.body)).toBe(true);
    });

    test('POST /api/v1/cycles should create new cycle', async () => {
      const user = await testUtils.createTestUser(['admin']);
      const cycleData = {
        name: 'Test Cycle',
        description: 'Test cycle description',
        startDate: '2024-01-01',
        endDate: '2024-12-31',
      };

      const response = await testUtils.makeAuthenticatedRequest('post', '/api/v1/cycles', user, cycleData);

      expect(response.status).toBe(201);
      expect(response.body).toHaveProperty('id');
      expect(response.body).toHaveProperty('name', cycleData.name);
      expect(response.body).toHaveProperty('description', cycleData.description);
    });

    test('GET /api/v1/cycles/:id should return specific cycle', async () => {
      const user = await testUtils.createTestUser(['admin']);
      
      // First create a cycle
      const cycleData = {
        name: 'Test Cycle',
        description: 'Test cycle description',
        startDate: '2024-01-01',
        endDate: '2024-12-31',
      };

      const createResponse = await testUtils.makeAuthenticatedRequest('post', '/api/v1/cycles', user, cycleData);

      expect(createResponse.status).toBe(201);
      const cycleId = createResponse.body.id;

      // Then get the cycle
      const response = await testUtils.makeAuthenticatedRequest('get', `/api/v1/cycles/${cycleId}`, user);

      expect(response.status).toBe(200);
      expect(response.body).toHaveProperty('id', cycleId);
      expect(response.body).toHaveProperty('name', cycleData.name);
    });
  });

  describe('Programmes Endpoints', () => {
    test('GET /api/v1/programmes should return programmes list', async () => {
      const user = await testUtils.createTestUser(['admin']);

      const response = await testUtils.makeAuthenticatedRequest('get', '/api/v1/programmes', user);

      expect(response.status).toBe(200);
      expect(Array.isArray(response.body)).toBe(true);
    });

    test('POST /api/v1/programmes should create new programme', async () => {
      const user = await testUtils.createTestUser(['admin']);
      const programmeData = {
        name: 'Test Programme',
        description: 'Test programme description',
        duration: 12,
        level: 'Bachelor',
      };

      const response = await testUtils.makeAuthenticatedRequest('post', '/api/v1/programmes', user, programmeData);

      expect(response.status).toBe(201);
      expect(response.body).toHaveProperty('id');
      expect(response.body).toHaveProperty('name', programmeData.name);
      expect(response.body).toHaveProperty('description', programmeData.description);
    });
  });

  describe('Courses Endpoints', () => {
    test('GET /api/v1/courses should return courses list', async () => {
      const user = await testUtils.createTestUser(['admin']);

      const response = await testUtils.makeAuthenticatedRequest('get', '/api/v1/courses', user);

      expect(response.status).toBe(200);
      expect(Array.isArray(response.body)).toBe(true);
    });

    test('POST /api/v1/courses should create new course', async () => {
      const user = await testUtils.createTestUser(['admin']);
      const courseData = {
        name: 'Test Course',
        description: 'Test course description',
        credits: 3,
        duration: 16,
      };

      const response = await testUtils.makeAuthenticatedRequest('post', '/api/v1/courses', user, courseData);

      expect(response.status).toBe(201);
      expect(response.body).toHaveProperty('id');
      expect(response.body).toHaveProperty('name', courseData.name);
      expect(response.body).toHaveProperty('description', courseData.description);
    });
  });

  describe('Teachers Endpoints', () => {
    test('GET /api/v1/teachers should return teachers list', async () => {
      const user = await testUtils.createTestUser(['admin']);

      const response = await testUtils.makeAuthenticatedRequest('get', '/api/v1/teachers', user);

      expect(response.status).toBe(200);
      expect(Array.isArray(response.body)).toBe(true);
    });

    test('POST /api/v1/teachers should create new teacher', async () => {
      const user = await testUtils.createTestUser(['admin']);
      const teacherData = {
        firstName: 'John',
        lastName: 'Doe',
        email: 'john.doe@example.com',
        phone: '+1234567890',
        specialization: 'Mathematics',
        hireDate: '2024-01-01',
      };

      const response = await testUtils.makeAuthenticatedRequest('post', '/api/v1/teachers', user, teacherData);

      expect(response.status).toBe(201);
      expect(response.body).toHaveProperty('id');
      expect(response.body).toHaveProperty('firstName', teacherData.firstName);
      expect(response.body).toHaveProperty('lastName', teacherData.lastName);
      expect(response.body).toHaveProperty('email', teacherData.email);
    });
  });

  describe('Students Endpoints', () => {
    test('GET /api/v1/students should return students list', async () => {
      const user = await testUtils.createTestUser(['admin']);

      const response = await testUtils.makeAuthenticatedRequest('get', '/api/v1/students', user);

      expect(response.status).toBe(200);
      expect(Array.isArray(response.body)).toBe(true);
    });

    test('POST /api/v1/students should create new student', async () => {
      const user = await testUtils.createTestUser(['admin']);
      const studentData = {
        firstName: 'Jane',
        lastName: 'Smith',
        email: 'jane.smith@example.com',
        phone: '+1234567890',
        dateOfBirth: '2000-01-01',
        address: '123 Main St',
        enrollmentDate: '2024-01-01',
      };

      const response = await testUtils.makeAuthenticatedRequest('post', '/api/v1/students', user, studentData);

      expect(response.status).toBe(201);
      expect(response.body).toHaveProperty('id');
      expect(response.body).toHaveProperty('firstName', studentData.firstName);
      expect(response.body).toHaveProperty('lastName', studentData.lastName);
      expect(response.body).toHaveProperty('email', studentData.email);
    });
  });

  describe('Error Handling', () => {
    test('Should return 404 for non-existent endpoints', async () => {
      const response = await request(fastify.server)
        .get('/api/v1/nonexistent');

      expect(response.status).toBe(404);
    });

    test('Should return 400 for invalid JSON', async () => {
      const response = await request(fastify.server)
        .post('/api/v1/auth/login')
        .set('Content-Type', 'application/json')
        .send('invalid json');

      expect(response.status).toBe(400);
    });

    test('Should return 401 for unauthorized access', async () => {
      const response = await request(fastify.server)
        .get('/api/v1/users');

      expect(response.status).toBe(401);
    });
  });
});
