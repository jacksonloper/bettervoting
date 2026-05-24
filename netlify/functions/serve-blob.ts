// Public blob fetcher. Netlify Blobs are not addressable by URL by default;
// this function makes uploaded election images reachable at /blob/<key>.
//
// Containers and keys come from NetlifyBlobService:
//   /blob/<container>/<key>

import { getStore } from '@netlify/blobs';
import type { Handler } from '@netlify/functions';

export const handler: Handler = async (event) => {
  const splat = event.path.replace(/^\/(\.netlify\/functions\/serve-blob|blob)\/?/, '');
  const parts = splat.split('/').filter(Boolean);
  if (parts.length < 2) {
    return { statusCode: 400, body: 'expected /blob/<container>/<key>' };
  }

  const [container, ...keyParts] = parts;
  const key = keyParts.join('/');

  const store = getStore(container);
  const blob = await store.getWithMetadata(key, { type: 'arrayBuffer' });
  if (!blob) {
    return { statusCode: 404, body: `not found: ${container}/${key}` };
  }

  const contentType =
    (blob.metadata?.contentType as string | undefined) ?? 'application/octet-stream';

  return {
    statusCode: 200,
    headers: {
      'content-type': contentType,
      'cache-control': 'public, max-age=31536000, immutable',
    },
    body: Buffer.from(blob.data as ArrayBuffer).toString('base64'),
    isBase64Encoded: true,
  };
};
