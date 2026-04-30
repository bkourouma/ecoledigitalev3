import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth-options';
import fs from 'fs/promises';
import path from 'path';
import { randomUUID } from 'crypto';

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ assignmentId: string }> }
) {
  console.log('📤 Submission upload request received');

  try {
    // Get session
    const session = await getServerSession(authOptions);

    if (!session?.user?.id) {
      console.error('❌ No session found for upload');
      return NextResponse.json(
        { success: false, error: 'Authentication required' },
        { status: 401 }
      );
    }

    // Await params (Next.js 15 requirement)
    const { assignmentId } = await params;

    console.log('📋 Upload request details:', {
      assignmentId,
      userId: session.user.id,
      hasSession: !!session
    });

    console.log('📤 Upload details:', {
      assignmentId,
      userId: session.user.id,
      tenantId: session.tenantId
    });
    
    // Get the form data from the request
    let formData;
    try {
      formData = await request.formData();
      console.log('📦 Form data received:', {
        hasFile: formData.has('file'),
        fileCount: Array.from(formData.keys()).length,
        keys: Array.from(formData.keys())
      });
    } catch (error) {
      console.error('❌ Failed to parse form data:', error);
      return NextResponse.json(
        { success: false, error: 'Invalid form data' },
        { status: 400 }
      );
    }

    // Validate file
    const file = formData.get('file') as File;
    if (!file || !(file instanceof File)) {
      console.error('❌ No valid file found in form data');
      return NextResponse.json(
        { success: false, error: 'No file provided' },
        { status: 400 }
      );
    }

    console.log('📁 File details:', {
      name: file.name,
      size: file.size,
      type: file.type
    });

    // Process the upload directly (like the test endpoint that works)
    // Get tenant ID from session or headers
    const incomingTenant = request.headers.get('X-Tenant') || request.headers.get('x-tenant');
    const tenantId = session.tenantId || incomingTenant || 'imhotepacademy';

    console.log('💾 Processing upload directly:', {
      assignmentId,
      tenantId,
      userId: session.user.id,
      fileName: file.name,
      fileSize: file.size,
      fileType: file.type
    });

    // Validate file type (PDF only)
    if (file.type !== 'application/pdf' && !file.name.toLowerCase().endsWith('.pdf')) {
      console.error('❌ Invalid file type:', file.type);
      return NextResponse.json(
        { success: false, error: 'Seuls les fichiers PDF sont acceptés' },
        { status: 400 }
      );
    }

    // Validate file size (max 10MB)
    const maxSize = 10 * 1024 * 1024; // 10MB
    if (file.size > maxSize) {
      console.error('❌ File too large:', file.size);
      return NextResponse.json(
        { success: false, error: 'Le fichier est trop volumineux (max 10MB)' },
        { status: 400 }
      );
    }

    // Save the file to the uploads directory
    try {
      // Create uploads directory structure
      const uploadsDir = process.env.FILE_STORAGE_PATH || path.join(process.cwd(), 'uploads');
      const tenantDir = path.join(uploadsDir, tenantId);
      const assignmentDir = path.join(tenantDir, assignmentId);

      // Ensure directories exist
      await fs.mkdir(assignmentDir, { recursive: true });

      // Generate unique filename
      const timestamp = Date.now();
      const fileExtension = path.extname(file.name);
      const sanitizedName = file.name.replace(/[^a-zA-Z0-9.-]/g, '_');
      const uniqueFilename = `submission-${session.user.id}-${timestamp}-${sanitizedName}`;
      const filePath = path.join(assignmentDir, uniqueFilename);

      console.log('💾 Saving file to:', filePath);

      // Save file
      const fileBuffer = Buffer.from(await file.arrayBuffer());
      await fs.writeFile(filePath, fileBuffer);

      // Generate file URL (using the same pattern as FileStorageService)
      const fileKey = `${tenantId}/${assignmentId}/${uniqueFilename}`;
      const fileUrl = `/api/v1/files/${fileKey}`;

      console.log('✅ File saved successfully:', {
        path: filePath,
        size: fileBuffer.length,
        url: fileUrl
      });

      // Generate submission ID
      const submissionId = randomUUID();

      console.log('✅ Upload successful:', {
        submissionId,
        fileUrl,
        fileName: file.name,
        fileSize: file.size
      });

      return NextResponse.json({
        success: true,
        data: {
          submissionId,
          fileUrl,
          fileName: file.name,
          fileSize: file.size,
          sizeMB: (file.size / (1024 * 1024)).toFixed(2),
          status: 'in_progress'
        },
        message: "Fichier téléchargé avec succès"
      });

    } catch (saveError) {
      console.error('❌ Failed to save file:', saveError);
      return NextResponse.json(
        {
          success: false,
          error: 'Erreur lors de la sauvegarde du fichier',
          details: saveError instanceof Error ? saveError.message : 'Unknown error'
        },
        { status: 500 }
      );
    }
  } catch (error) {
    console.error('❌ Upload API error:', error);
    return NextResponse.json(
      {
        success: false,
        error: 'Internal server error',
        debug: process.env.NODE_ENV === 'development' ? {
          message: error instanceof Error ? error.message : 'Unknown error'
        } : undefined
      },
      { status: 500 }
    );
  }
}
