import { useState } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import hljs from 'highlight.js/lib/core';
import javascript from 'highlight.js/lib/languages/javascript';
import typescript from 'highlight.js/lib/languages/typescript';
import python from 'highlight.js/lib/languages/python';
import json from 'highlight.js/lib/languages/json';
import bash from 'highlight.js/lib/languages/bash';
import css from 'highlight.js/lib/languages/css';
import xml from 'highlight.js/lib/languages/xml';
import sql from 'highlight.js/lib/languages/sql';
import { Check, Copy } from 'lucide-react';

for (const [name, grammar] of Object.entries({ javascript, typescript, python, json, bash, css, xml, sql })) {
  hljs.registerLanguage(name, grammar);
}
for (const [alias, language] of Object.entries({ js: 'javascript', jsx: 'javascript', ts: 'typescript', tsx: 'typescript', py: 'python', sh: 'bash', html: 'xml' })) {
  hljs.registerAliases(alias, { languageName: language });
}

function CodeBlock({ children }) {
  const [copied, setCopied] = useState(false);
  const code = String(children?.props?.children ?? '').replace(/\n$/, '');
  const language = /language-([\w+-]+)/.exec(children?.props?.className || '')?.[1] || '';
  const html = language && hljs.getLanguage(language) ? hljs.highlight(code, { language, ignoreIllegals: true }).value : hljs.highlightAuto(code).value;
  async function copy() {
    await navigator.clipboard.writeText(code);
    setCopied(true);
    setTimeout(() => setCopied(false), 1800);
  }
  return (
    <div className="code-block">
      <div className="code-head"><span>{language || 'code'}</span><button type="button" onClick={copy} aria-label="Copy code">{copied ? <Check size={14} /> : <Copy size={14} />}{copied ? 'Copied' : 'Copy'}</button></div>
      <pre><code dangerouslySetInnerHTML={{ __html: html }} /></pre>
    </div>
  );
}

export default function Markdown({ content }) {
  return <div className="markdown"><ReactMarkdown remarkPlugins={[remarkGfm]} components={{ pre: CodeBlock }}>{content}</ReactMarkdown></div>;
}
