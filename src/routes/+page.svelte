<script lang="ts">
  import { goto, invalidateAll } from '$app/navigation';
  import { onMount, tick } from 'svelte';
  import { gsap } from 'gsap';
  import { ArrowDown, ArrowUp, BarChart3, Bot, Check, ChevronDown, CircleStop, Clock3, Copy, History, ImagePlus, LoaderCircle, LogOut, Menu, MessageSquareText, PanelLeftClose, PanelLeftOpen, Plus, Sparkles, SquarePen, Trash2, User, X, Zap } from 'lucide-svelte';
  import { CHAT_MODELS, DEFAULT_CHAT_MODEL, trimContinuationOverlap, type ChatAttachment, type ChatMessage } from '$lib/chat';
  import ImageViewer from '$lib/ImageViewer.svelte';
  import Markdown from '$lib/Markdown.svelte';
  import ThroughputChart from '$lib/ThroughputChart.svelte';
  import { openImage } from '$lib/viewer.svelte';

  type ContextState = { summary: string; compactedThroughId: string; summarizedMessages: number; estimatedTokensAfter: number; compactedAt: string };
  type ConversationSummary = { id: string; title: string; model: string; messageCount: number; createdAt: string; updatedAt: string };
  type MessagePage = { conversation: ConversationSummary & { context?: ContextState }; messages: ChatMessage[]; hasMore: boolean };

  const HISTORY_PAGE_SIZE = 30;
  const MESSAGE_PAGE_SIZE = 30;
  // Server menggabungkan riwayat tersimpan, jadi cukup kirim ekor percakapan yang sedang dimuat.
  const CHAT_REQUEST_WINDOW = 40;

  const starters = [
    { title: 'Buat strategi produk', body: 'Susun strategi peluncuran produk SaaS B2B dalam 30 hari.' },
    { title: 'Jelaskan dengan simpel', body: 'Jelaskan cara kerja transformer seperti saya berusia 12 tahun.' },
    { title: 'Tulis kode yang bersih', body: 'Buat fungsi TypeScript untuk debounce dengan tipe yang aman.' }
  ];

  const models = CHAT_MODELS;

  let messages: ChatMessage[] = $state([]);
  let conversations: ConversationSummary[] = $state([]);
  let historyTotal = $state(0);
  let historyNextOffset: number | null = $state(null);
  let historyLoadingMore = $state(false);
  let activeConversationId = $state('');
  let loadingConversation = $state(false);
  let conversationError = $state('');
  let hasOlder = $state(false);
  let loadingOlder = $state(false);
  let pinnedToBottom = true;
  let lastScrollTop = 0;
  let showJump = $state(false);
  let composerHeight = $state(0);
  let openRequest = 0;
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
  let conversation: HTMLElement | undefined = $state();
  let conversationInner: HTMLElement | undefined = $state();
  let abortController: AbortController | null = null;
  let startedAt = 0;
  let firstTokenMs = $state(0);
  let outputTokens = $state(0);
  let copiedId = $state('');
  let thinkingLabel = $state('Menyusun jawaban');
  let throughput: number[] = $state([0, 0, 0, 0, 0, 0, 0, 0]);
  const selectedModel = $derived(models.find((item) => item.value === model) || models[0]);

  // Fallback aman untuk crypto.randomUUID (tidak tersedia di HTTP/internal/non-secure context)
  const makeId = () =>
    typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
      ? crypto.randomUUID()
      : `id-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;

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

  async function loadHistory(more = false) {
    if (more && (historyNextOffset === null || historyLoadingMore || historyLoading)) return;
    if (more) historyLoadingMore = true;
    else historyLoading = true;
    try {
      const offset = more ? historyNextOffset : 0;
      const response = await fetch(`/api/history?offset=${offset}&limit=${HISTORY_PAGE_SIZE}`);
      if (response.status === 401) return goto('/login');
      if (!response.ok) throw new Error('Gagal memuat riwayat.');
      const result = await response.json();
      const page: ConversationSummary[] = Array.isArray(result.conversations) ? result.conversations : [];
      const known = new Set(more ? conversations.map((item) => item.id) : []);
      conversations = more ? [...conversations, ...page.filter((item) => !known.has(item.id))] : page;
      historyNextOffset = typeof result.nextOffset === 'number' ? result.nextOffset : null;
      historyTotal = Number(result.total) || conversations.length;
    } catch { if (!more) conversations = []; }
    finally { historyLoading = false; historyLoadingMore = false; }
  }

  function handleHistoryScroll(event: Event) {
    const list = event.currentTarget as HTMLElement;
    if (list.scrollHeight - list.scrollTop - list.clientHeight < 120) void loadHistory(true);
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

  async function jumpToBottom(behavior: ScrollBehavior = 'auto') {
    pinnedToBottom = true;
    showJump = false;
    await tick();
    if (!conversation) return;
    // Animasi halus hanya untuk dua layar terakhir; jarak jauh dilompati dulu.
    const nearBottom = conversation.scrollHeight - conversation.clientHeight * 2;
    if (behavior === 'smooth' && conversation.scrollTop < nearBottom) conversation.scrollTop = nearBottom;
    conversation.scrollTo({ top: conversation.scrollHeight, behavior });
  }

  function handleConversationScroll() {
    if (!conversation) return;
    const top = conversation.scrollTop;
    const distance = conversation.scrollHeight - top - conversation.clientHeight;
    // Lepas dari bawah hanya bila posisi bergerak naik. Scroll anchoring browser (saat grafik/gambar
    // selesai dimuat) hanya menambah scrollTop, jadi tidak boleh dianggap pengguna menggulir ke atas.
    if (distance < 80) pinnedToBottom = true;
    else if (top < lastScrollTop - 1) pinnedToBottom = false;
    lastScrollTop = top;
    showJump = distance > 320;
    if (top < 320) void loadOlder();
  }

  // Tetap menempel di bawah saat isi bertambah (streaming, gambar/grafik selesai dimuat, composer membesar).
  $effect(() => {
    const scroller = conversation;
    const inner = conversationInner;
    if (!scroller || !inner) return;
    const observer = new ResizeObserver(() => {
      if (pinnedToBottom) scroller.scrollTop = scroller.scrollHeight;
    });
    observer.observe(inner);
    observer.observe(scroller);
    return () => observer.disconnect();
  });

  async function fetchMessagePage(id: string, before?: string): Promise<MessagePage | null> {
    const params = new URLSearchParams({ id, limit: String(MESSAGE_PAGE_SIZE) });
    if (before) params.set('before', before);
    const response = await fetch(`/api/history?${params}`);
    if (response.status === 401) { await goto('/login'); return null; }
    if (!response.ok) throw new Error('Gagal memuat percakapan.');
    return response.json();
  }

  async function loadOlder() {
    if (!hasOlder || loadingOlder || loadingConversation || !activeConversationId || !messages.length || !conversation) return;
    const request = openRequest;
    loadingOlder = true;
    let loaded = false;
    try {
      const page = await fetchMessagePage(activeConversationId, messages[0].id);
      if (!page || request !== openRequest || !conversation) return;
      const known = new Set(messages.map((message) => message.id));
      const previousHeight = conversation.scrollHeight;
      const previousTop = conversation.scrollTop;
      messages = [...page.messages.filter((message) => !known.has(message.id)), ...messages];
      hasOlder = page.hasMore;
      await tick();
      // Pertahankan posisi baca; lewati bila browser sudah menjangkar scroll sendiri.
      if (conversation && Math.abs(conversation.scrollTop - previousTop) < 1) {
        conversation.scrollTop = previousTop + (conversation.scrollHeight - previousHeight);
      }
      loaded = true;
    } catch { /* Coba lagi pada scroll berikutnya. */ }
    finally { loadingOlder = false; }
    if (loaded && request === openRequest && conversation && conversation.scrollTop < 320) void loadOlder();
  }

  function extractError(raw: string) {
    try {
      const parsed = JSON.parse(raw);
      const inner = typeof parsed.error === 'string' ? JSON.parse(parsed.error) : parsed.error;
      return inner?.error?.message || inner?.message || parsed.error || 'Permintaan gagal diproses.';
    } catch { return raw || 'Permintaan gagal diproses.'; }
  }

  /** Simpan hanya pesan yang berubah; server menggabungkannya ke riwayat berdasarkan id. */
  async function persistMessages(changed: ChatMessage[]) {
    if (!activeConversationId || changed.length === 0) return;
    const id = activeConversationId;
    const existing = conversations.find((item) => item.id === id);
    const now = new Date().toISOString();
    const firstQuestion = changed.find((item) => item.role === 'user')?.content || 'Percakapan baru';
    const summary: ConversationSummary = {
      id,
      title: existing?.title || firstQuestion.replace(/\s+/g, ' ').trim().slice(0, 52),
      model,
      messageCount: existing?.messageCount || 0,
      createdAt: existing?.createdAt || now,
      updatedAt: now
    };
    if (!existing) historyTotal += 1;
    conversations = [summary, ...conversations.filter((item) => item.id !== id)];
    try {
      const response = await fetch('/api/history', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ...summary,
          messages: changed.map(({ id: messageId, role, content, attachments }) => ({ id: messageId, role, content, ...(attachments?.length ? { attachments } : {}) })),
          ...(activeContext ? { context: activeContext } : {})
        })
      });
      if (response.status === 401) return goto('/login');
      const result = await response.json().catch(() => null);
      if (result?.conversation) conversations = conversations.map((item) => item.id === id ? result.conversation : item);
    } catch { /* Pesan tetap ada di layar; tersimpan pada penyimpanan berikutnya. */ }
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
    const requestMessages = previousMessages.slice(-CHAT_REQUEST_WINDOW).map(({ id, role, content: value, attachments }) => ({
      id,
      role,
      content: value,
      ...(attachments?.length ? { attachments } : {})
    }));
    messages = [...previousMessages, assistantMessage];
    await jumpToBottom();
    await persistMessages([userMessage]);
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

    let generated = '';
    let usageBase = 0;
    // Awal tiap lanjutan ditahan sebentar agar teks yang diulang model bisa dibuang sebelum tampil.
    let continuation: string | null = null;
    const settleContinuation = () => {
      if (continuation === null) return;
      generated += trimContinuationOverlap(generated, continuation);
      continuation = null;
    };
    let renderFrame = 0;
    const flushAssistant = () => {
      if (renderFrame) cancelAnimationFrame(renderFrame);
      renderFrame = 0;
      messages = messages.map((message) => message.id === assistantMessage.id ? { ...message, content: generated } : message);
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
            if (payload.type === 'response.continued') {
              // Server meminta model melanjutkan jawaban yang terpotong batas panjang.
              settleContinuation();
              continuation = '';
              usageBase = outputTokens;
              thinkingLabel = 'Melanjutkan jawaban';
              continue;
            }
            if (payload.type === 'response.truncated') {
              settleContinuation();
              generated += '\n\n> Jawaban mencapai batas panjang maksimum. Ketik "lanjutkan" untuk meneruskan.';
              scheduleRender();
              continue;
            }
            const delta = payload.choices?.[0]?.delta;
            if ((delta?.reasoning_content || delta?.reasoning) && !generated) thinkingLabel = 'Menalar jawaban';
            if (delta?.content) {
              if (!firstTokenMs) firstTokenMs = Math.round(performance.now() - startedAt);
              thinkingLabel = 'Menulis jawaban';
              if (continuation === null) generated += delta.content;
              else {
                continuation += delta.content;
                if (continuation.length >= 400) settleContinuation();
              }
              outputTokens = payload.usage?.completion_tokens ? usageBase + payload.usage.completion_tokens : Math.ceil(generated.length / 4);
              const seconds = Math.max((performance.now() - startedAt) / 1000, 0.1);
              throughput = [...throughput.slice(-11), Math.round((outputTokens / seconds) * 10) / 10];
              scheduleRender();
            }
            if (payload.usage?.completion_tokens) outputTokens = usageBase + payload.usage.completion_tokens;
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
      settleContinuation();
      flushAssistant();
    } catch (error) {
      settleContinuation();
      flushAssistant();
      if ((error as Error).name !== 'AbortError') { generated = `Maaf, terjadi kendala: ${(error as Error).message}`; flushAssistant(); }
    } finally {
      streaming = false;
      abortController = null;
      if (generated) {
        await persistMessages([{ ...assistantMessage, content: generated }]);
      } else {
        // Dihentikan sebelum ada token: jangan tinggalkan balasan kosong di riwayat.
        messages = messages.filter((message) => message.id !== assistantMessage.id);
      }
    }
  }

  function stopStream() { abortController?.abort(); }

  function resetChat() {
    abortController?.abort();
    openRequest += 1;
    streaming = false;
    messages = [];
    activeConversationId = '';
    activeContext = null;
    hasOlder = false;
    loadingConversation = false;
    conversationError = '';
    showJump = false;
    firstTokenMs = 0;
    outputTokens = 0;
    throughput = [0, 0, 0, 0, 0, 0, 0, 0];
    prompt = '';
    void discardPendingAttachment();
    sidebarOpen = false;
    tick().then(() => textarea?.focus());
  }

  async function openConversation(item: ConversationSummary) {
    if (streaming) return;
    sidebarOpen = false;
    if (item.id === activeConversationId && !conversationError) return jumpToBottom();
    const request = ++openRequest;
    activeConversationId = item.id;
    activeContext = null;
    model = models.some((entry) => entry.value === item.model) ? item.model : DEFAULT_CHAT_MODEL;
    messages = [];
    hasOlder = false;
    conversationError = '';
    loadingConversation = true;
    pinnedToBottom = true;
    showJump = false;
    void discardPendingAttachment();
    firstTokenMs = 0;
    outputTokens = 0;
    throughput = [0, 0, 0, 0, 0, 0, 0, 0];
    try {
      // Hanya halaman terakhir yang dimuat; pesan lama menyusul saat pengguna scroll ke atas.
      const page = await fetchMessagePage(item.id);
      if (!page || request !== openRequest) return;
      messages = page.messages;
      hasOlder = page.hasMore;
      activeContext = page.conversation.context || null;
    } catch {
      if (request === openRequest) conversationError = 'Percakapan gagal dimuat. Pilih lagi untuk mencoba ulang.';
    } finally {
      if (request === openRequest) loadingConversation = false;
    }
    if (request !== openRequest) return;
    await jumpToBottom();
    // Isi lebih pendek dari layar: langsung isi dengan pesan sebelumnya.
    if (conversation && conversation.scrollHeight <= conversation.clientHeight + 320) void loadOlder();
  }

  async function removeConversation(event: MouseEvent, id: string) {
    event.stopPropagation();
    if (streaming && id === activeConversationId) return;
    try {
      const response = await fetch(`/api/history?id=${encodeURIComponent(id)}`, { method: 'DELETE' });
      if (!response.ok) return;
      if (conversations.some((item) => item.id === id)) historyTotal = Math.max(0, historyTotal - 1);
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
      <div class="history-heading"><p class="eyebrow">Riwayat</p>{#if !sidebarCollapsed}<span>{historyTotal}</span>{/if}</div>
      <div class="history-list" onscroll={handleHistoryScroll}>
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
          {#if historyNextOffset !== null}
            <button class="history-more" onclick={() => loadHistory(true)} disabled={historyLoadingMore}>
              {#if historyLoadingMore}<LoaderCircle size={14} /><span>Memuat…</span>{:else}<ChevronDown size={14} /><span>Muat lebih banyak</span>{/if}
            </button>
          {/if}
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
        <button class="icon-button mobile-new" onclick={resetChat} aria-label="Percakapan baru" title="Percakapan baru"><SquarePen size={19} /></button>
      </div>
    </header>

    <div class="workspace" style:--composer-space={`${composerHeight}px`}>
      {#if !activeConversationId && messages.length === 0}
        <section class="empty-state">
          <div class="hero"><div class="hero-icon"><Sparkles size={26} /></div><p class="overline">SOLAR CHAT · PRIVATE AI WORKSPACE</p><h1>Mulai dengan sebuah <em>ide.</em></h1><p class="hero-copy">Tanyakan apa saja. Percakapan tersimpan dan konteksnya tetap terjaga.</p></div>
          <div class="starter-grid">{#each starters as starter, index}<button class="starter-card" onclick={() => setStarter(starter.body)}><span class="starter-index">0{index + 1}</span><strong>{starter.title}</strong><span>{starter.body}</span><ArrowUp size={17} /></button>{/each}</div>
        </section>
      {:else}
        <section class="conversation" bind:this={conversation} onscroll={handleConversationScroll} aria-live="polite" aria-busy={loadingConversation || loadingOlder}>
          <div class="conversation-inner" bind:this={conversationInner}>
            {#if hasOlder}
              <div class="older-status">{#if loadingOlder}<LoaderCircle size={14} /><span>Memuat pesan sebelumnya…</span>{:else}<button onclick={loadOlder}>Muat pesan sebelumnya</button>{/if}</div>
            {/if}
            {#if loadingConversation}
              <div class="conversation-skeleton" aria-label="Memuat percakapan">{#each [0, 1, 2] as row}<div class:assistant={row % 2 === 1}><i></i><span></span><span></span></div>{/each}</div>
            {:else if conversationError}
              <div class="conversation-error">{conversationError}</div>
            {/if}
            {#each messages as message (message.id)}
              <article class:assistant={message.role === 'assistant'} class="message">
                <div class="message-avatar">{#if message.role === 'assistant'}<Zap size={16} />{:else}<User size={16} />{/if}</div>
                <div class="message-body">
                  <div class="message-heading"><strong>{message.role === 'assistant' ? 'SOLAR' : 'Anda'}</strong>{#if message.role === 'assistant' && message.content && (!streaming || message !== messages[messages.length - 1])}<button onclick={() => copyMessage(message)} aria-label="Salin jawaban">{#if copiedId === message.id}<Check size={14} />{:else}<Copy size={14} />{/if}</button>{/if}</div>
                  {#if message.attachments?.length}
                    <div class="message-attachments">
                      {#each message.attachments as attachment}
                        <button type="button" onclick={() => openImage(attachment.url, attachment.name, attachment.name)} aria-label={`Perbesar ${attachment.name}`}><img src={attachment.url} alt={attachment.name} loading="lazy" decoding="async" /></button>
                      {/each}
                    </div>
                  {/if}
                  {#if message.content}
                    {#if message.role === 'assistant'}<Markdown content={message.content} streaming={streaming && message === messages[messages.length - 1]} />{:else}<p>{message.content}</p>{/if}
                    {#if message.role === 'assistant' && streaming && message === messages[messages.length - 1]}<span class="cursor"></span>{/if}
                  {:else}<div class="thinking"><i></i><i></i><i></i><span>{thinkingLabel}</span></div>{/if}
                </div>
              </article>
            {/each}
          </div>
        </section>
        {#if showJump}
          <button class="jump-button" style:bottom={`${composerHeight + 10}px`} onclick={() => jumpToBottom('smooth')} aria-label="Ke pesan terbaru"><ArrowDown size={17} /></button>
        {/if}
      {/if}

      <div class="composer-area" bind:clientHeight={composerHeight}>
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

<ImageViewer />
