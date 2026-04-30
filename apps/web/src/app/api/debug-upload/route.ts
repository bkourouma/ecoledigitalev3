import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth-options';
import fs from 'fs/promises';
import path from 'path';
import { randomUUID } from 'crypto';

export async function POST(request: NextRequest) {
  console.log('🔧 DEBUG: Upload endpoint hit');
  
  try {
    // Get session
    const session = await getServerSession(authOptions);

    if (!session?.user?.id) {
      console.error('❌ DEBUG: No session found');
      return NextResponse.json(
        { success: false, error: 'Authentication required' },
        { status: 401 }
      );
    }

    console.log('✅ DEBUG: Session found:', {
      userId: session.user.id,
      tenantId: session.tenantId
    });

    // Get form data
    let formData;
    try {
      formData = await request.formData();
      console.log('✅ DEBUG: Form data parsed:', {
        hasFile: formData.has('file'),
        keys: Array.from(formData.keys())
      });
    } catch (error) {
      console.error('❌ DEBUG: Failed to parse form data:', error);
      return NextResponse.json(
        { success: false, error: 'Invalid form data' },
        { status: 400 }
      );
    }

    // Get file
    const file = formData.get('file') as File;
    if (!file || !(file instanceof File)) {
      console.error('❌ DEBUG: No valid file found');
      return NextResponse.json(
        { success: false, error: 'No file provided' },
        { status: 400 }
      );
    }

    console.log('✅ DEBUG: File found:', {
      name: file.name,
      size: file.size,
      type: file.type
    });

    // Validate file type (PDF only)
    if (file.type !== 'application/pdf' && !file.name.toLowerCase().endsWith('.pdf')) {
      console.error('❌ DEBUG: Invalid file type:', file.type);
      return NextResponse.json(
        { success: false, error: 'Seuls les fichiers PDF sont acceptés' },
        { status: 400 }
      );
    }

    // Validate file size (max 10MB)
    const maxSize = 10 * 1024 * 1024; // 10MB
    if (file.size > maxSize) {
      console.error('❌ DEBUG: File too large:', file.size);
      return NextResponse.json(
        { success: false, error: 'Le fichier est trop volumineux (max 10MB)' },
        { status: 400 }
      );
    }

    console.log('✅ DEBUG: File validation passed');

    // Get tenant ID
    const tenantId = session.tenantId || 'imhotepacademy';
    const assignmentId = 'debug-assignment-id';

    // Save the file
    try {
      // Create uploads directory structure
      const uploadsDir = process.env.FILE_STORAGE_PATH || path.join(process.cwd(), 'uploads');
      const tenantDir = path.join(uploadsDir, tenantId);
      const assignmentDir = path.join(tenantDir, assignmentId);
      
      console.log('📁 DEBUG: Creating directories:', assignmentDir);
      
      // Ensure directories exist
      await fs.mkdir(assignmentDir, { recursive: true });
      
      // Generate unique filename
      const timestamp = Date.now();
      const sanitizedName = file.name.replace(/[^a-zA-Z0-9.-]/g, '_');
      const uniqueFilename = `debug-${session.user.id}-${timestamp}-${sanitizedName}`;
      const filePath = path.join(assignmentDir, uniqueFilename);
      
      console.log('💾 DEBUG: Saving file to:', filePath);
      
      // Save file
      const fileBuffer = Buffer.from(await file.arrayBuffer());
      await fs.writeFile(filePath, fileBuffer);
      
      console.log('✅ DEBUG: File saved successfully:', {
        path: filePath,
        size: fileBuffer.length
      });
      
      // Generate file URL
      const fileKey = `${tenantId}/${assignmentId}/${uniqueFilename}`;
      const fileUrl = `/api/v1/files/${fileKey}`;
      
      // Generate submission ID
      const submissionId = randomUUID();
      
      console.log('✅ DEBUG: Upload successful');

      return NextResponse.json({
        success: true,
        data: {
          submissionId,
          fileUrl,
          fileName: file.name,
          fileSize: file.size,
          sizeMB: (file.size / (1024 * 1024)).toFixed(2),
          status: 'in_progress',
          debug: {
            filePath,
            uniqueFilename,
            tenantId,
            assignmentId
          }
        },
        message: "DEBUG: Fichier téléchargé avec succès"
      });

    } catch (saveError) {
      console.error('❌ DEBUG: Failed to save file:', saveError);
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
    console.error('❌ DEBUG: Upload error:', error);
    return NextResponse.json(
      {
        success: false,
        error: 'Internal server error',
        debug: {
          message: error instanceof Error ? error.message : 'Unknown error'
        }
      },
      { status: 500 }
    );
  }
}

export async function GET() {
  return NextResponse.json({
    message: 'Debug upload endpoint is working',
    timestamp: new Date().toISOString()
  });
}
