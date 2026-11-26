import { app } from '@azure/functions';
import { assertSize, getContainer, getThread, handleError, HttpError, principalFor } from '../lib.js';

app.http('chat', {
  methods: ['POST'],
  authLevel: 'anonymous',
  route: 'chat',
  handler: async (request, context) => {
    try {
      const userId = principalFor(request);
      const { threadId, message, images = [] } = await request.json();
      if (typeof threadId !== 'string' || typeof message !== 'string' || message.length > 30000 ||
          !Array.isArray(images) || images.length > 4 || images.some((image) => typeof image !== 'string' || !/^data:image\/(jpeg|png|webp);base64,[a-zA-Z0-9+/=]+$/.test(image)) ||
          images.join('').length > 950000 || (!message.trim() && !images.length)) {
        throw new HttpError(400, 'Invalid message or images (maximum four images, 950 KB total).');
      }
      const container = await getContainer();
      const thread = await getThread(container, threadId, userId);
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
        context.error(`Azure OpenAI returned ${response.status}: ${detail.slice(0, 1000)}`);
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
      // Retain the newest messages if accumulated images or long conversations approach Cosmos' 2 MB limit.
      while (thread.messages.length > 2) {
        try { assertSize(thread); break; } catch (error) {
          if (!(error instanceof HttpError) || error.status !== 413) throw error;
          thread.messages.shift();
        }
      }
      assertSize(thread);
      const { resource } = await container.items.upsert(thread);
      return { jsonBody: { reply, usage, thread: resource } };
    } catch (error) {
      return handleError(error, context);
    }
  },
});
