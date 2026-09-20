<script lang="ts">
  import { onMount } from 'svelte';
  import { goto } from '$app/navigation';
  import { page } from '$app/state';
  import { gsap } from 'gsap';
  import { ArrowRight, Eye, EyeOff, LockKeyhole, ShieldCheck, UserRound, Zap } from 'lucide-svelte';

  let username = $state('');
  let password = $state('');
  let showPassword = $state(false);
  let loading = $state(false);
  let error = $state('');

  onMount(() => {
    gsap.from('.login-brand, .login-copy > *, .login-card', {
      opacity: 0,
      y: 18,
      duration: 0.65,
      stagger: 0.08,
      ease: 'power3.out'
    });
  });

  async function login(event: SubmitEvent) {
    event.preventDefault();
    if (loading) return;
    loading = true;
    error = '';

    try {
      const response = await fetch('/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username, password })
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || 'Tidak dapat masuk.');
      const returnTo = page.url.searchParams.get('returnTo');
      await goto(returnTo?.startsWith('/') ? returnTo : '/');
    } catch (cause) {
      error = (cause as Error).message;
    } finally {
      loading = false;
    }
  }
</script>

<svelte:head>
  <title>Masuk — SOLAR Chat</title>
  <meta name="description" content="Masuk ke private AI workspace SOLAR Chat." />
</svelte:head>

