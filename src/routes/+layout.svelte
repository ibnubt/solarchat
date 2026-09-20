<script lang="ts">
  import '../styles.css';
  let { children } = $props();
</script>

<svelte:head>
  <title>SOLAR Chat — Private AI Workspace</title>
  <meta
    name="description"
    content="SOLAR Chat adalah ruang kerja AI privat dengan streaming real-time, riwayat, dan konteks percakapan."
  />
</svelte:head>

{@render children()}
