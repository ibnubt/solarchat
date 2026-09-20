<script lang="ts">
  import { goto, invalidateAll } from '$app/navigation';
  import { onMount, tick } from 'svelte';
  import { gsap } from 'gsap';
  import { ArrowUp, BarChart3, Bot, Check, ChevronDown, CircleStop, Clock3, Copy, History, ImagePlus, LoaderCircle, LogOut, Menu, MessageSquareText, PanelLeftClose, PanelLeftOpen, Plus, Sparkles, Trash2, User, X, Zap } from 'lucide-svelte';
  import { CHAT_MODELS, DEFAULT_CHAT_MODEL, type ChatAttachment, type ChatMessage } from '$lib/chat';
  import Markdown from '$lib/Markdown.svelte';
  import ThroughputChart from '$lib/ThroughputChart.svelte';

  type ContextState = { summary: string; compactedThroughId: string; summarizedMessages: number; estimatedTokensAfter: number; compactedAt: string };
  type Conversation = { id: string; title: string; model: string; messages: ChatMessage[]; context?: ContextState; createdAt: string; updatedAt: string };

  const starters = [
    { title: 'Buat strategi produk', body: 'Susun strategi peluncuran produk SaaS B2B dalam 30 hari.' },
    { title: 'Jelaskan dengan simpel', body: 'Jelaskan cara kerja transformer seperti saya berusia 12 tahun.' },
    { title: 'Tulis kode yang bersih', body: 'Buat fungsi TypeScript untuk debounce dengan tipe yang aman.' }
  ];

  const models = CHAT_MODELS;

  let messages: ChatMessage[] = $state([]);
  let conversations: Conversation[] = $state([]);
  let activeConversationId = $state('');
  let activeContext: ContextState | null = $state(null);
  let prompt = $state('');
  let model = $state(DEFAULT_CHAT_MODEL);
  let pendingAttachment: ChatAttachment | null = $state(null);
  let uploadingImage = $state(false);
  let uploadError = $state('');
  let streaming = $state(false);
  let historyLoading = $state(true);
  let sidebarOpen = $state(false);
  let sidebarCollapsed = $state(false);
  let textarea: HTMLTextAreaElement;
  let imageInput: HTMLInputElement = $state()!;
  let conversation: HTMLElement = $state()!;
  let abortController: AbortController | null = null;
  let startedAt = 0;
  let firstTokenMs = $state(0);
  let outputTokens = $state(0);
  let copiedId = $state('');
  let thinkingLabel = $state('Menyusun jawaban');
  let throughput: number[] = $state([0, 0, 0, 0, 0, 0, 0, 0]);
  const selectedModel = $derived(models.find((item) => item.value === model) || models[0]);

  const makeId = () => crypto.randomUUID();

  onMount(() => {
    sidebarCollapsed = localStorage.getItem('tokenku-sidebar-collapsed') === 'true';
    void loadHistory();
    gsap.from('.brand, .hero > *, .starter-card', { opacity: 0, y: 14, duration: 0.55, stagger: 0.06, ease: 'power3.out' });
    const shortcut = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'k') { event.preventDefault(); resetChat(); }
    };
    window.addEventListener('keydown', shortcut);
    return () => window.removeEventListener('keydown', shortcut);
  });

  async function loadHistory() {
    historyLoading = true;
    try {
      const response = await fetch('/api/history');
      if (response.status === 401) return goto('/login');
      if (!response.ok) throw new Error('Gagal memuat riwayat.');
      const result = await response.json();
      conversations = Array.isArray(result.conversations) ? result.conversations : [];
    } catch { conversations = []; }
    finally { historyLoading = false; }
  }

  function toggleSidebar() {
    sidebarCollapsed = !sidebarCollapsed;
    localStorage.setItem('tokenku-sidebar-collapsed', String(sidebarCollapsed));
  }

  function setStarter(text: string) {
    prompt = text;
    tick().then(() => { textarea?.focus(); resizeTextarea(); });
  }

  function resizeTextarea() {
    if (!textarea) return;
    textarea.style.height = 'auto';
    textarea.style.height = `${Math.min(textarea.scrollHeight, 180)}px`;
  }

  async function uploadImage(file: File) {
    uploadError = '';
    if (!selectedModel.multimodal) {
      uploadError = 'Pilih model Vision untuk mengirim gambar.';
      return;
    }
    if (!['image/jpeg', 'image/png', 'image/webp'].includes(file.type)) {
      uploadError = 'Gunakan gambar JPEG, PNG, atau WebP.';
      return;
    }
    if (file.size > 5 * 1024 * 1024) {
      uploadError = 'Ukuran gambar maksimal 5 MB.';
      return;
    }
    uploadingImage = true;
    try {
      const form = new FormData();
      form.set('image', file);
      const response = await fetch('/api/uploads', { method: 'POST', body: form });
      const result = await response.json().catch(() => ({}));
      if (!response.ok || !result.attachment) throw new Error(result.error || 'Upload gambar gagal.');
      const previousAttachment = pendingAttachment;
      pendingAttachment = result.attachment as ChatAttachment;
      if (previousAttachment) await fetch(previousAttachment.url, { method: 'DELETE' }).catch(() => undefined);
    } catch (error) {
      uploadError = (error as Error).message;
    } finally {
      uploadingImage = false;
    }
  }

  async function selectImage(event: Event) {
    const input = event.currentTarget as HTMLInputElement;
    const file = input.files?.[0];
    input.value = '';
    if (file) await uploadImage(file);
  }

  function handlePaste(event: ClipboardEvent) {
    const imageItem = Array.from(event.clipboardData?.items || []).find(
      (item) => item.kind === 'file' && item.type.startsWith('image/')
    );
    if (!imageItem) return;

    event.preventDefault();
    if (streaming || uploadingImage) return;
    if (!selectedModel.multimodal) {
      uploadError = 'Pilih model Vision untuk menempelkan gambar.';
      return;
    }

    const clipboardFile = imageItem.getAsFile();
    if (!clipboardFile) {
      uploadError = 'Gambar dari clipboard tidak dapat dibaca.';
      return;
    }

    const extension = clipboardFile.type === 'image/jpeg' ? 'jpg' : clipboardFile.type.split('/')[1] || 'png';
    const file = new File([clipboardFile], clipboardFile.name || `clipboard-${Date.now()}.${extension}`, {
      type: clipboardFile.type,
      lastModified: clipboardFile.lastModified || Date.now()
    });
    void uploadImage(file);
  }

  async function discardPendingAttachment() {
    const attachment = pendingAttachment;
    pendingAttachment = null;
    uploadError = '';
    if (attachment) await fetch(attachment.url, { method: 'DELETE' }).catch(() => undefined);
  }

  function changeModel(event: Event) {
    const nextModel = (event.currentTarget as HTMLSelectElement).value;
    const next = models.find((item) => item.value === nextModel) || models[0];
    model = next.value;
    if (!next.multimodal && pendingAttachment) void discardPendingAttachment();
  }

  async function scrollToBottom(force = false) {
    if (!conversation) return;
    const distance = conversation.scrollHeight - conversation.scrollTop - conversation.clientHeight;
    if (!force && distance > 160) return;
    await tick();
    requestAnimationFrame(() => { if (conversation) conversation.scrollTop = conversation.scrollHeight; });
  }

  function extractError(raw: string) {
    try {
      const parsed = JSON.parse(raw);
      const inner = typeof parsed.error === 'string' ? JSON.parse(parsed.error) : parsed.error;
      return inner?.error?.message || inner?.message || parsed.error || 'Permintaan gagal diproses.';
    } catch { return raw || 'Permintaan gagal diproses.'; }
  }

  function conversationFrom(nextMessages: ChatMessage[]): Conversation {
    const existing = conversations.find((item) => item.id === activeConversationId);
    const now = new Date().toISOString();
    const firstQuestion = nextMessages.find((item) => item.role === 'user')?.content || 'Percakapan baru';
    return {
      id: activeConversationId,
      title: firstQuestion.replace(/\s+/g, ' ').trim().slice(0, 52),
      model,
      messages: nextMessages,
      ...(activeContext || existing?.context ? { context: activeContext || existing?.context } : {}),
      createdAt: existing?.createdAt || now,
      updatedAt: now
    };
  }

  async function persistConversation(nextMessages = messages) {
    if (!activeConversationId || nextMessages.length === 0) return;
    const saved = conversationFrom(nextMessages);
    conversations = [saved, ...conversations.filter((item) => item.id !== saved.id)];
    try {
      const response = await fetch('/api/history', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(saved) });
      if (response.status === 401) await goto('/login');
    } catch { /* Simpan ulang setelah respons berikutnya. */ }
  }

  async function sendMessage() {
    const attachment = pendingAttachment;
    const content = prompt.trim() || (attachment ? 'Jelaskan gambar ini.' : '');
    if ((!content && !attachment) || streaming || uploadingImage) return;
    if (!activeConversationId) activeConversationId = makeId();

    const userMessage: ChatMessage = {
      id: makeId(),
      role: 'user',
      content,
      ...(attachment ? { attachments: [attachment] } : {})
    };
    const assistantMessage: ChatMessage = { id: makeId(), role: 'assistant', content: '' };
    const previousMessages = [...messages, userMessage];
    const requestMessages = previousMessages.map(({ id, role, content: value, attachments }) => ({
      id,
      role,
      content: value,
      ...(attachments?.length ? { attachments } : {})
    }));
    messages = [...previousMessages, assistantMessage];
    await persistConversation(previousMessages);
    pendingAttachment = null;
    uploadError = '';
    prompt = '';
    resizeTextarea();
    streaming = true;
    const estimatedContextTokens = requestMessages.reduce(
      (total, message) => total + Math.ceil(message.content.length / 4) + 4,
      activeContext ? Math.ceil(activeContext.summary.length / 4) : 0
    );
    thinkingLabel = estimatedContextTokens >= 24_000 ? 'Meringkas konteks lama' : 'Menghubungkan ke model';
    startedAt = performance.now();
    firstTokenMs = 0;
    outputTokens = 0;
    throughput = [0, 0, 0, 0, 0, 0, 0, 0];
    abortController = new AbortController();
    await scrollToBottom(true);

    let generated = '';
    let renderFrame = 0;
    const flushAssistant = () => {
      if (renderFrame) cancelAnimationFrame(renderFrame);
      renderFrame = 0;
      messages = messages.map((message) => message.id === assistantMessage.id ? { ...message, content: generated } : message);
      void scrollToBottom();
    };
    const scheduleRender = () => { if (!renderFrame) renderFrame = requestAnimationFrame(flushAssistant); };

    try {
      const response = await fetch('/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ conversationId: activeConversationId, model, messages: requestMessages }),
        signal: abortController.signal
      });
      if (!response.ok || !response.body) throw new Error(extractError(await response.text()));

      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';
      const processEvent = (event: string) => {
        for (const line of event.split(/\r?\n/)) {
          if (!line.startsWith('data:')) continue;
          const data = line.slice(5).trim();
          if (!data || data === '[DONE]') continue;
          try {
            const payload = JSON.parse(data);
            if (payload.type === 'context.compacted' && payload.context) {
              activeContext = payload.context as ContextState;
              thinkingLabel = 'Konteks lama telah diringkas';
              continue;
            }
            const delta = payload.choices?.[0]?.delta;
            if (delta?.reasoning_content && !generated) thinkingLabel = 'Menalar jawaban';
            if (delta?.content) {
              if (!firstTokenMs) firstTokenMs = Math.round(performance.now() - startedAt);
              thinkingLabel = 'Menulis jawaban';
              generated += delta.content;
              outputTokens = payload.usage?.completion_tokens || Math.ceil(generated.length / 4);
              const seconds = Math.max((performance.now() - startedAt) / 1000, 0.1);
              throughput = [...throughput.slice(-11), Math.round((outputTokens / seconds) * 10) / 10];
              scheduleRender();
            }
            if (payload.usage?.completion_tokens) outputTokens = payload.usage.completion_tokens;
          } catch { /* Abaikan event keep-alive non-JSON. */ }
        }
      };

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const events = buffer.split(/\r?\n\r?\n/);
        buffer = events.pop() || '';
        events.forEach(processEvent);
      }
      if (buffer.trim()) processEvent(buffer);
      flushAssistant();
    } catch (error) {
      flushAssistant();
      if ((error as Error).name !== 'AbortError') { generated = `Maaf, terjadi kendala: ${(error as Error).message}`; flushAssistant(); }
    } finally {
      streaming = false;
      abortController = null;
      await persistConversation(messages);
      await scrollToBottom(true);
    }
  }

  function stopStream() { abortController?.abort(); }

  function resetChat() {
    abortController?.abort();
    streaming = false;
    messages = [];
    activeConversationId = '';
    activeContext = null;
    firstTokenMs = 0;
    outputTokens = 0;
    throughput = [0, 0, 0, 0, 0, 0, 0, 0];
    prompt = '';
    void discardPendingAttachment();
    sidebarOpen = false;
    tick().then(() => textarea?.focus());
  }

  async function openConversation(item: Conversation) {
    if (streaming) return;
    activeConversationId = item.id;
    activeContext = item.context || null;
    model = models.some((entry) => entry.value === item.model) ? item.model : DEFAULT_CHAT_MODEL;
    messages = item.messages;
    void discardPendingAttachment();
    firstTokenMs = 0;
    outputTokens = 0;
    throughput = [0, 0, 0, 0, 0, 0, 0, 0];
    sidebarOpen = false;
    await scrollToBottom(true);
  }

  async function removeConversation(event: MouseEvent, id: string) {
    event.stopPropagation();
    if (streaming && id === activeConversationId) return;
    try {
      const response = await fetch(`/api/history?id=${encodeURIComponent(id)}`, { method: 'DELETE' });
      if (!response.ok) return;
      conversations = conversations.filter((item) => item.id !== id);
      if (activeConversationId === id) resetChat();
    } catch { /* Pertahankan item bila server tidak dapat dijangkau. */ }
  }

  async function copyMessage(message: ChatMessage) {
    await navigator.clipboard.writeText(message.content);
    copiedId = message.id;
    setTimeout(() => (copiedId = ''), 1500);
  }

  async function logout() {
    abortController?.abort();
    await fetch('/api/auth/logout', { method: 'POST' });
    await invalidateAll();
    await goto('/login');
  }

  function handleKeydown(event: KeyboardEvent) {
    if (event.key === 'Enter' && !event.shiftKey) { event.preventDefault(); void sendMessage(); }
  }

  function relativeTime(value: string) {
    const minutes = Math.max(0, Math.round((Date.now() - new Date(value).getTime()) / 60_000));
    if (minutes < 1) return 'baru saja';
    if (minutes < 60) return `${minutes}m`;
    const hours = Math.floor(minutes / 60);
    return hours < 24 ? `${hours}j` : `${Math.floor(hours / 24)}h`;
  }

  const tokensPerSecond = $derived(throughput.length ? throughput[throughput.length - 1].toFixed(1) : '0.0');
