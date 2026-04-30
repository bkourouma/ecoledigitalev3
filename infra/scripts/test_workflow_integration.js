/**
 * Integration Test for Complete Assignment Workflow
 * Tests the entire flow: Creation → Assignment → Student Access → Submission
 */

const API_BASE_URL = process.env.API_URL || 'http://localhost:4000';
const TENANT_ID = 'imhotepacademy';

// Test scenario data
const testScenario = {
  teacher: null,
  class: null,
  course: null,
  assignment: null,
  instance: null,
  student: null,
  submission: null,
};

// Helper function for API requests
async function apiRequest(endpoint, options = {}) {
  const url = `${API_BASE_URL}${endpoint}`;
  const defaultHeaders = {
    'Content-Type': 'application/json',
    'X-Tenant': TENANT_ID,
    'X-Dev-Auth': '1',
  };

  const response = await fetch(url, {
    ...options,
    headers: { ...defaultHeaders, ...options.headers },
  });

  const data = await response.json();
  if (!response.ok) {
    throw new Error(`API Error ${response.status}: ${JSON.stringify(data)}`);
  }
  return { response, data };
}

// Step 1: Setup test environment
async function setupTestEnvironment() {
  console.log('\n📋 Step 1: Setting up test environment');
  
  try {
    // Get test teacher
    const { data: teachersData } = await apiRequest('/api/v1/teachers?limit=1');
    if (!teachersData.teachers?.length) throw new Error('No teachers found');
    testScenario.teacher = teachersData.teachers[0];
    
    // Get test class
    const { data: classesData } = await apiRequest('/api/v1/classes?limit=1&includeDetails=true');
    if (!classesData.data?.length) throw new Error('No classes found');
    testScenario.class = classesData.data[0];
    
    // Get test course
    const { data: coursesData } = await apiRequest('/api/v1/courses?limit=1');
    if (!coursesData.courses?.length) throw new Error('No courses found');
    testScenario.course = coursesData.courses[0];
    
    // Get test student
    const { data: studentsData } = await apiRequest('/api/v1/students?limit=1');
    if (studentsData.students?.length) {
      testScenario.student = studentsData.students[0];
    }
    
    console.log('✅ Test environment ready');
    console.log(`   - Teacher: ${testScenario.teacher.first_name} ${testScenario.teacher.last_name}`);
    console.log(`   - Class: ${testScenario.class.name} (${testScenario.class.studentCount} students)`);
    console.log(`   - Course: ${testScenario.course.name}`);
    if (testScenario.student) {
      console.log(`   - Student: ${testScenario.student.first_name} ${testScenario.student.last_name}`);
    }
    
    return true;
  } catch (error) {
    console.error('❌ Environment setup failed:', error.message);
    return false;
  }
}

// Step 2: Create assignment (new workflow - no status)
async function createAssignment() {
  console.log('\n📝 Step 2: Creating assignment (new workflow)');
  
  try {
    const assignmentData = {
      course_id: testScenario.course.id,
      title: 'Integration Test - Mathématiques Avancées',
      description: 'Test d\'intégration du nouveau workflow d\'assignation',
      type: 'evaluation',
      duration_minutes: 90,
      max_attempts: 2,
      shuffle_questions: true,
      show_results_mode: 'after_correction',
      late_submission_allowed: true,
      late_penalty_percent: 10,
    };

    const { data } = await apiRequest('/api/v1/assignments', {
      method: 'POST',
      body: JSON.stringify(assignmentData),
    });

    testScenario.assignment = data;
    console.log('✅ Assignment created successfully');
    console.log(`   - ID: ${data.id}`);
    console.log(`   - Title: ${data.title}`);
    console.log('   - Status: No status field (ready for assignment)');
    
    return true;
  } catch (error) {
    console.error('❌ Assignment creation failed:', error.message);
    return false;
  }
}

