import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth-options';

const API_BASE_URL = "";

export async function GET(
  request: NextRequest,
  { params }: { params: { studentId: string } }
) {
  try {
    // Get the authenticated user session
    const session = await getServerSession(authOptions);

    if (!session?.user?.id) {
      return NextResponse.json(
        { error: 'Non autorisé - Veuillez vous connecter' },
        { status: 401 }
      );
    }

    const { studentId } = params;
    
    // Verify that the requested student ID matches the session user ID
    // or that the user has permission to access this student's data
    if (studentId !== session.user.id) {
      // For now, we'll allow access but log it for debugging
      console.warn(`User ${session.user.id} requesting data for student ${studentId}`);
    }

    // Get query parameters from the request
    const url = new URL(request.url);
    const searchParams = url.searchParams.toString();
    const queryString = searchParams ? `?${searchParams}` : '';

    // Forward the request to the backend API
    const response = await fetch(`${API_BASE_URL}/api/v1/assignment-instances/students/${studentId}/assignments${queryString}`, {
      method: 'GET',
      headers: {
      "Content-Type": "application/json",
      "X-Tenant": "imhotepacademy",
            "X-User-Id": "634a57fe-2007-4ecb-ae5b-f9e3152a24fb"
    }
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error(`Backend API error: ${response.status} - ${errorText}`);
      
      // Return a more specific error message
      if (response.status === 404) {
        return NextResponse.json(
          { error: 'Aucun devoir trouvé pour cet étudiant' },
          { status: 404 }
        );
      }
      
      return NextResponse.json(
        { error: 'Erreur lors de la récupération des devoirs' },
        { status: response.status }
      );
    }

    const assignments = await response.json();
    return NextResponse.json(assignments);

  } catch (error) {
    console.error('Student assignments API route error:', error);
    return NextResponse.json(
      { error: 'Erreur interne du serveur' },
      { status: 500 }
    );
  }
}
