# infra-ui

[![npm version](https://img.shields.io/npm/v/@drprime/infra-ui)](https://www.npmjs.com/package/@drprime/infra-ui)
[![license](https://img.shields.io/npm/l/@drprime/infra-ui)](LICENSE)

A CLI that scaffolds production-ready backend infrastructure into your Next.js app — payments, auth, email, and communications — as real files you own, not dependencies you can't touch.

```bash
npx @drprime/infra-ui init
npx @drprime/infra-ui add stripe
```

---

## What it does

`infra-ui` reads your project (package manager, ORM, router mode) and writes a fully-typed `infra/` directory with working code for the component you choose. No wrappers, no magic — just files dropped into your project that you can read, edit, and understand.

**What you get per component:**

- Server utilities and typed helpers
- Next.js API route handlers (App Router or Pages Router)
- Webhook handlers with correct signature verification and retry semantics
- ORM adapters (Prisma, Drizzle, or a manual placeholder)
- Environment variables appended to `.env.local`
- An `infra.lock.json` tracking installed files and deps

---

## Requirements

- Next.js 13+
- Node.js 18+
- A project with a `package.json`

---

## Installation

```bash
# Run directly with npx (no install required)
npx @drprime/infra-ui init

# Or install globally
npm install -g @drprime/infra-ui
infra-ui init
```

---

## Commands

### `infra-ui init`

Scans your project and writes `infra.json` — the config file that `add` reads to generate the right code for your setup.

```bash
npx @drprime/infra-ui init
```

It detects:
- **Package manager** — npm, pnpm, yarn, bun
- **ORM** — Prisma, Drizzle, or none
- **Router mode** — App Router or Pages Router
- **Base path** — where your app source lives (e.g. `src/` or `.`)

The resulting `infra.json` looks like:

```json
{
  "packageManager": "npm",
  "orm": "prisma",
  "basePath": ".",
  "isAppRouter": true
}
```

Commit this file. It's the source of truth for all future `add` commands.

---

### `infra-ui add <component>`

Fetches a component from the registry and writes it into your project.

```bash
npx @drprime/infra-ui add stripe
npx @drprime/infra-ui add resend
npx @drprime/infra-ui add twilio
npx @drprime/infra-ui add authjs
npx @drprime/infra-ui add clerk
npx @drprime/infra-ui add paystack
```

The CLI will:
1. Prompt for any required API keys/secrets
2. Write files to `infra/<component>/` (and API routes to `app/api/` or `pages/api/`)
3. Install npm dependencies
4. Append env vars to `.env.local`
5. Update `infra.lock.json`

If a component is already installed, you'll be asked before anything is overwritten.

---

## Components

### Payments

#### `stripe`

Subscription billing via Stripe Checkout, plus a webhook handler for lifecycle events.

**Generated files:**

| File | Description |
|------|-------------|
| `infra/stripe/client.ts` | Stripe SDK singleton with env guard |
| `infra/stripe/actions.ts` | `createCheckoutSession()` and `createBillingPortalSession()` server actions |
| `infra/stripe/webhooks.ts` | `handleStripeEvent()` with `subscriptionIdOf()` helper |
| `infra/stripe/adapter.ts` | ORM-specific `upsertSubscription()` |
| `app/api/webhooks/stripe/route.ts` | Webhook endpoint with raw-body signature verification |

**Env vars written:**

```
STRIPE_SECRET_KEY=
STRIPE_WEBHOOK_SECRET=
NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY=
NEXT_PUBLIC_APP_URL=
```

**ORM adapters:** Prisma, Drizzle, manual placeholder

---

#### `paystack`

Paystack payments via Inline.js popup — amount set server-side, popup opened client-side with an `access_code`.

**Generated files:**

| File | Description |
|------|-------------|
| `infra/paystack/client.ts` | `paystackRequest()` fetch helper with secret-key guard |
| `infra/paystack/actions.ts` | `initializeTransaction()` and `verifyTransaction()` server actions |
| `infra/paystack/webhooks.ts` | HMAC-SHA512 verification + `handlePaystackEvent()` |
| `infra/paystack/checkout.tsx` | `<PaystackCheckoutButton>` client component |
| `infra/paystack/adapter.ts` | ORM-specific `recordPayment()` with idempotent upsert |
| `app/api/webhooks/paystack/route.ts` | Webhook endpoint |

**Env vars written:**

```
PAYSTACK_SECRET_KEY=
NEXT_PUBLIC_PAYSTACK_PUBLIC_KEY=
```

**Amount note:** amounts are in the smallest currency unit (kobo for NGN). Multiply by 100.

**ORM adapters:** Prisma, Drizzle, manual placeholder

---

### Auth

#### `authjs`

Auth.js v5 (NextAuth beta) with session callback, ORM adapter, and middleware.

**Generated files:**

| File | Description |
|------|-------------|
| `auth.ts` | NextAuth config with session callback and adapter |
| `infra/auth/adapter.ts` | ORM-specific adapter (`PrismaAdapter` / `DrizzleAdapter` / placeholder) |
| `app/api/auth/[...nextauth]/route.ts` | Route handler |
| `middleware.ts` | Auth middleware (written only if no existing middleware is detected) |

**Env vars written:**

```
AUTH_SECRET=          # auto-generated base64url secret
AUTH_GITHUB_ID=
AUTH_GITHUB_SECRET=
```

**Providers:** GitHub is scaffolded by default. Add others by editing `auth.ts`.

**ORM adapters:** Prisma (`@auth/prisma-adapter`), Drizzle (`@auth/drizzle-adapter`), manual placeholder

---

#### `clerk`

Clerk authentication with sign-in/sign-up pages, middleware, and webhook handler for user sync.

**Generated files (App Router):**

| File | Description |
|------|-------------|
| `app/(auth)/sign-in/[[...sign-in]]/page.tsx` | Sign-in page |
| `app/(auth)/sign-up/[[...sign-up]]/page.tsx` | Sign-up page |
| `middleware.ts` | `clerkMiddleware()` (non-destructive — writes sidecar if middleware exists) |
| `app/api/webhooks/clerk/route.ts` | Svix webhook with user sync |
| `infra/clerk/adapter.ts` | ORM-specific user upsert on `user.created` / `user.updated` |

**Env vars written:**

```
NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY=
CLERK_SECRET_KEY=
CLERK_WEBHOOK_SECRET=
NEXT_PUBLIC_CLERK_SIGN_IN_URL=/sign-in
NEXT_PUBLIC_CLERK_SIGN_UP_URL=/sign-up
```

**ORM adapters:** Prisma, Drizzle, manual placeholder

**Pages Router:** also supported — uses `micro` for raw-body parsing.

---

### Email

#### `resend`

Transactional email via Resend with a typed `sendEmail` server action.

**Generated files:**

| File | Description |
|------|-------------|
| `infra/resend/client.ts` | Resend client singleton |
| `infra/resend/actions.ts` | `sendEmail()` server action |
| `infra/resend/templates/welcome.tsx` | Example React Email template |

**Env vars written:**

```
RESEND_API_KEY=
RESEND_FROM_EMAIL=
```

---

### Communications

#### `twilio`

Twilio Programmable SMS, outbound voice calls, and Verify (2FA OTP).

**Generated files:**

| File | Description |
|------|-------------|
| `infra/twilio/client.ts` | Twilio client singleton with env guards |
| `infra/twilio/sms.ts` | `sendSms()` server action |
| `infra/twilio/voice.ts` | `makeCall()` server action |
| `infra/twilio/verify.ts` | `sendVerificationCode()` + `checkVerificationCode()` |
| `infra/twilio/webhook-url.ts` | Proxy-aware URL reconstruction for signature validation |
| `app/api/webhooks/twilio/sms/route.ts` | Incoming SMS webhook with TwiML reply |
| `app/api/webhooks/twilio/voice/route.ts` | Incoming voice webhook with TwiML response |

**Env vars written:**

```
TWILIO_ACCOUNT_SID=
TWILIO_AUTH_TOKEN=
TWILIO_PHONE_NUMBER=
TWILIO_VERIFY_SERVICE_SID=
TWILIO_WEBHOOK_BASE_URL=
```

**Proxy note:** if your app runs behind a reverse proxy (Vercel, Cloudflare, ngrok), set `TWILIO_WEBHOOK_BASE_URL` to your public URL so Twilio signature validation works correctly.

---

## ORM Adapter Support

When you run `infra-ui add`, the CLI reads the `orm` field from `infra.json` and writes an adapter to `infra/<component>/adapter.ts` matching your ORM:

| `orm` value | What's generated |
|-------------|-----------------|
| `prisma` | Prisma Client queries |
| `drizzle-orm` | Drizzle queries with `onConflictDoUpdate` |
| `manual` | Placeholder with `// TODO` comments |

Switch adapters at any time by re-running `infra-ui add <component>` and choosing to overwrite.

---

## App Router vs Pages Router

The CLI detects `isAppRouter` from `infra.json` and writes route handlers to the right place:

| Mode | API routes written to |
|------|-----------------------|
| App Router | `app/api/...` |
| Pages Router | `pages/api/...` |

Some components (Clerk, Auth.js) also adjust their middleware strategy based on the Next.js version detected.

---

## Lock File

Every `add` run updates `infra.lock.json` with:

```json
{
  "stripe": {
    "files": ["infra/stripe/client.ts", "..."],
    "deps": ["stripe"],
    "installedAt": "2026-05-24T12:00:00.000Z"
  }
}
```

This lets the CLI detect already-installed components and prompt before overwriting. Commit this file alongside `infra.json`.

---

## Registry Override

By default, component templates are fetched from:

```
https://raw.githubusercontent.com/DrPrime01/test-infra-monorepo/refs/heads/main/packages/registry/<component>.json
```

To pin to a different source (private fork, local dev server):

```bash
INFRA_REGISTRY_BASE=http://localhost:3001 npx @drprime/infra-ui add stripe
```

---

## Security

- All secrets are collected via masked password prompts — never echoed to the terminal
- Webhook handlers return `400` for missing/invalid signatures (no retry) and `500` for handler errors (retryable by the provider)
- Path traversal and symlink escape protection on all file writes
- Paystack webhook uses `crypto.timingSafeEqual` to prevent timing attacks
- Twilio webhook reconstructs the public URL correctly behind proxies before validating the signature

---

## Contributing

This is a monorepo with two packages:

```
packages/
  cli/        — the @drprime/infra-ui CLI (TypeScript, commander, @clack/prompts)
  registry/   — JSON component templates fetched at runtime
apps/
  test-infra-ui/  — Next.js test app
```

To build the CLI locally:

```bash
cd packages/cli
npm run build
```

To test an add command against the local registry:

```bash
INFRA_REGISTRY_BASE=file://$(pwd)/packages/registry node packages/cli/dist/index.js add stripe
```

---

## License

MIT
