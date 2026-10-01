const { S3Client, CreateBucketCommand, PutBucketCorsCommand, HeadBucketCommand } = require('@aws-sdk/client-s3');

// MinIOSetupConfig interface converted to JSDoc
/**
 * @typedef {Object} MinIOSetupConfig
 * @property {string} endpoint
 * @property {string} accessKey
 * @property {string} secretKey
 * @property {string} bucket
 * @property {string} [region]
 */

async function setupMinIO() {
  const config = {
    endpoint: process.env.MINIO_ENDPOINT || 'http://localhost:9000',
    accessKey: process.env.MINIO_ACCESS_KEY || process.env.MINIO_USER || '',
    secretKey: process.env.MINIO_SECRET_KEY || process.env.MINIO_PASSWORD || '',
    bucket: process.env.MINIO_BUCKET || 'course-materials',
    region: process.env.MINIO_REGION || 'us-east-1',
  };

  if (!config.accessKey || !config.secretKey) {
    throw new Error('MINIO_ACCESS_KEY et MINIO_SECRET_KEY (ou MINIO_USER et MINIO_PASSWORD) sont requis');
  }

  console.log('Setting up MinIO bucket:', config.bucket);
  console.log('MinIO endpoint:', config.endpoint);

  const s3Client = new S3Client({
    endpoint: config.endpoint,
    region: config.region,
    credentials: {
      accessKeyId: config.accessKey,
      secretAccessKey: config.secretKey,
    },
    forcePathStyle: true, // Required for MinIO
  });

  try {
    // Check if bucket exists
    try {
      await s3Client.send(new HeadBucketCommand({ Bucket: config.bucket }));
      console.log(`✓ Bucket '${config.bucket}' already exists`);
    } catch (error) {
      if (error.name === 'NotFound') {
        // Create bucket
        console.log(`Creating bucket '${config.bucket}'...`);
        await s3Client.send(new CreateBucketCommand({ 
          Bucket: config.bucket,
          CreateBucketConfiguration: {
            LocationConstraint: config.region,
          },
        }));
        console.log(`✓ Bucket '${config.bucket}' created successfully`);
      } else {
        throw error;
      }
    }

    // Set up CORS policy (skip for MinIO as it uses different configuration)
    console.log('⚠️  CORS policy configuration skipped for MinIO');
    console.log('   MinIO CORS should be configured via MinIO client or environment variables');
    console.log('✓ MinIO setup completed successfully!');

  } catch (error) {
    console.error('❌ MinIO setup failed:', error);
    process.exit(1);
  }
}

// Run setup if called directly
if (require.main === module) {
  setupMinIO().catch(console.error);
}

module.exports = { setupMinIO };
