import { randomUUID } from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { CosmosClient } from '@azure/cosmos';
import express from 'express';

const app = express();
const userId = 'saharsh';
const maxItemBytes = 1_800_000;
let containerPromise;

class HttpError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

function getContainer() {
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

async function getThread(container, id) {
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

function assertSize(thread) {
  if (Buffer.byteLength(JSON.stringify(thread), 'utf8') > maxItemBytes) {
    throw new HttpError(413, 'Thread is too large. Clear codebase context or start a new conversation.');
  }
}

function asyncRoute(handler) {
  return (req, res, next) => Promise.resolve(handler(req, res)).catch(next);
}

app.use('/api', (req, res, next) => {
  if (!process.env.APP_PASSWORD || req.headers['x-app-password'] !== process.env.APP_PASSWORD) {
    return res.status(401).json({ error: 'Invalid app password.' });
  }
  next();
}, express.json({ limit: '2mb' }));

app.get('/api/threads', asyncRoute(async (req, res) => {
  const container = await getContainer();
  const query = {
    query: 'SELECT c.id, c.title, c.updatedAt, c.codebaseTokens FROM c WHERE c.userId = @userId ORDER BY c.updatedAt DESC',
    parameters: [{ name: '@userId', value: userId }],
  };
  const { resources } = await container.items.query(query, { partitionKey: userId }).fetchAll();
  res.json(resources);
}));

app.get('/api/threads/:id', asyncRoute(async (req, res) => {
  res.json(await getThread(await getContainer(), req.params.id));
}));

app.post('/api/threads', asyncRoute(async (req, res) => {
  const data = req.body;
  if (!data || typeof data !== 'object' || Array.isArray(data)) throw new HttpError(400, 'Invalid thread data.');
  const container = await getContainer();
  const existing = data.id ? await getThread(container, data.id) : null;
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
  res.json(resource);
}));

app.delete('/api/threads/:id', asyncRoute(async (req, res) => {
  const container = await getContainer();
  await getThread(container, req.params.id);
  await container.item(req.params.id, userId).delete();
  res.sendStatus(204);
}));

app.post('/api/chat', asyncRoute(async (req, res) => {
  const { threadId, message, images = [] } = req.body || {};
  if (typeof threadId !== 'string' || typeof message !== 'string' || message.length > 30000 ||
      !Array.isArray(images) || images.length > 4 || images.some((image) => typeof image !== 'string' || !/^data:image\/(jpeg|png|webp);base64,[a-zA-Z0-9+/=]+$/.test(image)) ||
      images.join('').length > 950000 || (!message.trim() && !images.length)) {
    throw new HttpError(400, 'Invalid message or images (maximum four images, 950 KB total).');
  }
  const container = await getContainer();
  const thread = await getThread(container, threadId);
  const userMessage = { role: 'user', content: message.trim(), images, tokens: 0, timestamp: new Date().toISOString() };
  const history = [...thread.messages, userMessage].slice(-thread.maxContextMessages);
  const input = history.map((entry) => ({
    role: entry.role,
    content: entry.role === 'assistant' ? entry.content : [
      { type: 'input_text', text: entry.content || 'What is in this image?' },
      ...(entry.images || []).map((image) => ({ type: 'input_image', image_url: image })),
    ],
  }));
  const endpoint = process.env.AZURE_OPENAI_ENDPOINT?.replace(/\/$/, '');
  if (!endpoint || !process.env.AZURE_OPENAI_KEY) throw new Error('Azure OpenAI is not configured.');
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 180000);
  let response;
  try {
    response = await fetch(`${endpoint}/openai/v1/responses`, {
      method: 'POST',
      signal: controller.signal,
      headers: { 'Content-Type': 'application/json', 'api-key': process.env.AZURE_OPENAI_KEY },
      body: JSON.stringify({
        model: process.env.AZURE_OPENAI_MODEL || 'gpt-6-sol',
        instructions: `${thread.systemPrompt || ''}${thread.codebaseContext ? `\n\n<codebase>\n${thread.codebaseContext}\n</codebase>` : ''}`,
        input,
        ...(thread.reasoningEffort !== 'none' ? { reasoning: { effort: thread.reasoningEffort } } : {}),
      }),
    });
  } finally {
    clearTimeout(timeout);
  }
  if (!response.ok) {
    const detail = await response.text();
    console.error(`Azure OpenAI returned ${response.status}: ${detail.slice(0, 1000)}`);
    throw new HttpError(502, `AI service returned ${response.status}. Check your deployment and context size.`);
  }
  const result = await response.json();
  const reply = result.output_text || result.output?.flatMap((item) => item.content || [])
    .filter((part) => part.type === 'output_text' || part.type === 'text').map((part) => part.text || '').join('\n') || '';
  if (!reply) throw new HttpError(502, 'AI service returned no text. Try again.');
  const usage = { input_tokens: result.usage?.input_tokens || 0, output_tokens: result.usage?.output_tokens || 0 };
  userMessage.tokens = usage.input_tokens;
  thread.messages.push(userMessage, {
    role: 'assistant', content: reply, images: [], tokens: usage.output_tokens, timestamp: new Date().toISOString(),
  });
  if (thread.messages.length === 2 && thread.title === 'New conversation') {
    thread.title = (message.trim() || 'Image conversation').replace(/\s+/g, ' ').slice(0, 60);
  }
  thread.updatedAt = new Date().toISOString();
  while (thread.messages.length > 2) {
    try { assertSize(thread); break; } catch (error) {
      if (!(error instanceof HttpError) || error.status !== 413) throw error;
      thread.messages.shift();
    }
  }
  assertSize(thread);
  const { resource } = await container.items.upsert(thread);
  res.json({ reply, usage, thread: resource });
}));

app.use('/api', (req, res) => res.status(404).json({ error: 'API route not found.' }));
app.use(express.static('dist'));
app.get('/{*path}', (req, res) => res.sendFile(path.join(path.dirname(fileURLToPath(import.meta.url)), 'dist/index.html')));
app.use((error, req, res, next) => {
  if (!(error instanceof HttpError) && error.type !== 'entity.too.large' && !(error instanceof SyntaxError && error.status === 400)) {
    console.error(error);
  }
  res.status(error.status || 500).json({ error: error instanceof HttpError ? error.message : error.status === 413 ? 'Request body is too large.' : error.status === 400 ? 'Invalid JSON.' : 'An unexpected server error occurred.' });
});

app.listen(process.env.PORT || 8080, () => console.log(`Stillroom listening on port ${process.env.PORT || 8080}`));
