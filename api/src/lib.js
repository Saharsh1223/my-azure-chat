import { CosmosClient } from '@azure/cosmos';

const MAX_ITEM_BYTES = 1_800_000;
let containerPromise;

export class HttpError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

export function principalFor(request) {
  const header = request.headers.get('x-ms-client-principal');
  if (!header) throw new HttpError(401, 'Sign in with GitHub to continue.');
  let principal;
  try {
    principal = JSON.parse(Buffer.from(header, 'base64').toString('utf8'));
  } catch {
    throw new HttpError(401, 'Invalid sign-in information.');
  }
  if (typeof principal?.userDetails !== 'string' || !principal.userDetails ||
      (principal.userId !== undefined && typeof principal.userId !== 'string')) {
    throw new HttpError(401, 'Invalid sign-in information.');
  }
  const allowed = process.env.ALLOWED_GITHUB_USER;
  if (allowed && principal.userDetails.toLowerCase() !== allowed.toLowerCase()) {
    throw new HttpError(403, 'This account is not allowed.');
  }
  return principal.userId || 'saharsh';
}

export function getContainer() {
  if (!containerPromise) {
    containerPromise = (async () => {
      if (!process.env.COSMOS_ENDPOINT || !process.env.COSMOS_KEY) {
        throw new Error('Cosmos DB is not configured.');
      }
      const client = new CosmosClient({ endpoint: process.env.COSMOS_ENDPOINT, key: process.env.COSMOS_KEY });
      const { database } = await client.databases.createIfNotExists({ id: 'chatdb' });
      const { container } = await database.containers.createIfNotExists({ id: 'threads', partitionKey: { paths: ['/userId'] } });
      return container;
    })().catch((error) => {
      containerPromise = undefined;
      throw error;
    });
  }
  return containerPromise;
}

export async function getThread(container, id, userId) {
  if (!id || typeof id !== 'string') throw new HttpError(400, 'A thread ID is required.');
  try {
    const { resource } = await container.item(id, userId).read();
    if (!resource || resource.userId !== userId) throw new HttpError(404, 'Thread not found.');
    return resource;
  } catch (error) {
    if (error.code === 404) throw new HttpError(404, 'Thread not found.');
    throw error;
  }
}

export function assertSize(thread) {
  if (Buffer.byteLength(JSON.stringify(thread), 'utf8') > MAX_ITEM_BYTES) {
    throw new HttpError(413, 'Thread is too large. Clear codebase context or start a new conversation.');
  }
}

export function handleError(error, context) {
  if (!(error instanceof HttpError)) context.error(error);
  return { status: error.status || 500, jsonBody: { error: error.status ? error.message : 'An unexpected server error occurred.' } };
}
