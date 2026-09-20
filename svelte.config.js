import adapter from '@sveltejs/adapter-node';

/** @type {import('@sveltejs/kit').Config} */
const config = {
  kit: {
    adapter: adapter(),
    csrf: {
      // Nonaktifkan pemeriksaan Origin untuk POST (SvelteKit default terlalu ketat
      // di belakang Cloudflare Tunnel; proteksi tetap ada via httpOnly + sameSite=lax cookie)
      checkOrigin: false
    }
  }
};

export default config;
