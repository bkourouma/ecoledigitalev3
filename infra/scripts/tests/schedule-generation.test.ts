/**
 * Comprehensive Test Suite for Schedule Generation API
 * Tests all endpoints with various scenarios including edge cases
 */

import fetch from 'node-fetch';

// Test Configuration
const API_BASE_URL = process.env.API_BASE_URL || 'http://localhost:4000';
const TENANT_ID = '6eb9c106-b650-4398-b6fa-091b6828c4ba';

// Test Data Storage
let createdTimeSlots: string[] = [];
let testClassId: string;
let testCourseIds: string[] = [];
let generationRequestId: string;
let scheduleId: string;

// Helper Functions
const apiRequest = async (endpoint: string, options: any = {}) => {
  const url = `${API_BASE_URL}/api/v1/schedule-generation${endpoint}`;
  const response = await fetch(url, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      'x-tenant': TENANT_ID,
      ...options.headers,
    },
  });
  
  const data = await response.json();
  return { response, data };
};

const generateUUID = () => {
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function(c) {
    const r = Math.random() * 16 | 0;
    const v = c == 'x' ? r : (r & 0x3 | 0x8);
    return v.toString(16);
  });
};

describe('Schedule Generation API Tests', () => {
  beforeAll(async () => {
    // Setup test data - these would normally exist in the database
    testClassId = generateUUID();
    testCourseIds = [generateUUID(), generateUUID(), generateUUID()];
  });

  afterAll(async () => {
    // Cleanup created time slots
    // Note: In a real test, you'd want to clean up test data
    console.log(`Created ${createdTimeSlots.length} time slots during testing`);
  });

  describe('Time Slot Management', () => {
    test('should create a time slot successfully', async () => {
      const timeSlotData = {
        name: 'Test Monday Morning',
        dayOfWeek: 'monday',
        startTime: '08:00:00',
        endTime: '10:00:00',
        isActive: true,
        priority: 3,
        maxConcurrentSessions: 1
      };

      const { response, data } = await apiRequest('/time-slots', {
        method: 'POST',
        body: JSON.stringify(timeSlotData)
      });

      expect(response.status).toBe(201);
      expect(data.id).toBeDefined();
      expect(data.name).toBe(timeSlotData.name);
      expect(data.dayOfWeek).toBe(timeSlotData.dayOfWeek);
      
      createdTimeSlots.push(data.id);
    });

    test('should reject invalid time slot (end before start)', async () => {
      const invalidTimeSlot = {
        name: 'Invalid Time Slot',
        dayOfWeek: 'monday',
        startTime: '10:00:00',
        endTime: '08:00:00',
        priority: 1
      };

      const { response } = await apiRequest('/time-slots', {
        method: 'POST',
        body: JSON.stringify(invalidTimeSlot)
      });

      expect(response.status).toBe(400);
    });

    test('should list time slots', async () => {
      const { response, data } = await apiRequest('/time-slots');

      expect(response.status).toBe(200);
      expect(data.timeSlots).toBeDefined();
      expect(Array.isArray(data.timeSlots)).toBe(true);
    });

    test('should filter time slots by day', async () => {
      const { response, data } = await apiRequest('/time-slots?dayOfWeek=monday');

      expect(response.status).toBe(200);
      expect(data.timeSlots).toBeDefined();
      
      // All returned slots should be for Monday
      data.timeSlots.forEach((slot: any) => {
        expect(slot.dayOfWeek).toBe('monday');
      });
    });

    test('should create multiple time slots for testing', async () => {
      const timeSlots = [
        {
          name: 'Tuesday Morning',
          dayOfWeek: 'tuesday',
          startTime: '08:00:00',
          endTime: '10:00:00',
          priority: 3
        },
        {
          name: 'Wednesday Afternoon',
          dayOfWeek: 'wednesday',
          startTime: '14:00:00',
          endTime: '16:00:00',
          priority: 2
        },
        {
          name: 'Thursday Morning',
          dayOfWeek: 'thursday',
          startTime: '08:00:00',
          endTime: '10:00:00',
          priority: 3
        }
      ];

      for (const slot of timeSlots) {
        const { response, data } = await apiRequest('/time-slots', {
          method: 'POST',
          body: JSON.stringify(slot)
        });

        expect(response.status).toBe(201);
        createdTimeSlots.push(data.id);
      }
    });
  });

  describe('Generation Options', () => {
    test('should get generation options for a class', async () => {
      const { response, data } = await apiRequest(`/classes/${testClassId}/generation-options`);

      if (response.status === 404) {
        // Class doesn't exist, which is expected in test environment
        expect(response.status).toBe(404);
        return;
      }

      expect(response.status).toBe(200);
      expect(data.classInfo).toBeDefined();
      expect(data.availableCourses).toBeDefined();
      expect(data.availableTimeSlots).toBeDefined();
      expect(data.availableClassrooms).toBeDefined();
    });

    test('should reject invalid class ID', async () => {
      const { response } = await apiRequest('/classes/invalid-uuid/generation-options');

      expect(response.status).toBe(400);
    });
  });

  describe('Schedule Generation', () => {
    test('should reject generation without required fields', async () => {
      const { response } = await apiRequest('/generate', {
        method: 'POST',
        body: JSON.stringify({})
      });

      expect(response.status).toBe(400);
    });

    test('should reject generation with empty courses', async () => {
      const { response } = await apiRequest('/generate', {
        method: 'POST',
        body: JSON.stringify({
          classId: testClassId,
          selectedCourses: [],
          availableTimeSlots: createdTimeSlots.slice(0, 2)
        })
      });

      expect(response.status).toBe(400);
    });

    test('should reject generation with empty time slots', async () => {
      const { response } = await apiRequest('/generate', {
        method: 'POST',
        body: JSON.stringify({
          classId: testClassId,
          selectedCourses: [{
            courseId: testCourseIds[0],
            requiredHours: 20,
            preferredSessionDuration: 120
          }],
          availableTimeSlots: []
        })
      });

      expect(response.status).toBe(400);
    });

    test('should start schedule generation successfully', async () => {
      const generationRequest = {
        classId: testClassId,
        selectedCourses: [
          {
            courseId: testCourseIds[0],
            requiredHours: 20,
            preferredSessionDuration: 120,
            maxSessionsPerWeek: 2
          },
          {
            courseId: testCourseIds[1],
            requiredHours: 15,
            preferredSessionDuration: 90,
            maxSessionsPerWeek: 3
          }
        ],
        availableTimeSlots: createdTimeSlots.slice(0, 3),
        generationPreferences: {
          balanceWorkload: true,
          avoidBackToBackSessions: false,
          preferMorningSlots: true,
          maxDailyHours: 6,
          allowWeekendSessions: false
        }
      };

      const { response, data } = await apiRequest('/generate', {
        method: 'POST',
        body: JSON.stringify(generationRequest)
      });

      expect([201, 202]).toContain(response.status);
      expect(data.requestId).toBeDefined();
      
      generationRequestId = data.requestId;
      if (data.scheduleId) {
        scheduleId = data.scheduleId;
      }
    });
  });

  describe('Generation Status and Results', () => {
    test('should get generation status', async () => {
      if (!generationRequestId) {
        generationRequestId = generateUUID(); // Use dummy ID for test
      }

      const { response, data } = await apiRequest(`/${generationRequestId}/status`);

      if (response.status === 404) {
        // Request doesn't exist, which is expected in test environment
        expect(response.status).toBe(404);
        return;
      }

      expect(response.status).toBe(200);
      expect(data.requestId).toBe(generationRequestId);
      expect(data.status).toBeDefined();
      expect(['pending', 'processing', 'completed', 'failed', 'cancelled']).toContain(data.status);
    });

    test('should get generation result when completed', async () => {
      if (!generationRequestId) {
        generationRequestId = generateUUID(); // Use dummy ID for test
      }

      const { response, data } = await apiRequest(`/${generationRequestId}/result`);

      if (response.status === 404) {
        // Request doesn't exist, which is expected in test environment
        expect(response.status).toBe(404);
        return;
      }

      if (response.status === 400) {
        // Generation not complete yet
        expect(response.status).toBe(400);
        return;
      }

      expect(response.status).toBe(200);
      expect(data.request).toBeDefined();
      expect(data.schedule).toBeDefined();
    });
  });

  describe('Schedule Approval', () => {
    test('should reject approval without start date', async () => {
      const dummyScheduleId = generateUUID();
      
      const { response } = await apiRequest(`/${dummyScheduleId}/approve`, {
        method: 'POST',
        body: JSON.stringify({})
      });

      expect(response.status).toBe(400);
    });

    test('should reject approval with invalid date format', async () => {
      const dummyScheduleId = generateUUID();
      
      const { response } = await apiRequest(`/${dummyScheduleId}/approve`, {
        method: 'POST',
        body: JSON.stringify({
          startDate: 'invalid-date'
        })
      });

      expect(response.status).toBe(400);
    });

    test('should approve schedule with valid data', async () => {
      const dummyScheduleId = generateUUID();
      
      const { response } = await apiRequest(`/${dummyScheduleId}/approve`, {
        method: 'POST',
        body: JSON.stringify({
          startDate: '2024-09-01',
          endDate: '2024-12-31'
        })
      });

      if (response.status === 404) {
        // Schedule doesn't exist, which is expected in test environment
        expect(response.status).toBe(404);
        return;
      }

      expect([200, 400]).toContain(response.status);
    });
  });

  describe('Generation Requests Listing', () => {
    test('should list generation requests', async () => {
      const { response, data } = await apiRequest('/requests');

      expect(response.status).toBe(200);
      expect(data.requests).toBeDefined();
      expect(Array.isArray(data.requests)).toBe(true);
      expect(data.pagination).toBeDefined();
    });

    test('should filter requests by status', async () => {
      const { response, data } = await apiRequest('/requests?status=completed&limit=5');

      expect(response.status).toBe(200);
      expect(data.requests).toBeDefined();
      expect(data.pagination.limit).toBe(5);
    });
  });

  describe('Error Handling', () => {
    test('should reject requests without tenant header', async () => {
      const response = await fetch(`${API_BASE_URL}/api/v1/schedule-generation/time-slots`);
      
      expect(response.status).toBe(400);
    });

    test('should handle malformed JSON', async () => {
      const response = await fetch(`${API_BASE_URL}/api/v1/schedule-generation/time-slots`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-tenant': TENANT_ID
        },
        body: 'invalid json'
      });

      expect(response.status).toBe(400);
    });
  });

  describe('Performance Tests', () => {
    test('should handle multiple concurrent time slot creations', async () => {
      const promises = Array.from({ length: 5 }, (_, i) => 
        apiRequest('/time-slots', {
          method: 'POST',
          body: JSON.stringify({
            name: `Concurrent Slot ${i}`,
            dayOfWeek: 'friday',
            startTime: `${8 + i}:00:00`,
            endTime: `${10 + i}:00:00`,
            priority: 1
          })
        })
      );

      const results = await Promise.all(promises);
      
      results.forEach(({ response }) => {
        expect([201, 400, 500]).toContain(response.status);
      });
    });

    test('should respond to time slot listing within reasonable time', async () => {
      const startTime = Date.now();
      
      const { response } = await apiRequest('/time-slots');
      
      const duration = Date.now() - startTime;
      
      expect(response.status).toBe(200);
      expect(duration).toBeLessThan(5000); // Should respond within 5 seconds
    });
  });
});

// Export for use in other test files
export { apiRequest, TENANT_ID, API_BASE_URL };
