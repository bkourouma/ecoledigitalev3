describe('Basic Test Setup', () => {
  test('should have proper test environment', () => {
    expect(process.env.NODE_ENV).toBe('test');
    expect(process.env.DATABASE_URL).toBeDefined();
  });

  test('should be able to import modules', () => {
    expect(require('fastify')).toBeDefined();
    expect(require('@fastify/postgres')).toBeDefined();
    expect(require('supertest')).toBeDefined();
  });
});





