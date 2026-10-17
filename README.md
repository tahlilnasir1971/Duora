# Duora

An Android-first Expo app for a private chat between two people.

## What is in this first milestone

- Email and password sign-up/sign-in through Supabase Auth.
- Create a private chat and invite one other account with a single-use code.
- Persistent one-to-one messages with timestamps and Supabase Realtime updates.
- PostgreSQL Row Level Security so only the two chat members can read or send messages.
- An invite token is shown once and only its SHA-256 hash is stored in the database.

This milestone intentionally contains only chat. Personal agents, schedules, push notifications, and encryption beyond Supabase's standard transport/storage protections are not implemented.

## Setup

1. Create a Supabase project.
2. In the Supabase SQL editor, run [`supabase/migrations/202610170001_chat.sql`](supabase/migrations/202610170001_chat.sql).
3. Copy `.env.example` to `.env` and enter the project's URL and publishable key. These client values are not privileged server secrets; never put a service-role key in the app.
4. Install packages with `pnpm install`.
5. Start the development server with `pnpm start`, then open it in Expo Go on an Android phone or press `a` for an Android emulator.
6. Create two accounts on separate devices. On one, create the chat and share the invite code privately. On the other, enter the code to join.

If email confirmation is enabled in Supabase, confirm each account from its email before signing in.

## Current limitations

- Each account can join one chat in this initial version.
- The app loads the latest 100 messages; older-message pagination is a follow-up.
- There are no push notifications or delivery/read receipts.
- Real two-device messaging requires a Supabase project and the migration above; the app does not simulate a backend.
