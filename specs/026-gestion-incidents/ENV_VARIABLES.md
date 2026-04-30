# Environment Variables for Incident Management

This document lists the environment variables required for the incident management module.

## Required Environment Variables

Add these to your `apps/api/.env` file:

```env
# MinIO/S3 Configuration for File Storage
MINIO_ENDPOINT=http://localhost:9000
MINIO_ACCESS_KEY=minioadmin
MINIO_SECRET_KEY=minioadmin
MINIO_BUCKET=rso-incidents
MINIO_REGION=us-east-1

# File Upload Configuration for Incidents
# Maximum file size per upload (in bytes) - 100 MB for incident evidence
INCIDENT_MAX_FILE_SIZE=104857600

# PDF Generation Configuration
# Puppeteer configuration for incident PDF reports
PUPPETEER_HEADLESS=true
PUPPETEER_TIMEOUT=30000

# Incident Management Configuration
# Delay detection thresholds (in hours)
INCIDENT_DELAY_CRITICAL=6
INCIDENT_DELAY_HIGH=24
INCIDENT_DELAY_MODERATE=168
INCIDENT_DELAY_MINOR=336

# Incident archiving period (in years)
INCIDENT_ARCHIVE_PERIOD=2

# Export Configuration (if not already set)
RSO_EXPORTS_UPLOAD_DIR=./uploads/exports
```

## Notes

- The `MINIO_*` variables are used for storing incident evidence files (photos, videos, documents)
- `INCIDENT_MAX_FILE_SIZE` should match the Fastify multipart configuration (currently 100 MB)
- Delay detection thresholds are used by scheduled tasks to identify incidents that exceed expected resolution times
- The archiving period determines when closed incidents are automatically archived (default: 2 years)

