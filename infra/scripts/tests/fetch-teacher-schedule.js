const http = require('http');

function makeRequest(method, path, body = null, headers = {}) {
  return new Promise((resolve, reject) => {
    const options = {
      hostname: 'localhost',
      port: 4000,
      path: path,
      method: method,
      headers: {
        'Content-Type': 'application/json',
        ...headers
      }
    };

    const req = http.request(options, (res) => {
      let data = '';
      res.on('data', (chunk) => { data += chunk; });
      res.on('end', () => {
        try {
          resolve({ status: res.statusCode, data: JSON.parse(data), headers: res.headers });
        } catch (e) {
          resolve({ status: res.statusCode, data: data, headers: res.headers });
        }
      });
    });

    req.on('error', reject);
    if (body) req.write(JSON.stringify(body));
    req.end();
  });
}

async function getTeacherSchedule() {
  try {
    console.log('🔐 Step 1: Login as teacher\n');
    
    const loginResponse = await makeRequest('POST', '/api/v1/auth/login', {
      email: 'kouadio.assi@ecoledigitale.ci',
      password: 'imhotepacademy'
    }, {
      'X-Tenant': 'imhotepacademy'
    });

    if (loginResponse.status !== 200) {
      console.error('❌ Login failed:', loginResponse.data);
      return;
    }

    const token = loginResponse.data.token;
    console.log('✅ Login successful');
    console.log(`   Token: ${token.substring(0, 50)}...\n`);

    console.log('📊 Step 2: Fetch scheduled sessions\n');
    
    const scheduleResponse = await makeRequest('GET', '/api/v1/teacher/assignments/scheduled-sessions', null, {
      'X-Tenant': 'imhotepacademy',
      'Authorization': `Bearer ${token}`
    });

    if (scheduleResponse.status !== 200) {
      console.error('❌ Failed to fetch schedule:', scheduleResponse.data);
      return;
    }

    const sessions = scheduleResponse.data.data || [];
    console.log(`✅ Found ${sessions.length} scheduled sessions\n`);

    // Group by date
    const grouped = {};
    sessions.forEach(session => {
      const date = session.sessionDate || session.start_date;
      if (!grouped[date]) {
        grouped[date] = [];
      }
      grouped[date].push(session);
    });

    console.log('='.repeat(140));
    console.log('\n📅 SCHEDULED COURSES FOR TEACHER: kouadio.assi@ecoledigitale.ci\n');
    console.log('='.repeat(140));

    // Display grouped sessions
    Object.keys(grouped).sort().forEach(date => {
      const dayNames = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
      const sessions = grouped[date];
      const dateObj = new Date(date);
      const dayOfWeek = dayNames[dateObj.getDay()];
      
      console.log(`\n📅 ${date} (${dayOfWeek})`);
      console.log('-'.repeat(140));
      
      sessions.forEach((session, idx) => {
        const courseName = session.courseName || session.course_name || 'N/A';
        const courseCode = session.courseCode || session.course_code || 'N/A';
        const className = session.className || session.class_name || 'N/A';
        const classCode = session.classCode || session.class_code || 'N/A';
        const startTime = session.startTime || session.start_time || 'N/A';
        const endTime = session.endTime || session.end_time || 'N/A';
        const classroom = session.classroom || session.classroom_name || 'TBD';
        
        console.log(`\n${idx + 1}. ${courseName} (${courseCode})`);
        console.log(`   Class: ${className} (${classCode})`);
        console.log(`   Time: ${startTime} - ${endTime}`);
        console.log(`   Classroom: ${classroom}`);
      });
    });

    console.log('\n' + '='.repeat(140));

    // Summary statistics
    const courseStats = {};
    sessions.forEach(session => {
      const courseName = session.courseName || session.course_name || 'Unknown';
      const courseCode = session.courseCode || session.course_code || 'N/A';
      
      if (!courseStats[courseName]) {
        courseStats[courseName] = {
          code: courseCode,
          count: 0,
          hours: 0
        };
      }
      courseStats[courseName].count++;
      
      // Calculate hours
      const startTime = session.startTime || session.start_time || '00:00';
      const endTime = session.endTime || session.end_time || '00:00';
      const [startHour, startMin] = startTime.split(':').map(Number);
      const [endHour, endMin] = endTime.split(':').map(Number);
      const hours = (endHour - startHour) + (endMin - startMin) / 60;
      courseStats[courseName].hours += hours;
    });

    console.log('\n📈 SUMMARY STATISTICS:\n');
    console.log('='.repeat(140));
    console.log(`Total Sessions: ${sessions.length}`);
    console.log(`Total Courses: ${Object.keys(courseStats).length}`);
    console.log(`Total Classes: 1`);
    
    let totalHours = 0;
    Object.entries(courseStats).forEach(([courseName, stats]) => {
      console.log(`\n${courseName} (${stats.code}):`);
      console.log(`  Sessions: ${stats.count}`);
      console.log(`  Hours: ${stats.hours}`);
      totalHours += stats.hours;
    });
    
    console.log(`\nTotal Hours: ${totalHours}`);
    console.log('='.repeat(140));

    // Export as table format
    console.log('\n\n📋 TABLE FORMAT:\n');
    console.log('Date       | Day       | Time          | Course                                    | Class                    | Classroom');
    console.log('-'.repeat(150));
    
    sessions.forEach(session => {
      const date = session.sessionDate || session.start_date;
      const dateObj = new Date(date);
      const dayNames = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
      const dayName = dayNames[dateObj.getDay()];
      
      const startTime = session.startTime || session.start_time || 'N/A';
      const endTime = session.endTime || session.end_time || 'N/A';
      const time = `${startTime}-${endTime}`;
      
      const courseName = session.courseName || session.course_name || 'N/A';
      const courseCode = session.courseCode || session.course_code || 'N/A';
      const course = `${courseName} (${courseCode})`;
      
      const className = session.className || session.class_name || 'N/A';
      const classCode = session.classCode || session.class_code || 'N/A';
      const classInfo = `${className} (${classCode})`;
      
      const classroom = session.classroom || session.classroom_name || 'TBD';
      
      console.log(`${date} | ${dayName.padEnd(9)} | ${time.padEnd(13)} | ${course.padEnd(40)} | ${classInfo.padEnd(24)} | ${classroom}`);
    });

    console.log('\n✅ Schedule retrieved successfully!\n');

  } catch (error) {
    console.error('❌ Error:', error.message);
  }
}

getTeacherSchedule();