</script>

<svelte:head>
  <meta property="og:title" content="SOLAR Chat — Private AI Workspace" />
  <meta property="og:description" content="Ruang kerja AI SOLAR dengan streaming real-time, riwayat, dan konteks percakapan." />
</svelte:head>

<div class="app-shell" class:collapsed={sidebarCollapsed}>
  <aside class:open={sidebarOpen} class="sidebar">
    <div class="sidebar-top">
      <a class="brand" href="/" aria-label="SOLAR Chat"><span class="brand-mark"><Zap size={17} strokeWidth={2.5} /></span><span class="brand-name">SOLAR <span class="brand-suffix">CHAT</span></span></a>
      <button class="icon-button mobile-close" onclick={() => (sidebarOpen = false)} aria-label="Tutup menu"><X size={18} /></button>
    </div>

    <button class="new-chat" onclick={resetChat} title="Percakapan baru"><Plus size={17} /><span class="new-chat-label">Percakapan baru</span><span class="shortcut">⌘K</span></button>

    <section class="nav-section">
      <p class="eyebrow">Workspace</p>
      <a class="nav-item" href="/poc" title="Laporan POC Tokenku"><BarChart3 size={16} /><span class="new-chat-label">Laporan POC Tokenku</span></a>
    </section>

    <section class="history-section">
      <div class="history-heading"><p class="eyebrow">Riwayat</p>{#if !sidebarCollapsed}<span>{conversations.length}</span>{/if}</div>
      <div class="history-list">
        {#if historyLoading}
          <div class="history-empty"><i></i><span>Memuat riwayat…</span></div>
        {:else if conversations.length === 0}
          <div class="history-empty"><History size={17} /><span>Belum ada percakapan</span></div>
        {:else}
          {#each conversations as item (item.id)}
            <div class:active={item.id === activeConversationId} class="history-row">
              <button class="history-open" onclick={() => openConversation(item)} title={item.title}><MessageSquareText size={15} /><span><strong>{item.title}</strong><small>{relativeTime(item.updatedAt)}</small></span></button>
              <button class="history-delete" onclick={(event) => removeConversation(event, item.id)} aria-label={`Hapus ${item.title}`}><X size={13} /></button>
            </div>
          {/each}
        {/if}
      </div>
    </section>

    <div class="sidebar-insight">
      <div class="insight-heading"><span>Output stream</span><span class="status-pill"><i></i> {streaming ? 'aktif' : 'siap'}</span></div>
      <ThroughputChart points={throughput} />
      <div class="insight-stats"><div><strong>{tokensPerSecond}</strong><span>tok/dtk</span></div><div><strong>{firstTokenMs || '—'}</strong><span>TTFT (ms)</span></div></div>
    </div>

    <div class="sidebar-footer">
      <div class="avatar">SO</div><div class="profile-copy"><strong>SOLAR</strong><span>Private workspace</span></div>
      <div class="footer-actions">
        <button class="icon-button" onclick={logout} aria-label="Keluar" title="Keluar"><LogOut size={16} /></button>
        <button class="icon-button collapse-button" onclick={toggleSidebar} aria-label={sidebarCollapsed ? 'Perluas sidebar' : 'Ciutkan sidebar'} title={sidebarCollapsed ? 'Perluas sidebar' : 'Ciutkan sidebar'}>{#if sidebarCollapsed}<PanelLeftOpen size={17} />{:else}<PanelLeftClose size={17} />{/if}</button>
      </div>
    </div>
  </aside>

  {#if sidebarOpen}<button class="scrim" onclick={() => (sidebarOpen = false)} aria-label="Tutup menu"></button>{/if}

  <main class="main">
    <header class="topbar">
      <button class="icon-button menu-button" onclick={() => (sidebarOpen = true)} aria-label="Buka menu"><Menu size={20} /></button>
      <div class="model-select-group">
        <div class="model-select-wrap"><Bot size={16} /><select value={model} onchange={changeModel} aria-label="Pilih model" disabled={streaming}>{#each models as item}<option value={item.value}>{item.label} · {item.multimodal ? 'Vision' : 'Text'} · {item.cost}</option>{/each}</select><ChevronDown size={14} /></div>
        <span class:vision={selectedModel.multimodal} class="capability-badge">{selectedModel.multimodal ? 'Vision' : 'Text only'}</span>
      </div>
      <div class="topbar-actions">
        {#if activeConversationId}<button class="ghost-button danger" onclick={(event) => removeConversation(event, activeConversationId)}><Trash2 size={15} /> Hapus chat</button>{/if}
        <span class="connection"><i></i> API siap</span>
      </div>
    </header>

    <div class="workspace">
      {#if messages.length === 0}
        <section class="empty-state">
          <div class="hero"><div class="hero-icon"><Sparkles size={26} /></div><p class="overline">SOLAR CHAT · PRIVATE AI WORKSPACE</p><h1>Mulai dengan sebuah <em>ide.</em></h1><p class="hero-copy">Tanyakan apa saja. Percakapan tersimpan dan konteksnya tetap terjaga.</p></div>
          <div class="starter-grid">{#each starters as starter, index}<button class="starter-card" onclick={() => setStarter(starter.body)}><span class="starter-index">0{index + 1}</span><strong>{starter.title}</strong><span>{starter.body}</span><ArrowUp size={17} /></button>{/each}</div>
        </section>
      {:else}
        <section class="conversation" bind:this={conversation} aria-live="polite">
          <div class="conversation-inner">
            {#each messages as message (message.id)}
              <article class:assistant={message.role === 'assistant'} class="message">
                <div class="message-avatar">{#if message.role === 'assistant'}<Zap size={16} />{:else}<User size={16} />{/if}</div>
                <div class="message-body">
                  <div class="message-heading"><strong>{message.role === 'assistant' ? 'SOLAR' : 'Anda'}</strong>{#if message.role === 'assistant' && message.content && (!streaming || message !== messages[messages.length - 1])}<button onclick={() => copyMessage(message)} aria-label="Salin jawaban">{#if copiedId === message.id}<Check size={14} />{:else}<Copy size={14} />{/if}</button>{/if}</div>
                  {#if message.attachments?.length}
                    <div class="message-attachments">
                      {#each message.attachments as attachment}
                        <a href={attachment.url} target="_blank" rel="noreferrer" aria-label={`Buka ${attachment.name}`}><img src={attachment.url} alt={attachment.name} /></a>
                      {/each}
                    </div>
                  {/if}
                  {#if message.content}
                    {#if message.role === 'assistant'}<Markdown content={message.content} />{:else}<p>{message.content}</p>{/if}
                    {#if message.role === 'assistant' && streaming && message === messages[messages.length - 1]}<span class="cursor"></span>{/if}
                  {:else}<div class="thinking"><i></i><i></i><i></i><span>{thinkingLabel}</span></div>{/if}
                </div>
              </article>
            {/each}
          </div>
        </section>
      {/if}

      <div class="composer-area">
        <div class="composer" class:focused={prompt.length > 0 || !!pendingAttachment}>
          {#if pendingAttachment}
            <div class="pending-attachment">
              <img src={pendingAttachment.url} alt={pendingAttachment.name} />
              <div><strong>{pendingAttachment.name}</strong><span>{Math.max(1, Math.round(pendingAttachment.size / 1024))} KB · siap dikirim</span></div>
              <button onclick={() => void discardPendingAttachment()} aria-label="Hapus gambar"><X size={15} /></button>
            </div>
          {/if}
          {#if uploadError}<p class="upload-error">{uploadError}</p>{/if}
          <textarea bind:this={textarea} bind:value={prompt} oninput={resizeTextarea} onkeydown={handleKeydown} onpaste={handlePaste} placeholder={selectedModel.multimodal ? 'Ketik pesan atau paste gambar untuk SOLAR…' : 'Ketik pesan untuk SOLAR…'} aria-label="Pesan" rows="1" disabled={streaming}></textarea>
          <div class="composer-footer">
            <div class="composer-tools">
              {#if selectedModel.multimodal}
                <input bind:this={imageInput} class="file-input" type="file" accept="image/jpeg,image/png,image/webp" onchange={selectImage} aria-label="Pilih gambar" />
                <button class="attach-button" class:loading={uploadingImage} onclick={() => imageInput?.click()} disabled={streaming || uploadingImage} aria-label="Upload gambar" title="Upload atau paste gambar (maks. 5 MB)">{#if uploadingImage}<LoaderCircle size={16} />{:else}<ImagePlus size={16} />{/if}</button>
              {/if}
              <span><Sparkles size={14} /> {streaming ? thinkingLabel : selectedModel.multimodal ? 'Teks dan gambar aktif' : 'Konteks percakapan aktif'}</span>
            </div>
            {#if streaming}<button class="send-button stop" onclick={stopStream} aria-label="Hentikan respons"><CircleStop size={17} /></button>{:else}<button class="send-button" onclick={sendMessage} disabled={(!prompt.trim() && !pendingAttachment) || uploadingImage} aria-label="Kirim pesan"><ArrowUp size={18} strokeWidth={2.5} /></button>{/if}
          </div>
        </div>
        <div class="composer-meta">
          <span><Clock3 size={12} /> {firstTokenMs ? `${firstTokenMs} ms respons pertama` : 'Respons real-time'}</span>
          <span>{activeContext ? `${activeContext.summarizedMessages} pesan lama diringkas` : outputTokens ? `~${outputTokens} token dihasilkan` : selectedModel.multimodal ? 'Paste gambar · Enter kirim · Shift + Enter baris baru' : 'Enter kirim · Shift + Enter baris baru'}</span>
        </div>
      </div>
    </div>
  </main>
</div>
