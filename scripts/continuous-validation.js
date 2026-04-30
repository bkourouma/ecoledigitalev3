#!/usr/bin/env node

const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');

console.log('🔄 EcoleDigitale Continuous Validation Script');
console.log('============================================');

// Configuration
const VALIDATION_INTERVAL = 30000; // 30 seconds
const MAX_FAILURES = 3;
const FRONTEND_URL = 'http://localhost:3000';
const BACKEND_URL = 'http://localhost:4000';

let failureCount = 0;
let isRunning = false;

// Health check function
async function healthCheck() {
  try {
    const [frontendResponse, backendResponse] = await Promise.all([
      fetch(`${FRONTEND_URL}/api/health`).catch(() => ({ ok: false, status: 0 })),
      fetch(`${BACKEND_URL}/api/v1/health`).catch(() => ({ ok: false, status: 0 }))
    ]);

    return {
      frontend: { ok: frontendResponse.ok, status: frontendResponse.status },
      backend: { ok: backendResponse.ok, status: backendResponse.status },
      timestamp: new Date().toISOString()
    };
  } catch (error) {
    return {
      frontend: { ok: false, status: 0, error: error.message },
      backend: { ok: false, status: 0, error: error.message },
      timestamp: new Date().toISOString()
    };
  }
}

// Quick API test
async function quickApiTest() {
  try {
    const testEndpoints = [
      `${FRONTEND_URL}/api/teacher/corrections`,
      `${FRONTEND_URL}/api/student/grades`,
      `${BACKEND_URL}/api/v1/assignments`
    ];

    const results = await Promise.all(
      testEndpoints.map(async (url) => {
        try {
          const response = await fetch(url, {
            headers: {
              'X-Tenant': 'imhotepacademy',
              'X-Dev-Auth': '1',
              'X-User-Id': 'd7ea2980-d464-480b-b84c-13ed7df031bb',
            }
          });
          return { url, ok: response.ok, status: response.status };
        } catch (error) {
          return { url, ok: false, status: 0, error: error.message };
        }
      })
    );

    return results;
  } catch (error) {
    return [{ error: error.message }];
  }
}

// File system validation
function validateFileSystem() {
  const criticalFiles = [
    'apps/web/src/app/api/assignments/[assignmentId]/submissions/upload/route.ts',
    'apps/web/src/app/api/teacher/corrections/route.ts',
    'apps/web/src/app/api/v1/files/[...path]/route.ts',
    'apps/api/src/routes/files.ts',
    'apps/api/src/routes/submissions.ts'
  ];

  const missingFiles = criticalFiles.filter(file => !fs.existsSync(file));
  
  return {
    allFilesExist: missingFiles.length === 0,
    missingFiles,
    totalFiles: criticalFiles.length
  };
}

// TypeScript compilation check
function checkTypeScriptCompilation() {
  return new Promise((resolve) => {
    const tscProcess = spawn('npx', ['tsc', '--noEmit', '--project', 'apps/web'], {
      stdio: 'pipe',
      cwd: process.cwd()
    });

    let output = '';
    let errorOutput = '';

    tscProcess.stdout.on('data', (data) => {
      output += data.toString();
    });

    tscProcess.stderr.on('data', (data) => {
      errorOutput += data.toString();
    });

    tscProcess.on('close', (code) => {
      resolve({
        success: code === 0,
        code,
        output: output.trim(),
        errors: errorOutput.trim()
      });
    });

    // Timeout after 30 seconds
    setTimeout(() => {
      tscProcess.kill();
      resolve({
        success: false,
        code: -1,
        output: '',
        errors: 'TypeScript check timed out'
      });
    }, 30000);
  });
}

