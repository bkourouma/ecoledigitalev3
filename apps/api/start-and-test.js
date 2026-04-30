// Script to start server and test the endpoint
const { spawn } = require('child_process');
const http = require('http');

console.log('Starting API server...');

// Start the server
const server = spawn('npx', ['tsx', 'src/index.ts'], {
  cwd: __dirname,
  stdio: 'pipe'
});

server.stdout.on('data', (data) => {
  console.log('Server output:', data.toString());
});

server.stderr.on('data', (data) => {
  console.error('Server error:', data.toString());
});

// Wait a bit for server to start, then test
setTimeout(() => {
  console.log('Testing endpoint...');
  
  const testData = JSON.stringify({
    classId: "b7dfecb9-7dd5-4684-935f-a92b8975649f",
    courseId: "750e8400-e29b-41d4-a716-446655440001", 
    teacherId: "550abab6-7b05-4929-b7be-8d2446b9c26c",
    contractType: "salarie",
    datebut: "2025-01-15",
    datefin: "2025-02-15"
  });

  const options = {
    hostname: 'localhost',
    port: 4000,
    path: '/api/v1/teacher-assignments',
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Tenant': 'imhotepacademy',
      'Content-Length': Buffer.byteLength(testData)
    }
  };

  const req = http.request(options, (res) => {
    console.log('Response status:', res.statusCode);
    console.log('Response headers:', res.headers);
    
    let body = '';
    res.on('data', (chunk) => {
      body += chunk;
    });
    
    res.on('end', () => {
      console.log('Response body:', body);
      process.exit(0);
    });
  });

  req.on('error', (e) => {
    console.error('Request error:', e.message);
    process.exit(1);
  });

  req.write(testData);
  req.end();
  
}, 5000); // Wait 5 seconds for server to start
