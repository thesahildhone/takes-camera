# Supabase auth email templates

Paste in Supabase → Authentication → Emails → Templates (project delivery-room).
Each template's body goes in the "Message body" box; replace everything there.

| Template | Subject | File |
|---|---|---|
| Confirm signup | Confirm your SubmitReel email | confirm-signup.html |
| Reset password | Reset your SubmitReel password | reset-password.html |
| Change email address | Confirm your new SubmitReel email | change-email.html |

Keep `{{ .ConfirmationURL }}` exactly as written: it is the link Supabase fills in.
Rollback: Supabase has a "Reset to default" option on each template.
