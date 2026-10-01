const { Pool } = require('pg');

const pool = new Pool({
  user: 'postgres',
  password: process.env.PGPASSWORD || (() => { throw new Error("PGPASSWORD est requis (mot de passe Postgres)"); })(),
  host: 'localhost',
  port: 5432,
  database: 'dbecoledigitale'
});

async function getTeacherSchedule() {
  try {
    console.log('🔍 Fetching teacher schedule for: kouadio.assi@ecoledigitale.ci\n');

    // First, get the teacher ID
    const userResult = await pool.query(
      `SELECT u.id, u.email, t.id as teacher_id 
       FROM users u 
       LEFT JOIN teachers t ON t.user_id = u.id 
       WHERE u.email = $1`,
      ['kouadio.assi@ecoledigitale.ci']
    );

    if (userResult.rows.length === 0) {
      console.log('❌ Teacher not found');
      return;
    }

    const { id: user_id, teacher_id } = userResult.rows[0];
    console.log(`✅ Found teacher:`);
    console.log(`   User ID: ${user_id}`);
    console.log(`   Teacher ID: ${teacher_id}\n`);

    // Get all scheduled sessions for this teacher
    const sessionsResult = await pool.query(
      `SELECT 
        ss.id,
        ss.start_date,
        ss.start_time,
        ss.end_time,
        c.name as course_name,
        c.code as course_code,
        cl.name as class_name,
        cl.code as class_code,
        ss.classroom_name,
        EXTRACT(DOW FROM ss.start_date::date) as day_of_week
       FROM scheduled_sessions ss
       JOIN courses c ON ss.course_id = c.id
       JOIN classes cl ON ss.class_id = cl.id
       WHERE ss.teacher_id = $1
       ORDER BY ss.start_date, ss.start_time`,
      [teacher_id]
    );

    console.log(`📊 Found ${sessionsResult.rows.length} scheduled sessions:\n`);
    console.log('=' .repeat(120));

    // Group by date
    const grouped = {};
    sessionsResult.rows.forEach(session => {
      const date = session.start_date;
      if (!grouped[date]) {
        grouped[date] = [];
      }
      grouped[date].push(session);
    });

    // Display grouped sessions
    Object.keys(grouped).sort().forEach(date => {
      const dayNames = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
      const sessions = grouped[date];
      const dayOfWeek = dayNames[sessions[0].day_of_week];
      
      console.log(`\n📅 ${date} (${dayOfWeek})`);
      console.log('-'.repeat(120));
      
      sessions.forEach((session, idx) => {
        console.log(`${idx + 1}. ${session.course_name} (${session.course_code})`);
        console.log(`   Class: ${session.class_name} (${session.class_code})`);
        console.log(`   Time: ${session.start_time} - ${session.end_time}`);
        console.log(`   Classroom: ${session.classroom_name || 'TBD'}`);
        console.log('');
      });
    });

    console.log('=' .repeat(120));

    // Summary statistics
    const courseStats = {};
    sessionsResult.rows.forEach(session => {
      if (!courseStats[session.course_name]) {
        courseStats[session.course_name] = {
          code: session.course_code,
          count: 0,
          hours: 0
        };
      }
      courseStats[session.course_name].count++;
      
      // Calculate hours
      const [startHour, startMin] = session.start_time.split(':').map(Number);
      const [endHour, endMin] = session.end_time.split(':').map(Number);
      const hours = (endHour - startHour) + (endMin - startMin) / 60;
      courseStats[session.course_name].hours += hours;
    });

    console.log('\n📈 Summary Statistics:\n');
    console.log('=' .repeat(120));
    console.log(`Total Sessions: ${sessionsResult.rows.length}`);
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
    console.log('=' .repeat(120));

    // Export as table format
    console.log('\n\n📋 TABLE FORMAT:\n');
    console.log('Date       | Day       | Time          | Course                                    | Class                    | Classroom');
    console.log('-'.repeat(150));
    
    sessionsResult.rows.forEach(session => {
      const dayNames = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
      const dayName = dayNames[session.day_of_week];
      const time = `${session.start_time}-${session.end_time}`;
      const course = `${session.course_name} (${session.course_code})`;
      const classInfo = `${session.class_name} (${session.class_code})`;
      const classroom = session.classroom_name || 'TBD';
      
      console.log(`${session.start_date} | ${dayName.padEnd(9)} | ${time.padEnd(13)} | ${course.padEnd(40)} | ${classInfo.padEnd(24)} | ${classroom}`);
    });

    console.log('\n✅ Schedule retrieved successfully!\n');

  } catch (error) {
    console.error('❌ Error:', error.message);
  } finally {
    await pool.end();
  }
}

getTeacherSchedule();

