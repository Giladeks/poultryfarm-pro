// app/api/profile/avatar/route.js
// POST — generate a pre-signed S3 PUT URL for direct-to-S3 avatar upload
// Returns { uploadUrl, publicUrl }
//
// Required env vars (already in .env.example):
//   AWS_REGION           e.g. us-east-1
//   AWS_S3_BUCKET        e.g. poultryfarm-pro
//   AWS_ACCESS_KEY_ID
//   AWS_SECRET_ACCESS_KEY
//
// The bucket should have a CORS policy allowing PUT from your domain.
// Objects under avatars/ should have public-read ACL or a bucket policy.

import { NextResponse }    from 'next/server';
import { verifyToken }     from '@/lib/middleware/auth';
import { S3Client, PutObjectCommand } from '@aws-sdk/client-s3';
import { getSignedUrl }    from '@aws-sdk/s3-request-presigner';
import { z }               from 'zod';
import crypto              from 'crypto';

const bodySchema = z.object({
  fileName: z.string().min(1).max(200),
  fileType: z.enum(['image/jpeg', 'image/png', 'image/webp']),
});

const ALLOWED_TYPES = ['image/jpeg', 'image/png', 'image/webp'];

// Extension map
const EXT = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp' };

export async function POST(request) {
  const user = await verifyToken(request);
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  try {
    const body = await request.json();
    const { fileName, fileType } = bodySchema.parse(body);

    if (!ALLOWED_TYPES.includes(fileType))
      return NextResponse.json({ error: 'Invalid file type. Use JPEG, PNG or WebP.' }, { status: 400 });

    const {
      AWS_REGION, AWS_S3_BUCKET,
      AWS_ACCESS_KEY_ID, AWS_SECRET_ACCESS_KEY,
    } = process.env;

    if (!AWS_REGION || !AWS_S3_BUCKET || !AWS_ACCESS_KEY_ID || !AWS_SECRET_ACCESS_KEY) {
      return NextResponse.json(
        { error: 'AWS S3 is not configured. Set AWS_REGION, AWS_S3_BUCKET, AWS_ACCESS_KEY_ID, AWS_SECRET_ACCESS_KEY in your environment.' },
        { status: 503 }
      );
    }

    const s3 = new S3Client({
      region: AWS_REGION,
      credentials: { accessKeyId: AWS_ACCESS_KEY_ID, secretAccessKey: AWS_SECRET_ACCESS_KEY },
    });

    // Use a random key so old URLs can't be guessed / overwrote
    const uid = crypto.randomBytes(12).toString('hex');
    const ext = EXT[fileType];
    const key = `avatars/${user.tenantId}/${user.sub}/${uid}.${ext}`;

    const command = new PutObjectCommand({
      Bucket:      AWS_S3_BUCKET,
      Key:         key,
      ContentType: fileType,
      // ACL public-read so the image can be served directly by S3
      ACL:         'public-read',
    });

    // Pre-signed URL valid for 5 minutes
    const uploadUrl = await getSignedUrl(s3, command, { expiresIn: 300 });

    // Public URL the browser will use once upload completes
    const publicUrl = `https://${AWS_S3_BUCKET}.s3.${AWS_REGION}.amazonaws.com/${key}`;

    return NextResponse.json({ uploadUrl, publicUrl });
  } catch (err) {
    if (err.name === 'ZodError')
      return NextResponse.json({ error: 'Invalid request', details: err.errors }, { status: 422 });
    console.error('Avatar presign error:', err);
    return NextResponse.json({ error: 'Failed to generate upload URL' }, { status: 500 });
  }
}