<main class="login-page">
  <section class="login-intro">
    <a class="login-brand" href="/login" aria-label="SOLAR Chat">
      <span><Zap size={19} strokeWidth={2.6} /></span>
      SOLAR<i> CHAT</i>
    </a>

    <div class="login-copy">
      <p class="login-eyebrow">PRIVATE AI WORKSPACE</p>
      <h1>Ide mengalir.<br /><em>Jawaban tersimpan.</em></h1>
      <p>Ruang kerja AI privat untuk berdiskusi, menyimpan konteks, dan kembali ke percakapan kapan saja.</p>
      <div class="login-benefit"><ShieldCheck size={17} /><span>Sesi aman dengan cookie HTTP-only</span></div>
    </div>

    <p class="login-note">SOLAR Chat · Private AI workspace</p>
  </section>

  <section class="login-panel">
    <form class="login-card" onsubmit={login}>
      <div class="login-icon"><LockKeyhole size={22} /></div>
      <p class="login-kicker">Selamat datang</p>
      <h2>Masuk ke workspace</h2>
      <p class="login-description">Gunakan akun yang telah disiapkan untuk melanjutkan.</p>

      <label>
        <span>Username</span>
        <div class="input-wrap">
          <UserRound size={17} />
          <input bind:value={username} autocomplete="username" placeholder="Masukkan username" required />
        </div>
      </label>

      <label>
        <span>Password</span>
        <div class="input-wrap">
          <LockKeyhole size={17} />
          <input
            bind:value={password}
            type={showPassword ? 'text' : 'password'}
            autocomplete="current-password"
            placeholder="Masukkan password"
            required
          />
          <button type="button" class="password-toggle" onclick={() => (showPassword = !showPassword)} aria-label={showPassword ? 'Sembunyikan password' : 'Tampilkan password'}>
            {#if showPassword}<EyeOff size={17} />{:else}<Eye size={17} />{/if}
          </button>
        </div>
      </label>

      {#if error}<p class="login-error" role="alert">{error}</p>{/if}

      <button class="login-submit" type="submit" disabled={loading || !username || !password}>
        <span>{loading ? 'Memeriksa…' : 'Masuk'}</span>
        <ArrowRight size={18} />
      </button>

      <p class="login-security"><ShieldCheck size={13} /> Kredensial diverifikasi di server.</p>
    </form>
  </section>
</main>

<style>
  .login-page { min-height: 100vh; display: grid; grid-template-columns: minmax(0, 1.08fr) minmax(440px, .92fr); background: #f7f8f3; color: #222720; }
  .login-intro { min-height: 100vh; padding: 42px clamp(36px, 7vw, 110px); display: flex; flex-direction: column; position: relative; overflow: hidden; border-right: 1px solid #dde1d8; background-color: #edf1e7; background-image: linear-gradient(rgba(67,82,58,.045) 1px, transparent 1px), linear-gradient(90deg, rgba(67,82,58,.045) 1px, transparent 1px); background-size: 42px 42px; }
  .login-intro::after { content: ''; position: absolute; width: 390px; height: 390px; right: -140px; bottom: -170px; border: 70px solid rgba(168,220,63,.2); border-radius: 50%; }
  .login-brand { display: flex; align-items: center; gap: 10px; width: fit-content; color: #20241f; text-decoration: none; font-weight: 700; font-size: 20px; letter-spacing: -.04em; }
  .login-brand > span { width: 34px; height: 34px; display: grid; place-items: center; border-radius: 10px; color: #1d280d; background: #a8dc3f; }
  .login-brand i { color: #638f0c; font-style: normal; }
  .login-copy { margin: auto 0; max-width: 620px; position: relative; z-index: 1; }
  .login-eyebrow { margin: 0 0 18px; color: #718065; font-family: 'DM Mono', monospace; font-size: 10px; letter-spacing: .14em; }
  h1 { margin: 0; font-size: clamp(46px, 6vw, 78px); line-height: 1.02; letter-spacing: -.06em; font-weight: 600; }
  h1 em { color: #638f0c; font-family: Georgia, serif; font-weight: 400; }
  .login-copy > p:nth-of-type(2) { max-width: 520px; margin: 26px 0 0; color: #687062; font-size: 15px; line-height: 1.75; }
  .login-benefit { width: fit-content; display: flex; align-items: center; gap: 9px; margin-top: 32px; padding: 10px 13px; border: 1px solid #d1d8c9; border-radius: 10px; background: rgba(255,255,255,.58); color: #58624f; font-size: 11px; }
  .login-benefit :global(svg) { color: #67940e; }
  .login-note { margin: 0; color: #889183; font-family: 'DM Mono', monospace; font-size: 9px; text-transform: uppercase; letter-spacing: .08em; position: relative; z-index: 1; }
  .login-panel { min-height: 100vh; display: grid; place-items: center; padding: 40px; background: #fff; }
  .login-card { width: min(100%, 390px); }
  .login-icon { width: 45px; height: 45px; display: grid; place-items: center; border: 1px solid #dce1d7; border-radius: 13px; color: #608b0c; background: #f1f5e9; }
  .login-kicker { margin: 25px 0 7px; color: #6b950e; font-family: 'DM Mono', monospace; font-size: 9px; letter-spacing: .12em; text-transform: uppercase; }
  h2 { margin: 0; font-size: 28px; letter-spacing: -.045em; }
  .login-description { margin: 9px 0 30px; color: #7a8176; font-size: 12px; line-height: 1.6; }
  label { display: block; margin-top: 17px; }
  label > span { display: block; margin: 0 0 7px; color: #4e554b; font-size: 11px; font-weight: 600; }
  .input-wrap { height: 48px; display: flex; align-items: center; gap: 10px; padding: 0 13px; border: 1px solid #d6dbd1; border-radius: 11px; background: #fafbf8; color: #91988e; transition: border-color .2s, box-shadow .2s, background .2s; }
  .input-wrap:focus-within { border-color: #9aaa8a; background: #fff; box-shadow: 0 0 0 3px rgba(111,159,18,.08); }
  input { min-width: 0; flex: 1; border: 0; outline: 0; background: transparent; color: #222720; font-size: 13px; }
  input::placeholder { color: #a1a79e; }
  .password-toggle { padding: 4px; border: 0; background: transparent; color: #899087; cursor: pointer; }
  .login-error { margin: 13px 0 0; padding: 10px 12px; border: 1px solid #f0cbc7; border-radius: 8px; background: #fff3f1; color: #a54139; font-size: 11px; }
  .login-submit { width: 100%; height: 48px; margin-top: 22px; padding: 0 15px; display: flex; align-items: center; justify-content: space-between; border: 0; border-radius: 11px; background: #222720; color: #fff; font-size: 12px; font-weight: 600; cursor: pointer; transition: transform .18s, opacity .18s; }
  .login-submit:hover:not(:disabled) { transform: translateY(-2px); }
  .login-submit:disabled { opacity: .45; cursor: not-allowed; }
  .login-security { display: flex; align-items: center; justify-content: center; gap: 6px; margin: 14px 0 0; color: #939a90; font-size: 9px; }
  @media (max-width: 840px) {
    .login-page { grid-template-columns: 1fr; }
    .login-intro { min-height: 300px; padding: 28px; }
    .login-copy { margin: 50px 0 34px; }
    h1 { font-size: 43px; }
    .login-copy > p:nth-of-type(2), .login-benefit { display: none; }
    .login-panel { min-height: auto; padding: 48px 24px 70px; }
  }
  @media (max-width: 480px) {
    .login-intro { min-height: 265px; }
    .login-copy { margin: 38px 0 24px; }
    h1 { font-size: 37px; }
    .login-panel { place-items: start center; }
  }
</style>