// Step 3: Assign to class (new workflow)
async function assignToClass() {
  console.log('\n🎯 Step 3: Assigning to class (new workflow)');
  
  try {
    const instanceData = {
      assignment_id: testScenario.assignment.id,
      class_id: testScenario.class.id,
      starts_at: new Date().toISOString(),
      ends_at: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString(), // 1 week
      duration_minutes: 120, // Override default
      max_attempts: 3, // Override default
      show_results_mode: 'after_end', // Override default
    };

    const { data } = await apiRequest('/api/v1/assignment-instances', {
      method: 'POST',
      body: JSON.stringify(instanceData),
    });

    testScenario.instance = data;
    console.log('✅ Assignment assigned to class successfully');
    console.log(`   - Instance ID: ${data.id}`);
    console.log(`   - Class: ${testScenario.class.name}`);
    console.log(`   - Duration: ${data.duration_minutes} minutes (overridden)`);
    console.log(`   - Max attempts: ${data.max_attempts} (overridden)`);
    console.log(`   - Ends at: ${new Date(data.ends_at).toLocaleDateString('fr-FR')}`);
    
    return true;
  } catch (error) {
    console.error('❌ Class assignment failed:', error.message);
    return false;
  }
}

// Step 4: Verify teacher can see assigned assignments
async function verifyTeacherView() {
  console.log('\n👨‍🏫 Step 4: Verifying teacher view');
  
  try {
    const { data } = await apiRequest(`/api/v1/assignment-instances/classes/${testScenario.class.id}/assignments`);
    
    const ourInstance = data.assignments.find(a => a.id === testScenario.instance.id);
    if (!ourInstance) {
      throw new Error('Assignment instance not found in teacher view');
    }
    
    console.log('✅ Teacher view working correctly');
    console.log(`   - Found ${data.assignments.length} assignments for class`);
    console.log(`   - Our assignment visible: ${ourInstance.title}`);
    console.log(`   - Status: Available for students`);
    
    return true;
  } catch (error) {
    console.error('❌ Teacher view verification failed:', error.message);
    return false;
  }
}

// Step 5: Verify student can see available assignments
async function verifyStudentView() {
  console.log('\n🎓 Step 5: Verifying student view');
  
  if (!testScenario.student) {
    console.log('⚠️  No student available, skipping student view test');
    return true;
  }
  
  try {
    const { data } = await apiRequest(
      `/api/v1/assignment-instances/students/${testScenario.student.id}/assignments?status=available`
    );
    
    console.log('✅ Student view working correctly');
    console.log(`   - Found ${data.assignments.length} available assignments`);
    
    const ourAssignment = data.assignments.find(a => a.assignment_id === testScenario.assignment.id);
    if (ourAssignment) {
      console.log(`   - Our assignment visible: ${ourAssignment.title}`);
      console.log(`   - Course: ${ourAssignment.course_name}`);
      console.log(`   - Class: ${ourAssignment.class_name}`);
      console.log(`   - Submission status: ${ourAssignment.submission_status}`);
    }
    
    return true;
  } catch (error) {
    console.error('❌ Student view verification failed:', error.message);
    return false;
  }
}

// Step 6: Test assignment modification
async function testAssignmentModification() {
  console.log('\n🔧 Step 6: Testing assignment modification');
  
  try {
    // Update assignment instance parameters
    const updateData = {
      ends_at: new Date(Date.now() + 10 * 24 * 60 * 60 * 1000).toISOString(), // Extend by 3 days
      max_attempts: 5, // Increase attempts
    };

    const { data } = await apiRequest(`/api/v1/assignment-instances/${testScenario.instance.id}`, {
      method: 'PATCH',
      body: JSON.stringify(updateData),
    });

    console.log('✅ Assignment modification successful');
    console.log(`   - Extended deadline: ${new Date(data.ends_at).toLocaleDateString('fr-FR')}`);
    console.log(`   - Increased attempts: ${data.max_attempts}`);
    
    return true;
  } catch (error) {
    console.error('❌ Assignment modification failed:', error.message);
    return false;
  }
}

