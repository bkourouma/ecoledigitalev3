# API Test Suite Documentation

This document describes the comprehensive test suite for the EcoleDigitale API endpoints.

## Overview

The test suite covers all API endpoints to ensure they work correctly and handle various scenarios including:
- Successful operations
- Error conditions
- Authentication and authorization
- Data validation
- Database operations

## Test Structure

### Test Files
- `src/__tests__/api-endpoints.test.ts` - Main test suite for all endpoints
- `src/__tests__/utils/test-utils.ts` - Test utilities and helper functions
- `src/__tests__/setup.ts` - Test environment setup

### Test Categories

#### 1. Health Endpoints
- `GET /api/v1/health` - Application health check
- `GET /api/v1/health/db` - Database health check

#### 2. Authentication Endpoints
- `POST /api/v1/auth/login` - User authentication
  - Valid credentials
  - Invalid credentials
  - Missing tenant context

#### 3. Users Endpoints
- `GET /api/v1/users` - List all users
- `GET /api/v1/users/:id` - Get specific user

#### 4. Academic Module Endpoints

##### Cycles
- `GET /api/v1/cycles` - List all cycles
- `POST /api/v1/cycles` - Create new cycle
- `GET /api/v1/cycles/:id` - Get specific cycle

##### Programmes
- `GET /api/v1/programmes` - List all programmes
- `POST /api/v1/programmes` - Create new programme

##### Courses
- `GET /api/v1/courses` - List all courses
- `POST /api/v1/courses` - Create new course

##### Teachers
- `GET /api/v1/teachers` - List all teachers
- `POST /api/v1/teachers` - Create new teacher

##### Students
- `GET /api/v1/students` - List all students
- `POST /api/v1/students` - Create new student

#### 5. Error Handling
- 404 for non-existent endpoints
- 400 for invalid JSON
- 401 for unauthorized access

## Running Tests

### Prerequisites
- Node.js and pnpm installed
- PostgreSQL database running
- Environment variables configured

### Quick Start
```bash
# From the root directory
./test-all-api.bat

# Or from the API directory
cd apps/api
pnpm test
```

### Test Commands
```bash
# Run all tests
pnpm test

# Run tests in watch mode
pnpm test:watch

# Run tests with coverage report
pnpm test:coverage
```

### Test Environment Setup
The test suite automatically:
1. Sets up a test database connection
2. Creates test tenants and users
3. Cleans up test data after each test
4. Handles authentication for protected endpoints

## Test Utilities

### TestUtils Class
Provides helper methods for:
- Creating test tenants and users
- Authenticating users
- Making authenticated requests
- Cleaning up test data

### Test Data Management
- Each test creates its own test data
- Data is automatically cleaned up after each test
- Tests are isolated from each other

## Coverage Report

After running tests with coverage, you can view the detailed coverage report:
```
apps/api/coverage/index.html
```

The coverage report shows:
- Line coverage
- Branch coverage
- Function coverage
- Statement coverage

## Troubleshooting

### Common Issues

1. **Database Connection Failed**
   - Ensure PostgreSQL is running
   - Check DATABASE_URL environment variable
   - Verify database exists and is accessible

2. **Test Timeout**
   - Increase timeout in jest.config.js if needed
   - Check for slow database queries

3. **Authentication Failures**
   - Verify tenant context is properly set
   - Check user roles and permissions

### Debug Mode
To run tests in debug mode:
```bash
# Enable verbose logging
NODE_ENV=test DEBUG=* pnpm test
```

## Adding New Tests

When adding new endpoints, follow these patterns:

1. **Create test data** using TestUtils
2. **Test successful operations** first
3. **Test error conditions** and edge cases
4. **Verify response structure** and data types
5. **Clean up test data** in afterEach

### Example Test Structure
```typescript
describe('New Endpoint', () => {
  test('should perform expected operation', async () => {
    const user = await testUtils.createTestUser(['admin']);
    
    const response = await testUtils.makeAuthenticatedRequest(
      'post', 
      '/api/v1/new-endpoint', 
      user, 
      testData
    ).expect(201);
    
    expect(response.body).toHaveProperty('id');
    // Add more assertions...
  });
});
```

## Continuous Integration

The test suite is designed to run in CI/CD pipelines:
- Fast execution (under 30 seconds)
- Isolated tests
- Automatic cleanup
- Clear error reporting

## Performance Considerations

- Tests use a separate test database
- Each test is isolated
- Database connections are properly managed
- Test data is minimal and focused

## Security Testing

The test suite includes security-related tests:
- Authentication validation
- Authorization checks
- Input validation
- SQL injection prevention
- XSS protection

## Maintenance

- Update tests when API endpoints change
- Add tests for new features
- Review coverage reports regularly
- Keep test utilities up to date





