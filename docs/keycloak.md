# Keycloak

stac-x signs people in against the FFRD realm, the same one FFRD Cloud uses:
`https://auth.dewberryanalytics.com/auth/realms/ffrd`. Nobody hosts a
Keycloak for this app; it needs a client in that realm and five environment
variables.

## The client

In the admin console (`/auth/admin/ffrd/console/`), Clients, then Create client:

| Setting | Value |
| --- | --- |
| Client type | OpenID Connect |
| Client ID | `stac-x` |
| Name | STAC |
| Client authentication | On (confidential) |
| Authentication flow | Standard flow only. Direct access grants, implicit flow and service accounts off |
| PKCE method (Advanced tab) | S256 |
| Root URL | `https://ffrd.cloud.dewberryanalytics.com/stac` |
| Home URL | `https://ffrd.cloud.dewberryanalytics.com/stac/` |
| Valid redirect URIs | `https://ffrd.cloud.dewberryanalytics.com/stac/*` |
| Valid post logout redirect URIs | `https://ffrd.cloud.dewberryanalytics.com/stac/*` |
| Web origins | `+` |
| Front channel logout | Off |
| Backchannel logout URL | `https://ffrd.cloud.dewberryanalytics.com/stac/api/auth/backchannel-logout` |
| Backchannel logout session required | On |

Then copy the secret from the Credentials tab.

For local work, make a second client the way the realm already does for
FFRD Cloud (`ffrd-model-viewer-local`): `stac-x-local`, the same settings
with `http://localhost:3000/*` for the redirect URIs and no back-channel
URL, since Keycloak can't reach a laptop.

## Reviewers

To limit who can use Admin and save QC (which also promotes collections),
create a role and set `STAC_REVIEWER_ROLE` to its name. Either kind works:

- a client role on `stac-x` (Clients, stac-x, Roles), which keeps it out of
  the other FFRD apps, or
- a realm role, if one already means the right people.

Assign it to users or to a group. The role is read when someone signs in,
so a person given it has to sign out and back in. Leave `STAC_REVIEWER_ROLE`
unset and everyone who can sign in can review.

## The app's environment

```bash
KEYCLOAK_ISSUER=https://auth.dewberryanalytics.com/auth/realms/ffrd
KEYCLOAK_CLIENT_ID=stac-x
KEYCLOAK_CLIENT_SECRET=<from the Credentials tab>
AUTH_SECRET=<a long random string, different per deployment>
AUTH_URL=https://ffrd.cloud.dewberryanalytics.com
#STAC_REVIEWER_ROLE=stac-reviewer
```

`AUTH_URL` is the origin alone, with no `/stac`. The base path is baked into
the image (`NEXT_PUBLIC_BASE_PATH`), and Auth.js's routes sit under it at
`/stac/api/auth`. These are all read at run time, so turning sign-in on is a
change to the server's `.env` and a container restart, with no rebuild.

## What happens

- Opening any page without a session goes straight to Keycloak and back. Someone
  already signed in to another FFRD app doesn't see a sign-in page at all.
- API routes, the asset and preview proxies and server actions answer 401
  without a session. `/api/health` stays open for the Docker health check.
- A session lasts as long as Keycloak's does (see below). Sign out ends the
  Keycloak session too.
- When the Keycloak session ends anywhere else, Keycloak calls the
  back-channel URL and the session here ends on its next request.
- Each QC save records the username in the sidecar (`by`), and Admin's
  activity shows it. Records saved before sign-in have none.

## One sign-in with FFRD Cloud

FFRD Cloud (`ffrd-model-viewer`) is a client in the same realm, so the two
apps share Keycloak's session. How far that goes depends on realm settings
as much as on this app. As read from the admin console on 2026-11-16:

| Setting | Value |
| --- | --- |
| SSO Session Idle | 30 minutes |
| SSO Session Max | 10 hours |
| Access Token Lifespan | 5 days, and `ffrd-model-viewer` inherits it |
| `ffrd-model-viewer` back-channel logout URL | none |

This app checks in with Keycloak every five minutes while it's in use
(`src/keycloak-session.ts`): it trades its refresh token for a new one,
which counts as activity there, and ends its own session when Keycloak
won't take the token. What that means:

- Signed in to one app, opening the other needs no password while
  Keycloak's session is alive. Working here keeps it alive. FFRD Cloud
  doesn't, so after 30 minutes spent only there, this app asks for the
  password again.
- Signing out of FFRD Cloud signs you out here on your next request,
  through the back-channel URL above. If Keycloak's session had already
  ended, the next check notices instead, within five minutes.
- Leave this app idle past the realm's 30 minutes and the next page asks
  you to sign in again. No session here lasts past the realm's 10 hours.
- Signing out here ends Keycloak's session, but FFRD Cloud isn't told. It
  only goes back to Keycloak when its access token expires, which is five
  days, so it stays signed in until then. Setting Access Token Lifespan to
  a few minutes on the `ffrd-model-viewer` client (Advanced tab) would
  close that: it already refreshes on expiry and signs out when the refresh
  fails.

If Keycloak is down or answers with a server error, the check is skipped
and sessions here carry on.
