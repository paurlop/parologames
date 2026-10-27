# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Stack

delegated: Node.js 24 + TypeScript-free modern JavaScript (ESM), Express 5, SQLite through the built-in `node:sqlite` module, server-rendered HTML with a small vanilla JS layer, Docker for deployment. Chosen because a single-owner publishing site needs no SPA framework or separate database server, and fewer moving parts means fewer dependencies to audit and fewer things that can fall over. Deploy target is undecided; the app ships as a Docker image meant to sit behind Cloudflare (or another CDN/WAF).

## Users

- **Owner (Pau):** the only person who publishes. Uploads, edits, hides and removes games from a private admin panel.
- **Players:** the anonymous public. They browse the catalogue, play games directly in the browser and can download them. No player accounts.

## Product Purpose

parologames is Pau's own place on the web to publish the games they make. Success: a visitor lands, finds a game, and is playing it within seconds; anyone can also download the game to keep it. The site must stay online and uncompromised when it gets attention, including hostile attention.

## Positioning

A personal games label, not a marketplace: one creator's catalogue, curated by that creator, with no third-party uploads, ads or accounts between the player and the game.

## Operating Context

- Games are HTML5 builds (Unity WebGL, Godot, Phaser, plain JS…) uploaded as a ZIP with an `index.html`.
- Each game is playable in the page and downloadable (the web build ZIP, or an optional separate download ZIP such as a desktop build).
- Owner works from a desktop browser; players arrive from shared links, often on phones.

## Capabilities and Constraints

- Single admin account protected by password + TOTP 2FA.
- Uploaded game code is untrusted and must run isolated from the main site.
- Downloads limited to ZIP archives (no raw executables) — confirmed as a safety default, can be revisited.
- Undecided: hosting provider, domain, analytics.

## Brand Commitments

- Name: **parologames** (written as one lowercase word).

## Evidence on Hand

No games, screenshots, logos or testimonials exist yet. The empty catalogue state is the first thing the owner will see; nothing should be fabricated to fill it beyond clearly-labelled demo content the owner can delete.

## Product Principles

1. The game is the hero; the site gets out of the way.
2. Playing must be one click from any link.
3. Security and uptime are features, not afterthoughts — but never at the cost of a confusing experience.
4. Only the owner publishes; everything the public touches is read-only.

## Accessibility & Inclusion

WCAG 2.2 AA for the site chrome (navigation, catalogue, admin). Games themselves are the owner's responsibility.
