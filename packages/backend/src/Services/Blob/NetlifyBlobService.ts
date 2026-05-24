// Netlify Blobs replacement for Azure Blob Storage.
//
// Netlify Blobs has no native public URLs — every read goes through code.
// We store the upload in a named blob store ("container") and return a URL
// pointing to the serve-blob function (/blob/<container>/<key>), which is
// rewritten in netlify.toml to /.netlify/functions/serve-blob/<container>/<key>.

import Logger from '../Logging/Logger';

export default class NetlifyBlobService {
  private store(container: string) {
    // Lazy-require so the package is only loaded inside a Netlify Function
    // (it does no work outside the Netlify runtime).
    const { getStore } = require('@netlify/blobs');
    return getStore(container);
  }

  uploadBufferToBlob = async (
    containerName: string,
    blobName: string,
    buffer: Buffer,
    contentType?: string,
    onProgress?: (progress: any) => void,
  ): Promise<string> => {
    const store = this.store(containerName);

    // @netlify/blobs accepts Buffer | string | ArrayBuffer | Blob. We pass the
    // Buffer directly and stash the content-type in metadata so serve-blob can
    // set the right header.
    await store.set(blobName, buffer, {
      metadata: { contentType: contentType || 'application/octet-stream' },
    });

    if (onProgress) {
      // @netlify/blobs doesn't stream progress. Fire one "done" event so
      // callers that subscribe see something sane.
      try {
        onProgress({ loadedBytes: buffer.length });
      } catch (e) {
        Logger.warn({}, `onProgress callback threw: ${e}`);
      }
    }

    const siteOrigin =
      process.env.URL ||                              // production
      process.env.DEPLOY_PRIME_URL ||                 // deploy preview
      `http://localhost:${process.env.PORT || 8888}`; // netlify dev

    return `${siteOrigin}/blob/${encodeURIComponent(containerName)}/${encodeURIComponent(blobName)}`;
  };
}
