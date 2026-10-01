#!/usr/bin/env node

const { spawn } = require('child_process');
const path = require('path');

console.log('🚀 Starting API Integration Tests for EcoleDigitale');
console.log('================================================');

// Function to run a command and return a promise
function runCommand(command, args, options = {}) {
  return new Promise((resolve, reject) => {
    console.log(`\n📋 Running: ${command} ${args.join(' ')}`);
    
    const child = spawn(command, args, {
      stdio: 'inherit',
      shell: true,
      ...options
    });

    child.on('close', (code) => {
      if (code === 0) {
        console.log(`✅ Command completed successfully`);
        resolve(code);
      } else {
        console.log(`❌ Command failed with code ${code}`);
        reject(new Error(`Command failed with code ${code}`));
      }
    });

    child.on('error', (error) => {
      console.error(`❌ Error running command: ${error.message}`);
      reject(error);
    });
  });
}

async function main() {
  try {
    console.log('\n🔧 Step 1: Installing dependencies...');
    await runCommand('pnpm', ['install'], { cwd: path.join(__dirname, '..') });

    console.log('\n🏗️  Step 2: Building the project...');
    await runCommand('pnpm', ['build'], { cwd: path.join(__dirname, '..') });

    console.log('\n🌐 Step 3: Starting development servers...');
    console.log('Note: Make sure both frontend (port 3000) and backend (port 4000) are running');
    console.log('You can start them with: pnpm run dev');
    
    // Wait a bit for user to start servers
    console.log('\n⏳ Waiting 5 seconds for servers to be ready...');
    await new Promise(resolve => setTimeout(resolve, 5000));

    console.log('\n🧪 Step 4: Running API Integration Tests...');
    await runCommand('npx', ['playwright', 'test', 'api-integration-workflow.spec.ts', '--headed'], { 
      cwd: __dirname 
    });

    console.log('\n🧪 Step 5: Running Complete PDF Workflow Tests...');
    await runCommand('npx', ['playwright', 'test', 'assignment-pdf-workflow.spec.ts', '--headed'], { 
      cwd: __dirname 
    });

    console.log('\n🎉 All tests completed successfully!');
    console.log('================================================');
    console.log('✅ API Integration: PASSED');
    console.log('✅ PDF Workflow: PASSED');
    console.log('✅ Backend API connections: VERIFIED');
    console.log('✅ File upload/download: VERIFIED');
    console.log('✅ Grading system: VERIFIED');
    console.log('✅ Student grades view: VERIFIED');

  } catch (error) {
    console.error('\n❌ Test execution failed:', error.message);
    console.log('\n🔍 Troubleshooting tips:');
    console.log('1. Make sure both servers are running:');
    console.log('   - Frontend: http://localhost:3000');
    console.log('   - Backend: http://localhost:4000');
    console.log('2. Check that the database is properly set up');
    console.log('3. Verify that test accounts exist:');
    console.log('   - Teacher: kouadio.assi@ecoledigitale.ci (E2E_TEACHER_PASSWORD)');
    console.log('   - Student: voir E2E_STUDENT_PASSWORD');
    
    process.exit(1);
  }
}

// Handle process termination
process.on('SIGINT', () => {
  console.log('\n🛑 Tests interrupted by user');
  process.exit(0);
});

process.on('SIGTERM', () => {
  console.log('\n🛑 Tests terminated');
  process.exit(0);
});

main();
