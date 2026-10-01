#!/usr/bin/env node

/**
 * Schedule Generation Cleanup and Test Script (JavaScript)
 * 
 * Usage:
 *   node cleanup-and-test.js
 * 
 * This script:
 * 1. Cleans up all schedule-related data from the database
 * 2. Creates time slots
 * 3. Creates test schedules for 1 course and 2 courses
 */

const { Pool } = require('pg');

// Database connection - update if needed
const DATABASE_URL = process.env.DATABASE_URL || (() => { throw new Error("DATABASE_URL est requis (voir .env.example)"); })();

const pool = new Pool({
  connectionString: DATABASE_URL,
});

// Test IDs - Using real IDs from the database
const TENANT_ID = '6eb9c106-b650-4398-b6fa-091b6828c4ba';
const CLASS_ID = '5038f1db-e2d1-4d03-b7dd-dc2e2871f921'; // BTS-IDA-01
const USER_ID = '550e8400-e29b-41d4-a716-446655440000'; // Test user

// Course IDs - Will be fetched from database
let COURSE_IDS = {
  math: null,
  english: null,
  french: null,
};

async function fetchCourseIds() {
  console.log('📚 Fetching course IDs...\n');

  try {
    const result = await pool.query(
      `SELECT id, name FROM courses WHERE tenant_id = $1 LIMIT 3`,
      [TENANT_ID]
    );

    if (result.rows.length < 3) {
      throw new Error(`Expected at least 3 courses, found ${result.rows.length}`);
    }

    COURSE_IDS.math = result.rows[0].id;
    COURSE_IDS.english = result.rows[1].id;
    COURSE_IDS.french = result.rows[2].id;

    console.log(`✅ Math: ${result.rows[0].name} (${COURSE_IDS.math})`);
    console.log(`✅ English: ${result.rows[1].name} (${COURSE_IDS.english})`);
    console.log(`✅ French: ${result.rows[2].name} (${COURSE_IDS.french})\n`);
  } catch (error) {
    console.error('❌ Failed to fetch courses:', error.message);
    throw error;
  }
}

async function cleanupSchedules() {
  console.log('🧹 Cleaning up all schedule data...\n');

  try {
    await pool.query('DELETE FROM scheduled_sessions WHERE tenant_id = $1', [TENANT_ID]);
    console.log('✅ Deleted scheduled_sessions');

    await pool.query('DELETE FROM generated_schedules WHERE tenant_id = $1', [TENANT_ID]);
    console.log('✅ Deleted generated_schedules');

    await pool.query('DELETE FROM schedule_generation_requests WHERE tenant_id = $1', [TENANT_ID]);
    console.log('✅ Deleted schedule_generation_requests');

    await pool.query('DELETE FROM time_slots WHERE tenant_id = $1', [TENANT_ID]);
    console.log('✅ Deleted time_slots');

    console.log('\n✨ Cleanup complete!\n');
  } catch (error) {
    console.error('❌ Cleanup failed:', error.message);
    throw error;
  }
}

async function createTimeSlots() {
  console.log('📅 Creating time slots...\n');

  const timeSlots = [
    // Monday
    { day: 'monday', start: '08:00', end: '10:00', name: 'Monday 8:00-10:00', priority: 3 },
    { day: 'monday', start: '10:00', end: '12:00', name: 'Monday 10:00-12:00', priority: 3 },
    { day: 'monday', start: '14:00', end: '16:00', name: 'Monday 14:00-16:00', priority: 2 },
    // Tuesday
    { day: 'tuesday', start: '08:00', end: '10:00', name: 'Tuesday 8:00-10:00', priority: 3 },
    { day: 'tuesday', start: '10:00', end: '12:00', name: 'Tuesday 10:00-12:00', priority: 3 },
    { day: 'tuesday', start: '14:00', end: '16:00', name: 'Tuesday 14:00-16:00', priority: 2 },
    // Wednesday
    { day: 'wednesday', start: '08:00', end: '10:00', name: 'Wednesday 8:00-10:00', priority: 3 },
    { day: 'wednesday', start: '10:00', end: '12:00', name: 'Wednesday 10:00-12:00', priority: 3 },
    { day: 'wednesday', start: '14:00', end: '16:00', name: 'Wednesday 14:00-16:00', priority: 2 },
    // Thursday
    { day: 'thursday', start: '08:00', end: '10:00', name: 'Thursday 8:00-10:00', priority: 3 },
    { day: 'thursday', start: '10:00', end: '12:00', name: 'Thursday 10:00-12:00', priority: 3 },
    { day: 'thursday', start: '14:00', end: '16:00', name: 'Thursday 14:00-16:00', priority: 2 },
    // Friday
    { day: 'friday', start: '08:00', end: '10:00', name: 'Friday 8:00-10:00', priority: 3 },
    { day: 'friday', start: '10:00', end: '12:00', name: 'Friday 10:00-12:00', priority: 3 },
    { day: 'friday', start: '14:00', end: '16:00', name: 'Friday 14:00-16:00', priority: 2 },
  ];

  const slotIds = [];

  for (const slot of timeSlots) {
    const result = await pool.query(
      `INSERT INTO time_slots (tenant_id, name, day_of_week, start_time, end_time, priority, is_active)
       VALUES ($1, $2, $3, $4, $5, $6, true)
       RETURNING id`,
      [TENANT_ID, slot.name, slot.day, slot.start, slot.end, slot.priority]
    );
    slotIds.push(result.rows[0].id);
    console.log(`✅ Created time slot: ${slot.name}`);
  }

  console.log(`\n✨ Created ${slotIds.length} time slots\n`);
  return slotIds;
}

