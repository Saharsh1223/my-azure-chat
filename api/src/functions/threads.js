import { randomUUID } from 'node:crypto';
import { app } from '@azure/functions';
import { assertSize, getContainer, getThread, handleError, HttpError, principalFor } from '../lib.js';

app.http('listThreads', {
  methods: ['GET'],
  authLevel: 'anonymous',
  route: 'threads',
  handler: async (request, context) => {
    try {
      const userId = principalFor(request);
      const container = await getContainer();
      const query = {
        query: 'SELECT c.id, c.title, c.updatedAt, c.codebaseTokens FROM c WHERE c.userId = @userId ORDER BY c.updatedAt DESC',
        parameters: [{ name: '@userId', value: userId }],
      };
      const { resources } = await container.items.query(query, { partitionKey: userId }).fetchAll();
      return { jsonBody: resources };
    } catch (error) {
      return handleError(error, context);
    }
  },
});

app.http('getThread', {
  methods: ['GET'],
  authLevel: 'anonymous',
  route: 'threads/{id}',
  handler: async (request, context) => {
    try {
      const userId = principalFor(request);
      const thread = await getThread(await getContainer(), request.params.id, userId);
      return { jsonBody: thread };
    } catch (error) {
      return handleError(error, context);
    }
  },
});

app.http('saveThread', {
  methods: ['POST'],
  authLevel: 'anonymous',
  route: 'threads',
  handler: async (request, context) => {
    try {
      const userId = principalFor(request);
      const data = await request.json();
      if (!data || typeof data !== 'object' || Array.isArray(data)) throw new HttpError(400, 'Invalid thread data.');
      const container = await getContainer();
      const existing = data.id ? await getThread(container, data.id, userId) : null;
      const thread = existing || {
        id: randomUUID(), userId, title: 'New conversation', systemPrompt: '', codebaseContext: '',
        codebaseFileCount: 0, codebaseTokens: 0, maxContextMessages: 20, reasoningEffort: 'medium', messages: [],
      };
      for (const field of ['title', 'systemPrompt', 'codebaseContext']) {
        if (data[field] !== undefined) {
          if (typeof data[field] !== 'string') throw new HttpError(400, `Invalid ${field}.`);
          thread[field] = data[field];
        }
      }
      if (thread.title.length > 160 || thread.systemPrompt.length > 10000 || thread.codebaseContext.length > 450000) {
        throw new HttpError(413, 'Title, system prompt, or codebase exceeds its size limit.');
      }
      for (const field of ['codebaseFileCount', 'codebaseTokens']) {
        if (data[field] !== undefined) {
          if (!Number.isSafeInteger(data[field]) || data[field] < 0) throw new HttpError(400, `Invalid ${field}.`);
          thread[field] = data[field];
        }
      }
      if (data.maxContextMessages !== undefined) {
        if (!Number.isInteger(data.maxContextMessages) || data.maxContextMessages < 2 || data.maxContextMessages > 50) {
          throw new HttpError(400, 'History limit must be between 2 and 50.');
        }
        thread.maxContextMessages = data.maxContextMessages;
      }
      if (data.reasoningEffort !== undefined) {
        if (!['none', 'low', 'medium', 'high'].includes(data.reasoningEffort)) throw new HttpError(400, 'Invalid reasoning effort.');
        thread.reasoningEffort = data.reasoningEffort;
      }
      thread.updatedAt = new Date().toISOString();
      assertSize(thread);
      const { resource } = await container.items.upsert(thread);
      return { jsonBody: resource };
    } catch (error) {
      return handleError(error, context);
    }
  },
});

app.http('deleteThread', {
  methods: ['DELETE'],
  authLevel: 'anonymous',
  route: 'threads/{id}',
  handler: async (request, context) => {
    try {
      const userId = principalFor(request);
      const container = await getContainer();
      await getThread(container, request.params.id, userId);
      await container.item(request.params.id, userId).delete();
      return { status: 204 };
    } catch (error) {
      return handleError(error, context);
    }
  },
});
