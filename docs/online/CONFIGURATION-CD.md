# Configuration deployment (#261)

Configuration becomes a checked prerequisite of a gateway release. The existing GitHub workload identity
authenticates a deployment; no personal token or downloadable service-account key is required.

The repository owns Firestore rules, indexes and TTL policies for the isolated `fuse-riders` database, plus
the game's Firebase Auth domains/provider flags and the restrictions on its existing public web API key.
The default Datastore database and other project API keys are outside this deployment's scope.

The deployment first reads configuration and prints a plan containing only managed fields. It deploys the
named database with the pinned Firebase CLI, applies Auth/key changes with narrow API update masks, then
waits for required indexes/TTL policies and verifies the released rules and Auth/key configuration. A failed
verification prevents the gateway rollout. Existing OAuth client secrets are neither read nor rewritten.

Changing an OAuth web client's registered redirect URIs still needs a one-time console operation by any
authorized team member: Google exposes no supported API for the existing auto-created web client. The
deployment verifies the current redirect before making changes, so a missing registration fails with an
actionable message rather than deploying broken sign-in. Creating a new project/web app is bootstrap,
not an application release; the committed resource IDs must match the existing resources.

Rules deployment is scoped to the named database. Index deletion is not forced: unlisted existing
indexes are retained, and deletion needs a separately reviewed maintenance operation. Rollback uses an explicitly reviewed
configuration revision; reverting application code must keep required indexes and compatible Auth domains.
New fields and indexes should precede dependent code; remove obsolete configuration in a later change.

## Team workflow

Edit `firestore.rules`, `firestore.indexes.json` or `deploy/firebase-config.json` in a pull request. Run:

```sh
npm ci
npm run config:check
npm run config:plan -- --account YOUR_AUTHORIZED_GOOGLE_ACCOUNT
```

The check is offline; the plan reads the real project and checks the Google redirect without signing anyone in.
It prints only drift categories and resource identifiers. It never prints OAuth secrets or password hash configuration.
After merge and successful main CI, `backend.yml` installs the pinned CLI (`npm ci --prefix tools/firebase`),
authenticates through the existing main-only workload identity, and runs `scripts/deploy-cloud.sh`.
Configuration is verified before the image build and gateway update. The release artifacts contain the source SHA,
configuration digest and verification timestamp. They are evidence of configuration readiness, not proof of a completed browser login.

## One-time IAM bootstrap

An authorized project IAM administrator runs the reviewed bootstrap once:

```sh
BOOTSTRAP_ACCOUNT=YOUR_AUTHORIZED_GOOGLE_ACCOUNT bash scripts/bootstrap-configuration-cd.sh
```

It grants the existing `fuse-riders-deployer` a custom role from `deploy/configuration-role.yaml`.
There are no new secrets, downloaded keys, runtime grants or enabled services. The role has configuration permissions,
not Firestore document access, IAM administration, database creation/deletion or index deletion. Auth configuration
is project-wide; this project's Auth is shared, so domain/provider edits need review. The script pins the game's database,
web app and API key; those checks are application safeguards, not an IAM boundary for every configuration API.

Changing the existing OAuth client's registered redirect is a separate console bootstrap step:
open Google Cloud Console → APIs & Services → Credentials in `andershaf-87`, select the client identified in
`deploy/firebase-config.json`, and register `https://AUTH_DOMAIN/__/auth/handler`. Keep the old redirect while old clients
remain supported. Any team member with permission to edit that client can do this; Anders need not operate CD.

## Failures and rollback

A permission error names the endpoint and stops the release. Check the role definition and explicit project;
never solve this by uploading an owner's credential. Missing resources or mismatched app/key/client IDs require
bootstrap review rather than automatic resource creation. An API key restriction conflict needs review of actual usage;
CD does not override Google's usage safety check.

Index/TTL readiness is polled for up to ten minutes after applying configuration. Large changes may need longer;
let the existing operation finish and rerun the backend workflow at the current main revision. No gateway is rolled out
when readiness times out. Partial configuration changes can remain after failure, so keep schema changes compatible
with the currently running gateway. Firestore document migrations/backfills are not implemented by this workflow.

A queued old revision cannot overwrite newer configuration: if it needs a change and is behind main, it stops.
Use a reviewed revert on current main to roll configuration back. An application traffic rollback does not revert
rules, TTLs or indexes, and deleting data through TTL cannot be undone by reverting configuration.

## Verification on 2026-09-17

The custom role and binding were installed successfully for the existing deployer using the authorized bootstrap
account. The read-only production plan verified the database, current rules, ready history index, active TTLs,
Auth settings, web-key restrictions and accepted Google redirect, with no drift. Local release checks and seven
configuration regressions passed. The first GitHub workload-identity configuration deployment and an authenticated
browser history flow remain post-merge verification; the read-only plan does not claim those succeeded.