async function createTestSchedule(coursesToSchedule, testName) {
  console.log(`\n🎯 Creating test schedule: ${testName}\n`);

  try {
    // Get time slots
    const slotsResult = await pool.query(
      'SELECT id FROM time_slots WHERE tenant_id = $1 ORDER BY day_of_week, start_time',
      [TENANT_ID]
    );
    const timeSlotIds = slotsResult.rows.map(r => r.id);

    // Create generation request
    const selectedCourses = coursesToSchedule.map(c => ({
      courseId: c.courseId,
      requiredHours: c.hours,
      preferredSessionDuration: 120,
    }));

    const requestResult = await pool.query(
      `INSERT INTO schedule_generation_requests 
       (tenant_id, class_id, requested_by, selected_courses, available_time_slots, generation_preferences, status)
       VALUES ($1, $2, $3, $4, $5, $6, 'completed')
       RETURNING id`,
      [
        TENANT_ID,
        CLASS_ID,
        USER_ID,
        JSON.stringify(selectedCourses),
        JSON.stringify(timeSlotIds),
        JSON.stringify({
          balanceWorkload: true,
          preferMorningSlots: true,
          avoidBackToBackSessions: false,
          allowWeekendSessions: false,
        }),
      ]
    );

    const requestId = requestResult.rows[0].id;
    console.log(`✅ Created generation request: ${requestId}`);

    // Create mock schedule data
    const totalHours = coursesToSchedule.reduce((sum, c) => sum + c.hours, 0);
    const scheduleData = {
      sessions: [],
      totalHours,
      weeklyDistribution: {
        monday: Math.ceil(totalHours / 5),
        tuesday: Math.ceil(totalHours / 5),
        wednesday: Math.ceil(totalHours / 5),
        thursday: Math.ceil(totalHours / 5),
        friday: Math.ceil(totalHours / 5),
        saturday: 0,
        sunday: 0,
      },
    };

    // Create generated schedule
    const scheduleResult = await pool.query(
      `INSERT INTO generated_schedules 
       (tenant_id, generation_request_id, schedule_data, optimization_score, conflicts_detected, is_approved)
       VALUES ($1, $2, $3, $4, $5, true)
       RETURNING id`,
      [
        TENANT_ID,
        requestId,
        JSON.stringify(scheduleData),
        85.5,
        JSON.stringify([]),
      ]
    );

    const scheduleId = scheduleResult.rows[0].id;
    console.log(`✅ Created generated schedule: ${scheduleId}`);
    console.log(`✅ Optimization score: 85.5%`);
    console.log(`✅ Total hours: ${totalHours}h`);
    console.log(`✅ Status: APPROVED`);

    return { requestId, scheduleId };
  } catch (error) {
    console.error(`❌ Failed to create test schedule: ${testName}`, error.message);
    throw error;
  }
}

async function main() {
  console.log('╔════════════════════════════════════════════════════════════╗');
  console.log('║  Schedule Generation - Cleanup & Test Script               ║');
  console.log('╚════════════════════════════════════════════════════════════╝\n');

  try {
    // Step 0: Fetch course IDs
    await fetchCourseIds();

    // Step 1: Cleanup
    await cleanupSchedules();

    // Step 2: Create time slots
    const timeSlotIds = await createTimeSlots();

    // Step 3: Create test schedules
    console.log('📝 Creating test schedules...\n');

    // Test 1: One course
    const test1 = await createTestSchedule(
      [{ courseId: COURSE_IDS.math, hours: 20 }],
      'Single Course (Math - 20 hours)'
    );

    // Test 2: Two courses
    const test2 = await createTestSchedule(
      [
        { courseId: COURSE_IDS.english, hours: 15 },
        { courseId: COURSE_IDS.french, hours: 18 },
      ],
      'Two Courses (English 15h + French 18h)'
    );

    console.log('\n╔════════════════════════════════════════════════════════════╗');
    console.log('║  ✨ All tests created successfully!                        ║');
    console.log('╚════════════════════════════════════════════════════════════╝\n');

    console.log('📊 Summary:');
    console.log(`  • Time slots created: ${timeSlotIds.length}`);
    console.log(`  • Test 1 (1 course): Request ${test1.requestId}`);
    console.log(`  • Test 2 (2 courses): Request ${test2.requestId}`);
    console.log('\n✅ Script completed successfully!\n');

  } catch (error) {
    console.error('\n❌ Script failed:', error);
    process.exit(1);
  } finally {
    await pool.end();
  }
}

main();

