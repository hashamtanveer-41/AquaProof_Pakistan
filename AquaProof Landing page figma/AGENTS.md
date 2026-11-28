# figma-make-app

React + Vite + Tailwind CSS project running inside Figma Make.

## Development Server

A Vite development server is **already running** on `$PORT` (default 8443). You don't need to start it manually.

- Preview URL: The user can access the running app through the preview panel
- Hot reload: Changes to source files are reflected immediately

## Project Structure

This is the canonical project structure. Start with task-relevant files below. Only follow imports or inspect other files when required, when a documented path is missing, or when the repository contradicts this guide.

- `src/main.tsx` - React entrypoint; imports `src/index.css` and mounts `src/App.tsx` into the `#root` element
- `src/App.tsx` - Primary application component and the usual starting point for UI work
- `src/index.css` - Global CSS entrypoint and Tailwind CSS v4 import
- `index.html` - Vite HTML shell containing the `#root` element and loading `src/main.tsx`
- `package.json` - Project dependencies and the Vite build, development, preview, and formatting scripts
- `vite.config.ts` - Vite configuration with React, Tailwind CSS v4, and Figma Make plugins plus the `@` alias for `src`
- `.mise.toml` - Toolchain versions for Node.js and pnpm

## Dependencies

- Runtime: React 19 and React DOM 19
- Styling: Tailwind CSS v4 with the `@tailwindcss/vite` plugin
- Build tooling: Vite 8, TypeScript 5.7, and `@vitejs/plugin-react`
- Formatting: oxfmt

## Styling

This project uses **Tailwind CSS v4** through the `@tailwindcss/vite` plugin configured in `vite.config.ts`. `src/index.css` imports Tailwind with `@import 'tailwindcss';`. Use Tailwind utility classes directly in JSX and put global CSS or Tailwind v4 theme customization in `src/index.css`. This scaffold does not need a Tailwind config file or PostCSS config.

`src/main.tsx` imports `src/index.css`, so global font wiring belongs in `src/index.css`. Keep CSS `@import` statements first, then add any `@font-face` rules and font-family defaults there.

Tailwind emits utility classes in `@layer utilities`, and CSS outside any cascade layer overrides every layer regardless of specificity. Put global element styles, such as resets and defaults for `body`, headings, `button`, or `input`, inside `@layer base { ... }` so utility classes on those elements still apply. Tailwind's Preflight already applies `box-sizing: border-box`, removes default margins, and sets `font: inherit` on form controls, so do not repeat those rules.

## AquaProof story page

The landing page is a scroll-driven, low-poly 3D story ("One wheat field. Two decisions before the rain."), built with three.js and no video or photo assets. A fixed full-screen stage sits over a tall scroll track. Each chapter is a camera shot, labels are pinned to things in the scene, and the project section scrolls up over the stage at the end.

- `src/story/config.ts`: demo, contact and GitHub links, sample data labels, the two officer-approved SMS-style advisories (Urdu and English), and the farmer's Roman Urdu reply with its parsed fields. Set `DEMO_URL` to the prototype's address; while it is `null`, every "Explore the live demo" button goes to the `#demo` section, which says the link is coming. `CONTACT_URL` (a `mailto:` or web link) shows a contact link when set.
- `src/story/timeline.ts`: chapter windows on the 0–1 scroll progress, with `film` mapping each chapter onto the 3D film's own timing (`toFilm`). It also holds the field and pump-house coordinates, and the pinned labels with their sources (officer record, weather forecast sample, AquaProof estimate), timed in film time.
- `src/story/world.ts`: the procedural scene (field, canal, path, pump house, trees, village, farmer, sky and storm), the camera keyframes (`KEYS`), light and weather (`ENV`), and the green-to-gold season change. It is lazy-loaded, so text paints before three.js arrives.
- `src/story/Journey.tsx`: one-line chapter captions and the in-story product panels (Farm Map, Irrigation Intelligence, AI Advisory Center, styled after the officer dashboard), the render loop, route navigation, "Play the story", and "Read as text" (a plain reading mode, also used automatically if WebGL is unavailable).
- `src/App.tsx`: mounts the story and the project section (how it works, what works today versus in progress, stack, team, demo and repo links). Keep it in step with the AquaProof repository README.

Accessibility and performance: with `prefers-reduced-motion`, the camera holds one shot per chapter instead of travelling between them, and wind, drift and the intro move are turned off. The loop lowers resolution and then turns off shadows on slow devices, and stops rendering once the project section covers the stage.

Run locally with `pnpm install` and `pnpm dev`. To deploy, publish from Figma Make, or run `.figma/make/deploy`, which runs `pnpm run build` and `figma make deploy --build-dir dist`. It is a static site.
