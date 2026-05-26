import { BadRequest, InternalServerError } from "@curveball/http-errors";
import Logger from '../Services/Logging/Logger';
import { randomUUID } from "crypto";
import ServiceLocator from "../ServiceLocator";
import { C, logCtx } from "../honoTypes";

const BlobService = ServiceLocator.blobService();
const CONTAINER_NAME = 'candidate-photos';

export const uploadImageController = async (c: C) => {
    const ctx = logCtx(c);
    // Web Request's formData() decodes multipart. Replaces multer.
    const form = await c.req.raw.formData();
    const fileField = form.get('file');
    if (!(fileField instanceof File)) {
        throw new BadRequest('Expected a file field named "file"');
    }
    if (!fileField.type.startsWith('image/')) {
        throw new BadRequest('Only image uploads are allowed');
    }

    const buffer = Buffer.from(await fileField.arrayBuffer());
    const blobName = `${randomUUID()}.jpg`;
    try {
        const photo_filename = await BlobService.uploadBufferToBlob(
            CONTAINER_NAME,
            blobName,
            buffer,
            fileField.type,
            (progress: any) => Logger.info(ctx, progress),
        );
        Logger.info(ctx, `File uploaded successfully. ${photo_filename}`);
        return c.json({ photo_filename });
    } catch (e: any) {
        throw new InternalServerError(e);
    }
};
