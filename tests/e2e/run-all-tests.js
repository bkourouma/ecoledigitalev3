#!/usr/bin/env node

const { execSync } = require('child_process');
const path = require('path');

console.log('🚀 Starting E2E Tests for Assignment PDF Workflow...\n');

const testFiles = [
  'assignment-workflow.spec.ts',
  'assignment-pdf-workflow.spec.ts',
  'file-validation-security.spec.ts',
  'assignment-state-transitions.spec.ts'
];

const results = {
  passed: 0,
  failed: 0,
  total: 0
};

async function runTest(testFile) {
  console.log(`\n📋 Running test: ${testFile}`);
  console.log('=' .repeat(50));
  
  try {
    const testPath = path.join(__dirname, testFile);
    execSync(`npx playwright test "${testPath}" --reporter=line`, { 
      stdio: 'inherit',
      cwd: process.cwd()
    });
    
    console.log(`✅ ${testFile} - PASSED`);
    results.passed++;
  } catch (error) {
    console.log(`❌ ${testFile} - FAILED`);
    console.log(`Error: ${error.message}`);
    results.failed++;
  }
  
  results.total++;
}

async function runAllTests() {
  console.log('🔧 Setting up test environment...');
  
  // Install Playwright browsers if needed
  try {
    execSync('npx playwright install', { stdio: 'inherit' });
  } catch (error) {
    console.log('⚠️  Playwright browsers already installed or installation failed');
  }
  
  // Create fixtures directory if it doesn't exist
  const fixturesDir = path.join(__dirname, 'fixtures');
  try {
    execSync(`mkdir -p "${fixturesDir}"`, { stdio: 'inherit' });
  } catch (error) {
    // Directory might already exist
  }
  
  console.log('\n🧪 Running all E2E tests...\n');
  
  for (const testFile of testFiles) {
    await runTest(testFile);
  }
  
  // Print summary
  console.log('\n' + '='.repeat(60));
  console.log('📊 TEST SUMMARY');
  console.log('='.repeat(60));
  console.log(`Total Tests: ${results.total}`);
  console.log(`✅ Passed: ${results.passed}`);
  console.log(`❌ Failed: ${results.failed}`);
  console.log(`Success Rate: ${((results.passed / results.total) * 100).toFixed(1)}%`);
  
  if (results.failed > 0) {
    console.log('\n⚠️  Some tests failed. Please check the output above for details.');
    process.exit(1);
  } else {
    console.log('\n🎉 All tests passed! The assignment PDF workflow is working correctly.');
    process.exit(0);
  }
}

// Handle cleanup on exit
process.on('SIGINT', () => {
  console.log('\n\n🛑 Tests interrupted by user');
  process.exit(1);
});

process.on('uncaughtException', (error) => {
  console.error('\n💥 Unexpected error:', error);
  process.exit(1);
});

runAllTests().catch(error => {
  console.error('\n💥 Failed to run tests:', error);
  process.exit(1);
});