// Main validation function
async function runValidation() {
  if (isRunning) {
    console.log('⏳ Validation already running, skipping...');
    return;
  }

  isRunning = true;
  const timestamp = new Date().toLocaleTimeString();
  
  console.log(`\n🔍 Running validation at ${timestamp}...`);

  try {
    // 1. Health check
    const health = await healthCheck();
    const healthOk = health.frontend.ok && health.backend.ok;
    console.log(`Health: ${healthOk ? '✅' : '❌'} Frontend: ${health.frontend.status}, Backend: ${health.backend.status}`);

    // 2. File system check
    const fileSystem = validateFileSystem();
    console.log(`Files: ${fileSystem.allFilesExist ? '✅' : '❌'} ${fileSystem.totalFiles - fileSystem.missingFiles.length}/${fileSystem.totalFiles} files exist`);
    
    if (fileSystem.missingFiles.length > 0) {
      console.log(`Missing files: ${fileSystem.missingFiles.join(', ')}`);
    }

    // 3. Quick API test (only if servers are healthy)
    let apiResults = [];
    if (healthOk) {
      apiResults = await quickApiTest();
      const apiOk = apiResults.every(result => result.ok !== false);
      console.log(`APIs: ${apiOk ? '✅' : '❌'} ${apiResults.filter(r => r.ok).length}/${apiResults.length} endpoints responding`);
      
      if (!apiOk) {
        const failedApis = apiResults.filter(r => !r.ok);
        failedApis.forEach(api => {
          console.log(`  ❌ ${api.url}: ${api.status} ${api.error || ''}`);
        });
      }
    }

    // 4. TypeScript compilation (every 5th check to avoid overhead)
    let tsCheck = { success: true };
    if (Math.random() < 0.2) { // 20% chance
      console.log('🔧 Running TypeScript check...');
      tsCheck = await checkTypeScriptCompilation();
      console.log(`TypeScript: ${tsCheck.success ? '✅' : '❌'} Compilation ${tsCheck.success ? 'passed' : 'failed'}`);
      
      if (!tsCheck.success && tsCheck.errors) {
        console.log(`TS Errors: ${tsCheck.errors.substring(0, 200)}...`);
      }
    }

    // Overall status
    const overallOk = healthOk && fileSystem.allFilesExist && tsCheck.success && 
                     (apiResults.length === 0 || apiResults.every(r => r.ok !== false));

    if (overallOk) {
      failureCount = 0;
      console.log('✅ All validations passed');
    } else {
      failureCount++;
      console.log(`❌ Validation failed (${failureCount}/${MAX_FAILURES})`);
      
      if (failureCount >= MAX_FAILURES) {
        console.log('🚨 Maximum failures reached! Please check the system.');
        
        // Log detailed error report
        const errorReport = {
          timestamp: new Date().toISOString(),
          health,
          fileSystem,
          apiResults,
          tsCheck
        };
        
        const reportPath = path.join(__dirname, 'validation-error-report.json');
        fs.writeFileSync(reportPath, JSON.stringify(errorReport, null, 2));
        console.log(`📄 Error report saved to: ${reportPath}`);
        
        // Reset failure count to continue monitoring
        failureCount = 0;
      }
    }

  } catch (error) {
    console.error('❌ Validation error:', error.message);
    failureCount++;
  } finally {
    isRunning = false;
  }
}

// Start continuous monitoring
console.log(`🚀 Starting continuous validation (every ${VALIDATION_INTERVAL/1000}s)`);
console.log('Press Ctrl+C to stop\n');

// Run initial validation
runValidation();

// Set up interval
const validationInterval = setInterval(runValidation, VALIDATION_INTERVAL);

// Graceful shutdown
process.on('SIGINT', () => {
  console.log('\n🛑 Stopping continuous validation...');
  clearInterval(validationInterval);
  
  // Final validation report
  console.log('\n📊 Final Status:');
  console.log(`Total failures detected: ${failureCount}`);
  console.log('Validation stopped.');
  
  process.exit(0);
});

process.on('SIGTERM', () => {
  clearInterval(validationInterval);
  process.exit(0);
});

// Handle uncaught exceptions
process.on('uncaughtException', (error) => {
  console.error('❌ Uncaught exception:', error.message);
  clearInterval(validationInterval);
  process.exit(1);
});

process.on('unhandledRejection', (reason, promise) => {
  console.error('❌ Unhandled rejection at:', promise, 'reason:', reason);
});
