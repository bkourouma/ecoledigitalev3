import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth-options';
import fs from 'fs/promises';
import path from 'path';

interface Grade {
  id: string;
  assignment: {
    id: string;
    title: string;
    type: string;
  };
  course: {
    id: string;
    name: string;
    code: string;
  };
  grade: number;
  max_grade: number;
  coefficient: number;
  date: string;
  instructor: {
    id: string;
    first_name: string;
    last_name: string;
  };
  feedback: string | null;
}

export async function GET(request: NextRequest) {
  console.log('📊 STUDENT GRADES: Request received');

  try {
    // Get session
    const session = await getServerSession(authOptions);

    if (!session?.user?.id) {
      console.error('❌ STUDENT GRADES: No session found');
      return NextResponse.json(
        { success: false, error: 'Authentication required' },
        { status: 401 }
      );
    }

    console.log('📊 STUDENT GRADES: Request details:', {
      studentId: session.user.id,
      userEmail: session.user.email
    });

    // Get query parameters
    const { searchParams } = new URL(request.url);
    const courseFilter = searchParams.get('courseId') || 'all';

    // Get tenant ID from session or headers
    const incomingTenant = request.headers.get('X-Tenant') || request.headers.get('x-tenant');
    const tenantId = session.tenantId || incomingTenant || 'imhotepacademy';
    const activeAcademicYearId = request.headers.get('X-Academic-Year-Id') || request.headers.get('x-academic-year-id');

    // Get Authorization header from request (added by fetch interceptor)
    const authorization = request.headers.get('Authorization');
    
    console.log('📊 STUDENT GRADES: Request details:', {
      studentId: session.user.id,
      tenantId,
      hasAuthHeader: !!authorization
    });

    // Try to fetch grades from backend API first
    const grades: Grade[] = [];

    try {
      console.log('🔍 STUDENT GRADES: Fetching grades from backend API...');
      
      // Build headers for backend request
      const headers: HeadersInit = {
        'Content-Type': 'application/json',
        'X-Tenant': tenantId,
        'X-User-Id': session.user.id,
      };

      // Forward Authorization header if present (JWT token)
      if (authorization) {
        headers['Authorization'] = authorization;
        console.log('✅ JWT token forwarded to backend');
      } else {
        console.warn('⚠️  No Authorization header found - backend may reject request');
      }
      if (activeAcademicYearId) {
        headers['X-Academic-Year-Id'] = activeAcademicYearId;
      }

      const backendResponse = await fetch(`http://localhost:4000/api/v1/student/grades`, {
        headers,
      });

      if (backendResponse.ok) {
        const backendData = await backendResponse.json();
        console.log('✅ STUDENT GRADES: Backend data received:', {
          success: backendData.success,
          hasData: !!backendData.data,
          gradesCount: backendData.data?.grades?.length || backendData.data?.length || 0
        });
        
        // Backend returns { success: true, data: { grades: [...], stats: {...} }, pagination: {...} }
        // Extract grades array
        const gradesArray = backendData.data?.grades || backendData.data || [];
        
        if (backendData.success && gradesArray.length > 0) {
          // Transform backend data to match our interface
          const backendGrades = gradesArray.map((item: any) => ({
            id: item.id || item.submission_id || `grade-${session.user.id}-${item.assignment?.id || item.assignment_id}`,
            assignment: {
              id: item.assignment?.id || item.assignment_id,
              title: item.assignment?.title || item.assignment_title || `Devoir ${(item.assignment?.id || item.assignment_id || '').substring(0, 8)}...`,
              type: item.assignment?.type || item.assignment_type || 'homework'
            },
            course: {
              id: item.course?.id || item.course_id || 'course-1',
              name: item.course?.name || item.course_name || 'Cours Général',
              code: item.course?.code || item.course_code || 'CG001'
            },
            grade: parseFloat(item.grade || item.final_score || item.manual_score || 0),
            max_grade: item.max_grade || item.max_points || 20,
            coefficient: item.coefficient || 1,
            date: item.date || item.graded_at || new Date().toISOString(),
            instructor: {
              id: item.instructor?.id || item.teacher_id || 'teacher-1',
              first_name: item.instructor?.first_name || item.teacher_first_name || 'Enseignant',
              last_name: item.instructor?.last_name || item.teacher_last_name || 'Principal'
            },
            feedback: item.feedback
          }));
          
          grades.push(...backendGrades);
          console.log(`✅ STUDENT GRADES: Added ${backendGrades.length} grades from backend`);
        }
      } else {
        console.log(`❌ STUDENT GRADES: Backend API error: ${backendResponse.status}`);
      }
    } catch (error) {
      console.log('❌ STUDENT GRADES: Backend API failed, trying local files:', error);
    }

    // Fallback: Scan grades directory for student's grades if backend failed
    if (grades.length === 0) {
      console.log('🔍 STUDENT GRADES: Falling back to local files...');
      const gradesDir = process.env.GRADES_STORAGE_PATH || path.join(process.cwd(), 'grades');
      const tenantGradesDir = path.join(gradesDir, tenantId);

      try {
        // Check if tenant grades directory exists
        await fs.access(tenantGradesDir);
        
        // List assignment directories
        const assignmentDirs = await fs.readdir(tenantGradesDir);
        
        for (const assignmentId of assignmentDirs) {
          const assignmentGradesDir = path.join(tenantGradesDir, assignmentId);
          
          try {
            const stats = await fs.stat(assignmentGradesDir);
            if (!stats.isDirectory()) continue;
            
            // Look for this student's grade file
            const gradeFileName = `submission-${session.user.id}-${assignmentId}.json`;
            const gradeFilePath = path.join(assignmentGradesDir, gradeFileName);

            try {
              const gradeFileContent = await fs.readFile(gradeFilePath, 'utf-8');
              const gradeData = JSON.parse(gradeFileContent);

              // Fetch real assignment data from backend
              let assignmentTitle = `Devoir ${assignmentId.substring(0, 8)}...`;
              let courseName = 'Cours Général';
              let courseCode = 'CG001';

              try {
                const assignmentResponse = await fetch(`http://localhost:4000/api/v1/assignments/${assignmentId}`, {
                  headers: {
                    'Content-Type': 'application/json',
                    'X-Tenant': tenantId,
                  }
                });

                if (assignmentResponse.ok) {
                  const assignmentResult = await assignmentResponse.json();
                  assignmentTitle = assignmentResult.title || assignmentTitle;

                  if (assignmentResult.course) {
                    courseName = assignmentResult.course.name || courseName;
                    courseCode = assignmentResult.course.code || courseCode;
                  }
                }
              } catch (error) {
                console.log('Could not fetch assignment data for grades, using fallback');
              }
              
              // Create grade object with real data
              const grade: Grade = {
                id: `grade-${session.user.id}-${assignmentId}`,
                assignment: {
                  id: assignmentId,
                  title: assignmentTitle,
                  type: 'homework'
                },
                course: {
                  id: 'course-1',
                  name: courseName,
                  code: courseCode
                },
                grade: gradeData.final_score || gradeData.manual_score || 0,
                max_grade: 20,
                coefficient: 1,
                date: gradeData.graded_at,
                instructor: {
                  id: gradeData.graded_by?.id || 'teacher-1',
                  first_name: gradeData.graded_by?.name?.split(' ')[0] || 'Enseignant',
                  last_name: gradeData.graded_by?.name?.split(' ').slice(1).join(' ') || 'Principal'
                },
                feedback: gradeData.feedback
              };
              
              grades.push(grade);
              
            } catch (error) {
              // No grade file for this student in this assignment
              continue;
            }
            
          } catch (error) {
            console.log(`Skipping assignment directory ${assignmentId}:`, error);
            continue;
          }
        }
        
      } catch (error) {
        console.log('📊 STUDENT GRADES: No grades directory found');
      }
    }

    // Sort by date (most recent first)
    grades.sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());

    // Calculate statistics
    const totalGrades = grades.length;
    const totalPoints = grades.reduce((sum, grade) => sum + grade.grade, 0);
    const maxTotalPoints = grades.reduce((sum, grade) => sum + grade.max_grade, 0);
    const average = totalGrades > 0 ? totalPoints / totalGrades : 0;
    const bestScore = totalGrades > 0 ? Math.max(...grades.map(g => g.grade)) : 0;

    // Grade distribution
    const gradeDistribution = {
      excellent: grades.filter(g => g.grade >= 15).length,
      good: grades.filter(g => g.grade >= 10 && g.grade < 15).length,
      average: grades.filter(g => g.grade >= 8 && g.grade < 10).length,
      below_average: grades.filter(g => g.grade < 8).length
    };

    const statistics = {
      average,
      total_points: totalPoints,
      max_total_points: maxTotalPoints,
      best_score: bestScore,
      grade_distribution: gradeDistribution
    };

    console.log('✅ STUDENT GRADES: Found grades:', {
      total: totalGrades,
      average: average.toFixed(1),
      bestScore
    });

    return NextResponse.json({
      success: true,
      data: grades,
      statistics
    });

  } catch (error) {
    console.error('❌ STUDENT GRADES: API error:', error);
    return NextResponse.json(
      {
        success: false,
        error: 'Internal server error',
        details: error instanceof Error ? error.message : 'Unknown error'
      },
      { status: 500 }
    );
  }
}
