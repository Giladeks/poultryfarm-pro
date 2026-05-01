// app/api/observations/photo/route.js
// POST — generate a pre-signed S3 PUT URL for a flagged observation photo.
// Returns { uploadUrl, publicUrl }
// Photos stored under observations/{tenantId}/{taskId}/{uid}.{ext}

import { NextResponse }                          from 'next/server';
import { verifyToken }                           from '@/lib/middleware/auth';
import { S3Client, PutObjectCommand }            from '@aws-sdk/client-s3';
import { getSignedUrl }                          from '@aws-sdk/s3-request-presigner';
import { z }                                     from 'zod';
import crypto                                    from 'crypto';

const bodySchema = z.object({
  taskId:   z.string().min(1),
  fileName: z.string().min(1).max(200),
  fileType: z.enum(['image/jpeg', 'image/png', 'image/webp']),
});

const EXT = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp' };

export async function POST(request) {
  const user = await verifyToken(request);
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  // Only workers and managers can upload observation photos
  const ALLOWED = ['PEN_WORKER', 'PEN_MANAGER', 'FARM_MANAGER', 'FARM_ADMIN',
                   'INTERNAL_CONTROL', 'CHAIRPERSON', 'SUPER_ADMIN'];
  if (!ALLOWED.includes(user.role))
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

  try {
    const body = await request.json();
    const { taskId, fileName, fileType } = bodySchema.parse(body);

    const { AWS_REGION, AWS_S3_BUCKET, AWS_ACCESS_KEY_ID, AWS_SECRET_ACCESS_KEY } = process.env;

    if (!AWS_REGION || !AWS_S3_BUCKET || !AWS_ACCESS_KEY_ID || !AWS_SECRET_ACCESS_KEY) {
      return NextResponse.json(
        { error: 'S3 not configured — set AWS_REGION, AWS_S3_BUCKET, AWS_ACCESS_KEY_ID, AWS_SECRET_ACCESS_KEY' },
        { status: 503 }
      );
    }

    const s3  = new S3Client({
      region:      AWS_REGION,
      credentials: { accessKeyId: AWS_ACCESS_KEY_ID, secretAccessKey: AWS_SECRET_ACCESS_KEY },
    });

    const uid = crypto.randomBytes(10).toString('hex');
    const ext = EXT[fileType];
    const key = `observations/${user.tenantId}/${taskId}/${uid}.${ext}`;

    const command = new PutObjectCommand({
      Bucket:      AWS_S3_BUCKET,
      Key:         key,
      ContentType: fileType,
      ACL:         'public-read',
    });

    const uploadUrl = await getSignedUrl(s3, command, { expiresIn: 300 }); // 5 min
    const publicUrl = `https://${AWS_S3_BUCKET}.s3.${AWS_REGION}.amazonaws.com/${key}`;

    return NextResponse.json({ uploadUrl, publicUrl });
  } catch (err) {
    if (err?.name === 'ZodError')
      return NextResponse.json({ error: 'Invalid request', details: err.errors }, { status: 422 });
    console.error('[observations/photo]', err);
    return NextResponse.json({ error: 'Failed to generate upload URL' }, { status: 500 });
  }
}
