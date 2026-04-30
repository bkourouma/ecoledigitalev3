import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth-options';
import fs from 'fs/promises';
import path from 'path';
import { randomUUID } from 'crypto';

export async function POST(request: NextRequest) {
  console.log('📤 Attendance report upload request received');
  
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

    // Get tenant ID from session or headers
    // Prefer session.tenantId (UUID) over header (slug)
    const incomingTenant = request.headers.get('X-Tenant') || request.headers.get('x-tenant');
    // Use session.tenantId if available (UUID), otherwise use incomingTenant (slug)
    // Fallback to 'imhotepacademy' for development
    let tenantId = session.tenantId || incomingTenant || 'imhotepacademy';
    
    // If tenantId is a slug (not UUID), we need to resolve it to UUID
    // For now, we'll use the slug directly since files are stored with slug
    // The backend route will try both UUID and slug paths
    const isUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(tenantId);
    
    // If we have a slug, keep it as-is (backend will handle both)
    // If we have a UUID, use it directly
    // This ensures consistency: files stored with slug can be read with UUID and vice versa

    console.log('📤 Attendance report upload details:', {
      userId: session.user.id,
      tenantId: tenantId,
      isUuid: isUuid,
      sessionTenantId: session.tenantId,
      incomingTenant: incomingTenant,
    });

    // Get the form data from the request
    let formData;
    try {
      formData = await request.formData();
      console.log('📦 Form data received:', {
        hasFile: formData.has('file'),
        fileCount: Array.from(formData.keys()).length
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
        { success: false, error: 'Aucun fichier fourni' },
        { status: 400 }
      );
    }
    
    // Validate file type (PDF only for attendance reports)
    const allowedTypes = ['application/pdf'];
    const allowedExtensions = ['.pdf'];
    const fileExtension = path.extname(file.name).toLowerCase();
    
    if (!allowedTypes.includes(file.type) && !allowedExtensions.includes(fileExtension)) {
      console.error('❌ Invalid file type:', file.type);
      return NextResponse.json(
        { success: false, error: 'Seuls les fichiers PDF sont acceptés pour les rapports de présence' },
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
    
    console.log('📁 File details:', {
      name: file.name,
      size: file.size,
      type: file.type
    });
    
    // Create uploads directory structure
    const uploadsDir = process.env.FILE_STORAGE_PATH || path.join(process.cwd(), 'uploads');
    const tenantDir = path.join(uploadsDir, tenantId);
    const attendanceReportsDir = path.join(tenantDir, 'attendance-reports');
    
    // Ensure directories exist
    await fs.mkdir(attendanceReportsDir, { recursive: true });
    
    // Generate unique filename
    const timestamp = Date.now();
    const sanitizedName = file.name.replace(/[^a-zA-Z0-9.-]/g, '_');
    const uniqueId = randomUUID().split('-')[0];
    const uniqueFilename = `rapport-presence-${timestamp}-${uniqueId}-${sanitizedName}`;
    const filePath = path.join(attendanceReportsDir, uniqueFilename);
    
    console.log('💾 Saving file to:', filePath);
    
    // Save file
    const fileBuffer = Buffer.from(await file.arrayBuffer());
    await fs.writeFile(filePath, fileBuffer);
    
    // Generate file URL (using the same pattern as FileStorageService)
    const fileKey = `${tenantId}/attendance-reports/${uniqueFilename}`;
    const fileUrl = `/api/v1/files/${fileKey}`;
    
    console.log('✅ File uploaded successfully:', {
      fileKey,
      fileUrl,
      fileName: file.name,
      fileSize: file.size
    });
    
    return NextResponse.json({
      success: true,
      data: {
        fileUrl,
        fileName: file.name,
        fileSize: file.size,
        fileKey,
      },
      message: 'Fichier téléchargé avec succès'
    });
    
  } catch (error) {
    console.error('❌ Attendance report upload error:', error);
    return NextResponse.json(
      {
        success: false,
        error: 'Erreur lors du téléchargement du fichier',
        details: error instanceof Error ? error.message : 'Unknown error'
      },
      { status: 500 }
    );
  }
}

