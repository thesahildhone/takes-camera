# Delivery Room — source

React + TypeScript + Vite. Backend: Supabase project delivery-room (ref qchxfwoaaoslipwkdqep).

Build: npm install && npm run build, then copy dist/ into /app of this repo (live at https://thesahildhone.github.io/takes-camera/app/).

Test build: emails auto-confirmed (no email provider yet).

## Socials (added 13 Nov 2026)
Spec: social_media_workflow_spec_v3 (Socials only; OF flow untouched).

- Tables: social_content_types, social_sections, social_projects, social_assignments, social_submissions (versioned, never overwritten). RLS isolates agencies; creators only see published projects assigned to them while their membership is active.
- Storage bucket `social` (private): `{ws}/ref/{project}/…` agency references; `{ws}/sub/{project}/{creator}/{submissionId}-clean|mix.ext` creator videos. Rules in social_can_read / social_can_write.
- RPCs: social_bootstrap, social_publish, social_assign, social_unassign, social_start, social_submit (idempotent by client id), social_review.
- Edge function `social-import`: downloads direct video-file links only. Instagram/TikTok/YouTube are never scraped; they get the official embed plus "upload a copy you have permission to use".
- Transcripts run in the agency's browser (Whisper base via transformers.js, lib/whisper.worker.ts); the model downloads from huggingface.co the first time. Always needs agency approval before creators see it.
- Sound: extracted in the browser to WAV. Music version is only made and accepted when rights_status = licensed.
- Creator camera (components/SocialCamera.tsx): multi-clip, per-clip redo/trim/delete+undo/reorder, still/scroll teleprompter, dance sound cueing with countdown, drafts in IndexedDB. Joining (lib/assemble.ts) re-records clips in real time into clean + optional music copy.
- "Sent" = submitted or approved, used for all counters.
- Tests: e2e/creator_flow.py and e2e/agency_flow.py (Playwright, Supabase mocked; needs `vite preview` on :4173 and e2e/ref.mp4 + ref.wav).
