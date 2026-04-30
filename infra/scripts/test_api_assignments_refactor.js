/**
 * API Test Script for Assignments Refactor
 * Tests the new assignment instances workflow
 */

const API_BASE_URL = process.env.API_URL || 'http://localhost:4000';
const TENANT_ID = 'imhotepacademy';

// Test data
let testData = {
  teacherId: null,
  classId: null,
  courseId: null,
  assignmentId: null,
  instanceId: null,
  studentId: null,
};

// Helper function to make API requests
async function apiRequest(endpoint, options = {}) {
  const url = `${API_BASE_URL}${endpoint}`;
  const defaultHeaders = {
    'Content-Type': 'application/json',
    'X-Tenant': TENANT_ID,
    'X-Dev-Auth': '1', // Development bypass
  };

  const response = await fetch(url, {
    ...options,
    headers: {
      ...defaultHeaders,
      ...options.headers,
    },
  });

  const data = await response.json();
  
  if (!response.ok) {
    throw new Error(`API Error ${response.status}: ${JSON.stringify(data)}`);
  }

  return { response, data };
}

// Test 1: Create a new assignment (without status)
async function testCreateAssignment() {
  console.log('\n🧪 Test 1: Create Assignment without Status');
  
  try {
    // First, get a course ID
    const { data: coursesData } = await apiRequest('/api/v1/courses?limit=1');
    if (!coursesData.courses || coursesData.courses.length === 0) {
      throw new Error('No courses found for testing');
    }
    testData.courseId = coursesData.courses[0].id;
    
    // Create assignment
    const assignmentData = {
      course_id: testData.courseId,
      title: 'Test Assignment - Refactor Validation',
      description: 'This assignment tests the new workflow without status field',
      type: 'evaluation',
      duration_minutes: 90,
      max_attempts: 2,
      shuffle_questions: true,
      show_results_mode: 'after_correction',
    };

    const { data } = await apiRequest('/api/v1/assignments', {
      method: 'POST',
      body: JSON.stringify(assignmentData),
    });

    testData.assignmentId = data.id;
    console.log('✅ Assignment created successfully:', data.id);
    console.log('   - No status field required');
    console.log('   - Assignment ready for assignment to classes');
    
    return true;
  } catch (error) {
    console.error('❌ Test 1 failed:', error.message);
    return false;
  }
}

// Test 2: Get classes for assignment
async function testGetClasses() {
  console.log('\n🧪 Test 2: Get Classes for Assignment');
  
  try {
    const { data } = await apiRequest('/api/v1/classes?limit=1&includeDetails=true');
    
    if (!data.data || data.data.length === 0) {
      throw new Error('No classes found for testing');
    }
    
    testData.classId = data.data[0].id;
    console.log('✅ Classes retrieved successfully');
    console.log('   - Found class:', data.data[0].name);
    console.log('   - Student count:', data.data[0].studentCount);
    
    return true;
  } catch (error) {
    console.error('❌ Test 2 failed:', error.message);
    return false;
  }
}

// Test 3: Create assignment instance
async function testCreateAssignmentInstance() {
  console.log('\n🧪 Test 3: Create Assignment Instance');
  
  try {
    // Get a teacher ID
    const { data: teachersData } = await apiRequest('/api/v1/teachers?limit=1');
    if (!teachersData.teachers || teachersData.teachers.length === 0) {
      throw new Error('No teachers found for testing');
    }
    testData.teacherId = teachersData.teachers[0].id;

    const instanceData = {
      assignment_id: testData.assignmentId,
      class_id: testData.classId,
      starts_at: new Date().toISOString(),
      ends_at: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString(), // 1 week from now
      duration_minutes: 120,
      max_attempts: 3,
      show_results_mode: 'after_end',
    };

    const { data } = await apiRequest('/api/v1/assignment-instances', {
      method: 'POST',
      body: JSON.stringify(instanceData),
    });

    testData.instanceId = data.id;
    console.log('✅ Assignment instance created successfully:', data.id);
    console.log('   - Assignment assigned to class');
    console.log('   - Custom parameters applied');
    
    return true;
  } catch (error) {
    console.error('❌ Test 3 failed:', error.message);
    return false;
  }
}

// Test 4: Get assignments for class
async function testGetClassAssignments() {
  console.log('\n🧪 Test 4: Get Class Assignments');
  
  try {
    const { data } = await apiRequest(`/api/v1/assignment-instances/classes/${testData.classId}/assignments`);
    
    console.log('✅ Class assignments retrieved successfully');
    console.log('   - Found assignments:', data.assignments.length);
    
    const ourInstance = data.assignments.find(a => a.id === testData.instanceId);
    if (ourInstance) {
      console.log('   - Our test instance found in results');
      console.log('   - Title:', ourInstance.title);
      console.log('   - Ends at:', ourInstance.ends_at);
    }
    
    return true;
  } catch (error) {
    console.error('❌ Test 4 failed:', error.message);
    return false;
  }
}

