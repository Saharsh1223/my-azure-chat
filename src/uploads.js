const MAX_CONTEXT = 450000;
const ignoredDirs = new Set(['node_modules', '.git', 'library', 'temp', 'obj', 'builds', 'dist', '.next']);
const ignoredExt = new Set(['meta', 'png', 'jpg', 'jpeg', 'gif', 'webp', 'svg', 'ico', 'pdf', 'zip', 'gz', '7z', 'rar', 'exe', 'dll', 'so', 'dylib', 'class', 'jar', 'wasm', 'mp3', 'mp4', 'mov', 'woff', 'woff2', 'ttf', 'otf', 'bin', 'db', 'sqlite', 'lock']);
const codeExt = new Set(['js', 'jsx', 'ts', 'tsx', 'mjs', 'cjs', 'json', 'css', 'scss', 'html', 'htm', 'vue', 'svelte', 'py', 'rb', 'rs', 'go', 'java', 'kt', 'swift', 'c', 'h', 'cpp', 'hpp', 'cs', 'php', 'sh', 'bash', 'sql', 'md', 'txt', 'yaml', 'yml', 'toml', 'xml', 'graphql', 'gql', 'dockerfile', 'gitignore', 'env', 'ini', 'conf']);

export async function packCodebase(files) {
  let context = '';
  let count = 0;
  let skipped = 0;
  let truncated = false;
  for (const file of files) {
    const path = file.webkitRelativePath || file.name;
    const parts = path.split('/');
    const name = parts.at(-1).toLowerCase();
    const ext = name.includes('.') ? name.split('.').at(-1) : name;
    if (parts.slice(0, -1).some((part) => ignoredDirs.has(part.toLowerCase())) ||
        ignoredExt.has(ext) || name === '.env' || name.startsWith('.env.') ||
        (!codeExt.has(ext) && !file.type.startsWith('text/')) || file.size > 500000) {
      skipped++;
      continue;
    }
    const text = await file.text();
    if (text.includes('\0')) { skipped++; continue; }
    const safePath = path.replaceAll('"', '&quot;').replaceAll('<', '&lt;');
    const prefix = `<file path="${safePath}">\n`;
    const suffix = '\n</file>\n\n';
    const available = MAX_CONTEXT - context.length - prefix.length - suffix.length;
    if (available <= 0) { truncated = true; break; }
    context += prefix + text.slice(0, available) + suffix;
    count++;
    if (text.length > available) { truncated = true; break; }
  }
  return { codebaseContext: context, codebaseFileCount: count, codebaseTokens: Math.ceil(context.length / 4), skipped, truncated };
}

export function resizeImage(file) {
  return new Promise((resolve, reject) => {
    const image = new Image();
    const url = URL.createObjectURL(file);
    image.onload = () => {
      URL.revokeObjectURL(url);
      const scale = Math.min(1, 1280 / Math.max(image.width, image.height));
      const canvas = document.createElement('canvas');
      canvas.width = Math.round(image.width * scale);
      canvas.height = Math.round(image.height * scale);
      canvas.getContext('2d').drawImage(image, 0, 0, canvas.width, canvas.height);
      resolve(canvas.toDataURL('image/jpeg', 0.72));
    };
    image.onerror = () => { URL.revokeObjectURL(url); reject(new Error('Could not read image.')); };
    image.src = url;
  });
}
