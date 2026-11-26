import { lazy, Suspense, useEffect, useRef, useState } from 'react';
import { ArrowUp, ChevronDown, Code2, ImagePlus, Menu, MessageSquare, PanelLeftClose, Plus, Settings2, Sparkles, Trash2, X } from 'lucide-react';
import { api, saveThread } from './api.js';
import { packCodebase, resizeImage } from './uploads.js';
const Markdown = lazy(() => import('./Markdown.jsx'));

const settingsFields = ['title', 'systemPrompt', 'codebaseContext', 'codebaseFileCount', 'codebaseTokens', 'maxContextMessages', 'reasoningEffort'];

export default function App() {
  const [threads, setThreads] = useState([]);
  const [thread, setThread] = useState(null);
  const [draft, setDraft] = useState('');
  const [images, setImages] = useState([]);
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(true);
  const [sidebar, setSidebar] = useState(false);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [controls, setControls] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [uploading, setUploading] = useState(false);
  const bottom = useRef(null);
  const folderInput = useRef(null);
  const imageInput = useRef(null);
  const saveTimer = useRef(null);
  const saveQueue = useRef(Promise.resolve());
  const current = useRef(null);
  const selectedId = useRef(null);

  useEffect(() => { current.current = thread; selectedId.current = thread?.id; }, [thread]);
  useEffect(() => {
    api('/threads').then(setThreads).catch((e) => setError(e.message)).finally(() => setLoading(false));
    return () => clearTimeout(saveTimer.current);
  }, []);
  useEffect(() => { bottom.current?.scrollIntoView({ behavior: 'smooth' }); }, [thread?.messages?.length, busy]);

  function updateList(item) {
    setThreads((prev) => [
      { id: item.id, title: item.title, updatedAt: item.updatedAt, codebaseTokens: item.codebaseTokens },
      ...prev.filter((entry) => entry.id !== item.id),
    ]);
  }

  function queueSettings(snapshot) {
    const payload = { id: snapshot.id, ...Object.fromEntries(settingsFields.map((key) => [key, snapshot[key]])) };
    saveQueue.current = saveQueue.current.catch(() => {}).then(async () => {
      const saved = await saveThread(payload);
      updateList(saved);
      return saved;
    });
    saveQueue.current.catch((e) => setError(e.message));
    return saveQueue.current;
  }

  function flushSettings() {
    if (saveTimer.current) {
      clearTimeout(saveTimer.current);
      saveTimer.current = null;
      return queueSettings(current.current);
    }
    return saveQueue.current;
  }

  function editSettings(patch) {
    const next = { ...current.current, ...patch };
    current.current = next;
    setThread(next);
    clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(() => { saveTimer.current = null; queueSettings(next); }, 650);
  }

  async function selectThread(id) {
    try {
      await flushSettings();
      setError('');
      setSidebar(false);
      setControls(false);
      if (!id) { current.current = null; setThread(null); return; }
      const selected = await api(`/threads/${encodeURIComponent(id)}`);
      current.current = selected;
      setThread(selected);
    } catch (e) { setError(e.message); }
  }

  async function createThread() {
    try {
      await flushSettings();
      const created = await saveThread({});
      updateList(created);
      current.current = created;
      setThread(created);
      setSidebar(false);
      setControls(false);
      setError('');
      return created;
    } catch (e) { setError(e.message); return null; }
  }

  async function deleteThread(id) {
    if (!window.confirm('Delete this conversation permanently?')) return;
    try {
      await flushSettings();
      await api(`/threads/${encodeURIComponent(id)}`, { method: 'DELETE' });
      setThreads((prev) => prev.filter((item) => item.id !== id));
      if (selectedId.current === id) { current.current = null; setThread(null); }
    } catch (e) { setError(e.message); }
  }

  async function addImages(files) {
    setError('');
    try {
      const remaining = 4 - images.length;
      if (files.length > remaining) throw new Error('Add up to four images per message.');
      const resized = await Promise.all(Array.from(files).map(resizeImage));
      const all = [...images, ...resized];
      if (all.join('').length > 950000) throw new Error('Images exceed 950 KB. Try fewer or smaller images.');
      setImages(all);
    } catch (e) { setError(e.message); }
  }

  async function uploadFolder(event) {
    const files = Array.from(event.target.files || []);
    event.target.value = '';
    if (!files.length) return;
    setUploading(true);
    setNotice('');
    try {
      const packed = await packCodebase(files);
      if (!packed.codebaseFileCount) throw new Error('No readable code or text files found in this folder.');
      if (!current.current) {
        const created = await createThread();
        if (!created) return;
      }
      editSettings(packed);
      await flushSettings();
      setNotice(`${packed.codebaseFileCount} files attached (${packed.codebaseTokens.toLocaleString()} estimated tokens).${packed.truncated ? ' Context capped at 450,000 characters; remaining files were omitted.' : ''}${packed.skipped ? ` ${packed.skipped} binary, ignored, or oversized files skipped.` : ''}`);
    } catch (e) { setError(e.message); }
    finally { setUploading(false); }
  }

  async function send() {
    if (busy || (!draft.trim() && !images.length)) return;
    setBusy(true);
    setError('');
    try {
      let active = current.current;
      if (!active) active = await createThread();
      if (!active) return;
      await flushSettings();
      const result = await api('/chat', { method: 'POST', body: JSON.stringify({ threadId: active.id, message: draft, images }) });
      current.current = result.thread;
      setThread(result.thread);
      updateList(result.thread);
      setDraft('');
      setImages([]);
    } catch (e) { setError(e.message); }
    finally { setBusy(false); }
  }

  const usage = thread?.messages?.slice(-2).reduce((total, message) => total + (message.tokens || 0), 0) || 0;

  return (
    <div className="app-shell">
      {sidebar && <button className="scrim" aria-label="Close sidebar" onClick={() => setSidebar(false)} />}
      <aside className={`sidebar ${sidebar ? 'open' : ''} ${sidebarCollapsed ? 'collapsed' : ''}`}>
        <div className="sidebar-brand"><div className="brand-mark"><span /><span /><span /></div><span>stillroom</span><button className="icon-btn collapse-desktop" aria-label="Collapse sidebar" onClick={() => setSidebarCollapsed(true)}><PanelLeftClose size={18} /></button><button className="icon-btn close-mobile" aria-label="Close sidebar" onClick={() => setSidebar(false)}><X size={19} /></button></div>
        <button className="new-chat" onClick={createThread}><Plus size={17} /> New conversation</button>
        <div className="sidebar-label">YOUR CONVERSATIONS</div>
        <nav className="thread-list" aria-label="Conversations">
          {loading && <div className="empty-list">Loading conversations...</div>}
          {!loading && !threads.length && <div className="empty-list">A blank page, just for you.</div>}
          {threads.map((item) => <div className={`thread-row ${thread?.id === item.id ? 'selected' : ''}`} key={item.id}>
            <button className="thread-name" onClick={() => selectThread(item.id)}><MessageSquare size={16} /><span>{item.title}</span></button>
            <button className="delete-btn" aria-label={`Delete ${item.title}`} title="Delete conversation" onClick={() => deleteThread(item.id)}><Trash2 size={15} /></button>
          </div>)}
        </nav>
        <div className="sidebar-footer"><span className="status-dot" /> PRIVATE WORKSPACE <span className="footer-line" /><a href="/.auth/logout">Sign out</a></div>
      </aside>

      <main className="main-panel">
        <header className="topbar">
          <div className="topbar-left"><button className={`icon-btn sidebar-toggle ${sidebarCollapsed ? 'visible' : ''}`} aria-label="Toggle sidebar" onClick={() => { if (window.matchMedia('(max-width: 760px)').matches) setSidebar(true); else setSidebarCollapsed((value) => !value); }}><Menu size={21} /></button><span className="topbar-title">{thread?.title || 'New conversation'}</span><span className="topbar-tag">PERSONAL SPACE</span></div>
          <button className={`controls-trigger ${controls ? 'active' : ''}`} onClick={() => setControls(true)}><Settings2 size={17} /><span>Controls</span></button>
        </header>

        <div className="conversation" key={thread?.id || 'empty'}>
          {!thread?.messages?.length ? <div className="welcome"><div className="welcome-icon"><Sparkles size={26} strokeWidth={1.4} /></div><div className="eyebrow">A QUIETER PLACE TO THINK</div><h1>What’s on your mind?</h1><p>Ask a question, explore an idea, or bring a codebase along.<br className="desktop-break" /> Your conversations stay in your private workspace.</p><div className="welcome-hints"><span>01 / Start a conversation</span><span>02 / Add context in Controls</span><span>03 / Make it yours</span></div></div> :
            <div className="messages">{thread.messages.map((item, index) => <article className={`message ${item.role}`} key={`${item.timestamp}-${index}`}>
              <div className="message-identity">{item.role === 'user' ? 'YOU' : <><span className="small-mark">✳</span> STILLROOM</>}<span className="message-time">{new Date(item.timestamp).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}</span></div>
              <div className="message-content">{item.images?.length > 0 && <div className="message-images">{item.images.map((src, i) => <img src={src} alt={`Attachment ${i + 1}`} key={i} />)}</div>}{item.role === 'assistant' ? <Suspense fallback={<div className="user-text">{item.content}</div>}><Markdown content={item.content} /></Suspense> : <div className="user-text">{item.content}</div>}</div>
              {item.tokens > 0 && <div className="message-tokens">{item.role === 'user' ? 'INPUT' : 'OUTPUT'} · {item.tokens.toLocaleString()} TOKENS</div>}
            </article>)}{busy && <div className="thinking"><span className="thinking-dot" /> Thinking through your message...</div>}<div ref={bottom} /></div>}
        </div>

        <div className="composer-zone">{error && <div className="feedback error"><span>{error}</span><button aria-label="Dismiss error" onClick={() => setError('')}><X size={15} /></button></div>}{notice && <div className="feedback notice"><span>{notice}</span><button aria-label="Dismiss notice" onClick={() => setNotice('')}><X size={15} /></button></div>}
          <div className="composer">{images.length > 0 && <div className="image-preview">{images.map((src, index) => <div className="preview" key={index}><img src={src} alt={`Pending attachment ${index + 1}`} /><button aria-label="Remove image" onClick={() => setImages(images.filter((_, i) => i !== index))}><X size={13} /></button></div>)}</div>}
            <textarea aria-label="Message" placeholder="Ask anything, or paste an image..." value={draft} onChange={(e) => setDraft(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) { e.preventDefault(); send(); } }} onPaste={(e) => { const pasted = Array.from(e.clipboardData?.files || []).filter((file) => file.type.startsWith('image/')); if (pasted.length) { e.preventDefault(); addImages(pasted); } }} rows={2} />
            <div className="composer-bottom"><div className="composer-tools"><button className="attach-btn" title="Attach images" aria-label="Attach images" onClick={() => imageInput.current?.click()}><ImagePlus size={19} /></button><input hidden ref={imageInput} type="file" accept="image/*" multiple onChange={(e) => { addImages(Array.from(e.target.files)); e.target.value = ''; }} />{thread?.codebaseFileCount > 0 && <span className="context-chip"><Code2 size={14} /> {thread.codebaseFileCount} files</span>}</div><button className="send-btn" title="Send message" aria-label="Send message" disabled={busy || (!draft.trim() && !images.length)} onClick={send}><ArrowUp size={20} /></button></div>
          </div><div className="composer-caption"><span>ENTER TO SEND · SHIFT+ENTER FOR NEW LINE</span><span>{thread?.messages?.length ? `LAST EXCHANGE · ${usage.toLocaleString()} TOKENS` : 'POWERED BY AZURE OPENAI'}</span></div>
        </div>
      </main>

      {controls && <><button className="drawer-scrim" aria-label="Close controls" onClick={() => setControls(false)} /><aside className="controls-drawer" aria-label="Conversation controls"><div className="drawer-top"><div><span className="eyebrow">PERSONALIZE YOUR SPACE</span><h2>Conversation controls</h2></div><button className="icon-btn" aria-label="Close controls" onClick={() => setControls(false)}><X size={21} /></button></div><div className="drawer-content">
        {!thread && <div className="drawer-info">Settings will be available once you start a conversation.</div>}
        <section className="control-section"><label htmlFor="system-prompt">System prompt</label><p>Set the tone and role of your assistant for this thread.</p><textarea id="system-prompt" disabled={!thread} rows={6} placeholder="You are a thoughtful, concise assistant..." value={thread?.systemPrompt || ''} onChange={(e) => editSettings({ systemPrompt: e.target.value })} maxLength={10000} /><span className="field-meta">AUTO-SAVED · {thread?.systemPrompt?.length || 0} / 10,000</span></section>
        <section className="control-section"><div className="label-row"><label htmlFor="history-limit">Context history</label><strong>{thread?.maxContextMessages || 20} messages</strong></div><p>How many recent messages the assistant can see.</p><input type="range" id="history-limit" disabled={!thread} min="2" max="50" value={thread?.maxContextMessages || 20} onChange={(e) => editSettings({ maxContextMessages: Number(e.target.value) })} /><div className="range-labels"><span>2</span><span>50</span></div></section>
        <section className="control-section"><label htmlFor="reasoning">Reasoning effort</label><p>Higher effort may take longer and use more tokens.</p><div className="select-wrap"><select id="reasoning" disabled={!thread} value={thread?.reasoningEffort || 'medium'} onChange={(e) => editSettings({ reasoningEffort: e.target.value })}><option value="none">None</option><option value="low">Low</option><option value="medium">Medium</option><option value="high">High</option></select><ChevronDown size={16} /></div></section>
        <section className="control-section codebase-section"><label>Codebase context</label><p>Attach source files as lasting context for this conversation. Files are sent to your Azure OpenAI deployment with each message; exclude secrets.</p><div className="codebase-card"><div className="codebase-icon"><Code2 size={20} /></div><div><strong>{thread?.codebaseFileCount ? `${thread.codebaseFileCount} files attached` : 'No codebase attached'}</strong><span>{thread?.codebaseFileCount ? `~${thread.codebaseTokens.toLocaleString()} tokens · saved across devices` : 'Choose a folder to get started'}</span></div></div><button className="folder-btn" disabled={uploading} onClick={() => folderInput.current?.click()}>{uploading ? 'Reading files...' : thread?.codebaseFileCount ? 'Replace codebase folder' : 'Upload codebase folder'}</button><input hidden ref={folderInput} type="file" webkitdirectory="" directory="" multiple onChange={uploadFolder} />{thread?.codebaseFileCount > 0 && <button className="clear-btn" onClick={() => { editSettings({ codebaseContext: '', codebaseFileCount: 0, codebaseTokens: 0 }); setNotice('Codebase context removed from this thread.'); }}>Clear codebase</button>}<span className="field-meta">450,000 CHARACTER LIMIT · BINARY FILES SKIPPED</span></section>
      </div><div className="drawer-foot"><span className="status-dot" /> Settings save automatically</div></aside></>}
    </div>
  );
}