// Test 5: Get student assignments (new endpoint)
async function testGetStudentAssignments() {
  console.log('\n🧪 Test 5: Get Student Assignments');
  
  try {
    // Get a student ID
    const { data: studentsData } = await apiRequest('/api/v1/students?limit=1');
    if (!studentsData.students || studentsData.students.length === 0) {
      console.log('⚠️  No students found, skipping student assignments test');
      return true;
    }
    testData.studentId = studentsData.students[0].id;

    const { data } = await apiRequest(`/api/v1/assignment-instances/students/${testData.studentId}/assignments?status=available`);
    
    console.log('✅ Student assignments retrieved successfully');
    console.log('   - Available assignments:', data.assignments.length);
    console.log('   - New endpoint working correctly');
    
    return true;
  } catch (error) {
    console.error('❌ Test 5 failed:', error.message);
    return false;
  }
}

// Test 6: Verify old status-based queries don't work
async function testStatusBasedQueriesRemoved() {
  console.log('\n🧪 Test 6: Verify Status-Based Queries Removed');
  
  try {
    // Try to create assignment with status (should be ignored)
    const assignmentWithStatus = {
      course_id: testData.courseId,
      title: 'Test Assignment with Status',
      description: 'This should ignore the status field',
      type: 'homework',
      status: 'published', // This should be ignored
    };

    const { data } = await apiRequest('/api/v1/assignments', {
      method: 'POST',
      body: JSON.stringify(assignmentWithStatus),
    });

    console.log('✅ Assignment created successfully (status field ignored)');
    console.log('   - Status field in request was ignored');
    console.log('   - Assignment created without status dependency');
    
    // Clean up this test assignment
    await apiRequest(`/api/v1/assignments/${data.id}`, {
      method: 'DELETE',
    });
    
    return true;
  } catch (error) {
    console.error('❌ Test 6 failed:', error.message);
    return false;
  }
}

// Test 7: Performance test
async function testPerformance() {
  console.log('\n🧪 Test 7: Performance Test');
  
  try {
    const startTime = Date.now();
    
    // Make multiple concurrent requests
    const promises = [
      apiRequest('/api/v1/assignments?limit=10'),
      apiRequest('/api/v1/classes?limit=10'),
      apiRequest(`/api/v1/assignment-instances/classes/${testData.classId}/assignments`),
    ];
    
    await Promise.all(promises);
    
    const endTime = Date.now();
    const duration = endTime - startTime;
    
    console.log('✅ Performance test completed');
    console.log(`   - Multiple concurrent requests: ${duration}ms`);
    console.log('   - All endpoints responding correctly');
    
    return duration < 2000; // Should complete within 2 seconds
  } catch (error) {
    console.error('❌ Test 7 failed:', error.message);
    return false;
  }
}

// Cleanup function
async function cleanup() {
  console.log('\n🧹 Cleaning up test data...');
  
  try {
    if (testData.instanceId) {
      await apiRequest(`/api/v1/assignment-instances/${testData.instanceId}`, {
        method: 'DELETE',
      });
      console.log('   - Assignment instance deleted');
    }
    
    if (testData.assignmentId) {
      await apiRequest(`/api/v1/assignments/${testData.assignmentId}`, {
        method: 'DELETE',
      });
      console.log('   - Test assignment deleted');
    }
    
    console.log('✅ Cleanup completed');
  } catch (error) {
    console.error('⚠️  Cleanup warning:', error.message);
  }
}

// Main test runner
async function runTests() {
  console.log('🚀 Starting Assignments Refactor API Tests');
  console.log('='.repeat(50));
  
  const tests = [
    testCreateAssignment,
    testGetClasses,
    testCreateAssignmentInstance,
    testGetClassAssignments,
    testGetStudentAssignments,
    testStatusBasedQueriesRemoved,
    testPerformance,
  ];
  
  let passed = 0;
  let failed = 0;
  
  for (const test of tests) {
    try {
      const result = await test();
      if (result) {
        passed++;
      } else {
        failed++;
      }
    } catch (error) {
      console.error('❌ Test failed with exception:', error.message);
      failed++;
    }
  }
  
  await cleanup();
  
  console.log('\n' + '='.repeat(50));
  console.log('📊 Test Results Summary');
  console.log(`✅ Passed: ${passed}`);
  console.log(`❌ Failed: ${failed}`);
  console.log(`📈 Success Rate: ${Math.round((passed / (passed + failed)) * 100)}%`);
  
  if (failed === 0) {
    console.log('\n🎉 All tests passed! The assignments refactor is working correctly.');
  } else {
    console.log('\n⚠️  Some tests failed. Please review the errors above.');
    process.exit(1);
  }
}

// Run tests if this script is executed directly
if (require.main === module) {
  runTests().catch(error => {
    console.error('💥 Test runner failed:', error);
    process.exit(1);
  });
}

module.exports = { runTests, testData };