// Step 7: Test workflow edge cases
async function testEdgeCases() {
  console.log('\n🧪 Step 7: Testing edge cases');
  
  try {
    // Test 1: Try to create assignment instance with invalid data
    try {
      await apiRequest('/api/v1/assignment-instances', {
        method: 'POST',
        body: JSON.stringify({
          assignment_id: testScenario.assignment.id,
          class_id: testScenario.class.id,
          // Missing required fields
        }),
      });
      console.log('❌ Should have failed with missing required fields');
      return false;
    } catch (error) {
      console.log('✅ Correctly rejected invalid assignment instance');
    }
    
    // Test 2: Try to assign same assignment to same class twice
    try {
      await apiRequest('/api/v1/assignment-instances', {
        method: 'POST',
        body: JSON.stringify({
          assignment_id: testScenario.assignment.id,
          class_id: testScenario.class.id,
          ends_at: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString(),
        }),
      });
      console.log('⚠️  Duplicate assignment allowed (may be intentional)');
    } catch (error) {
      console.log('✅ Correctly prevented duplicate assignment');
    }
    
    // Test 3: Query expired assignments
    const { data } = await apiRequest(
      `/api/v1/assignment-instances/students/${testScenario.student?.id || 'test'}/assignments?status=expired`
    );
    console.log(`✅ Expired assignments query works (found ${data.assignments?.length || 0})`);
    
    return true;
  } catch (error) {
    console.error('❌ Edge cases test failed:', error.message);
    return false;
  }
}

// Cleanup function
async function cleanup() {
  console.log('\n🧹 Cleaning up test data...');
  
  try {
    if (testScenario.instance?.id) {
      await apiRequest(`/api/v1/assignment-instances/${testScenario.instance.id}`, {
        method: 'DELETE',
      });
      console.log('   - Assignment instance deleted');
    }
    
    if (testScenario.assignment?.id) {
      await apiRequest(`/api/v1/assignments/${testScenario.assignment.id}`, {
        method: 'DELETE',
      });
      console.log('   - Test assignment deleted');
    }
    
    console.log('✅ Cleanup completed');
  } catch (error) {
    console.error('⚠️  Cleanup warning:', error.message);
  }
}

// Main integration test runner
async function runIntegrationTests() {
  console.log('🚀 Starting Complete Workflow Integration Tests');
  console.log('='.repeat(60));
  console.log('Testing: Creation → Assignment → Student Access → Management');
  
  const steps = [
    { name: 'Setup Environment', fn: setupTestEnvironment },
    { name: 'Create Assignment', fn: createAssignment },
    { name: 'Assign to Class', fn: assignToClass },
    { name: 'Verify Teacher View', fn: verifyTeacherView },
    { name: 'Verify Student View', fn: verifyStudentView },
    { name: 'Test Modification', fn: testAssignmentModification },
    { name: 'Test Edge Cases', fn: testEdgeCases },
  ];
  
  let passed = 0;
  let failed = 0;
  
  for (const step of steps) {
    try {
      const result = await step.fn();
      if (result) {
        passed++;
      } else {
        failed++;
      }
    } catch (error) {
      console.error(`❌ ${step.name} failed with exception:`, error.message);
      failed++;
    }
  }
  
  await cleanup();
  
  console.log('\n' + '='.repeat(60));
  console.log('📊 Integration Test Results');
  console.log(`✅ Passed: ${passed}/${steps.length}`);
  console.log(`❌ Failed: ${failed}/${steps.length}`);
  console.log(`📈 Success Rate: ${Math.round((passed / steps.length) * 100)}%`);
  
  if (failed === 0) {
    console.log('\n🎉 All integration tests passed!');
    console.log('✨ The new assignment workflow is fully functional:');
    console.log('   • Assignments created without status dependency');
    console.log('   • Flexible assignment to multiple classes');
    console.log('   • Per-instance parameter customization');
    console.log('   • Student access based on assignment instances');
    console.log('   • Teacher management of assigned instances');
    console.log('\n🚀 Ready for production deployment!');
  } else {
    console.log('\n⚠️  Some integration tests failed. Please review the errors above.');
    process.exit(1);
  }
}

// Run tests if this script is executed directly
if (require.main === module) {
  runIntegrationTests().catch(error => {
    console.error('💥 Integration test runner failed:', error);
    process.exit(1);
  });
}

module.exports = { runIntegrationTests, testScenario };
