#!/usr/bin/env node

import { v2 as cloudinary } from 'cloudinary';
import 'dotenv/config';

function requireEnv(name) {
  const value = process.env[name]?.trim();

  if (!value) {
    throw new Error(`Missing required environment variable: ${name}`);
  }

  return value;
}

cloudinary.config({
  cloud_name: requireEnv('CLOUDINARY_CLOUD_NAME'),
  api_key: requireEnv('CLOUDINARY_API_KEY'),
  api_secret: requireEnv('CLOUDINARY_API_SECRET'),
  secure: true,
});

const sampleImageUrl =
  'https://res.cloudinary.com/demo/image/upload/sample.jpg';

async function main() {
  const uploadResult = await cloudinary.uploader.upload(sampleImageUrl, {
    folder: 'onboarding',
  });

  console.log('Uploaded image secure URL:');
  console.log(uploadResult.secure_url);
  console.log('');
  console.log('Uploaded image public ID:');
  console.log(uploadResult.public_id);
  console.log('');

  const resource = await cloudinary.api.resource(uploadResult.public_id);

  console.log('Image metadata:');
  console.log(`Width: ${resource.width}`);
  console.log(`Height: ${resource.height}`);
  console.log(`Format: ${resource.format}`);
  console.log(`File size in bytes: ${resource.bytes}`);
  console.log('');

  const transformedUrl = cloudinary.url(uploadResult.public_id, {
    secure: true,
    // f_auto lets Cloudinary choose the best image format for the user's browser.
    fetch_format: 'auto',
    // q_auto lets Cloudinary choose an efficient quality level automatically.
    quality: 'auto',
  });

  console.log(
    'Done! Click link below to see optimized version of the image. Check the size and the format.',
  );
  console.log(transformedUrl);
}

main().catch((error) => {
  console.error('Cloudinary onboarding failed:');
  console.error(error);
  process.exitCode = 1;
});
