// @ts-check
import { defineConfig } from 'astro/config';
import react from '@astrojs/react';

// Static site: built to dist/ and served from Cloudflare Pages.
// React is used only for the interactive diagram island.
export default defineConfig({
  site: 'https://systems.pablomagnaghi.com',
  integrations: [react()],
});
